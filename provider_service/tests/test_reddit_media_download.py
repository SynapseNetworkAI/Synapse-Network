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
from app.services import reddit_media_download_service  # noqa: E402
from app.services.reddit_media_download.downloader import DownloadedMedia  # noqa: E402
from app.services.reddit_media_download.repository import (  # noqa: E402
    InMemoryRedditMediaDownloadRepository,
    PostgresRedditMediaDownloadRepository,
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


class SchemaCursor:
    def __init__(self, columns: set[str]) -> None:
        self.columns = columns
        self.executed: list[str] = []
        self._fetchall: list[tuple[str]] = []

    def execute(self, query: str, params=None) -> None:
        normalized = " ".join(query.split())
        self.executed.append(normalized)
        if normalized.startswith("SELECT column_name FROM information_schema.columns"):
            self._fetchall = [(column,) for column in sorted(self.columns)]
            return
        if normalized.startswith("ALTER TABLE provider_reddit_media_assets RENAME COLUMN media_kind TO media_type"):
            self.columns.discard("media_kind")
            self.columns.add("media_type")
            return
        if normalized.startswith("ALTER TABLE provider_reddit_media_assets ADD COLUMN max_file_size_mb"):
            self.columns.add("max_file_size_mb")
            return
        if normalized.startswith("ALTER TABLE provider_reddit_media_assets ADD COLUMN created_utc"):
            self.columns.add("created_utc")
            return
        raise AssertionError(f"unexpected query: {normalized}")

    def fetchall(self):
        return self._fetchall


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


def test_reddit_repository_repairs_legacy_schema_columns():
    cursor = SchemaCursor(
        {
            "asset_key",
            "post_id",
            "post_url",
            "subreddit",
            "author",
            "media_kind",
            "storage_backend",
            "storage_key",
            "mime_type",
            "size_bytes",
            "sha256",
            "download_status",
            "generated_at",
            "expires_at",
            "response_json",
            "created_at",
            "updated_at",
        }
    )
    repository = PostgresRedditMediaDownloadRepository(
        dsn="postgresql://postgres:postgres@localhost:5432/provider_service",
        asset_table="provider_reddit_media_assets",
        invocation_table="provider_api_invocations",
    )

    repository._ensure_asset_table_schema(cursor)

    assert "media_type" in cursor.columns
    assert "max_file_size_mb" in cursor.columns
    assert "created_utc" in cursor.columns


def test_reddit_media_download_size_limit_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryRedditMediaDownloadRepository()

    async def _too_big(_, *, target_dir):
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

    async def _boom(_, *, target_dir):
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
    call_count = 0

    async def _fake_download(_, *, target_dir):
        nonlocal call_count
        _ = target_dir
        call_count += 1
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
    assert call_count == 1
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


def test_reddit_media_download_timeout_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryRedditMediaDownloadRepository()

    async def _slow_download(_, *, target_dir):
        _ = target_dir
        await __import__("asyncio").sleep(0.05)
        raise AssertionError("should have timed out before download completed")

    monkeypatch.setattr(reddit_media_download_service, "download_reddit_media", _slow_download)
    monkeypatch.setattr(reddit_media_download_service, "build_video_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        reddit_media_download_service,
        "get_reddit_media_download_repository",
        lambda: repo,
    )
    monkeypatch.setattr(
        reddit_media_download_service,
        "get_settings",
        lambda: types.SimpleNamespace(
            reddit_media_cache_ttl_s=86400,
            reddit_media_tmp_dir="storage/reddit_media/tmp",
            reddit_media_download_timeout_s=0.001,
            reddit_media_max_concurrency=1,
            video_storage_key_prefix="reddit",
        ),
    )

    client = TestClient(app)
    payload = {"postUrl": "https://www.reddit.com/r/openai/comments/2abcde/test_post/"}
    response = client.post(
        "/provider-services/reddit-media-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "REDDIT_MEDIA_DOWNLOAD_TIMEOUT"
