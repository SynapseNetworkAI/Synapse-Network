# pyright: reportMissingImports=false

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.schemas.sentiment import RawFeedRecord, SentimentRequest, SentimentResponse  # noqa: E402
from app.services.sentiment import repository as sentiment_repository  # noqa: E402


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
        if normalized_query.startswith("INSERT INTO provider_sentiment_snapshots"):
            assert params is not None
            self.store["snapshots"][params[0]] = params[-1]
            return
        if normalized_query.startswith("SELECT response_json FROM provider_sentiment_snapshots"):
            assert params is not None
            payload = self.store["snapshots"].get(params[0])
            self._fetchone = None if payload is None else (payload,)
            return
        if normalized_query.startswith("INSERT INTO provider_sentiment_raw_feeds"):
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


def _build_response() -> SentimentResponse:
    return SentimentResponse.model_validate(
        {
            "service": {
                "serviceId": "svc_web3_sentiment_index",
                "serviceName": "Web3 Sentiment Index",
                "version": "1.0.0",
            },
            "sources": [{"name": "alternative_me", "freshnessSec": 30}],
            "freshness": {
                "generatedAt": "2026-03-24T12:00:00Z",
                "maxSourceAgeSec": 30,
                "cacheHit": False,
            },
            "result": {
                "symbol": "ETH",
                "sentiment_score": 68,
                "sentiment_label": "greed",
                "trend_direction": "up",
                "volatility_signal": "medium",
                "market_temperature": "risk-on but not overheated",
                "reasoning_bullets": ["sample 1", "sample 2"],
                "action_hint": "sample",
            },
            "errors": [],
        }
    )


def _build_request() -> SentimentRequest:
    return SentimentRequest.model_validate(
        {
            "symbol": "ETH",
            "chain": "ethereum",
            "lookback_hours": 24,
            "include_narrative": True,
        }
    )


def test_repository_factory_returns_file_backend(monkeypatch, tmp_path):
    sentiment_repository.get_sentiment_repository.cache_clear()
    monkeypatch.setattr(
        sentiment_repository,
        "get_settings",
        lambda: SimpleNamespace(
            sentiment_repository_backend="file",
            sentiment_storage_dir=str(tmp_path / "sentiment-storage"),
            provider_service_postgres_dsn=None,
            sentiment_postgres_snapshot_table="provider_sentiment_snapshots",
            sentiment_postgres_raw_feed_table="provider_sentiment_raw_feeds",
            sentiment_postgres_scheduler_job_table="provider_sentiment_scheduler_jobs",
        ),
    )

    repository = sentiment_repository.get_sentiment_repository()

    assert isinstance(repository, sentiment_repository.FileBackedSentimentRepository)


def test_postgres_repository_persists_snapshot_and_raw_feed_records(monkeypatch):
    store = {"snapshots": {}, "raw_feeds": []}
    executed: list[tuple[str, object]] = []
    monkeypatch.setattr(
        sentiment_repository,
        "_load_psycopg",
        lambda: FakePsycopg(store, executed),
    )

    repository = sentiment_repository.PostgresSentimentRepository(
        dsn="postgresql://postgres:postgres@localhost:5432/provider_service"
    )
    request = _build_request()
    response = _build_response()

    repository.save_snapshot("eth__ethereum__24h__narrative_on", request, response)
    loaded = repository.load_snapshot("eth__ethereum__24h__narrative_on")
    repository.append_raw_feed_records(
        "eth__ethereum__24h__narrative_on",
        request,
        [
            RawFeedRecord(
                symbol="ETH",
                chain="ethereum",
                sourceName="alternative_me",
                success=True,
                fetchedAt="2026-03-24T12:00:00Z",
                sourceTimestamp="2026-03-24T11:59:30Z",
                latencyMs=83,
                retryCount=1,
                timeoutMs=2000,
                httpStatus=200,
                payloadHash="abc123",
                payloadExcerpt={
                    "value": 72,
                    "classification": "greed",
                    "timestamp": 1710931200,
                },
                errorCode=None,
                errorMessage=None,
            )
        ],
    )

    assert loaded is not None
    assert loaded.result.symbol == "ETH"
    assert store["raw_feeds"][0][0] == "eth__ethereum__24h__narrative_on"
    assert store["raw_feeds"][0][1] == "ETH"
    assert store["raw_feeds"][0][3] == "alternative_me"
    persisted_payload = json.loads(store["snapshots"]["eth__ethereum__24h__narrative_on"])
    assert persisted_payload["result"]["symbol"] == "ETH"
    assert not any(query.startswith("CREATE TABLE") for query, _ in executed)
    assert not any(query.startswith("ALTER TABLE") for query, _ in executed)


def test_repository_factory_returns_postgres_backend(monkeypatch):
    store = {"snapshots": {}, "raw_feeds": []}
    executed: list[tuple[str, object]] = []
    sentiment_repository.get_sentiment_repository.cache_clear()
    monkeypatch.setattr(
        sentiment_repository,
        "_load_psycopg",
        lambda: FakePsycopg(store, executed),
    )
    monkeypatch.setattr(
        sentiment_repository,
        "get_settings",
        lambda: SimpleNamespace(
            sentiment_repository_backend="postgres",
            sentiment_storage_dir="logs/sentiment",
            provider_service_postgres_dsn="postgresql://postgres:postgres@localhost:5432/provider_service",
            sentiment_postgres_snapshot_table="provider_sentiment_snapshots",
            sentiment_postgres_raw_feed_table="provider_sentiment_raw_feeds",
            sentiment_postgres_scheduler_job_table="provider_sentiment_scheduler_jobs",
        ),
    )

    repository = sentiment_repository.get_sentiment_repository()

    assert isinstance(repository, sentiment_repository.PostgresSentimentRepository)


def test_postgres_repository_requires_shared_provider_dsn(monkeypatch):
    sentiment_repository.get_sentiment_repository.cache_clear()
    monkeypatch.setattr(
        sentiment_repository,
        "get_settings",
        lambda: SimpleNamespace(
            sentiment_repository_backend="postgres",
            sentiment_storage_dir="logs/sentiment",
            provider_service_postgres_dsn=None,
            sentiment_postgres_snapshot_table="provider_sentiment_snapshots",
            sentiment_postgres_raw_feed_table="provider_sentiment_raw_feeds",
            sentiment_postgres_scheduler_job_table="provider_sentiment_scheduler_jobs",
        ),
    )

    with pytest.raises(ValueError, match="PROVIDER_SERVICE_POSTGRES_DSN"):
        sentiment_repository.get_sentiment_repository()


def test_postgres_repository_requires_safe_table_name():
    with pytest.raises(ValueError, match="Invalid Postgres table name"):
        sentiment_repository.PostgresSentimentRepository(
            dsn="postgresql://postgres:postgres@localhost:5432/provider_service",
            snapshot_table="provider_sentiment_snapshots;drop table users",
        )


def test_file_repository_tracks_scheduler_job_lifecycle(tmp_path):
    repository = sentiment_repository.FileBackedSentimentRepository(tmp_path)
    request = _build_request()
    snapshot_key = "eth__ethereum__24h__narrative_on"

    acquired = repository.try_acquire_scheduler_job(
        snapshot_key,
        request,
        job_owner="scheduler-node-a",
        lease_expires_at="2026-03-24T12:02:00Z",
        started_at="2026-03-24T12:00:00Z",
        refresh_reason="scheduler",
    )

    assert acquired is not None
    assert acquired.job_status == "running"
    assert acquired.job_owner == "scheduler-node-a"

    blocked = repository.try_acquire_scheduler_job(
        snapshot_key,
        request,
        job_owner="scheduler-node-b",
        lease_expires_at="2026-03-24T12:03:00Z",
        started_at="2026-03-24T12:01:00Z",
        refresh_reason="scheduler",
    )

    assert blocked is None

    failed = repository.mark_scheduler_job_failed(
        snapshot_key,
        job_owner="scheduler-node-a",
        finished_at="2026-03-24T12:00:30Z",
        next_run_at="2026-03-24T12:01:30Z",
        refresh_reason="scheduler",
        error_code="SCHEDULER_REFRESH_FAILED",
        error_message="boom",
    )

    assert failed is not None
    assert failed.job_status == "cooldown"
    assert failed.consecutive_failures == 1

    before_cooldown = repository.try_acquire_scheduler_job(
        snapshot_key,
        request,
        job_owner="scheduler-node-a",
        lease_expires_at="2026-03-24T12:03:00Z",
        started_at="2026-03-24T12:01:00Z",
        refresh_reason="scheduler",
    )

    assert before_cooldown is None

    reacquired = repository.try_acquire_scheduler_job(
        snapshot_key,
        request,
        job_owner="scheduler-node-a",
        lease_expires_at="2026-03-24T12:04:00Z",
        started_at="2026-03-24T12:01:31Z",
        refresh_reason="scheduler",
    )

    assert reacquired is not None
    assert reacquired.job_status == "running"

    succeeded = repository.mark_scheduler_job_succeeded(
        snapshot_key,
        job_owner="scheduler-node-a",
        finished_at="2026-03-24T12:02:00Z",
        next_run_at="2026-03-24T12:02:30Z",
        refresh_reason="scheduler",
    )

    assert succeeded is not None
    assert succeeded.job_status == "idle"
    assert succeeded.consecutive_failures == 0


def test_file_repository_logs_persistence_events(monkeypatch, tmp_path):
    entries: list[tuple[str, str]] = []

    class FakeLogger:
        def info(self, message: str) -> None:
            entries.append(("info", message))

        def warning(self, message: str) -> None:
            entries.append(("warning", message))

        def debug(self, message: str) -> None:
            entries.append(("debug", message))

    monkeypatch.setattr(sentiment_repository, "repository_logger", FakeLogger())

    repository = sentiment_repository.FileBackedSentimentRepository(tmp_path)
    request = _build_request()
    response = _build_response()
    snapshot_key = "eth__ethereum__24h__narrative_on"

    repository.save_snapshot(snapshot_key, request, response)
    repository.append_raw_feed_records(
        snapshot_key,
        request,
        [
            RawFeedRecord(
                symbol="ETH",
                chain="ethereum",
                sourceName="alternative_me",
                success=True,
                fetchedAt="2026-03-24T12:00:00Z",
                sourceTimestamp="2026-03-24T11:59:30Z",
                latencyMs=83,
                retryCount=1,
                timeoutMs=2000,
                httpStatus=200,
                payloadHash="abc123",
                payloadExcerpt={
                    "value": 72,
                    "classification": "greed",
                    "timestamp": 1710931200,
                },
                errorCode=None,
                errorMessage=None,
            )
        ],
    )
    repository.try_acquire_scheduler_job(
        snapshot_key,
        request,
        job_owner="scheduler-node-a",
        lease_expires_at="2026-03-24T12:02:00Z",
        started_at="2026-03-24T12:00:00Z",
        refresh_reason="scheduler",
    )

    assert any("Sentiment snapshot persisted" in message for _, message in entries)
    assert any("Sentiment raw feeds persisted" in message for _, message in entries)
    assert any(
        "Sentiment scheduler state updated" in message and "transition=acquired" in message
        for _, message in entries
    )