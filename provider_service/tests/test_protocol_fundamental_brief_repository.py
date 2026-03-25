# pyright: reportMissingImports=false

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.schemas.protocol_fundamental_brief import (  # noqa: E402
    DexScreenerPayloadExcerpt,
    ProtocolFundamentalBriefRequest,
    ProtocolFundamentalBriefResponse,
)
from app.services import protocol_fundamental_brief_service  # noqa: E402
from app.services.protocol_fundamental_brief.domain import (  # noqa: E402
    DexScreenerMarketObservation,
    ProtocolBriefSnapshotKey,
    ProtocolBriefSnapshotRecord,
)
from app.services.protocol_fundamental_brief import repository as brief_repository  # noqa: E402


class FakeCursor:
    def __init__(self, store: dict, executed: list[tuple[str, object]]) -> None:
        self.store = store
        self.executed = executed
        self._fetchone = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, query: str, params=None) -> None:
        normalized_query = " ".join(query.split())
        self.executed.append((normalized_query, params))
        if normalized_query.startswith("INSERT INTO provider_protocol_briefs"):
            assert params is not None
            self.store["snapshots"][params[0]] = params
            return
        if normalized_query.startswith("SELECT protocol, chain, lookback_days, peer_set_json"):
            assert params is not None
            payload = self.store["snapshots"].get(params[0])
            self._fetchone = (
                None
                if payload is None
                else (
                    payload[1],
                    payload[2],
                    payload[3],
                    payload[4],
                    payload[7],
                    payload[8],
                    payload[9],
                    payload[10],
                )
            )
            return
        if normalized_query.startswith("INSERT INTO provider_protocol_brief_raw_feeds"):
            assert params is not None
            self.store["raw_feeds"].append(params)

    def fetchone(self):
        return self._fetchone


class FakeConnection:
    def __init__(self, store: dict, executed: list[tuple[str, object]]) -> None:
        self.store = store
        self.executed = executed

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return FakeCursor(self.store, self.executed)


class FakePsycopg:
    def __init__(self, store: dict, executed: list[tuple[str, object]]) -> None:
        self.store = store
        self.executed = executed

    def connect(self, dsn: str, autocommit: bool = True) -> FakeConnection:
        assert dsn == "postgresql://postgres:postgres@localhost:5432/provider_service"
        assert autocommit is True
        return FakeConnection(self.store, self.executed)


def _build_request() -> ProtocolFundamentalBriefRequest:
    return ProtocolFundamentalBriefRequest.model_validate(
        {
            "protocol": "Aave",
            "chain": "ethereum",
            "peer_set": ["Compound", "Morpho"],
            "lookback_days": 30,
        }
    )


def _build_snapshot_record() -> ProtocolBriefSnapshotRecord:
    request = _build_request()
    observation = DexScreenerMarketObservation(
        freshness_sec=30,
        source_timestamp="2026-03-24T11:59:30Z",
        fetched_at="2026-03-24T12:00:00Z",
        latency_ms=45,
        retry_count=0,
        timeout_ms=3000,
        http_status=200,
        payload_hash="dex-hash",
        chain_id="ethereum",
        pair_address="0xpair",
        dex_id="uniswap",
        base_token_symbol="AAVE",
        quote_token_symbol="USDC",
        labels=("bluechip",),
        spot_price_usd=96.2,
        price_change_5m_pct=0.1,
        price_change_1h_pct=0.5,
        price_change_6h_pct=1.7,
        price_change_24h_pct=2.4,
        volume_24h_usd=12_800_000.0,
        buy_txn_24h=1812,
        sell_txn_24h=1654,
        liquidity_usd=5_400_000.0,
        market_cap_usd=1_500_000_000.0,
        fdv_usd=1_700_000_000.0,
        pair_age_days=240,
        excerpt=DexScreenerPayloadExcerpt(
            chainId="ethereum",
            pairAddress="0xpair",
            dexId="uniswap",
            baseSymbol="AAVE",
            quoteSymbol="USDC",
            liquidityUsd=5_400_000.0,
            volume24hUsd=12_800_000.0,
        ),
    )
    response = ProtocolFundamentalBriefResponse.model_validate(
        {
            "service": {
                "serviceId": protocol_fundamental_brief_service.SERVICE_ID,
                "serviceName": protocol_fundamental_brief_service.SERVICE_NAME,
                "version": protocol_fundamental_brief_service.SERVICE_VERSION,
            },
            "sources": [{"name": "dexscreener_market", "freshnessSec": 30}],
            "freshness": {
                "generatedAt": "2026-03-24T12:00:00Z",
                "maxSourceAgeSec": 30,
                "cacheHit": False,
            },
            "result": {
                "protocol": "Aave",
                "price_summary": "price",
                "tvl_summary": "tvl",
                "revenue_signals": ["revenue"],
                "peer_comparison": ["peer"],
                "risk_flags": ["risk"],
                "operator_view": "view",
            },
            "errors": [],
        }
    )
    return ProtocolBriefSnapshotRecord.from_live_response(
        snapshot_key=ProtocolBriefSnapshotKey.from_request(request),
        request=request,
        response=response,
        observations=(observation,),
        cache_ttl_s=300,
    )


def test_repository_factory_returns_file_backend(monkeypatch, tmp_path):
    brief_repository.get_protocol_brief_repository.cache_clear()
    monkeypatch.setattr(
        brief_repository,
        "get_settings",
        lambda: SimpleNamespace(
            protocol_brief_repository_backend="file",
            protocol_brief_storage_dir=str(tmp_path / "protocol-brief-storage"),
            protocol_brief_postgres_dsn=None,
            protocol_brief_postgres_snapshot_table="provider_protocol_briefs",
            protocol_brief_postgres_raw_feed_table="provider_protocol_brief_raw_feeds",
        ),
    )

    repository = brief_repository.get_protocol_brief_repository()

    assert isinstance(repository, brief_repository.FileBackedProtocolBriefRepository)


def test_postgres_repository_persists_snapshot_and_raw_feed_records(monkeypatch):
    store = {"snapshots": {}, "raw_feeds": []}
    executed: list[tuple[str, object]] = []
    monkeypatch.setattr(
        brief_repository,
        "_load_psycopg",
        lambda: FakePsycopg(store, executed),
    )

    repository = brief_repository.PostgresProtocolBriefRepository(
        dsn="postgresql://postgres:postgres@localhost:5432/provider_service"
    )
    record = _build_snapshot_record()
    repository.save_snapshot(record)
    loaded = repository.load_snapshot(record.brief_key)
    repository.append_raw_feed_records(
        [
            DexScreenerMarketObservation(
                freshness_sec=30,
                source_timestamp="2026-03-24T11:59:30Z",
                fetched_at="2026-03-24T12:00:00Z",
                latency_ms=45,
                retry_count=0,
                timeout_ms=3000,
                http_status=200,
                payload_hash="dex-hash",
                chain_id="ethereum",
                pair_address="0xpair",
                dex_id="uniswap",
                base_token_symbol="AAVE",
                quote_token_symbol="USDC",
                labels=("bluechip",),
                spot_price_usd=96.2,
                price_change_5m_pct=0.1,
                price_change_1h_pct=0.5,
                price_change_6h_pct=1.7,
                price_change_24h_pct=2.4,
                volume_24h_usd=12_800_000.0,
                buy_txn_24h=1812,
                sell_txn_24h=1654,
                liquidity_usd=5_400_000.0,
                market_cap_usd=1_500_000_000.0,
                fdv_usd=1_700_000_000.0,
                pair_age_days=240,
                excerpt=DexScreenerPayloadExcerpt(
                    chainId="ethereum",
                    pairAddress="0xpair",
                    dexId="uniswap",
                    baseSymbol="AAVE",
                    quoteSymbol="USDC",
                    liquidityUsd=5_400_000.0,
                    volume24hUsd=12_800_000.0,
                ),
            ).to_raw_feed_record(brief_key=record.brief_key, payload=record.request)
        ]
    )

    assert loaded is not None
    assert loaded.request.protocol == "Aave"
    assert store["raw_feeds"][0][0] == record.brief_key
    assert store["raw_feeds"][0][1] == "Aave"
    assert store["raw_feeds"][0][3] == "dexscreener_market"
    persisted_peer_set = json.loads(store["snapshots"][record.brief_key][4])
    assert persisted_peer_set == ["Compound", "Morpho"]
    persisted_payload = json.loads(store["snapshots"][record.brief_key][10])
    assert persisted_payload["result"]["protocol"] == "Aave"
    assert not any(query.startswith("CREATE TABLE") for query, _ in executed)
    assert not any(query.startswith("ALTER TABLE") for query, _ in executed)


def test_repository_factory_returns_postgres_backend(monkeypatch):
    store = {"snapshots": {}, "raw_feeds": []}
    executed: list[tuple[str, object]] = []
    brief_repository.get_protocol_brief_repository.cache_clear()
    monkeypatch.setattr(
        brief_repository,
        "_load_psycopg",
        lambda: FakePsycopg(store, executed),
    )
    monkeypatch.setattr(
        brief_repository,
        "get_settings",
        lambda: SimpleNamespace(
            protocol_brief_repository_backend="postgres",
            protocol_brief_storage_dir="logs/protocol_brief",
            protocol_brief_postgres_dsn="postgresql://postgres:postgres@localhost:5432/provider_service",
            protocol_brief_postgres_snapshot_table="provider_protocol_briefs",
            protocol_brief_postgres_raw_feed_table="provider_protocol_brief_raw_feeds",
        ),
    )

    repository = brief_repository.get_protocol_brief_repository()

    assert isinstance(repository, brief_repository.PostgresProtocolBriefRepository)


def test_postgres_repository_requires_safe_table_name():
    with pytest.raises(ValueError, match="Invalid Postgres table name"):
        brief_repository.PostgresProtocolBriefRepository(
            dsn="postgresql://postgres:postgres@localhost:5432/provider_service",
            snapshot_table="provider_protocol_briefs;drop table users",
        )