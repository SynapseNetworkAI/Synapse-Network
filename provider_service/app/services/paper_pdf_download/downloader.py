from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import re
import xml.etree.ElementTree as ET

import httpx

from app.core.log_config import logger
from app.schemas.paper_pdf_download import PaperPdfDownloadRequest


PAPER_DOWNLOAD_TIMEOUT_S = 30.0
MAX_PDF_SIZE_BYTES = 128 * 1024 * 1024
ARXIV_ID_PATTERN = re.compile(r"(?P<id>(?:\d{4}\.\d{4,5}|[a-z-]+/\d{7})(?:v\d+)?)")
ARXIV_API_URL = "https://export.arxiv.org/api/query"


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


def _normalize_year(value: int | None) -> int | None:
    if value is None:
        return None
    max_year = datetime.now(UTC).year + 1
    if 1900 <= value <= max_year:
        return value
    return None


def _extract_arxiv_id(payload: PaperPdfDownloadRequest) -> str:
    if payload.paper_id:
        match = ARXIV_ID_PATTERN.search(payload.paper_id)
        if match:
            return match.group("id")
    if payload.paper_url:
        match = ARXIV_ID_PATTERN.search(payload.paper_url)
        if match:
            return match.group("id")
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


async def _download_pdf(
    client: httpx.AsyncClient,
    *,
    pdf_url: str,
    target_dir: Path,
    fallback_name: str,
) -> tuple[Path, str, int]:
    file_name = Path(pdf_url).name or fallback_name
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
        expected_size = int(response.headers.get("Content-Length") or 0)
        if expected_size > MAX_PDF_SIZE_BYTES:
            raise ValueError("PAPER_PDF_SIZE_EXCEEDED")
        size_bytes = 0
        with file_path.open("wb") as handle:
            async for chunk in response.aiter_bytes():
                if not chunk:
                    continue
                size_bytes += len(chunk)
                if size_bytes > MAX_PDF_SIZE_BYTES:
                    handle.close()
                    file_path.unlink(missing_ok=True)
                    raise ValueError("PAPER_PDF_SIZE_EXCEEDED")
                handle.write(chunk)
                digest.update(chunk)
    if not file_path.exists():
        raise ValueError("PAPER_PDF_DOWNLOAD_FAILED")
    size_bytes = file_path.stat().st_size
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
            except httpx.HTTPError as exc:
                logger.warning(
                    "paper_pdf_download metadata fallback",
                    source="arxiv",
                    paper_id=paper_id,
                    error=str(exc),
                )
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

        raise ValueError("PAPER_METADATA_EXTRACTION_FAILED")
