from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

from fastapi import HTTPException

from app.core.config import get_settings
from app.schemas.github_release_asset_download import (
    GitHubReleaseAssetDownloadRequest,
    GitHubReleaseAssetDownloadResponse,
    GitHubReleaseAssetDownloadResult,
    GitHubReleaseAssetMetadata,
    GitHubReleaseStoredAsset,
)
from app.schemas.sentiment import ErrorRecord, FreshnessRecord, ServiceDescriptor, SourceRecord
from app.services.download_snapshot_replay import replay_cached_snapshot_if_available
from app.services.github_release_asset_download.domain import (
    GitHubReleaseAssetRecord,
    asset_key_from_request,
)
from app.services.github_release_asset_download.downloader import (
    download_github_release_asset,
)
from app.services.github_release_asset_download.repository import (
    asset_expiry,
    get_github_release_asset_download_repository,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord
from app.services.asset_storage import build_asset_storage


SERVICE_ID = "svc_github_release_asset_download"
SERVICE_NAME = "GitHub Release Asset Downloader"
SERVICE_VERSION = "1.0.0"


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _to_zulu(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _download_dir() -> Path:
    return Path(get_settings().github_release_asset_tmp_dir).resolve()


def _storage_key(repo: str, release_tag: str, filename: str) -> str:
    now = _now_utc()
    # `video_storage_key_prefix` is a legacy shared storage prefix setting reused by all asset types.
    prefix = get_settings().video_storage_key_prefix.strip("/") or "github_release_assets"
    repo_segment = repo.replace("/", "__")
    tag_segment = release_tag.replace("/", "__")
    return f"{prefix}/{now:%Y/%m/%d}/{repo_segment}/{tag_segment}/{filename}".strip("/")


async def execute_github_release_asset_download(
    payload: GitHubReleaseAssetDownloadRequest,
    *,
    request_id: str | None,
    gateway_request_id: str | None,
) -> GitHubReleaseAssetDownloadResponse:
    repository = get_github_release_asset_download_repository()
    storage = build_asset_storage()
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
        downloaded = await download_github_release_asset(payload, target_dir=_download_dir())
        key = _storage_key(downloaded.repo, downloaded.release_tag, downloaded.file_path.name)
        stored = storage.put_file(
            source_path=downloaded.file_path,
            target_key=key,
            content_type=downloaded.mime_type,
        )
        response = GitHubReleaseAssetDownloadResponse(
            service=ServiceDescriptor(
                serviceId=SERVICE_ID,
                serviceName=SERVICE_NAME,
                version=SERVICE_VERSION,
            ),
            sources=[SourceRecord(name="github_releases_api", freshnessSec=0)],
            freshness=FreshnessRecord(
                generatedAt=_to_zulu(_now_utc()),
                maxSourceAgeSec=0,
                cacheHit=False,
            ),
            result=GitHubReleaseAssetDownloadResult(
                repo=payload.repo,
                releaseTag=downloaded.release_tag,
                status="downloaded",
                assetName=downloaded.asset_name,
                signatureVerified=downloaded.signature_verified,
                asset=GitHubReleaseStoredAsset(
                    storageKey=stored.key,
                    storageBackend=stored.backend,
                    mimeType=stored.content_type,
                    sizeBytes=stored.size_bytes,
                    sha256=downloaded.sha256,
                ),
                metadata=GitHubReleaseAssetMetadata(
                    repo=payload.repo,
                    releaseTag=downloaded.release_tag,
                    assetName=downloaded.asset_name,
                    assetPattern=payload.asset_pattern,
                    releaseUrl=downloaded.release_url,
                    downloadUrl=downloaded.download_url,
                ),
            ),
            errors=[],
        )
        repository.save_asset(
            GitHubReleaseAssetRecord(
                asset_key=asset_key,
                request=payload,
                response=response,
                expires_at=asset_expiry(get_settings().github_release_asset_cache_ttl_s),
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
                    "releaseTag": downloaded.release_tag,
                },
            )
        )
        return response
    except ValueError as exc:
        message = str(exc)
        code = message if message.isupper() else "GITHUB_ASSET_DOWNLOAD_FAILED"
    except Exception as exc:  # noqa: BLE001
        code = "GITHUB_ASSET_DOWNLOAD_FAILED"
        message = str(exc)

    snapshot = repository.load_asset(asset_key)
    if snapshot is not None and not snapshot.is_expired(now=_now_utc()):
        replay = snapshot.as_cache_hit_response().model_copy(
            update={
                "errors": [
                    *snapshot.response.errors,
                    ErrorRecord(
                        code="GITHUB_ASSET_SNAPSHOT_FALLBACK_USED",
                        message="Returning persisted GitHub release asset due to live download failure.",
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
