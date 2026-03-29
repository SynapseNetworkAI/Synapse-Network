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
from app.services import paper_pdf_download_service  # noqa: E402
from app.services.paper_pdf_download.downloader import DownloadedPaperPdf  # noqa: E402
from app.services.paper_pdf_download.repository import (  # noqa: E402
    InMemoryPaperPdfDownloadRepository,
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
    service_id = paper_pdf_download_service.SERVICE_ID
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
    repo = InMemoryPaperPdfDownloadRepository()
    pdf_file = tmp_path / "paper.pdf"
    pdf_file.write_bytes(b"%PDF-1.7 fake paper")

    async def _fake_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedPaperPdf(
            source="arxiv",
            paper_id="2401.00001",
            source_url="https://arxiv.org/abs/2401.00001",
            file_path=pdf_file,
            mime_type="application/pdf",
            size_bytes=pdf_file.stat().st_size,
            sha256="abc123",
            title="Agent Economy Infra",
            authors=["Cliff", "Synapse Bot"],
            year=2026,
            doi=None,
        )

    monkeypatch.setattr(paper_pdf_download_service, "download_paper_pdf", _fake_download)
    monkeypatch.setattr(paper_pdf_download_service, "build_asset_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        paper_pdf_download_service,
        "get_paper_pdf_download_repository",
        lambda: repo,
    )
    return repo


def test_paper_pdf_download_success(stub_runtime):
    client = TestClient(app)
    payload = {"paperId": "2401.00001", "source": "arxiv"}

    response = client.post(
        "/provider-services/paper-pdf-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_paper_pdf_download"
    assert body["result"]["status"] == "downloaded"
    assert body["result"]["pdf"]["storageBackend"] == "minio"
    assert body["result"]["metadata"]["title"] == "Agent Economy Infra"
    assert len(stub_runtime.assets) == 1
    assert len(stub_runtime.invocations) == 1


def test_paper_pdf_download_requires_signature():
    client = TestClient(app)
    response = client.post(
        "/provider-services/paper-pdf-download/invoke",
        json={"paperId": "2401.00001", "source": "arxiv"},
    )

    assert response.status_code == 401


def test_paper_pdf_download_invalid_payload_rejected(stub_runtime):
    client = TestClient(app)
    payload = {"paperUrl": "http://arxiv.org/abs/2401.00001", "source": "arxiv"}

    response = client.post(
        "/provider-services/paper-pdf-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422


def test_paper_pdf_download_size_limit_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryPaperPdfDownloadRepository()

    async def _too_big(_, *, target_dir):
        _ = target_dir
        raise ValueError("PAPER_PDF_SIZE_EXCEEDED")

    monkeypatch.setattr(paper_pdf_download_service, "download_paper_pdf", _too_big)
    monkeypatch.setattr(paper_pdf_download_service, "build_asset_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        paper_pdf_download_service,
        "get_paper_pdf_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"paperId": "2401.00001", "source": "arxiv"}
    response = client.post(
        "/provider-services/paper-pdf-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "PAPER_PDF_SIZE_EXCEEDED"


def test_paper_pdf_download_failure_without_snapshot_returns_502(
    monkeypatch: pytest.MonkeyPatch,
):
    repo = InMemoryPaperPdfDownloadRepository()

    async def _boom(_, *, target_dir):
        _ = target_dir
        raise ValueError("PAPER_PDF_DOWNLOAD_FAILED")

    monkeypatch.setattr(paper_pdf_download_service, "download_paper_pdf", _boom)
    monkeypatch.setattr(paper_pdf_download_service, "build_asset_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        paper_pdf_download_service,
        "get_paper_pdf_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"paperId": "2401.00001", "source": "arxiv"}
    response = client.post(
        "/provider-services/paper-pdf-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "PAPER_PDF_DOWNLOAD_FAILED"
    assert len(repo.invocations) == 0


def test_paper_pdf_download_idempotent_replay_hits_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    repo = InMemoryPaperPdfDownloadRepository()
    pdf_file = tmp_path / "paper.pdf"
    pdf_file.write_bytes(b"%PDF-1.7 fake paper")
    call_count = 0

    async def _fake_download(_, *, target_dir):
        nonlocal call_count
        _ = target_dir
        call_count += 1
        return DownloadedPaperPdf(
            source="arxiv",
            paper_id="2401.00001",
            source_url="https://arxiv.org/abs/2401.00001",
            file_path=pdf_file,
            mime_type="application/pdf",
            size_bytes=pdf_file.stat().st_size,
            sha256="abc123",
            title="Agent Economy Infra",
            authors=["Cliff", "Synapse Bot"],
            year=2026,
            doi=None,
        )

    monkeypatch.setattr(paper_pdf_download_service, "download_paper_pdf", _fake_download)
    monkeypatch.setattr(paper_pdf_download_service, "build_asset_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        paper_pdf_download_service,
        "get_paper_pdf_download_repository",
        lambda: repo,
    )

    client = TestClient(app)
    payload = {"paperId": "2401.00001", "source": "arxiv"}
    first = client.post(
        "/provider-services/paper-pdf-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    second = client.post(
        "/provider-services/paper-pdf-download/invoke",
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


def test_paper_pdf_download_snapshot_fallback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    backing_repo = InMemoryPaperPdfDownloadRepository()
    pdf_file = tmp_path / "fallback.pdf"
    pdf_file.write_bytes(b"%PDF-1.7 fallback paper")

    async def _ok_download(payload, *, target_dir):
        _ = payload
        _ = target_dir
        return DownloadedPaperPdf(
            source="arxiv",
            paper_id="2401.00001",
            source_url="https://arxiv.org/abs/2401.00001",
            file_path=pdf_file,
            mime_type="application/pdf",
            size_bytes=pdf_file.stat().st_size,
            sha256="zxy123",
            title="Fallback Paper",
            authors=["Cliff"],
            year=2026,
            doi=None,
        )

    monkeypatch.setattr(paper_pdf_download_service, "download_paper_pdf", _ok_download)
    monkeypatch.setattr(paper_pdf_download_service, "build_asset_storage", lambda: FakeStorage())
    monkeypatch.setattr(
        paper_pdf_download_service,
        "get_paper_pdf_download_repository",
        lambda: backing_repo,
    )

    client = TestClient(app)
    payload = {"paperId": "2401.00001", "source": "arxiv"}
    warm = client.post(
        "/provider-services/paper-pdf-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    assert warm.status_code == 200

    replay_repo = ReplayAwareRepository(backing_repo)

    async def _boom(payload, *, target_dir):
        _ = payload
        _ = target_dir
        raise ValueError("PAPER_PDF_DOWNLOAD_FAILED")

    monkeypatch.setattr(paper_pdf_download_service, "download_paper_pdf", _boom)
    monkeypatch.setattr(
        paper_pdf_download_service,
        "get_paper_pdf_download_repository",
        lambda: replay_repo,
    )

    replay = client.post(
        "/provider-services/paper-pdf-download/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert replay.status_code == 200
    body = replay.json()
    assert body["freshness"]["cacheHit"] is True
    assert body["errors"][-1]["code"] == "PAPER_PDF_SNAPSHOT_FALLBACK_USED"
    assert replay_repo.invocations[-1].cache_hit is True
