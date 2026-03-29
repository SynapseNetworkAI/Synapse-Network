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
    media_file.write_bytes(b"demo-media")

    async def _fake_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedMedia(
            post_id="abc123",
            subreddit="MachineLearning",
            author="u/example",
            media_kind="video",
            file_path=media_file,
            mime_type="video/mp4",
            sha256="abc123",
        )

    monkeypatch.setattr(reddit_media_download_service, "download_reddit_media", _fake_download)
    monkeypatch.setattr(reddit_media_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(reddit_media_download_service, "get_reddit_media_download_repository", lambda: repo)
    return repo


def test_reddit_media_download_success(stub_runtime):
    client = TestClient(app)
    payload = {"postUrl": "https://www.reddit.com/r/MachineLearning/comments/abc123/sample_post/"}

    response = client.post(
        "/provider-services/reddit-media-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_reddit_media_download"
    assert body["result"]["status"] == "downloaded"
    assert body["result"]["meta"]["postId"] == "abc123"
    assert len(stub_runtime.assets) == 1
    assert len(stub_runtime.invocations) == 1


def test_reddit_media_download_requires_signature():
    client = TestClient(app)
    response = client.post(
        "/provider-services/reddit-media-download/invoke",
        json={"postUrl": "https://www.reddit.com/r/MachineLearning/comments/abc123/sample_post/"},
    )

    assert response.status_code == 401


def test_reddit_media_download_invalid_url_rejected(stub_runtime):
    client = TestClient(app)
    payload = {"postUrl": "https://example.com/not-reddit"}

    response = client.post(
        "/provider-services/reddit-media-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422


def test_reddit_media_download_snapshot_fallback(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    repo = InMemoryRedditMediaDownloadRepository()
    file_path = tmp_path / "fallback.mp4"
    file_path.write_bytes(b"fallback-media")

    async def _ok_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedMedia(
            post_id="abc123",
            subreddit="MachineLearning",
            author="u/example",
            media_kind="video",
            file_path=file_path,
            mime_type="video/mp4",
            sha256="zxy123",
        )

    monkeypatch.setattr(reddit_media_download_service, "download_reddit_media", _ok_download)
    monkeypatch.setattr(reddit_media_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(reddit_media_download_service, "get_reddit_media_download_repository", lambda: repo)

    payload = reddit_media_download_service.RedditMediaDownloadRequest.model_validate(
        {"postUrl": "https://www.reddit.com/r/MachineLearning/comments/abc123/sample_post/"}
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

    replayed = __import__("asyncio").run(
        reddit_media_download_service.execute_reddit_media_download(
            payload,
            request_id="req-2",
            gateway_request_id="gw-2",
        )
    )

    assert replayed.freshness.cache_hit is True
    assert replayed.errors[-1].code == "REDDIT_MEDIA_SNAPSHOT_FALLBACK_USED"
