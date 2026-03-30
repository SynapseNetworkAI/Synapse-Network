# pyright: reportMissingImports=false

import hashlib
import hmac
import json
import sys
import types
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services import twitter_video_download_service  # noqa: E402
from app.services.twitter_video_download.downloader import DownloadedVideo  # noqa: E402
from app.services.twitter_video_download.repository import (  # noqa: E402
    InMemoryTwitterVideoDownloadRepository,
)
from app.services.twitter_video_download.storage import StoredObject  # noqa: E402


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
    service_id = twitter_video_download_service.SERVICE_ID
    signed_at = "1710931200"
    body = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
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
    repo = InMemoryTwitterVideoDownloadRepository()

    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"demo-video")

    async def _fake_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedVideo(
            tweet_id="1900000000000000000",
            file_path=video_file,
            duration_sec=40,
            width=1280,
            height=720,
            mime_type="video/mp4",
            sha256="abc123",
        )

    monkeypatch.setattr(
        twitter_video_download_service,
        "download_twitter_video",
        _fake_download,
    )
    monkeypatch.setattr(
        twitter_video_download_service,
        "build_video_storage",
        lambda: FakeStorage(),
    )
    monkeypatch.setattr(
        twitter_video_download_service,
        "get_twitter_video_download_repository",
        lambda: repo,
    )
    return repo


def test_twitter_video_download_success(stub_runtime):
    client = TestClient(app)
    payload = {"postUrl": "https://x.com/openai/status/1900000000000000000"}

    response = client.post(
        "/provider-services/twitter-video-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_twitter_video_download"
    assert body["result"]["status"] == "downloaded"
    assert body["result"]["video"]["storageBackend"] == "minio"
    assert len(stub_runtime.assets) == 1
    assert len(stub_runtime.invocations) == 1


def test_twitter_video_download_requires_signature():
    client = TestClient(app)
    response = client.post(
        "/provider-services/twitter-video-download/invoke",
        json={"postUrl": "https://x.com/openai/status/1900000000000000000"},
    )

    assert response.status_code == 401


def test_twitter_video_download_invalid_url_rejected(stub_runtime):
    client = TestClient(app)
    payload = {"postUrl": "http://example.com/not-twitter"}

    response = client.post(
        "/provider-services/twitter-video-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422


def test_twitter_video_download_snapshot_fallback(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    repo = InMemoryTwitterVideoDownloadRepository()
    file_path = tmp_path / "fallback.mp4"
    file_path.write_bytes(b"fallback-video")

    async def _ok_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedVideo(
            tweet_id="1900000000000000000",
            file_path=file_path,
            duration_sec=42,
            width=1920,
            height=1080,
            mime_type="video/mp4",
            sha256="zxy123",
        )

    monkeypatch.setattr(twitter_video_download_service, "download_twitter_video", _ok_download)
    monkeypatch.setattr(twitter_video_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        twitter_video_download_service,
        "get_twitter_video_download_repository",
        lambda: repo,
    )

    payload = twitter_video_download_service.TwitterVideoDownloadRequest.model_validate(
        {"postUrl": "https://x.com/openai/status/1900000000000000000"}
    )
    first = __import__("asyncio").run(
        twitter_video_download_service.execute_twitter_video_download(
            payload,
            request_id="req-1",
            gateway_request_id="gw-1",
        )
    )
    assert first.result.status == "downloaded"

    async def _boom(_payload, *, target_dir):
        _ = target_dir
        raise ValueError("VIDEO_DOWNLOAD_FAILED")

    monkeypatch.setattr(twitter_video_download_service, "download_twitter_video", _boom)

    replayed = __import__("asyncio").run(
        twitter_video_download_service.execute_twitter_video_download(
            payload,
            request_id="req-2",
            gateway_request_id="gw-2",
        )
    )

    assert replayed.freshness.cache_hit is True
    assert replayed.errors[-1].code == "TWITTER_VIDEO_SNAPSHOT_FALLBACK_USED"


def test_twitter_video_download_timeout_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryTwitterVideoDownloadRepository()

    async def _slow_download(_, *, target_dir):
        _ = target_dir
        await __import__("asyncio").sleep(0.05)
        raise AssertionError("should have timed out before download completed")

    monkeypatch.setattr(twitter_video_download_service, "download_twitter_video", _slow_download)
    monkeypatch.setattr(twitter_video_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        twitter_video_download_service,
        "get_twitter_video_download_repository",
        lambda: repo,
    )
    monkeypatch.setattr(
        twitter_video_download_service,
        "get_settings",
        lambda: types.SimpleNamespace(
            twitter_video_cache_ttl_s=86400,
            twitter_video_tmp_dir="storage/twitter_videos/tmp",
            twitter_video_download_timeout_s=0.001,
            twitter_video_max_concurrency=1,
            video_storage_key_prefix="twitter",
        ),
    )

    client = TestClient(app)
    payload = {"postUrl": "https://x.com/openai/status/1900000000000000000"}
    response = client.post(
        "/provider-services/twitter-video-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "TWITTER_VIDEO_DOWNLOAD_TIMEOUT"
