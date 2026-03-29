from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_settings
from app.schemas.reddit_media_download import (
    RedditMediaAsset,
    RedditMediaDownloadRequest,
    RedditMediaDownloadResponse,
    RedditMediaDownloadResult,
    RedditMediaMeta,
)
from app.schemas.sentiment import FreshnessRecord, ServiceDescriptor, SourceRecord
from app.services.download_runtime.executor import (
    DownloadExecutionContext,
    execute_download_with_repository,
)
from app.services.reddit_media_download.domain import (
    RedditMediaAssetRecord,
    asset_key_from_request,
)
from app.services.reddit_media_download.downloader import download_reddit_media
from app.services.reddit_media_download.repository import (
    asset_expiry,
    get_reddit_media_download_repository,
)
from app.services.twitter_video_download.storage import build_video_storage


SERVICE_ID = "svc_reddit_media_download"
SERVICE_NAME = "Reddit Media Downloader"
SERVICE_VERSION = "1.0.0"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _download_dir() -> Path:
    return Path(get_settings().reddit_media_tmp_dir).resolve()


def _storage_key(post_id: str, filename: str) -> str:
    now = _now_utc()
    prefix = get_settings().video_storage_key_prefix.strip("/") or "reddit"
    return f"{prefix}/{now:%Y/%m/%d}/{post_id}/{filename}".strip("/")


async def execute_reddit_media_download(
    payload: RedditMediaDownloadRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
) -> RedditMediaDownloadResponse:
    repository = get_reddit_media_download_repository()
    storage = build_video_storage()
    asset_key = asset_key_from_request(payload)

    async def _run_live_download() -> tuple[RedditMediaDownloadResponse, dict[str, str]]:
        downloaded = await download_reddit_media(payload, target_dir=_download_dir())
        key = _storage_key(downloaded.post_id, downloaded.file_path.name)
        stored = storage.put_file(
            source_path=downloaded.file_path,
            target_key=key,
            content_type=downloaded.mime_type,
        )
        response = RedditMediaDownloadResponse(
            service=ServiceDescriptor(serviceId=SERVICE_ID, serviceName=SERVICE_NAME, version=SERVICE_VERSION),
            sources=[SourceRecord(name="reddit_public_web", freshnessSec=0)],
            freshness=FreshnessRecord(generatedAt=_to_zulu(_now_utc()), maxSourceAgeSec=0, cacheHit=False),
            result=RedditMediaDownloadResult(
                postUrl=payload.post_url,
                status="downloaded",
                asset=RedditMediaAsset(
                    storageKey=stored.key,
                    storageBackend=stored.backend,
                    mimeType=stored.content_type,
                    sizeBytes=stored.size_bytes,
                    sha256=downloaded.sha256,
                ),
                meta=RedditMediaMeta(
                    postId=downloaded.post_id,
                    subreddit=downloaded.subreddit,
                    author=downloaded.author,
                    mediaKind=downloaded.media_kind,
                ),
            ),
            errors=[],
        )
        return response, {"assetKey": asset_key, "storageKey": stored.key}

    def _build_record(response: RedditMediaDownloadResponse) -> RedditMediaAssetRecord:
        return RedditMediaAssetRecord(
            asset_key=asset_key,
            request=payload,
            response=response,
            expires_at=asset_expiry(get_settings().reddit_media_cache_ttl_s),
        )

    return await execute_download_with_repository(
        context=DownloadExecutionContext(
            service_id=SERVICE_ID,
            request_id=request_id,
            gateway_request_id=gateway_request_id,
            input_payload=payload.model_dump(by_alias=True, mode="json"),
            asset_key=asset_key,
            fallback_error_code="REDDIT_MEDIA_SNAPSHOT_FALLBACK_USED",
            fallback_error_message="Returning persisted reddit media asset due to live download failure.",
            default_error_code="REDDIT_MEDIA_DOWNLOAD_FAILED",
        ),
        repository=repository,
        run_live_download=_run_live_download,
        build_record=_build_record,
        now_utc=_now_utc,
    )
