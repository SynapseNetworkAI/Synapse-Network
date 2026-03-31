from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

from fastapi import HTTPException

from app.core.config import get_settings
from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord
from app.schemas.twitter_video_download import (
    TwitterVideoAsset,
    TwitterVideoDownloadRequest,
    TwitterVideoDownloadResponse,
    TwitterVideoDownloadResult,
)
from app.services.asset_storage import build_storage_gateway
from app.services.download_abstractions import DownloadPolicy, MediaAsset, run_guarded_download
from app.services.smart_contract_audit.domain import ProviderInvocationRecord
from app.services.twitter_video_download.domain import (
    TwitterVideoAssetRecord,
    asset_key_from_request,
)
from app.services.twitter_video_download.downloader import download_twitter_video
from app.services.twitter_video_download.repository import (
    asset_expiry,
    get_twitter_video_download_repository,
)

# Compatibility alias for existing tests / patches during the Phase C rollout.
build_video_storage = build_storage_gateway


SERVICE_ID = "svc_twitter_video_download"
SERVICE_NAME = "Twitter Video Downloader"
SERVICE_VERSION = "1.0.0"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _download_policy(payload: TwitterVideoDownloadRequest) -> DownloadPolicy:
    settings = get_settings()
    now = _now_utc()
    prefix = settings.video_storage_key_prefix.strip("/") or "twitter"
    return DownloadPolicy(
        temp_dir=Path(settings.twitter_video_tmp_dir).resolve(),
        storage_prefix=f"{prefix}/{now:%Y/%m/%d}",
        default_storage_namespace="twitter",
        timeout_s=settings.twitter_video_download_timeout_s,
        concurrency_limit=settings.twitter_video_max_concurrency,
        max_duration_sec=payload.max_duration_sec,
        max_size_bytes=payload.max_file_size_mb * 1024 * 1024,
    )


def _storage_key(policy: DownloadPolicy, tweet_id: str, filename: str) -> str:
    return policy.build_storage_key(tweet_id, filename=filename)


async def execute_twitter_video_download(
    payload: TwitterVideoDownloadRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
    disconnect_checker=None,
) -> TwitterVideoDownloadResponse:
    repository = get_twitter_video_download_repository()
    storage = build_video_storage()
    policy = _download_policy(payload)
    start = perf_counter()
    asset_key = asset_key_from_request(payload)
    downloaded = None

    try:
        try:
            downloaded = await run_guarded_download(
                service_key=SERVICE_ID,
                policy=policy,
                timeout_error_code="TWITTER_VIDEO_DOWNLOAD_TIMEOUT",
                disconnect_error_code="TWITTER_VIDEO_DOWNLOAD_CANCELLED",
                disconnect_checker=disconnect_checker,
                operation=lambda: download_twitter_video(payload, target_dir=policy.resolved_tmp_dir()),
            )
            key = _storage_key(policy, downloaded.tweet_id, downloaded.file_path.name)
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

            response = TwitterVideoDownloadResponse(
                service=ServiceDescriptor(
                    serviceId=SERVICE_ID,
                    serviceName=SERVICE_NAME,
                    version=SERVICE_VERSION,
                ),
                sources=[SourceRecord(name="x_api_v2", freshnessSec=0)],
                freshness=FreshnessRecord(
                    generatedAt=_to_zulu(_now_utc()),
                    maxSourceAgeSec=0,
                    cacheHit=False,
                ),
                result=TwitterVideoDownloadResult(
                    postUrl=payload.post_url,
                    tweetId=downloaded.tweet_id,
                    status="downloaded",
                    video=TwitterVideoAsset(**media_asset.as_video_payload()),
                    previewImage=None,
                ),
                errors=[],
            )

            repository.save_asset(
                TwitterVideoAssetRecord(
                    asset_key=asset_key,
                    request=payload,
                    response=response,
                    expires_at=asset_expiry(get_settings().twitter_video_cache_ttl_s),
                )
            )

            latency_ms = int((perf_counter() - start) * 1000)
            repository.append_invocation(
                ProviderInvocationRecord.build(
                    service_id=SERVICE_ID,
                    input_payload=payload.model_dump(by_alias=True, mode="json"),
                    response_status=200,
                    request_id=request_id,
                    gateway_request_id=gateway_request_id,
                    error_code=None,
                    upstream_status=None,
                    latency_ms=latency_ms,
                    cache_hit=False,
                    observability_payload={"assetKey": asset_key, "storageKey": stored.key},
                )
            )
            return response
        except ValueError as exc:
            message = str(exc)
            code = message if message.isupper() else "VIDEO_DOWNLOAD_FAILED"
        except Exception as exc:  # noqa: BLE001
            code = "VIDEO_DOWNLOAD_FAILED"
            message = str(exc)

        if code == "TWITTER_VIDEO_DOWNLOAD_CANCELLED":
            raise HTTPException(
                status_code=499,
                detail={"code": code, "message": "Request disconnected during twitter video download."},
            )

        snapshot = repository.load_asset(asset_key)
        if snapshot is not None and not snapshot.is_expired(now=_now_utc()):
            response = snapshot.as_cache_hit_response().model_copy(
                update={
                    "errors": [
                        *snapshot.response.errors,
                        ErrorRecord(
                            code="TWITTER_VIDEO_SNAPSHOT_FALLBACK_USED",
                            message="Returning persisted twitter video asset due to live download failure.",
                        ),
                    ]
                }
            )
            repository.append_invocation(
                ProviderInvocationRecord.build(
                    service_id=SERVICE_ID,
                    input_payload=payload.model_dump(by_alias=True, mode="json"),
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
            return response

        raise HTTPException(status_code=502, detail={"code": code, "message": message})
    finally:
        if downloaded is not None:
            downloaded.file_path.unlink(missing_ok=True)
