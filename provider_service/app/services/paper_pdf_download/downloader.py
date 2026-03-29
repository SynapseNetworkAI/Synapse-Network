from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import re
from urllib.parse import quote, urlparse
import xml.etree.ElementTree as ET

import httpx

from app.core.log_config import logger
from app.schemas.paper_pdf_download import PaperPdfDownloadRequest


PAPER_DOWNLOAD_TIMEOUT_S = 30.0
MAX_PDF_SIZE_BYTES = 128 * 1024 * 1024
MIN_VALID_PUBLICATION_YEAR = 1900
ARXIV_ID_PATTERN = re.compile(r"(?P<arxiv_id>(?:\d{4}\.\d{4,5}|[a-z-]+/\d{7})(?:v\d+)?)")
OPENALEX_ID_PATTERN = re.compile(r"(?P<openalex_id>W\d+)", re.IGNORECASE)
DOI_PATTERN = re.compile(r"(?P<doi>10\.\d{4,9}/[-._;()/:A-Z0-9]+)", re.IGNORECASE)
ARXIV_API_URL = "https://export.arxiv.org/api/query"
OPENALEX_API_URL = "https://api.openalex.org/works"
CROSSREF_API_URL = "https://api.crossref.org/works"
# Security boundary: only explicitly reviewed scholarly distribution hosts may serve direct PDF bytes.
# Keep this list exact-match only; no wildcard or suffix matching, so spoofed hosts like
# `arxiv.org.evil.com` are rejected even if they contain a trusted name fragment.
TRUSTED_PDF_HOSTS = {
    "aclanthology.org",
    "arxiv.org",
    "ceur-ws.org",
    "eprint.iacr.org",
    "openreview.net",
    "proceedings.mlr.press",
    "www.aclanthology.org",
}


@dataclass(frozen=True)
class DownloadedPaperPdf:
    source: str
    paper_id: str | None
    source_url: str | None
    file_path: Path
    mime_type: str
    size_bytes: int
    sha256: str
    title: str | None
    authors: list[str]
    year: int | None
    doi: str | None


@dataclass(frozen=True)
class ResolvedPaperLocator:
    source: str
    paper_id: str | None
    source_url: str | None
    pdf_url: str
    title: str | None
    authors: list[str]
    year: int | None
    doi: str | None


def _normalize_whitespace(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(str(value).split())
    return normalized or None


def _normalize_year(value: int | None) -> int | None:
    if value is None:
        return None
    max_year = datetime.now(UTC).year + 1
    if MIN_VALID_PUBLICATION_YEAR <= value <= max_year:
        return value
    return None


def _normalize_https_url(value: str | None) -> str | None:
    if not value:
        return None
    normalized = str(value).strip()
    parsed = urlparse(normalized)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        return None
    if parsed.username or parsed.password:
        return None
    if parsed.port not in (None, 443):
        return None
    return normalized


def _is_trusted_pdf_url(value: str | None) -> bool:
    normalized = _normalize_https_url(value)
    if normalized is None:
        return False
    parsed = urlparse(normalized)
    host = parsed.netloc.lower()
    if host not in TRUSTED_PDF_HOSTS:
        return False
    return parsed.path.lower().endswith(".pdf")


def _select_trusted_pdf_url(*candidates: str | None) -> str | None:
    for candidate in candidates:
        if _is_trusted_pdf_url(candidate):
            return str(candidate).strip()
    return None


def _extract_arxiv_id(payload: PaperPdfDownloadRequest) -> str:
    if payload.paper_id:
        match = ARXIV_ID_PATTERN.search(payload.paper_id)
        if match:
            return match.group("arxiv_id")
    if payload.paper_url:
        match = ARXIV_ID_PATTERN.search(payload.paper_url)
        if match:
            return match.group("arxiv_id")
    raise ValueError("PAPER_NOT_FOUND")


def _extract_openalex_id(payload: PaperPdfDownloadRequest) -> str:
    for raw in (payload.paper_id, payload.paper_url):
        if not raw:
            continue
        match = OPENALEX_ID_PATTERN.search(raw)
        if match:
            return match.group("openalex_id").upper()
    raise ValueError("PAPER_NOT_FOUND")


def _extract_doi(payload: PaperPdfDownloadRequest) -> str:
    for raw in (payload.paper_id, payload.paper_url):
        if not raw:
            continue
        match = DOI_PATTERN.search(raw)
        if match:
            return match.group("doi")
    raise ValueError("PAPER_NOT_FOUND")


async def _fetch_arxiv_metadata(
    client: httpx.AsyncClient,
    *,
    paper_id: str,
) -> tuple[str | None, list[str], int | None, str | None]:
    response = await client.get(ARXIV_API_URL, params={"id_list": paper_id})
    response.raise_for_status()
    root = ET.fromstring(response.text)
    namespaces = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
    entry = root.find("atom:entry", namespaces)
    if entry is None:
        return None, [], None, None
    title = _normalize_whitespace(entry.findtext("atom:title", default=None, namespaces=namespaces))
    authors = [
        _normalize_whitespace(node.findtext("atom:name", default="", namespaces=namespaces)) or "unknown"
        for node in entry.findall("atom:author", namespaces)
    ]
    published = entry.findtext("atom:published", default=None, namespaces=namespaces)
    year = (
        _normalize_year(int(published[:4]))
        if published and len(published) >= 4 and published[:4].isdigit()
        else None
    )
    doi = _normalize_whitespace(entry.findtext("arxiv:doi", default=None, namespaces=namespaces))
    return title, authors, year, doi


async def _fetch_openalex_locator(
    client: httpx.AsyncClient,
    *,
    payload: PaperPdfDownloadRequest,
) -> ResolvedPaperLocator:
    work_id = _extract_openalex_id(payload)
    response = await client.get(f"{OPENALEX_API_URL}/{work_id}")
    if response.status_code == 404:
        raise ValueError("PAPER_NOT_FOUND")
    try:
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValueError("PAPER_METADATA_EXTRACTION_FAILED") from exc
    data = response.json()
    pdf_url = _select_trusted_pdf_url(
        ((data.get("primary_location") or {}).get("pdf_url")),
        ((data.get("best_oa_location") or {}).get("pdf_url")),
        *[
            (location or {}).get("pdf_url")
            for location in list(data.get("locations") or [])
        ],
    )
    if pdf_url is None:
        raise ValueError("PAPER_METADATA_EXTRACTION_FAILED")
    authors = []
    for authorship in list(data.get("authorships") or []):
        author_name = _normalize_whitespace(((authorship or {}).get("author") or {}).get("display_name"))
        if author_name:
            authors.append(author_name)
    title = _normalize_whitespace(data.get("title") or data.get("display_name"))
    doi = _normalize_whitespace(data.get("doi"))
    source_url = payload.paper_url or _normalize_https_url(data.get("id")) or f"https://openalex.org/{work_id}"
    return ResolvedPaperLocator(
        source=payload.source,
        paper_id=work_id,
        source_url=source_url,
        pdf_url=pdf_url,
        title=title,
        authors=authors,
        year=_normalize_year(data.get("publication_year")),
        doi=doi,
    )


async def _fetch_crossref_locator(
    client: httpx.AsyncClient,
    *,
    payload: PaperPdfDownloadRequest,
) -> ResolvedPaperLocator:
    doi = _extract_doi(payload)
    encoded_doi = quote(doi, safe="")
    response = await client.get(f"{CROSSREF_API_URL}/{encoded_doi}")
    if response.status_code == 404:
        raise ValueError("PAPER_NOT_FOUND")
    try:
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ValueError("PAPER_METADATA_EXTRACTION_FAILED") from exc
    message = (response.json() or {}).get("message") or {}
    links = list(message.get("link") or [])
    pdf_url = _select_trusted_pdf_url(
        *[
            (link or {}).get("URL")
            for link in links
            if str((link or {}).get("content-type") or "").lower() == "application/pdf"
            or str((link or {}).get("URL") or "").lower().endswith(".pdf")
        ]
    )
    if pdf_url is None:
        raise ValueError("PAPER_METADATA_EXTRACTION_FAILED")
    authors = []
    for author in list(message.get("author") or []):
        given = _normalize_whitespace((author or {}).get("given"))
        family = _normalize_whitespace((author or {}).get("family"))
        full_name = " ".join(part for part in (given, family) if part).strip()
        if full_name:
            authors.append(full_name)
    title_values = list(message.get("title") or [])
    title = _normalize_whitespace(title_values[0] if title_values else None)
    year = None
    for key in ("published-print", "published-online", "issued"):
        date_parts = (((message.get(key) or {}).get("date-parts") or [[]])[0] or [])
        if date_parts:
            year = _normalize_year(int(date_parts[0]))
            break
    source_url = payload.paper_url or f"https://doi.org/{doi}"
    return ResolvedPaperLocator(
        source=payload.source,
        paper_id=payload.paper_id or doi,
        source_url=source_url,
        pdf_url=pdf_url,
        title=title,
        authors=authors,
        year=year,
        doi=_normalize_whitespace(message.get("DOI") or doi),
    )


@asynccontextmanager
async def _paper_client(client: httpx.AsyncClient | None):
    if client is not None:
        yield client
        return

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=PAPER_DOWNLOAD_TIMEOUT_S,
        headers={"User-Agent": "synapse-provider-service"},
    ) as managed_client:
        yield managed_client


async def _download_pdf(
    client: httpx.AsyncClient,
    *,
    pdf_url: str,
    target_dir: Path,
    fallback_name: str,
) -> tuple[Path, str, int]:
    file_name = Path(urlparse(pdf_url).path).name or fallback_name
    if not file_name.lower().endswith(".pdf"):
        file_name = f"{file_name}.pdf"
    file_path = target_dir / file_name
    digest = hashlib.sha256()
    async with client.stream("GET", pdf_url) as response:
        if response.status_code == 404:
            raise ValueError("PAPER_NOT_FOUND")
        try:
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ValueError("PAPER_PDF_DOWNLOAD_FAILED") from exc
        # Intentional short-circuit: if upstream already declares an oversized payload, fail early;
        # otherwise the streaming counter below remains the authoritative size guard.
        expected_size = int(response.headers.get("Content-Length") or 0)
        if expected_size > MAX_PDF_SIZE_BYTES:
            raise ValueError("PAPER_PDF_SIZE_EXCEEDED")
        size_bytes = 0
        try:
            with file_path.open("wb") as handle:
                async for chunk in response.aiter_bytes():
                    if not chunk:
                        continue
                    size_bytes += len(chunk)
                    if size_bytes > MAX_PDF_SIZE_BYTES:
                        raise ValueError("PAPER_PDF_SIZE_EXCEEDED")
                    handle.write(chunk)
                    digest.update(chunk)
        except Exception:
            file_path.unlink(missing_ok=True)
            raise
    if not file_path.exists():
        raise ValueError("PAPER_PDF_DOWNLOAD_FAILED")
    size_bytes = file_path.stat().st_size
    return file_path, digest.hexdigest(), size_bytes


async def download_paper_pdf(
    payload: PaperPdfDownloadRequest,
    *,
    target_dir: Path,
    client: httpx.AsyncClient | None = None,
) -> DownloadedPaperPdf:
    target_dir.mkdir(parents=True, exist_ok=True)
    async with _paper_client(client) as current_client:
        if payload.source == "arxiv":
            paper_id = _extract_arxiv_id(payload)
            pdf_url = f"https://arxiv.org/pdf/{paper_id}.pdf"
            try:
                title, authors, year, doi = await _fetch_arxiv_metadata(current_client, paper_id=paper_id)
            except httpx.HTTPError as exc:
                logger.warning(
                    "paper_pdf_download metadata fallback",
                    source="arxiv",
                    paper_id=paper_id,
                    error=str(exc),
                )
                title, authors, year, doi = None, [], None, None
            file_path, sha256, size_bytes = await _download_pdf(
                current_client,
                pdf_url=pdf_url,
                target_dir=target_dir,
                fallback_name=f"{paper_id}.pdf",
            )
            return DownloadedPaperPdf(
                source=payload.source,
                paper_id=paper_id,
                source_url=payload.paper_url or f"https://arxiv.org/abs/{paper_id}",
                file_path=file_path,
                mime_type="application/pdf",
                size_bytes=size_bytes,
                sha256=sha256,
                title=title,
                authors=authors,
                year=year,
                doi=doi,
            )

        if payload.source == "openalex":
            locator = await _fetch_openalex_locator(current_client, payload=payload)
        elif payload.source == "crossref":
            locator = await _fetch_crossref_locator(current_client, payload=payload)
        else:
            raise ValueError("PAPER_METADATA_EXTRACTION_FAILED")

        file_path, sha256, size_bytes = await _download_pdf(
            current_client,
            pdf_url=locator.pdf_url,
            target_dir=target_dir,
            fallback_name=f"{locator.paper_id or 'paper'}.pdf",
        )
        return DownloadedPaperPdf(
            source=locator.source,
            paper_id=locator.paper_id,
            source_url=locator.source_url,
            file_path=file_path,
            mime_type="application/pdf",
            size_bytes=size_bytes,
            sha256=sha256,
            title=locator.title,
            authors=locator.authors,
            year=locator.year,
            doi=locator.doi,
        )
