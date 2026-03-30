from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

from fastapi import HTTPException

from app.core.config import get_settings
from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord
from app.schemas.tiktok_video_download import (
    TikTokDownloadTrace,
    TikTokVideoAsset,
    TikTokVideoDownloadRequest,
    TikTokVideoDownloadResponse,
    TikTokVideoDownloadResult,
)
from app.services.asset_storage import build_storage_gateway
from app.services.download_abstractions import DownloadPolicy, MediaAsset, run_guarded_download
from app.services.download_snapshot_replay import replay_cached_snapshot_if_available
from app.services.smart_contract_audit.domain import ProviderInvocationRecord
from app.services.tiktok_video_download.domain import TikTokVideoAssetRecord, asset_key_from_request
from app.services.tiktok_video_download.downloader import download_tiktok_video
from app.services.tiktok_video_download.repository import (
    asset_expiry,
    get_tiktok_video_download_repository,
)

# Compatibility alias for existing tests / patches during the Phase C rollout.
build_video_storage = build_storage_gateway


SERVICE_ID = "svc_tiktok_video_download"
SERVICE_NAME = "TikTok Video Downloader"
SERVICE_VERSION = "1.0.0"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _download_policy(payload: TikTokVideoDownloadRequest) -> DownloadPolicy:
    settings = get_settings()
    now = _now_utc()
    prefix = settings.video_storage_key_prefix.strip("/") or "tiktok"
    return DownloadPolicy(
        temp_dir=Path(settings.tiktok_video_tmp_dir).resolve(),
        storage_prefix=f"{prefix}/{now:%Y/%m/%d}",
        default_storage_namespace="tiktok",
        timeout_s=settings.tiktok_video_download_timeout_s,
        max_duration_sec=payload.max_duration_sec,
        max_size_bytes=payload.max_file_size_mb * 1024 * 1024,
        concurrency_limit=settings.tiktok_video_max_concurrency,
    )


def _storage_key(policy: DownloadPolicy, video_id: str, filename: str) -> str:
    return policy.build_storage_key(video_id, filename=filename)


async def execute_tiktok_video_download(
    payload: TikTokVideoDownloadRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
) -> TikTokVideoDownloadResponse:
    repository = get_tiktok_video_download_repository()
    storage = build_video_storage()
    policy = _download_policy(payload)
    start = perf_counter()
    asset_key = asset_key_from_request(payload)
    serialized_payload = payload.model_dump(by_alias=True, mode="json")
    downloaded = None

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
        try:
            downloaded = await run_guarded_download(
                service_key=SERVICE_ID,
                policy=policy,
                timeout_error_code="TIKTOK_VIDEO_DOWNLOAD_TIMEOUT",
                operation=lambda: download_tiktok_video(payload, target_dir=policy.resolved_tmp_dir()),
            )
            key = _storage_key(policy, downloaded.video_id, downloaded.file_path.name)
            stored = storage.put_file(
                source_path=downloaded.file_path,
                target_key=key,
                content_type=downloaded.mime_type,
            )
            media_asset = MediaAsset.from_stored(
                stored,
                sha256=downloaded.sha256,
                duration_sec=downloaded.duration_sec,
                width=downloaded.width,
                height=downloaded.height,
            )

            response = TikTokVideoDownloadResponse(
                service=ServiceDescriptor(
                    serviceId=SERVICE_ID,
                    serviceName=SERVICE_NAME,
                    version=SERVICE_VERSION,
                ),
                sources=[SourceRecord(name="tiktok_public_web", freshnessSec=0)],
                freshness=FreshnessRecord(
                    generatedAt=_to_zulu(_now_utc()),
                    maxSourceAgeSec=0,
                    cacheHit=False,
                ),
                result=TikTokVideoDownloadResult(
                    videoUrl=payload.video_url,
                    videoId=downloaded.video_id,
                    status="downloaded",
                    video=TikTokVideoAsset(**media_asset.as_video_payload()),
                    subtitle=None,
                    downloadTrace=TikTokDownloadTrace(
                        sourcePlatform="tiktok", fallbackUsed=False
                    ),
                ),
                errors=[],
            )

            repository.save_asset(
                TikTokVideoAssetRecord(
                    asset_key=asset_key,
                    request=payload,
                    response=response,
                    expires_at=asset_expiry(get_settings().tiktok_video_cache_ttl_s),
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
                    observability_payload={"assetKey": asset_key, "storageKey": stored.key},
                )
            )
            return response
        except ValueError as exc:
            message = str(exc)
            code = message if message.isupper() else "TIKTOK_VIDEO_DOWNLOAD_FAILED"
        except Exception as exc:  # noqa: BLE001
            code = "TIKTOK_VIDEO_DOWNLOAD_FAILED"
            message = str(exc)

        snapshot = repository.load_asset(asset_key)
        if snapshot is not None and not snapshot.is_expired(now=_now_utc()):
            replay = snapshot.as_cache_hit_response().model_copy(
                update={
                    "errors": [
                        *snapshot.response.errors,
                        ErrorRecord(
                            code="TIKTOK_VIDEO_SNAPSHOT_FALLBACK_USED",
                            message="Returning persisted tiktok video asset due to live download failure.",
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
    finally:
        if downloaded is not None:
            downloaded.file_path.unlink(missing_ok=True)
