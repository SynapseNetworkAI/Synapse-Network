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
from app.services import reddit_media_download_service  # noqa: E402
from app.services.reddit_media_download.downloader import DownloadedMedia  # noqa: E402
from app.services.reddit_media_download.repository import (  # noqa: E402
    InMemoryRedditMediaDownloadRepository,
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
    service_id = reddit_media_download_service.SERVICE_ID
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
    repo = InMemoryRedditMediaDownloadRepository()
    media_file = tmp_path / "media.mp4"
    media_file.write_bytes(b"reddit-media")

    async def _fake_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedMedia(
            post_id="2abcde",
            subreddit="openai",
            author="agentbro",
            created_utc=1710931200,
            media_type="video",
            file_path=media_file,
            mime_type="video/mp4",
            sha256="abc123",
        )

    monkeypatch.setattr(reddit_media_download_service, "download_reddit_media", _fake_download)
    monkeypatch.setattr(reddit_media_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        reddit_media_download_service,
        "get_reddit_media_download_repository",
        lambda: repo,
    )
    return repo


def test_reddit_media_download_success(stub_runtime):
    client = TestClient(app)
    payload = {"postUrl": "https://www.reddit.com/r/openai/comments/2abcde/test_post/"}

    response = client.post(
        "/provider-services/reddit-media-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_reddit_media_download"
    assert body["result"]["status"] == "downloaded"
    assert body["result"]["media"]["storageBackend"] == "minio"
    assert len(stub_runtime.assets) == 1
    assert len(stub_runtime.invocations) == 1


def test_reddit_media_download_requires_signature():
    client = TestClient(app)
    response = client.post(
        "/provider-services/reddit-media-download/invoke",
        json={"postUrl": "https://www.reddit.com/r/openai/comments/2abcde/test_post/"},
    )

    assert response.status_code == 401


def test_reddit_media_download_invalid_url_rejected(stub_runtime):
    client = TestClient(app)
    payload = {"postUrl": "http://example.com/not-reddit"}

    response = client.post(
        "/provider-services/reddit-media-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422


def test_reddit_media_download_size_limit_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryRedditMediaDownloadRepository()

    async def _too_big(payload, *, target_dir):
        _ = payload
        _ = target_dir
        raise ValueError("REDDIT_MEDIA_SIZE_EXCEEDED")

    monkeypatch.setattr(reddit_media_download_service, "download_reddit_media", _too_big)
    monkeypatch.setattr(reddit_media_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        reddit_media_download_service,
        "get_reddit_media_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"postUrl": "https://www.reddit.com/r/openai/comments/2abcde/test_post/"}
    response = client.post(
        "/provider-services/reddit-media-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "REDDIT_MEDIA_SIZE_EXCEEDED"


def test_reddit_media_download_failure_without_snapshot_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryRedditMediaDownloadRepository()

    async def _boom(payload, *, target_dir):
        _ = payload
        _ = target_dir
        raise ValueError("REDDIT_MEDIA_DOWNLOAD_FAILED")

    monkeypatch.setattr(reddit_media_download_service, "download_reddit_media", _boom)
    monkeypatch.setattr(reddit_media_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        reddit_media_download_service,
        "get_reddit_media_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"postUrl": "https://www.reddit.com/r/openai/comments/2abcde/test_post/"}
    response = client.post(
        "/provider-services/reddit-media-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "REDDIT_MEDIA_DOWNLOAD_FAILED"
    assert len(repo.invocations) == 0


def test_reddit_media_download_idempotent_replay_hits_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    repo = InMemoryRedditMediaDownloadRepository()
    media_file = tmp_path / "media.mp4"
    media_file.write_bytes(b"reddit-media")
    calls = {"count": 0}

    async def _fake_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        calls["count"] += 1
        return DownloadedMedia(
            post_id="2abcde",
            subreddit="openai",
            author="agentbro",
            created_utc=1710931200,
            media_type="video",
            file_path=media_file,
            mime_type="video/mp4",
            sha256="abc123",
        )

    monkeypatch.setattr(reddit_media_download_service, "download_reddit_media", _fake_download)
    monkeypatch.setattr(reddit_media_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        reddit_media_download_service,
        "get_reddit_media_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"postUrl": "https://www.reddit.com/r/openai/comments/2abcde/test_post/"}
    first = client.post(
        "/provider-services/reddit-media-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    second = client.post(
        "/provider-services/reddit-media-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert calls["count"] == 1
    assert second.json()["freshness"]["cacheHit"] is True
    assert second.json()["errors"] == []
    assert len(repo.invocations) == 2
    assert repo.invocations[-1].cache_hit is True
    assert repo.invocations[-1].observability_payload["replayReason"] == "IDEMPOTENT_SNAPSHOT_REPLAY"


def test_reddit_media_download_snapshot_fallback(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    backing_repo = InMemoryRedditMediaDownloadRepository()
    media_file = tmp_path / "fallback.mp4"
    media_file.write_bytes(b"fallback-media")

    async def _ok_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedMedia(
            post_id="2abcde",
            subreddit="openai",
            author="agentbro",
            created_utc=1710931200,
            media_type="video",
            file_path=media_file,
            mime_type="video/mp4",
            sha256="zxy123",
        )

    monkeypatch.setattr(reddit_media_download_service, "download_reddit_media", _ok_download)
    monkeypatch.setattr(reddit_media_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        reddit_media_download_service,
        "get_reddit_media_download_repository",
        lambda: backing_repo,
    )

    payload = reddit_media_download_service.RedditMediaDownloadRequest.model_validate(
        {"postUrl": "https://www.reddit.com/r/openai/comments/2abcde/test_post/"}
    )
    first = __import__("asyncio").run(
        reddit_media_download_service.execute_reddit_media_download(
            payload,
            request_id="req-1",
            gateway_request_id="gw-1",
        )
    )
    assert first.result.status == "downloaded"

    async def _boom(_payload, *, target_dir):
        _ = target_dir
        raise ValueError("REDDIT_MEDIA_DOWNLOAD_FAILED")

    monkeypatch.setattr(reddit_media_download_service, "download_reddit_media", _boom)
    monkeypatch.setattr(
        reddit_media_download_service,
        "get_reddit_media_download_repository",
        lambda: ReplayAwareRepository(backing_repo),
    )

    replayed = __import__("asyncio").run(
        reddit_media_download_service.execute_reddit_media_download(
            payload,
            request_id="req-2",
            gateway_request_id="gw-2",
        )
    )

    assert replayed.freshness.cache_hit is True
    assert replayed.errors[-1].code == "REDDIT_MEDIA_SNAPSHOT_FALLBACK_USED"
