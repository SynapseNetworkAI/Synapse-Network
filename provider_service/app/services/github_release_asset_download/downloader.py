from __future__ import annotations

import fnmatch
import hashlib
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.schemas.github_release_asset_download import GitHubReleaseAssetDownloadRequest


GITHUB_API_BASE_URL = "https://api.github.com"
GITHUB_DOWNLOAD_TIMEOUT_S = 30.0
MAX_ASSET_SIZE_BYTES = 2 * 1024 * 1024 * 1024
ALLOWED_GITHUB_DOWNLOAD_HOSTS = {"github.com", "www.github.com"}


@dataclass(frozen=True)
class DownloadedGitHubReleaseAsset:
    repo: str
    release_tag: str
    asset_name: str
    release_url: str | None
    download_url: str | None
    file_path: Path
    mime_type: str
    size_bytes: int
    sha256: str
    signature_verified: bool


def _select_asset(assets: list[dict], *, asset_pattern: str | None) -> dict:
    if not assets:
        raise ValueError("GITHUB_ASSET_NOT_FOUND")
    if asset_pattern:
        for asset in assets:
            name = str(asset.get("name") or "")
            if fnmatch.fnmatchcase(name, asset_pattern):
                return asset
        raise ValueError("GITHUB_ASSET_NOT_FOUND")
    return assets[0]


async def download_github_release_asset(
    payload: GitHubReleaseAssetDownloadRequest,
    *,
    target_dir: Path,
) -> DownloadedGitHubReleaseAsset:
    target_dir.mkdir(parents=True, exist_ok=True)
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "synapse-provider-service",
    }
    async with httpx.AsyncClient(
        base_url=GITHUB_API_BASE_URL,
        follow_redirects=True,
        timeout=GITHUB_DOWNLOAD_TIMEOUT_S,
        headers=headers,
    ) as client:
        release_path = (
            f"/repos/{payload.repo}/releases/latest"
            if payload.latest
            else f"/repos/{payload.repo}/releases/tags/{payload.tag}"
        )
        release_response = await client.get(release_path)
        if release_response.status_code == 404:
            raise ValueError("GITHUB_ASSET_NOT_FOUND")
        try:
            release_response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ValueError("GITHUB_ASSET_DOWNLOAD_FAILED") from exc
        release_payload = release_response.json()
        asset = _select_asset(
            list(release_payload.get("assets") or []),
            asset_pattern=payload.asset_pattern,
        )
        expected_size = int(asset.get("size") or 0)
        if expected_size > MAX_ASSET_SIZE_BYTES:
            raise ValueError("GITHUB_ASSET_SIZE_EXCEEDED")

        asset_name = Path(str(asset.get("name") or "release-asset.bin")).name
        file_path = target_dir / asset_name
        digest = hashlib.sha256()
        size_bytes = 0

        download_url = str(asset.get("browser_download_url") or "").strip()
        if not download_url:
            raise ValueError("GITHUB_ASSET_NOT_FOUND")
        parsed_download_url = urlparse(download_url)
        if (
            parsed_download_url.scheme.lower() != "https"
            or parsed_download_url.netloc.lower() not in ALLOWED_GITHUB_DOWNLOAD_HOSTS
        ):
            raise ValueError("GITHUB_ASSET_DOWNLOAD_FAILED")

        async with client.stream(
            "GET",
            download_url,
            headers={"Accept": "application/octet-stream", "User-Agent": "synapse-provider-service"},
        ) as download_response:
            if download_response.status_code == 404:
                raise ValueError("GITHUB_ASSET_NOT_FOUND")
            try:
                download_response.raise_for_status()
            except httpx.HTTPError as exc:
                raise ValueError("GITHUB_ASSET_DOWNLOAD_FAILED") from exc
            with file_path.open("wb") as handle:
                async for chunk in download_response.aiter_bytes():
                    if not chunk:
                        continue
                    size_bytes += len(chunk)
                    if size_bytes > MAX_ASSET_SIZE_BYTES:
                        handle.close()
                        file_path.unlink(missing_ok=True)
                        raise ValueError("GITHUB_ASSET_SIZE_EXCEEDED")
                    handle.write(chunk)
                    digest.update(chunk)

        if not file_path.exists():
            raise ValueError("GITHUB_ASSET_DOWNLOAD_FAILED")
        size_bytes = file_path.stat().st_size

        return DownloadedGitHubReleaseAsset(
            repo=payload.repo,
            release_tag=str(release_payload.get("tag_name") or payload.tag or "latest"),
            asset_name=asset_name,
            release_url=str(release_payload.get("html_url") or "") or None,
            download_url=download_url,
            file_path=file_path,
            mime_type=str(asset.get("content_type") or "application/octet-stream"),
            size_bytes=size_bytes,
            sha256=digest.hexdigest(),
            signature_verified=False,
        )
