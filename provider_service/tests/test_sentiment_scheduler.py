# pyright: reportMissingImports=false

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.main import create_app  # noqa: E402
from app.schemas.sentiment import ErrorRecord, SchedulerJobRecord, SentimentRequest, SentimentResponse  # noqa: E402
from app.services.sentiment import scheduler as sentiment_scheduler  # noqa: E402


def _build_response(symbol: str = "ETH") -> SentimentResponse:
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
                "symbol": symbol,
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


def test_scheduler_targets_defaults_to_hot_set(monkeypatch):
    monkeypatch.setattr(
        sentiment_scheduler,
        "get_settings",
        lambda: SimpleNamespace(sentiment_scheduler_targets_json=""),
    )

    targets = sentiment_scheduler.scheduler_targets()

    assert len(targets) == 5
    assert [(target.symbol, target.chain) for target in targets] == [
        ("BTC", "market-wide"),
        ("ETH", "market-wide"),
        ("SOL", "market-wide"),
        ("ETH", "ethereum"),
        ("SOL", "solana"),
    ]


def test_scheduler_run_once_refreshes_all_targets(monkeypatch):
    calls: list[tuple[str, str]] = []

    class FakeRepository:
        def try_acquire_scheduler_job(self, snapshot_key, payload, **kwargs):
            _ = kwargs
            return SchedulerJobRecord(
                snapshotKey=snapshot_key,
                symbol=payload.symbol,
                chain=payload.chain,
                lookbackHours=payload.lookback_hours,
                includeNarrative=payload.include_narrative,
                jobOwner="scheduler-test",
                jobStatus="running",
            )

        def mark_scheduler_job_succeeded(self, snapshot_key, **kwargs):
            _ = snapshot_key
            _ = kwargs
            return None

        def mark_scheduler_job_failed(self, snapshot_key, **kwargs):
            _ = snapshot_key
            _ = dict(kwargs)
            return None

    monkeypatch.setattr(
        sentiment_scheduler,
        "scheduler_targets",
        lambda: [
            SentimentRequest.model_validate({"symbol": "BTC"}),
            SentimentRequest.model_validate({"symbol": "ETH", "chain": "ethereum"}),
        ],
    )

    async def _fake_refresh(payload: SentimentRequest, *, reason: str):
        await asyncio.sleep(0)
        calls.append((payload.symbol, reason))
        return _build_response(payload.symbol)

    monkeypatch.setattr(
        sentiment_scheduler.sentiment_service,
        "refresh_sentiment_snapshot",
        _fake_refresh,
    )
    monkeypatch.setattr(
        sentiment_scheduler,
        "get_sentiment_repository",
        lambda: FakeRepository(),
    )

    scheduler = sentiment_scheduler.SentimentScheduler(
        interval_s=30,
        max_concurrent_snapshots=1,
        lease_ttl_s=120,
    )

    asyncio.run(scheduler.run_once())

    assert calls == [
        ("BTC", "scheduler"),
        ("ETH", "scheduler"),
    ]


def test_scheduler_from_settings_respects_enable_flag(monkeypatch):
    monkeypatch.setattr(
        sentiment_scheduler,
        "get_settings",
        lambda: SimpleNamespace(
            sentiment_scheduler_enabled=False,
            sentiment_scheduler_interval_s=30,
            sentiment_scheduler_max_concurrent_snapshots=2,
            sentiment_scheduler_lease_ttl_s=120,
        ),
    )

    assert sentiment_scheduler.scheduler_from_settings() is None


def test_scheduler_skips_target_when_lease_not_acquired(monkeypatch):
    calls: list[str] = []

    class FakeRepository:
        def try_acquire_scheduler_job(self, snapshot_key, payload, **kwargs):
            _ = snapshot_key
            _ = payload
            _ = kwargs
            return None

        def mark_scheduler_job_succeeded(self, snapshot_key, **kwargs):
            raise AssertionError(f"unexpected success update for {snapshot_key}: {kwargs}")

        def mark_scheduler_job_failed(self, snapshot_key, **kwargs):
            raise AssertionError(f"unexpected failure update for {snapshot_key}: {kwargs}")

    monkeypatch.setattr(
        sentiment_scheduler,
        "scheduler_targets",
        lambda: [SentimentRequest.model_validate({"symbol": "BTC"})],
    )

    async def _fake_refresh(payload: SentimentRequest, *, reason: str):
        await asyncio.sleep(0)
        _ = reason
        calls.append(payload.symbol)
        return _build_response(payload.symbol)

    monkeypatch.setattr(
        sentiment_scheduler.sentiment_service,
        "refresh_sentiment_snapshot",
        _fake_refresh,
    )
    monkeypatch.setattr(
        sentiment_scheduler,
        "get_sentiment_repository",
        lambda: FakeRepository(),
    )

    scheduler = sentiment_scheduler.SentimentScheduler(
        interval_s=30,
        max_concurrent_snapshots=1,
        lease_ttl_s=120,
    )

    asyncio.run(scheduler.run_once())

    assert calls == []


def test_scheduler_marks_cooldown_when_refresh_throws(monkeypatch):
    failures: list[dict[str, str]] = []

    class FakeRepository:
        def try_acquire_scheduler_job(self, snapshot_key, payload, **kwargs):
            _ = kwargs
            return SchedulerJobRecord(
                snapshotKey=snapshot_key,
                symbol=payload.symbol,
                chain=payload.chain,
                lookbackHours=payload.lookback_hours,
                includeNarrative=payload.include_narrative,
                jobOwner="scheduler-test",
                jobStatus="running",
            )

        def mark_scheduler_job_succeeded(self, snapshot_key, **kwargs):
            raise AssertionError(f"unexpected success update for {snapshot_key}: {kwargs}")

        def mark_scheduler_job_failed(self, snapshot_key, **kwargs):
            failures.append({"snapshot_key": snapshot_key, **kwargs})
            return None

    monkeypatch.setattr(
        sentiment_scheduler,
        "scheduler_targets",
        lambda: [SentimentRequest.model_validate({"symbol": "BTC"})],
    )

    async def _fake_refresh(payload: SentimentRequest, *, reason: str):
        await asyncio.sleep(0)
        _ = payload
        _ = reason
        raise RuntimeError("upstream timeout")

    monkeypatch.setattr(
        sentiment_scheduler.sentiment_service,
        "refresh_sentiment_snapshot",
        _fake_refresh,
    )
    monkeypatch.setattr(
        sentiment_scheduler,
        "get_sentiment_repository",
        lambda: FakeRepository(),
    )

    scheduler = sentiment_scheduler.SentimentScheduler(
        interval_s=30,
        max_concurrent_snapshots=1,
        lease_ttl_s=120,
    )

    asyncio.run(scheduler.run_once())

    assert len(failures) == 1
    assert failures[0]["error_code"] == "SCHEDULER_REFRESH_FAILED"


def test_scheduler_marks_cooldown_when_refresh_uses_fallback(monkeypatch):
    failures: list[dict[str, str]] = []

    class FakeRepository:
        def try_acquire_scheduler_job(self, snapshot_key, payload, **kwargs):
            _ = kwargs
            return SchedulerJobRecord(
                snapshotKey=snapshot_key,
                symbol=payload.symbol,
                chain=payload.chain,
                lookbackHours=payload.lookback_hours,
                includeNarrative=payload.include_narrative,
                jobOwner="scheduler-test",
                jobStatus="running",
                consecutiveFailures=1,
            )

        def mark_scheduler_job_succeeded(self, snapshot_key, **kwargs):
            raise AssertionError(f"unexpected success update for {snapshot_key}: {kwargs}")

        def mark_scheduler_job_failed(self, snapshot_key, **kwargs):
            failures.append({"snapshot_key": snapshot_key, **kwargs})
            return None

    monkeypatch.setattr(
        sentiment_scheduler,
        "scheduler_targets",
        lambda: [SentimentRequest.model_validate({"symbol": "BTC"})],
    )

    async def _fake_refresh(payload: SentimentRequest, *, reason: str):
        await asyncio.sleep(0)
        _ = payload
        _ = reason
        response = _build_response("BTC")
        return response.model_copy(
            update={
                "errors": [
                    {
                        "code": "SENTIMENT_SNAPSHOT_FALLBACK_USED",
                        "message": "fallback",
                    }
                ]
            }
        )

    monkeypatch.setattr(
        sentiment_scheduler.sentiment_service,
        "refresh_sentiment_snapshot",
        _fake_refresh,
    )
    monkeypatch.setattr(
        sentiment_scheduler,
        "get_sentiment_repository",
        lambda: FakeRepository(),
    )

    scheduler = sentiment_scheduler.SentimentScheduler(
        interval_s=30,
        max_concurrent_snapshots=1,
        lease_ttl_s=120,
    )

    asyncio.run(scheduler.run_once())

    assert len(failures) == 1
    assert failures[0]["error_code"] == "SENTIMENT_SNAPSHOT_FALLBACK_USED"


def test_scheduler_tolerates_dict_shaped_errors_in_refresh_summary(monkeypatch):
    entries: list[tuple[str, str]] = []

    class FakeLogger:
        def info(self, message: str) -> None:
            entries.append(("info", message))

        def debug(self, message: str) -> None:
            entries.append(("debug", message))

        def warning(self, message: str) -> None:
            entries.append(("warning", message))

        def error(self, message: str) -> None:
            entries.append(("error", message))

    class FakeRepository:
        def try_acquire_scheduler_job(self, snapshot_key, payload, **kwargs):
            _ = kwargs
            return SchedulerJobRecord(
                snapshotKey=snapshot_key,
                symbol=payload.symbol,
                chain=payload.chain,
                lookbackHours=payload.lookback_hours,
                includeNarrative=payload.include_narrative,
                jobOwner="scheduler-test",
                jobStatus="running",
            )

        def mark_scheduler_job_succeeded(self, snapshot_key, **kwargs):
            _ = snapshot_key
            _ = kwargs
            return None

        def mark_scheduler_job_failed(self, snapshot_key, **kwargs):
            raise AssertionError(f"unexpected failure update for {snapshot_key}: {kwargs}")

    monkeypatch.setattr(
        sentiment_scheduler,
        "scheduler_targets",
        lambda: [SentimentRequest.model_validate({"symbol": "BTC"})],
    )

    async def _fake_refresh(payload: SentimentRequest, *, reason: str):
        await asyncio.sleep(0)
        _ = payload
        _ = reason
        response = _build_response("BTC")
        return response.model_copy(
            update={
                "errors": [
                    {"code": "UPSTREAM_TIMEOUT", "message": "simulated dict error"}
                ]
            }
        )

    monkeypatch.setattr(
        sentiment_scheduler.sentiment_service,
        "refresh_sentiment_snapshot",
        _fake_refresh,
    )
    monkeypatch.setattr(
        sentiment_scheduler,
        "get_sentiment_repository",
        lambda: FakeRepository(),
    )

    scheduler = sentiment_scheduler.SentimentScheduler(
        interval_s=30,
        max_concurrent_snapshots=1,
        lease_ttl_s=120,
    )
    scheduler._logger = FakeLogger()

    asyncio.run(scheduler.run_once())

    success_logs = [message for level, message in entries if level == "info" and "Scheduler refresh succeeded" in message]
    error_logs = [message for level, message in entries if level == "error"]

    assert len(success_logs) == 1
    assert error_logs == []


def test_app_lifespan_starts_and_stops_scheduler(monkeypatch):
    events: list[str] = []

    class FakeScheduler:
        async def start(self) -> None:
            await asyncio.sleep(0)
            events.append("start")

        async def stop(self) -> None:
            await asyncio.sleep(0)
            events.append("stop")

    monkeypatch.setattr(
        "app.main.scheduler_from_settings",
        lambda: FakeScheduler(),
    )

    app = create_app()
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert events == ["start", "stop"]


def test_scheduler_logs_job_start_and_success(monkeypatch):
    entries: list[tuple[str, str]] = []

    class FakeLogger:
        def info(self, message: str) -> None:
            entries.append(("info", message))

        def debug(self, message: str) -> None:
            entries.append(("debug", message))

        def warning(self, message: str) -> None:
            entries.append(("warning", message))

        def error(self, message: str) -> None:
            entries.append(("error", message))

    class FakeRepository:
        def try_acquire_scheduler_job(self, snapshot_key, payload, **kwargs):
            _ = kwargs
            return SchedulerJobRecord(
                snapshotKey=snapshot_key,
                symbol=payload.symbol,
                chain=payload.chain,
                lookbackHours=payload.lookback_hours,
                includeNarrative=payload.include_narrative,
                jobOwner="scheduler-test",
                jobStatus="running",
            )

        def mark_scheduler_job_succeeded(self, snapshot_key, **kwargs):
            _ = snapshot_key
            _ = kwargs
            return None

        def mark_scheduler_job_failed(self, snapshot_key, **kwargs):
            raise AssertionError(f"unexpected failure update for {snapshot_key}: {kwargs}")

    monkeypatch.setattr(
        sentiment_scheduler,
        "scheduler_targets",
        lambda: [SentimentRequest.model_validate({"symbol": "BTC"})],
    )

    async def _fake_refresh(payload: SentimentRequest, *, reason: str):
        await asyncio.sleep(0)
        _ = payload
        _ = reason
        return _build_response("BTC")

    monkeypatch.setattr(
        sentiment_scheduler.sentiment_service,
        "refresh_sentiment_snapshot",
        _fake_refresh,
    )
    monkeypatch.setattr(
        sentiment_scheduler,
        "get_sentiment_repository",
        lambda: FakeRepository(),
    )

    scheduler = sentiment_scheduler.SentimentScheduler(
        interval_s=30,
        max_concurrent_snapshots=1,
        lease_ttl_s=120,
    )
    scheduler._logger = FakeLogger()

    asyncio.run(scheduler.run_once())

    start_logs = [message for level, message in entries if level == "info" and "Scheduler refresh started" in message]
    success_logs = [message for level, message in entries if level == "info" and "Scheduler refresh succeeded" in message]

    assert len(start_logs) == 1
    assert "snapshot_key=btc__market_wide__24h__narrative_on" in start_logs[0]
    assert "lease_expires_at=" in start_logs[0]
    assert len(success_logs) == 1
    assert "duration_ms=" in success_logs[0]
    assert "sentiment_label=greed" in success_logs[0]