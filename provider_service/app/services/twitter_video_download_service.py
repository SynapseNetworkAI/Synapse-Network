from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.core.config import get_settings
from app.schemas.sentiment import FreshnessRecord, ServiceDescriptor, SourceRecord
from app.schemas.twitter_video_download import (
    TwitterVideoAsset,
    TwitterVideoDownloadRequest,
    TwitterVideoDownloadResponse,
    TwitterVideoDownloadResult,
)
from app.services.download_runtime.executor import (
    DownloadExecutionContext,
    execute_download_with_repository,
)
from app.services.twitter_video_download.domain import (
    TwitterVideoAssetRecord,
    asset_key_from_request,
)
from app.services.twitter_video_download.downloader import download_twitter_video
from app.services.twitter_video_download.repository import (
    asset_expiry,
    get_twitter_video_download_repository,
)
from app.services.twitter_video_download.storage import build_video_storage


SERVICE_ID = "svc_twitter_video_download"
SERVICE_NAME = "Twitter Video Downloader"
SERVICE_VERSION = "1.0.0"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _download_dir() -> Path:
    return Path(get_settings().twitter_video_tmp_dir).resolve()


def _storage_key(tweet_id: str, filename: str) -> str:
    now = _now_utc()
    prefix = get_settings().video_storage_key_prefix.strip("/")
    return f"{prefix}/{now:%Y/%m/%d}/{tweet_id}/{filename}".strip("/")


async def execute_twitter_video_download(
    payload: TwitterVideoDownloadRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
) -> TwitterVideoDownloadResponse:
    repository = get_twitter_video_download_repository()
    storage = build_video_storage()
    asset_key = asset_key_from_request(payload)

    async def _run_live_download() -> tuple[TwitterVideoDownloadResponse, dict[str, str]]:
        downloaded = await download_twitter_video(payload, target_dir=_download_dir())
        key = _storage_key(downloaded.tweet_id, downloaded.file_path.name)
        stored = storage.put_file(
            source_path=downloaded.file_path,
            target_key=key,
            content_type=downloaded.mime_type,
        )
        response = TwitterVideoDownloadResponse(
            service=ServiceDescriptor(
                serviceId=SERVICE_ID,
                serviceName=SERVICE_NAME,
                version=SERVICE_VERSION,
            ),
            sources=[SourceRecord(name="x_public_web", freshnessSec=0)],
            freshness=FreshnessRecord(
                generatedAt=_to_zulu(_now_utc()),
                maxSourceAgeSec=0,
                cacheHit=False,
            ),
            result=TwitterVideoDownloadResult(
                postUrl=payload.post_url,
                tweetId=downloaded.tweet_id,
                status="downloaded",
                video=TwitterVideoAsset(
                    storageKey=stored.key,
                    storageBackend=stored.backend,
                    mimeType=stored.content_type,
                    sizeBytes=stored.size_bytes,
                    durationSec=downloaded.duration_sec,
                    width=downloaded.width,
                    height=downloaded.height,
                    sha256=downloaded.sha256,
                ),
                previewImage=None,
            ),
            errors=[],
        )
        return response, {"assetKey": asset_key, "storageKey": stored.key}

    def _build_record(response: TwitterVideoDownloadResponse) -> TwitterVideoAssetRecord:
        return TwitterVideoAssetRecord(
            asset_key=asset_key,
            request=payload,
            response=response,
            expires_at=asset_expiry(get_settings().twitter_video_cache_ttl_s),
        )

    return await execute_download_with_repository(
        context=DownloadExecutionContext(
            service_id=SERVICE_ID,
            request_id=request_id,
            gateway_request_id=gateway_request_id,
            input_payload=payload.model_dump(by_alias=True, mode="json"),
            asset_key=asset_key,
            fallback_error_code="TWITTER_VIDEO_SNAPSHOT_FALLBACK_USED",
            fallback_error_message="Returning persisted twitter video asset due to live download failure.",
            default_error_code="VIDEO_DOWNLOAD_FAILED",
        ),
        repository=repository,
        run_live_download=_run_live_download,
        build_record=_build_record,
        now_utc=_now_utc,
    )
