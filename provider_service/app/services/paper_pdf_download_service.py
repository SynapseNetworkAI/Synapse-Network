from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

from fastapi import HTTPException

from app.core.config import get_settings
from app.schemas.paper_pdf_download import (
    PaperPdfDownloadRequest,
    PaperPdfDownloadResponse,
    PaperPdfDownloadResult,
    PaperPdfMetadata,
    PaperPdfStoredAsset,
)
from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord
from app.services.download_snapshot_replay import replay_cached_snapshot_if_available
from app.services.paper_pdf_download.domain import PaperPdfAssetRecord, asset_key_from_request
from app.services.paper_pdf_download.downloader import download_paper_pdf
from app.services.paper_pdf_download.repository import (
    asset_expiry,
    get_paper_pdf_download_repository,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord
from app.services.twitter_video_download.storage import build_video_storage


SERVICE_ID = "svc_paper_pdf_download"
SERVICE_NAME = "Paper PDF Downloader"
SERVICE_VERSION = "1.0.0"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _download_dir() -> Path:
    return Path(get_settings().paper_pdf_tmp_dir).resolve()


def _storage_key(source: str, paper_id: str | None, filename: str) -> str:
    now = _now_utc()
    prefix = get_settings().video_storage_key_prefix.strip("/") or "paper_pdf"
    paper_segment = (paper_id or "paper").replace("/", "__")
    return f"{prefix}/{now:%Y/%m/%d}/{source}/{paper_segment}/{filename}".strip("/")


async def execute_paper_pdf_download(
    payload: PaperPdfDownloadRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
) -> PaperPdfDownloadResponse:
    repository = get_paper_pdf_download_repository()
    storage = build_video_storage()
    start = perf_counter()
    asset_key = asset_key_from_request(payload)
    serialized_payload = payload.model_dump(by_alias=True, mode="json")

    replay = replay_cached_snapshot_if_available(
        repository=repository,
        asset_key=asset_key,
        now=_now_utc(),
        service_id=SERVICE_ID,
        payload=serialized_payload,
        request_id=request_id,
        gateway_request_id=gateway_request_id,
        start_time=start,
    )
    if replay is not None:
        return replay

    try:
        downloaded = await download_paper_pdf(payload, target_dir=_download_dir())
        key = _storage_key(downloaded.source, downloaded.paper_id, downloaded.file_path.name)
        stored = storage.put_file(
            source_path=downloaded.file_path,
            target_key=key,
            content_type=downloaded.mime_type,
        )
        response = PaperPdfDownloadResponse(
            service=ServiceDescriptor(
                serviceId=SERVICE_ID,
                serviceName=SERVICE_NAME,
                version=SERVICE_VERSION,
            ),
            sources=[SourceRecord(name=f"{downloaded.source}_paper_source", freshnessSec=0)],
            freshness=FreshnessRecord(
                generatedAt=_to_zulu(_now_utc()),
                maxSourceAgeSec=0,
                cacheHit=False,
            ),
            result=PaperPdfDownloadResult(
                source=downloaded.source,
                paperId=downloaded.paper_id,
                status="downloaded",
                pdf=PaperPdfStoredAsset(
                    storageKey=stored.key,
                    storageBackend=stored.backend,
                    mimeType=stored.content_type,
                    sizeBytes=stored.size_bytes,
                    sha256=downloaded.sha256,
                ),
                metadata=PaperPdfMetadata(
                    title=downloaded.title,
                    authors=downloaded.authors,
                    year=downloaded.year,
                    doi=downloaded.doi,
                    sourceUrl=downloaded.source_url,
                ),
                textExtractJobId=None,
            ),
            errors=[],
        )
        repository.save_asset(
            PaperPdfAssetRecord(
                asset_key=asset_key,
                request=payload,
                response=response,
                expires_at=asset_expiry(get_settings().paper_pdf_cache_ttl_s),
            )
        )
        repository.append_invocation(
            ProviderInvocationRecord.build(
                service_id=SERVICE_ID,
                input_payload=serialized_payload,
                response_status=200,
                request_id=request_id,
                gateway_request_id=gateway_request_id,
                error_code=None,
                upstream_status=None,
                latency_ms=int((perf_counter() - start) * 1000),
                cache_hit=False,
                observability_payload={
                    "assetKey": asset_key,
                    "storageKey": stored.key,
                    "source": downloaded.source,
                },
            )
        )
        return response
    except ValueError as exc:
        message = str(exc)
        code = message if message.isupper() else "PAPER_PDF_DOWNLOAD_FAILED"
    except Exception as exc:  # noqa: BLE001
        code = "PAPER_PDF_DOWNLOAD_FAILED"
        message = str(exc)

    snapshot = repository.load_asset(asset_key)
    if snapshot is not None and not snapshot.is_expired(now=_now_utc()):
        replay = snapshot.as_cache_hit_response().model_copy(
            update={
                "errors": [
                    *snapshot.response.errors,
                    ErrorRecord(
                        code="PAPER_PDF_SNAPSHOT_FALLBACK_USED",
                        message="Returning persisted paper pdf asset due to live download failure.",
                    ),
                ]
            }
        )
        repository.append_invocation(
            ProviderInvocationRecord.build(
                service_id=SERVICE_ID,
                input_payload=serialized_payload,
                response_status=200,
                request_id=request_id,
                gateway_request_id=gateway_request_id,
                error_code=code,
                upstream_status=None,
                latency_ms=int((perf_counter() - start) * 1000),
                cache_hit=True,
                observability_payload={"assetKey": asset_key, "fallbackReason": message},
            )
        )
        return replay

    raise HTTPException(status_code=502, detail={"code": code, "message": message})
