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

from app.main import app  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.services import sentiment_service  # noqa: E402


def _signed_headers(payload: dict) -> dict[str, str]:
    settings = get_settings()
    service_id = sentiment_service.SERVICE_ID
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


def test_web3_sentiment_index_returns_structured_response_and_cache_hit():
    sentiment_service._snapshot_cache.clear()
    client = TestClient(app)

    payload = {
        "symbol": "ETH",
        "chain": "ethereum",
        "lookback_hours": 24,
        "include_narrative": True,
    }

    first_response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    assert first_response.status_code == 200
    first_body = first_response.json()

    assert first_body["service"]["serviceId"] == "svc_web3_sentiment_index"
    assert first_body["service"]["serviceName"] == "Web3 Sentiment Index"
    assert first_body["freshness"]["cacheHit"] is False
    assert first_body["result"]["symbol"] == "ETH"
    assert 0 <= first_body["result"]["sentiment_score"] <= 100
    assert first_body["result"]["trend_direction"] in {"up", "down", "sideways"}
    assert first_body["result"]["volatility_signal"] in {"low", "medium", "high"}
    assert len(first_body["result"]["reasoning_bullets"]) >= 2
    assert first_body["errors"] == []

    second_response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )
    assert second_response.status_code == 200
    second_body = second_response.json()
    assert second_body["freshness"]["cacheHit"] is True


def test_web3_sentiment_index_rejects_unsupported_symbol():
    sentiment_service._snapshot_cache.clear()
    client = TestClient(app)

    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json={"symbol": "DOGE"},
        headers=_signed_headers({"symbol": "DOGE"}),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any("symbol must be one of" in entry["msg"] for entry in detail)


def test_web3_sentiment_index_requires_gateway_signature():
    sentiment_service._snapshot_cache.clear()
    client = TestClient(app)

    response = client.post(
        "/provider-services/web3-sentiment-index/invoke",
        json={"symbol": "ETH"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GATEWAY_SIGNATURE_REQUIRED"
