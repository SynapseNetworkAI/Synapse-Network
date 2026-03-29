# pyright: reportMissingImports=false

import hashlib
import hmac
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services import github_release_asset_download_service  # noqa: E402
from app.services.github_release_asset_download.downloader import (  # noqa: E402
    DownloadedGitHubReleaseAsset,
)
from app.services.github_release_asset_download.repository import (  # noqa: E402
    InMemoryGitHubReleaseAssetDownloadRepository,
)
from app.services.twitter_video_download.storage import StoredObject  # noqa: E402
from tests.helpers.download_replay import ReplayAwareRepository  # noqa: E402


class FakeStorage:
    def put_file(self, *, source_path: Path, target_key: str, content_type: str) -> StoredObject:
        assert source_path.exists()
        return StoredObject(
            key=target_key,
            backend="minio",
            content_type=content_type,
            size_bytes=source_path.stat().st_size,
        )


def _signed_headers(payload: dict) -> dict[str, str]:
    settings = get_settings()
    service_id = github_release_asset_download_service.SERVICE_ID
    signed_at = "1710931200"
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(body).hexdigest()
    canonical = f"{service_id}.{signed_at}.{digest}"
    signature = hmac.new(
        settings.gateway_provider_signature_secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Synapse-Service-Id": service_id,
        "X-Synapse-Signed-At": signed_at,
        "X-Synapse-Signature": signature,
    }


@pytest.fixture
def stub_runtime(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    repo = InMemoryGitHubReleaseAssetDownloadRepository()
    asset_file = tmp_path / "openai-python.tar.gz"
    asset_file.write_bytes(b"github-release")

    async def _fake_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedGitHubReleaseAsset(
            repo="openai/openai-python",
            release_tag="v1.0.0",
            asset_name="openai-python.tar.gz",
            release_url="https://github.com/openai/openai-python/releases/tag/v1.0.0",
            download_url="https://github.com/openai/openai-python/releases/download/v1.0.0/openai-python.tar.gz",
            file_path=asset_file,
            mime_type="application/gzip",
            size_bytes=asset_file.stat().st_size,
            sha256="abc123",
            signature_verified=False,
        )

    monkeypatch.setattr(
        github_release_asset_download_service,
        "download_github_release_asset",
        _fake_download,
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "build_video_storage",
        lambda: FakeStorage(),
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "get_github_release_asset_download_repository",
        lambda: repo,
    )
    return repo


def test_github_release_asset_download_success(stub_runtime):
    client = TestClient(app)
    payload = {
        "repo": "openai/openai-python",
        "tag": "v1.0.0",
        "assetPattern": "*.tar.gz",
    }

    response = client.post(
        "/provider-services/github-release-asset-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_github_release_asset_download"
    assert body["result"]["status"] == "downloaded"
    assert body["result"]["asset"]["storageBackend"] == "minio"
    assert body["result"]["signatureVerified"] is False
    assert len(stub_runtime.assets) == 1
    assert len(stub_runtime.invocations) == 1


def test_github_release_asset_download_requires_signature():
    client = TestClient(app)
    response = client.post(
        "/provider-services/github-release-asset-download/invoke",
        json={"repo": "openai/openai-python", "latest": True},
    )

    assert response.status_code == 401


def test_github_release_asset_download_invalid_repo_rejected(stub_runtime):
    client = TestClient(app)
    payload = {"repo": "openai", "tag": "v1.0.0"}

    response = client.post(
        "/provider-services/github-release-asset-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422


def test_github_release_asset_download_size_limit_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryGitHubReleaseAssetDownloadRepository()

    async def _too_big(_, *, target_dir):
        _ = target_dir
        raise ValueError("GITHUB_ASSET_SIZE_EXCEEDED")

    monkeypatch.setattr(
        github_release_asset_download_service,
        "download_github_release_asset",
        _too_big,
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "build_video_storage",
        lambda: FakeStorage(),
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "get_github_release_asset_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"repo": "openai/openai-python", "latest": True}
    response = client.post(
        "/provider-services/github-release-asset-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "GITHUB_ASSET_SIZE_EXCEEDED"


def test_github_release_asset_download_failure_without_snapshot_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryGitHubReleaseAssetDownloadRepository()

    async def _boom(_, *, target_dir):
        _ = target_dir
        raise ValueError("GITHUB_ASSET_DOWNLOAD_FAILED")

    monkeypatch.setattr(
        github_release_asset_download_service,
        "download_github_release_asset",
        _boom,
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "build_video_storage",
        lambda: FakeStorage(),
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "get_github_release_asset_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"repo": "openai/openai-python", "latest": True}
    response = client.post(
        "/provider-services/github-release-asset-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "GITHUB_ASSET_DOWNLOAD_FAILED"
    assert len(repo.invocations) == 0


def test_github_release_asset_download_idempotent_replay_hits_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    repo = InMemoryGitHubReleaseAssetDownloadRepository()
    asset_file = tmp_path / "openai-python.tar.gz"
    asset_file.write_bytes(b"github-release")
    call_count = 0

    async def _fake_download(_, *, target_dir):
        nonlocal call_count
        _ = target_dir
        call_count += 1
        return DownloadedGitHubReleaseAsset(
            repo="openai/openai-python",
            release_tag="v1.0.0",
            asset_name="openai-python.tar.gz",
            release_url="https://github.com/openai/openai-python/releases/tag/v1.0.0",
            download_url="https://github.com/openai/openai-python/releases/download/v1.0.0/openai-python.tar.gz",
            file_path=asset_file,
            mime_type="application/gzip",
            size_bytes=asset_file.stat().st_size,
            sha256="abc123",
            signature_verified=False,
        )

    monkeypatch.setattr(
        github_release_asset_download_service,
        "download_github_release_asset",
        _fake_download,
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "build_video_storage",
        lambda: FakeStorage(),
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "get_github_release_asset_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"repo": "openai/openai-python", "latest": True}
    first = client.post(
        "/provider-services/github-release-asset-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    second = client.post(
        "/provider-services/github-release-asset-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert call_count == 1
    assert second.json()["freshness"]["cacheHit"] is True
    assert second.json()["errors"] == []
    assert len(repo.invocations) == 2
    assert repo.invocations[-1].cache_hit is True
    assert repo.invocations[-1].observability_payload["replayReason"] == "IDEMPOTENT_SNAPSHOT_REPLAY"


def test_github_release_asset_download_snapshot_fallback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    backing_repo = InMemoryGitHubReleaseAssetDownloadRepository()
    asset_file = tmp_path / "fallback.tar.gz"
    asset_file.write_bytes(b"github-release-fallback")

    async def _ok_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedGitHubReleaseAsset(
            repo="openai/openai-python",
            release_tag="v1.0.0",
            asset_name="fallback.tar.gz",
            release_url="https://github.com/openai/openai-python/releases/tag/v1.0.0",
            download_url="https://github.com/openai/openai-python/releases/download/v1.0.0/fallback.tar.gz",
            file_path=asset_file,
            mime_type="application/gzip",
            size_bytes=asset_file.stat().st_size,
            sha256="zxy123",
            signature_verified=False,
        )

    monkeypatch.setattr(
        github_release_asset_download_service,
        "download_github_release_asset",
        _ok_download,
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "build_video_storage",
        lambda: FakeStorage(),
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "get_github_release_asset_download_repository",
        lambda: backing_repo,
    )

    client = TestClient(app)
    payload = {"repo": "openai/openai-python", "latest": True}
    warm = client.post(
        "/provider-services/github-release-asset-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    assert warm.status_code == 200

    replay_repo = ReplayAwareRepository(backing_repo)

    async def _boom(payload, *, target_dir):
        _ = payload
        _ = target_dir
        raise ValueError("GITHUB_ASSET_DOWNLOAD_FAILED")

    monkeypatch.setattr(
        github_release_asset_download_service,
        "download_github_release_asset",
        _boom,
    )
    monkeypatch.setattr(
        github_release_asset_download_service,
        "get_github_release_asset_download_repository",
        lambda: replay_repo,
    )

    replay = client.post(
        "/provider-services/github-release-asset-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert replay.status_code == 200
    body = replay.json()
    assert body["freshness"]["cacheHit"] is True
    assert body["errors"][-1]["code"] == "GITHUB_ASSET_SNAPSHOT_FALLBACK_USED"
    assert replay_repo.invocations[-1].cache_hit is True
