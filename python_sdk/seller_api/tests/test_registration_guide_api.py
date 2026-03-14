# pyright: reportMissingImports=false

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "seller_api"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src.api.routers import services  # noqa: E402


def test_registration_guide_returns_field_metadata(monkeypatch):
    app = FastAPI()
    app.include_router(services.router, prefix="/api")

    monkeypatch.setattr(services.credential_service, "require_owner_wallet", lambda *_: "0xowner")

    client = TestClient(app)
    resp = client.get(
        "/api/v1/services/registration-guide",
        headers={"Authorization": "Bearer t", "X-User-Address": "0xowner"},
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "success"
    assert isinstance(payload.get("principles"), list)
    assert isinstance(payload.get("fields"), list)
    assert any(item.get("key") == "invoke.targets" for item in payload["fields"])
    assert any(item.get("key") == "healthCheck.path" for item in payload["fields"])
