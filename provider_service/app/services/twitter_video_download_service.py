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
from app.services.download_abstractions import DownloadPolicy, MediaAsset
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

build_video_storage = build_storage_gateway


SERVICE_ID = "svc_twitter_video_download"
SERVICE_NAME = "Twitter Video Downloader"
SERVICE_VERSION = "1.0.0"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _download_policy() -> DownloadPolicy:
    settings = get_settings()
    now = _now_utc()
    prefix = settings.video_storage_key_prefix.strip("/") or "twitter"
    return DownloadPolicy(
        temp_dir=Path(settings.twitter_video_tmp_dir).resolve(),
        storage_prefix=f"{prefix}/{now:%Y/%m/%d}",
        default_storage_namespace="twitter",
    )


def _storage_key(policy: DownloadPolicy, tweet_id: str, filename: str) -> str:
    return policy.build_storage_key(tweet_id, filename=filename)


async def execute_twitter_video_download(
    payload: TwitterVideoDownloadRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
) -> TwitterVideoDownloadResponse:
    repository = get_twitter_video_download_repository()
    storage = build_video_storage()
    policy = _download_policy()
    start = perf_counter()
    asset_key = asset_key_from_request(payload)

    try:
        downloaded = await download_twitter_video(payload, target_dir=policy.resolved_tmp_dir())
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
