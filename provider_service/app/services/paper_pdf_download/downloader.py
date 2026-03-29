from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

import httpx

from app.schemas.paper_pdf_download import PaperPdfDownloadRequest


PAPER_DOWNLOAD_TIMEOUT_S = 30.0
MAX_PDF_BYTES = 128 * 1024 * 1024
_ARXIV_ID_PATTERN = re.compile(r"(?P<id>(?:\d{4}\.\d{4,5}|[a-z-]+/\d{7})(?:v\d+)?)")


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


def _normalize_whitespace(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(str(value).split())
    return normalized or None


def _extract_arxiv_id(payload: PaperPdfDownloadRequest) -> str:
    if payload.paper_id:
        match = _ARXIV_ID_PATTERN.search(payload.paper_id)
        if match:
            return match.group("id")
    if payload.paper_url:
        match = _ARXIV_ID_PATTERN.search(payload.paper_url)
        if match:
            return match.group("id")
    raise ValueError("PAPER_NOT_FOUND")


async def _fetch_arxiv_metadata(
    client: httpx.AsyncClient,
    *,
    paper_id: str,
) -> tuple[str | None, list[str], int | None, str | None]:
    response = await client.get("https://export.arxiv.org/api/query", params={"id_list": paper_id})
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
    year = int(published[:4]) if published and len(published) >= 4 and published[:4].isdigit() else None
    doi = _normalize_whitespace(entry.findtext("arxiv:doi", default=None, namespaces=namespaces))
    return title, authors, year, doi


def _resolved_direct_pdf_url(payload: PaperPdfDownloadRequest) -> tuple[str | None, str | None]:
    if payload.paper_url:
        parsed = urlparse(payload.paper_url)
        if parsed.path.lower().endswith(".pdf"):
            paper_id = payload.paper_id or Path(parsed.path).stem
            return payload.paper_url, paper_id
    return None, payload.paper_id


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
        with file_path.open("wb") as handle:
            async for chunk in response.aiter_bytes():
                if not chunk:
                    continue
                handle.write(chunk)
                digest.update(chunk)
    if not file_path.exists():
        raise ValueError("PAPER_PDF_DOWNLOAD_FAILED")
    size_bytes = file_path.stat().st_size
    if size_bytes > MAX_PDF_BYTES:
        raise ValueError("PAPER_PDF_SIZE_EXCEEDED")
    return file_path, digest.hexdigest(), size_bytes


async def download_paper_pdf(
    payload: PaperPdfDownloadRequest,
    *,
    target_dir: Path,
) -> DownloadedPaperPdf:
    target_dir.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=PAPER_DOWNLOAD_TIMEOUT_S,
        headers={"User-Agent": "synapse-provider-service"},
    ) as client:
        if payload.source == "arxiv":
            paper_id = _extract_arxiv_id(payload)
            pdf_url = f"https://arxiv.org/pdf/{paper_id}.pdf"
            try:
                title, authors, year, doi = await _fetch_arxiv_metadata(client, paper_id=paper_id)
            except httpx.HTTPError:
                title, authors, year, doi = None, [], None, None
            file_path, sha256, size_bytes = await _download_pdf(
                client,
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

        pdf_url, paper_id = _resolved_direct_pdf_url(payload)
        if not pdf_url:
            raise ValueError("PAPER_METADATA_EXTRACTION_FAILED")
        file_path, sha256, size_bytes = await _download_pdf(
            client,
            pdf_url=pdf_url,
            target_dir=target_dir,
            fallback_name=(paper_id or "paper") + ".pdf",
        )
        return DownloadedPaperPdf(
            source=payload.source,
            paper_id=paper_id,
            source_url=payload.paper_url,
            file_path=file_path,
            mime_type="application/pdf",
            size_bytes=size_bytes,
            sha256=sha256,
            title=None,
            authors=[],
            year=None,
            doi=None,
        )
