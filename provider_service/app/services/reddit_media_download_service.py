from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

from fastapi import HTTPException

from app.core.config import get_settings
from app.schemas.reddit_media_download import (
    RedditMediaAsset,
    RedditMediaDownloadRequest,
    RedditMediaDownloadResponse,
    RedditMediaDownloadResult,
    RedditPostMeta,
)
from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord
from app.services.asset_storage import build_storage_gateway
from app.services.download_abstractions import DownloadPolicy, MediaAsset, run_guarded_download
from app.services.download_snapshot_replay import replay_cached_snapshot_if_available
from app.services.reddit_media_download.domain import RedditMediaAssetRecord, asset_key_from_request
from app.services.reddit_media_download.downloader import download_reddit_media
from app.services.reddit_media_download.repository import (
    asset_expiry,
    get_reddit_media_download_repository,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord

# Compatibility alias for existing tests / patches during the Phase C rollout.
build_video_storage = build_storage_gateway


SERVICE_ID = "svc_reddit_media_download"
SERVICE_NAME = "Reddit Media Downloader"
SERVICE_VERSION = "1.0.0"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _download_policy(payload: RedditMediaDownloadRequest) -> DownloadPolicy:
    settings = get_settings()
    now = _now_utc()
    prefix = settings.video_storage_key_prefix.strip("/") or "reddit"
    return DownloadPolicy(
        temp_dir=Path(settings.reddit_media_tmp_dir).resolve(),
        storage_prefix=f"{prefix}/{now:%Y/%m/%d}",
        default_storage_namespace="reddit",
        timeout_s=settings.reddit_media_download_timeout_s,
        max_size_bytes=payload.max_file_size_mb * 1024 * 1024,
        concurrency_limit=settings.reddit_media_max_concurrency,
    )


def _storage_key(policy: DownloadPolicy, post_id: str, filename: str) -> str:
    return policy.build_storage_key(post_id, filename=filename)


async def execute_reddit_media_download(
    payload: RedditMediaDownloadRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
    disconnect_checker=None,
) -> RedditMediaDownloadResponse:
    repository = get_reddit_media_download_repository()
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
            timeout_error_code="REDDIT_MEDIA_DOWNLOAD_TIMEOUT",
            disconnect_error_code="REDDIT_MEDIA_DOWNLOAD_CANCELLED",
            disconnect_checker=disconnect_checker,
            operation=lambda: download_reddit_media(payload, target_dir=policy.resolved_tmp_dir()),
        )
            key = _storage_key(policy, downloaded.post_id, downloaded.file_path.name)
            stored = storage.put_file(
                source_path=downloaded.file_path,
                target_key=key,
                content_type=downloaded.mime_type,
            )
            media_asset = MediaAsset.from_stored(stored, sha256=downloaded.sha256)
            response = RedditMediaDownloadResponse(
                service=ServiceDescriptor(
                    serviceId=SERVICE_ID,
                    serviceName=SERVICE_NAME,
                    version=SERVICE_VERSION,
                ),
                sources=[SourceRecord(name="reddit_public_web", freshnessSec=0)],
                freshness=FreshnessRecord(
                    generatedAt=_to_zulu(_now_utc()),
                    maxSourceAgeSec=0,
                    cacheHit=False,
                ),
                result=RedditMediaDownloadResult(
                    postUrl=payload.post_url,
                    mediaType=downloaded.media_type,
                    status="downloaded",
                    media=RedditMediaAsset(**media_asset.as_stored_payload()),
                    postMeta=RedditPostMeta(
                        subreddit=downloaded.subreddit,
                        postId=downloaded.post_id,
                        author=downloaded.author,
                        createdUtc=downloaded.created_utc,
                    ),
                ),
                errors=[],
            )

            repository.save_asset(
                RedditMediaAssetRecord(
                    asset_key=asset_key,
                    request=payload,
                    response=response,
                    expires_at=asset_expiry(get_settings().reddit_media_cache_ttl_s),
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
            code = message if message.isupper() else "REDDIT_MEDIA_DOWNLOAD_FAILED"
        except Exception as exc:  # noqa: BLE001
            code = "REDDIT_MEDIA_DOWNLOAD_FAILED"
            message = str(exc)

        if code == "REDDIT_MEDIA_DOWNLOAD_CANCELLED":
            raise HTTPException(
                status_code=499,
                detail={"code": code, "message": "Request disconnected during reddit media download."},
            )

        snapshot = repository.load_asset(asset_key)
        if snapshot is not None and not snapshot.is_expired(now=_now_utc()):
            replay = snapshot.as_cache_hit_response().model_copy(
                update={
                    "errors": [
                        *snapshot.response.errors,
                        ErrorRecord(
                            code="REDDIT_MEDIA_SNAPSHOT_FALLBACK_USED",
                            message="Returning persisted reddit media asset due to live download failure.",
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
