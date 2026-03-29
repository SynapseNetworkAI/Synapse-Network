# pyright: reportMissingImports=false

import asyncio
import hashlib
import hmac
import json
from datetime import UTC, datetime
import sys
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services import protocol_fundamental_brief_service  # noqa: E402
from app.services.protocol_fundamental_brief.domain import (  # noqa: E402
    DefiLlamaProtocolObservation,
    DexScreenerMarketObservation,
    ProtocolBriefSnapshotKey,
    ProtocolBriefSnapshotRecord,
)
from app.services.protocol_fundamental_brief import plugins as brief_plugins  # noqa: E402


class NoopProtocolBriefRepository:
    def load_snapshot(self, brief_key: str):
        _ = brief_key
        return None

    def save_snapshot(self, record):
        _ = record

    def append_raw_feed_records(self, records):
        _ = records


def _fake_plugin_observation(
    *,
    source_name: str,
    freshness_sec: int,
) -> brief_plugins.ProtocolBriefObservation:
    timestamp = datetime(2026, 3, 24, 13, 0, tzinfo=UTC).isoformat().replace(
        "+00:00",
        "Z",
    )
    if source_name == "defillama_protocol":
        return DefiLlamaProtocolObservation(
            freshness_sec=freshness_sec,
            source_timestamp=timestamp,
            fetched_at=timestamp,
            latency_ms=42,
            retry_count=0,
            timeout_ms=3000,
            http_status=200,
            payload_hash=f"{source_name}-hash",
            protocol_slug="aave",
            protocol_display_name="Aave",
            protocol_symbol="AAVE",
            category="Lending",
            tvl_usd_current=5_200_000_000.0,
            tvl_change_7d_pct=-5.3,
            fees_24h_usd=320_000.0,
            revenue_24h_usd=180_000.0,
            excerpt={
                "protocolSlug": "aave",
                "displayName": "Aave",
                "category": "Lending",
                "tvlUsd": 5_200_000_000.0,
                "chainCount": 6,
                "fees24hUsd": 320_000.0,
                "revenue24hUsd": 180_000.0,
            },
        )
    return DexScreenerMarketObservation(
        freshness_sec=freshness_sec,
        source_timestamp=timestamp,
        fetched_at=timestamp,
        latency_ms=42,
        retry_count=0,
        timeout_ms=3000,
        http_status=200,
        payload_hash=f"{source_name}-hash",
        chain_id="ethereum",
        pair_address="0xpair",
        dex_id="uniswap",
        base_token_symbol="AAVE",
        quote_token_symbol="USDC",
        labels=("bluechip",),
        spot_price_usd=96.2,
        price_change_5m_pct=0.2,
        price_change_1h_pct=0.8,
        price_change_6h_pct=1.9,
        price_change_24h_pct=4.3,
        liquidity_usd=5_400_000.0,
        volume_24h_usd=12_800_000.0,
        buy_txn_24h=1812,
        sell_txn_24h=1654,
        excerpt={
            "chainId": "ethereum",
            "pairAddress": "0xpair",
            "dexId": "uniswap",
            "baseSymbol": "AAVE",
            "quoteSymbol": "USDC",
            "liquidityUsd": 5_400_000.0,
            "volume24hUsd": 12_800_000.0,
        },
    )


def _signed_headers(payload: dict) -> dict[str, str]:
    settings = get_settings()
    service_id = protocol_fundamental_brief_service.SERVICE_ID
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


def _fake_peer_defillama_observation(
    *,
    protocol_display_name: str,
    tvl_usd_current: float,
    tvl_change_30d_pct: float,
    revenue_30d_usd: float,
):
    timestamp = datetime(2026, 3, 24, 13, 0, tzinfo=UTC).isoformat().replace(
        "+00:00",
        "Z",
    )
    return DefiLlamaProtocolObservation(
        freshness_sec=120,
        source_timestamp=timestamp,
        fetched_at=timestamp,
        latency_ms=40,
        retry_count=0,
        timeout_ms=3000,
        http_status=200,
        payload_hash=f"{protocol_display_name}-hash",
        protocol_slug=protocol_display_name.lower(),
        protocol_display_name=protocol_display_name,
        protocol_symbol=protocol_display_name[:4].upper(),
        category="Lending",
        supported_chains=("ethereum", "arbitrum"),
        chain_tvl_breakdown=(),
        tvl_usd_current=tvl_usd_current,
        tvl_change_1d_pct=0.8,
        tvl_change_7d_pct=1.4,
        tvl_change_30d_pct=tvl_change_30d_pct,
        fees_24h_usd=90_000.0,
        fees_7d_usd=640_000.0,
        fees_30d_usd=2_600_000.0,
        revenue_24h_usd=40_000.0,
        revenue_7d_usd=280_000.0,
        revenue_30d_usd=revenue_30d_usd,
        excerpt={
            "protocolSlug": protocol_display_name.lower(),
            "displayName": protocol_display_name,
            "category": "Lending",
            "tvlUsd": tvl_usd_current,
            "chainCount": 2,
            "fees24hUsd": 90_000.0,
            "revenue24hUsd": 40_000.0,
        },
    )


def test_protocol_fundamental_brief_returns_structured_response(
    monkeypatch: pytest.MonkeyPatch,
):
    protocol_fundamental_brief_service._snapshot_cache.clear()

    async def _fake_collect_live_observations(_payload):
        await asyncio.sleep(0)
        return (
            (
                _fake_plugin_observation(
                    source_name="defillama_protocol",
                    freshness_sec=180,
                ),
                _fake_plugin_observation(
                    source_name="dexscreener_market",
                    freshness_sec=30,
                ),
            ),
            [],
            [],
        )

    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "_collect_live_observations",
        _fake_collect_live_observations,
    )
    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "get_protocol_brief_repository",
        lambda: NoopProtocolBriefRepository(),
    )
    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "_collect_peer_observations",
        lambda _payload: asyncio.sleep(0, result=(
            _fake_peer_defillama_observation(
                protocol_display_name="Compound",
                tvl_usd_current=2_800_000_000.0,
                tvl_change_30d_pct=1.1,
                revenue_30d_usd=1_200_000.0,
            ),
            _fake_peer_defillama_observation(
                protocol_display_name="Morpho",
                tvl_usd_current=1_900_000_000.0,
                tvl_change_30d_pct=3.4,
                revenue_30d_usd=900_000.0,
            ),
        )),
    )

    client = TestClient(app)
    payload = {
        "protocol": "Aave",
        "chain": "ethereum",
        "peer_set": ["Compound", "Morpho"],
        "lookback_days": 30,
    }

    response = client.post(
        "/provider-services/protocol-fundamental-brief/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_protocol_fundamental_brief"
    assert body["service"]["serviceName"] == "Protocol Fundamental Brief"
    assert body["sources"] == [
        {"name": "defillama_protocol", "freshnessSec": 180},
        {"name": "dexscreener_market", "freshnessSec": 30},
    ]
    assert body["freshness"]["cacheHit"] is False
    assert body["freshness"]["maxSourceAgeSec"] == 180
    assert body["result"]["protocol"] == "Aave"
    assert "price context is positive" in body["result"]["price_summary"]
    assert "TVL is" in body["result"]["tvl_summary"]
    assert len(body["result"]["revenue_signals"]) >= 1
    assert len(body["result"]["risk_flags"]) >= 1
    assert len(body["result"]["peer_comparison"]) >= 1
    assert "Phase 2" not in body["result"]["operator_view"]
    assert body["errors"] == []


def test_protocol_fundamental_brief_preserves_request_id_header(
    monkeypatch: pytest.MonkeyPatch,
):
    protocol_fundamental_brief_service._snapshot_cache.clear()

    async def _fake_collect_live_observations(_payload):
        await asyncio.sleep(0)
        return ((), [], [])

    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "_collect_live_observations",
        _fake_collect_live_observations,
    )
    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "get_protocol_brief_repository",
        lambda: NoopProtocolBriefRepository(),
    )

    client = TestClient(app)
    payload = {"protocol": "Uniswap"}

    response = client.post(
        "/provider-services/protocol-fundamental-brief/invoke",
        json=payload,
        headers={
            **_signed_headers(payload),
            "X-Request-Id": "req-protocol-brief-smoke",
        },
    )

    assert response.status_code == 200
    assert response.headers["X-Request-Id"] == "req-protocol-brief-smoke"


def test_protocol_fundamental_brief_surfaces_source_errors(
    monkeypatch: pytest.MonkeyPatch,
):
    protocol_fundamental_brief_service._snapshot_cache.clear()

    async def _fake_collect_live_observations(_payload):
        await asyncio.sleep(0)
        return (
            (
                _fake_plugin_observation(
                    source_name="defillama_protocol",
                    freshness_sec=240,
                ),
            ),
            [],
            [
                protocol_fundamental_brief_service.ErrorRecord(
                    code="DEXSCREENER_MARKET_UNAVAILABLE",
                    message="DexScreener market feed unavailable: upstream timeout",
                )
            ],
        )

    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "_collect_live_observations",
        _fake_collect_live_observations,
    )
    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "get_protocol_brief_repository",
        lambda: NoopProtocolBriefRepository(),
    )

    client = TestClient(app)
    payload = {"protocol": "Aave"}

    response = client.post(
        "/provider-services/protocol-fundamental-brief/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["sources"] == [{"name": "defillama_protocol", "freshnessSec": 240}]
    assert body["errors"][0]["code"] == "DEXSCREENER_MARKET_UNAVAILABLE"
    assert any(
        "DEXSCREENER_MARKET_UNAVAILABLE" in risk_flag
        for risk_flag in body["result"]["risk_flags"]
    )


def test_protocol_fundamental_brief_uses_persisted_snapshot_before_refresh(
    monkeypatch: pytest.MonkeyPatch,
):
    protocol_fundamental_brief_service._snapshot_cache.clear()

    class FakeRepository:
        def __init__(self, snapshot: ProtocolBriefSnapshotRecord) -> None:
            self.snapshot = snapshot

        def load_snapshot(self, brief_key: str):
            assert brief_key == self.snapshot.brief_key
            return self.snapshot

        def save_snapshot(self, record):
            raise AssertionError("save_snapshot should not run on cached read")

        def append_raw_feed_records(self, records):
            raise AssertionError("append_raw_feed_records should not run on cached read")

    payload = {"protocol": "Aave", "chain": "ethereum", "lookback_days": 30}
    request = protocol_fundamental_brief_service.ProtocolFundamentalBriefRequest.model_validate(payload)
    live_response = protocol_fundamental_brief_service.ProtocolFundamentalBriefResponse.model_validate(
        {
            "service": {
                "serviceId": protocol_fundamental_brief_service.SERVICE_ID,
                "serviceName": protocol_fundamental_brief_service.SERVICE_NAME,
                "version": protocol_fundamental_brief_service.SERVICE_VERSION,
            },
            "sources": [{"name": "defillama_protocol", "freshnessSec": 120}],
            "freshness": {
                "generatedAt": "2099-03-24T12:00:00Z",
                "maxSourceAgeSec": 120,
                "cacheHit": False,
            },
            "result": {
                "protocol": "Aave",
                "price_summary": "cached-price",
                "tvl_summary": "cached-tvl",
                "revenue_signals": ["cached-revenue"],
                "peer_comparison": [],
                "risk_flags": ["cached-risk"],
                "operator_view": "cached-view",
            },
            "errors": [],
        }
    )
    snapshot = ProtocolBriefSnapshotRecord(
        brief_key=ProtocolBriefSnapshotKey.from_request(request).value,
        request=request,
        response=live_response,
        source_generated_at="2099-03-24T11:58:00Z",
        expires_at="2099-03-24T12:05:00Z",
    )

    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "get_protocol_brief_repository",
        lambda: FakeRepository(snapshot),
    )

    async def _unexpected_collect(_payload):
        raise AssertionError("live collection should not run when persisted snapshot is fresh")

    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "_collect_live_observations",
        _unexpected_collect,
    )

    client = TestClient(app)
    response = client.post(
        "/provider-services/protocol-fundamental-brief/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["freshness"]["cacheHit"] is True
    assert body["result"]["price_summary"] == "cached-price"


def test_protocol_fundamental_brief_uses_in_memory_snapshot_before_repository(
    monkeypatch: pytest.MonkeyPatch,
):
    protocol_fundamental_brief_service._snapshot_cache.clear()

    class FailIfTouchedRepository:
        def load_snapshot(self, brief_key: str):
            raise AssertionError(f"repository load should not run for in-memory cache hit: {brief_key}")

        def save_snapshot(self, record):
            raise AssertionError(f"repository save should not run for in-memory cache hit: {record}")

        def append_raw_feed_records(self, records):
            raise AssertionError(f"raw feed append should not run for in-memory cache hit: {records}")

    payload = {"protocol": "Aave", "chain": "ethereum", "lookback_days": 30}
    request = protocol_fundamental_brief_service.ProtocolFundamentalBriefRequest.model_validate(payload)
    live_response = protocol_fundamental_brief_service.ProtocolFundamentalBriefResponse.model_validate(
        {
            "service": {
                "serviceId": protocol_fundamental_brief_service.SERVICE_ID,
                "serviceName": protocol_fundamental_brief_service.SERVICE_NAME,
                "version": protocol_fundamental_brief_service.SERVICE_VERSION,
            },
            "sources": [{"name": "defillama_protocol", "freshnessSec": 60}],
            "freshness": {
                "generatedAt": "2099-03-24T12:00:00Z",
                "maxSourceAgeSec": 60,
                "cacheHit": False,
            },
            "result": {
                "protocol": "Aave",
                "price_summary": "memory-price",
                "tvl_summary": "memory-tvl",
                "revenue_signals": ["memory-revenue"],
                "peer_comparison": [],
                "risk_flags": ["memory-risk"],
                "operator_view": "memory-view",
            },
            "errors": [],
        }
    )
    snapshot = ProtocolBriefSnapshotRecord(
        brief_key=ProtocolBriefSnapshotKey.from_request(request).value,
        request=request,
        response=live_response,
        source_generated_at="2099-03-24T11:58:00Z",
        expires_at="2099-03-24T12:05:00Z",
    )
    protocol_fundamental_brief_service._snapshot_cache.put(snapshot)

    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "get_protocol_brief_repository",
        lambda: FailIfTouchedRepository(),
    )

    async def _unexpected_collect(_payload):
        raise AssertionError("live collection should not run when in-memory snapshot is fresh")

    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "_collect_live_observations",
        _unexpected_collect,
    )

    client = TestClient(app)
    response = client.post(
        "/provider-services/protocol-fundamental-brief/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["freshness"]["cacheHit"] is True
    assert body["result"]["price_summary"] == "memory-price"


def test_protocol_fundamental_brief_falls_back_to_persisted_snapshot_on_total_source_failure(
    monkeypatch: pytest.MonkeyPatch,
):
    protocol_fundamental_brief_service._snapshot_cache.clear()

    class FakeRepository:
        def __init__(self, snapshot: ProtocolBriefSnapshotRecord) -> None:
            self.snapshot = snapshot
            self.appended: list = []

        def load_snapshot(self, brief_key: str):
            assert brief_key == self.snapshot.brief_key
            return self.snapshot

        def save_snapshot(self, record):
            raise AssertionError("save_snapshot should not run when all live sources fail")

        def append_raw_feed_records(self, records):
            self.appended.extend(records)

    payload = {"protocol": "Aave"}
    request = protocol_fundamental_brief_service.ProtocolFundamentalBriefRequest.model_validate(payload)
    live_response = protocol_fundamental_brief_service.ProtocolFundamentalBriefResponse.model_validate(
        {
            "service": {
                "serviceId": protocol_fundamental_brief_service.SERVICE_ID,
                "serviceName": protocol_fundamental_brief_service.SERVICE_NAME,
                "version": protocol_fundamental_brief_service.SERVICE_VERSION,
            },
            "sources": [{"name": "defillama_protocol", "freshnessSec": 120}],
            "freshness": {
                "generatedAt": "2026-03-24T12:00:00Z",
                "maxSourceAgeSec": 120,
                "cacheHit": False,
            },
            "result": {
                "protocol": "Aave",
                "price_summary": "stored-price",
                "tvl_summary": "stored-tvl",
                "revenue_signals": ["stored-revenue"],
                "peer_comparison": [],
                "risk_flags": ["stored-risk"],
                "operator_view": "stored-view",
            },
            "errors": [],
        }
    )
    snapshot = ProtocolBriefSnapshotRecord(
        brief_key=ProtocolBriefSnapshotKey.from_request(request).value,
        request=request,
        response=live_response,
        source_generated_at="2026-03-24T11:58:00Z",
        expires_at="2026-03-24T12:05:00Z",
    )
    repository = FakeRepository(snapshot)

    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "get_protocol_brief_repository",
        lambda: repository,
    )

    async def _failed_collect(_payload):
        await asyncio.sleep(0)
        return (
            (),
            [],
            [
                protocol_fundamental_brief_service.ErrorRecord(
                    code="DEFILLAMA_PROTOCOL_UNAVAILABLE",
                    message="DefiLlama protocol feed unavailable: upstream timeout",
                )
            ],
        )

    monkeypatch.setattr(
        protocol_fundamental_brief_service,
        "_collect_live_observations",
        _failed_collect,
    )

    client = TestClient(app)
    response = client.post(
        "/provider-services/protocol-fundamental-brief/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["freshness"]["cacheHit"] is True
    assert body["result"]["price_summary"] == "stored-price"
    assert body["errors"][-1]["code"] == "PROTOCOL_BRIEF_SNAPSHOT_FALLBACK_USED"


def test_protocol_fundamental_brief_rejects_invalid_lookback_days():
    client = TestClient(app)
    payload = {"protocol": "Aave", "lookback_days": 180}

    response = client.post(
        "/provider-services/protocol-fundamental-brief/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any(entry["loc"][-1] == "lookback_days" for entry in detail)


def test_protocol_fundamental_brief_requires_gateway_signature():
    client = TestClient(app)

    response = client.post(
        "/provider-services/protocol-fundamental-brief/invoke",
        json={"protocol": "Aave"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GATEWAY_SIGNATURE_REQUIRED"


def test_protocol_fundamental_brief_rejects_invalid_gateway_signature():
    client = TestClient(app)
    payload = {"protocol": "Aave"}
    headers = _signed_headers(payload)
    headers["X-Synapse-Signature"] = "bad-signature"

    response = client.post(
        "/provider-services/protocol-fundamental-brief/invoke",
        json=payload,
        headers=headers,
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GATEWAY_SIGNATURE_INVALID"