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
from app.services import tiktok_video_download_service  # noqa: E402
from app.services.tiktok_video_download.downloader import DownloadedVideo  # noqa: E402
from app.services.tiktok_video_download.repository import (  # noqa: E402
    InMemoryTikTokVideoDownloadRepository,
)
from tests.helpers.download_replay import ReplayAwareRepository  # noqa: E402
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
    service_id = tiktok_video_download_service.SERVICE_ID
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
    repo = InMemoryTikTokVideoDownloadRepository()
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"demo-video")

    async def _fake_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedVideo(
            video_id="7499999999999999999",
            file_path=video_file,
            duration_sec=36,
            width=1080,
            height=1920,
            mime_type="video/mp4",
            sha256="abc123",
        )

    monkeypatch.setattr(tiktok_video_download_service, "download_tiktok_video", _fake_download)
    monkeypatch.setattr(tiktok_video_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        tiktok_video_download_service,
        "get_tiktok_video_download_repository",
        lambda: repo,
    )
    return repo


def test_tiktok_video_download_success(stub_runtime):
    client = TestClient(app)
    payload = {"videoUrl": "https://www.tiktok.com/@openai/video/7499999999999999999"}

    response = client.post(
        "/provider-services/tiktok-video-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_tiktok_video_download"
    assert body["result"]["status"] == "downloaded"
    assert body["result"]["video"]["storageBackend"] == "minio"
    assert len(stub_runtime.assets) == 1
    assert len(stub_runtime.invocations) == 1


def test_tiktok_video_download_requires_signature():
    client = TestClient(app)
    response = client.post(
        "/provider-services/tiktok-video-download/invoke",
        json={"videoUrl": "https://www.tiktok.com/@openai/video/7499999999999999999"},
    )

    assert response.status_code == 401


def test_tiktok_video_download_invalid_url_rejected(stub_runtime):
    client = TestClient(app)
    payload = {"videoUrl": "http://example.com/not-tiktok"}

    response = client.post(
        "/provider-services/tiktok-video-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422


def test_tiktok_video_download_duration_limit_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryTikTokVideoDownloadRepository()

    async def _too_long(_, *, target_dir):
        _ = target_dir
        raise ValueError("TIKTOK_VIDEO_DURATION_EXCEEDED")

    monkeypatch.setattr(tiktok_video_download_service, "download_tiktok_video", _too_long)
    monkeypatch.setattr(tiktok_video_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        tiktok_video_download_service,
        "get_tiktok_video_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"videoUrl": "https://www.tiktok.com/@openai/video/7499999999999999999"}
    response = client.post(
        "/provider-services/tiktok-video-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "TIKTOK_VIDEO_DURATION_EXCEEDED"


def test_tiktok_video_download_failure_without_snapshot_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryTikTokVideoDownloadRepository()

    async def _boom(_, *, target_dir):
        _ = target_dir
        raise ValueError("TIKTOK_VIDEO_DOWNLOAD_FAILED")

    monkeypatch.setattr(tiktok_video_download_service, "download_tiktok_video", _boom)
    monkeypatch.setattr(tiktok_video_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        tiktok_video_download_service,
        "get_tiktok_video_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"videoUrl": "https://www.tiktok.com/@openai/video/7499999999999999999"}
    response = client.post(
        "/provider-services/tiktok-video-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "TIKTOK_VIDEO_DOWNLOAD_FAILED"
    assert len(repo.invocations) == 0


def test_tiktok_video_download_idempotent_replay_hits_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    repo = InMemoryTikTokVideoDownloadRepository()
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"demo-video")
    call_count = 0

    async def _fake_download(_, *, target_dir):
        nonlocal call_count
        _ = target_dir
        call_count += 1
        return DownloadedVideo(
            video_id="7499999999999999999",
            file_path=video_file,
            duration_sec=36,
            width=1080,
            height=1920,
            mime_type="video/mp4",
            sha256="abc123",
        )

    monkeypatch.setattr(tiktok_video_download_service, "download_tiktok_video", _fake_download)
    monkeypatch.setattr(tiktok_video_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        tiktok_video_download_service,
        "get_tiktok_video_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"videoUrl": "https://www.tiktok.com/@openai/video/7499999999999999999"}
    first = client.post(
        "/provider-services/tiktok-video-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    second = client.post(
        "/provider-services/tiktok-video-download/invoke",
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


def test_tiktok_video_download_snapshot_fallback(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    backing_repo = InMemoryTikTokVideoDownloadRepository()
    file_path = tmp_path / "fallback.mp4"
    file_path.write_bytes(b"fallback-video")

    async def _ok_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedVideo(
            video_id="7499999999999999999",
            file_path=file_path,
            duration_sec=36,
            width=1080,
            height=1920,
            mime_type="video/mp4",
            sha256="zxy123",
        )

    monkeypatch.setattr(tiktok_video_download_service, "download_tiktok_video", _ok_download)
    monkeypatch.setattr(tiktok_video_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        tiktok_video_download_service,
        "get_tiktok_video_download_repository",
        lambda: backing_repo,
    )

    payload = tiktok_video_download_service.TikTokVideoDownloadRequest.model_validate(
        {"videoUrl": "https://www.tiktok.com/@openai/video/7499999999999999999"}
    )
    first = __import__("asyncio").run(
        tiktok_video_download_service.execute_tiktok_video_download(
            payload,
            request_id="req-1",
            gateway_request_id="gw-1",
        )
    )
    assert first.result.status == "downloaded"

    async def _boom(_payload, *, target_dir):
        _ = target_dir
        raise ValueError("TIKTOK_VIDEO_DOWNLOAD_FAILED")

    monkeypatch.setattr(tiktok_video_download_service, "download_tiktok_video", _boom)
    monkeypatch.setattr(
        tiktok_video_download_service,
        "get_tiktok_video_download_repository",
        lambda: ReplayAwareRepository(backing_repo),
    )

    replayed = __import__("asyncio").run(
        tiktok_video_download_service.execute_tiktok_video_download(
            payload,
            request_id="req-2",
            gateway_request_id="gw-2",
        )
    )

    assert replayed.freshness.cache_hit is True
    assert replayed.errors[-1].code == "TIKTOK_VIDEO_SNAPSHOT_FALLBACK_USED"


def test_tiktok_video_download_timeout_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryTikTokVideoDownloadRepository()

    async def _slow_download(_, *, target_dir):
        _ = target_dir
        await __import__("asyncio").sleep(0.05)
        raise AssertionError("should have timed out before download completed")

    monkeypatch.setattr(tiktok_video_download_service, "download_tiktok_video", _slow_download)
    monkeypatch.setattr(tiktok_video_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        tiktok_video_download_service,
        "get_tiktok_video_download_repository",
        lambda: repo,
    )
    monkeypatch.setattr(
        tiktok_video_download_service,
        "get_settings",
        lambda: types.SimpleNamespace(
            tiktok_video_cache_ttl_s=86400,
            tiktok_video_tmp_dir="storage/tiktok_videos/tmp",
            tiktok_video_download_timeout_s=0.001,
            tiktok_video_max_concurrency=1,
            video_storage_key_prefix="tiktok",
        ),
    )

    client = TestClient(app)
    payload = {"videoUrl": "https://www.tiktok.com/@openai/video/7499999999999999999"}
    response = client.post(
        "/provider-services/tiktok-video-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "TIKTOK_VIDEO_DOWNLOAD_TIMEOUT"
