# pyright: reportMissingImports=false

import hashlib
import hmac
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services import whale_flow_monitor_service  # noqa: E402


def _signed_headers(payload: dict) -> dict[str, str]:
    settings = get_settings()
    service_id = whale_flow_monitor_service.SERVICE_ID
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


def test_whale_flow_monitor_returns_structured_response():
    client = TestClient(app)
    payload = {
        "token": "ETH",
        "chain": "ethereum",
        "window_minutes": 60,
        "min_usd_value": 100000,
        "limit": 5,
    }

    response = client.post(
        "/provider-services/whale-flow-monitor/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_whale_flow_monitor"
    assert body["service"]["serviceName"] == "Whale Flow Monitor"
    assert body["freshness"]["cacheHit"] is False
    assert body["result"]["token"] == "ETH"
    assert body["result"]["chain"] == "ethereum"
    assert body["result"]["net_direction"] in {"net_inflow", "net_outflow", "mixed"}
    assert len(body["result"]["events"]) == 5
    assert all(event["usd_value"] >= 100000 for event in body["result"]["events"])


def test_whale_flow_monitor_requires_gateway_signature():
    client = TestClient(app)
    response = client.post(
        "/provider-services/whale-flow-monitor/invoke",
        json={"token": "ETH", "chain": "ethereum"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GATEWAY_SIGNATURE_REQUIRED"


def test_whale_flow_monitor_rejects_invalid_payload():
    client = TestClient(app)
    payload = {
        "token": "ETH",
        "chain": "ethereum",
        "window_minutes": 3,
    }

    response = client.post(
        "/provider-services/whale-flow-monitor/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422


def test_whale_flow_monitor_persists_snapshot_and_invocation(monkeypatch):
    from app.services.whale_flow_monitor.repository import InMemoryWhaleFlowRepository
    from app.services import whale_flow_monitor_service

    repository = InMemoryWhaleFlowRepository()
    monkeypatch.setattr(
        whale_flow_monitor_service,
        "get_whale_flow_repository",
        lambda: repository,
    )

    response = client = TestClient(app).post(
        "/provider-services/whale-flow-monitor/invoke",
        json={"token": "ETH", "chain": "ethereum"},
        headers=_signed_headers({"token": "ETH", "chain": "ethereum"}),
    )

    assert response.status_code == 200
    assert len(repository.snapshots) == 1
    assert len(repository.invocations) == 1
    assert repository.invocations[0].response_status == 200


def test_whale_flow_monitor_replay_from_snapshot_when_runtime_fails(monkeypatch):
    from app.services.whale_flow_monitor.repository import InMemoryWhaleFlowRepository
    from app.services.whale_flow_monitor.domain import WhaleFlowSnapshotRecord
    from app.services import whale_flow_monitor_service

    repository = InMemoryWhaleFlowRepository()
    payload = whale_flow_monitor_service.WhaleFlowMonitorRequest.model_validate(
        {"token": "ETH", "chain": "ethereum"}
    )
    live_response = __import__("asyncio").run(whale_flow_monitor_service.build_whale_flow_monitor(payload))
    snapshot_key = whale_flow_monitor_service.build_snapshot_key(payload)
    repository.save_snapshot(
        WhaleFlowSnapshotRecord(
            snapshot_key=snapshot_key,
            request=payload,
            response=live_response,
            expires_at="2099-01-01T00:00:00Z",
        )
    )

    async def _boom(_payload):
        raise RuntimeError("upstream failed")

    monkeypatch.setattr(whale_flow_monitor_service, "build_whale_flow_monitor", _boom)
    monkeypatch.setattr(whale_flow_monitor_service, "get_whale_flow_repository", lambda: repository)

    response = __import__("asyncio").run(
        whale_flow_monitor_service.execute_whale_flow_monitor(
            payload,
            request_id="req-1",
            gateway_request_id="gw-1",
        )
    )

    assert response.freshness.cache_hit is True
    assert response.errors[-1].code == "WHALE_FLOW_SNAPSHOT_FALLBACK_USED"
