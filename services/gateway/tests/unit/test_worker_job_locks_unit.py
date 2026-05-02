from __future__ import annotations

import argparse
import logging
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from src import worker as gateway_worker
from src.services.platform.job_locks import (
    advisory_lock_key,
    postgres_advisory_job_lock,
)
from src.services.platform.tasks import consumer_withdraw_processor
from src.services.platform.tasks import provider_withdraw_expiry_reaper


class _ClosableStorage:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class _FakeCursor:
    def __init__(self, acquired: bool) -> None:
        self._acquired = acquired
        self.executed: list[tuple[str, tuple[object, ...]]] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, sql: str, params: tuple[object, ...]) -> None:
        self.executed.append((sql, params))

    def fetchone(self) -> tuple[bool]:
        return (self._acquired,)


class _FakeConn:
    def __init__(self, acquired: bool) -> None:
        self.cursor_obj = _FakeCursor(acquired)

    def cursor(self) -> _FakeCursor:
        return self.cursor_obj


class _FakeDb:
    def __init__(self, acquired: bool) -> None:
        self.conn = _FakeConn(acquired)

    @contextmanager
    def connect(self):
        yield self.conn


class _FakeStorage:
    def __init__(self, acquired: bool) -> None:
        self.db = _FakeDb(acquired)

    def get_database_manager(self) -> _FakeDb:
        return self.db


def test_postgres_advisory_job_lock_acquires_and_unlocks() -> None:
    storage = _FakeStorage(acquired=True)

    with postgres_advisory_job_lock(storage, "deposit-indexer") as acquired:
        assert acquired is True

    executed_sql = [sql for sql, _params in storage.db.conn.cursor_obj.executed]
    assert "SELECT pg_try_advisory_lock(%s)" in executed_sql
    assert "SELECT pg_advisory_unlock(%s)" in executed_sql
    assert isinstance(advisory_lock_key("deposit-indexer"), int)


def test_postgres_advisory_job_lock_skips_when_already_running() -> None:
    storage = _FakeStorage(acquired=False)

    with postgres_advisory_job_lock(storage, "deposit-indexer") as acquired:
        assert acquired is False

    executed_sql = [sql for sql, _params in storage.db.conn.cursor_obj.executed]
    assert "SELECT pg_try_advisory_lock(%s)" in executed_sql
    assert "SELECT pg_advisory_unlock(%s)" not in executed_sql


class _RowsStorage:
    def __init__(self, *, provider_rows=None, consumer_rows=None) -> None:
        self.provider_rows = provider_rows or []
        self.consumer_rows = consumer_rows or []

    def get_data_manager(self):
        return SimpleNamespace(
            system=SimpleNamespace(
                gateway_state=SimpleNamespace(
                    read_provider_withdrawal_rows=lambda: self.provider_rows,
                    read_consumer_refund_rows=lambda: self.consumer_rows,
                )
            )
        )


def test_provider_withdrawal_timeout_alert_logs_timed_out_rows(
    monkeypatch,
    caplog,
) -> None:
    monkeypatch.setattr(provider_withdraw_expiry_reaper.time, "time", lambda: 1_000)
    monkeypatch.setattr(
        provider_withdraw_expiry_reaper.settings,
        "withdrawal_timeout_alert_after_sec",
        100,
        raising=False,
    )
    monkeypatch.setattr(
        provider_withdraw_expiry_reaper.settings,
        "environment",
        "staging",
        raising=False,
    )
    storage = _RowsStorage(
        provider_rows=[
            SimpleNamespace(status="COMPLETED", created_at=100),
            SimpleNamespace(status="REQUESTED", created_at=None),
            SimpleNamespace(status="REQUESTED", created_at=700),
            SimpleNamespace(status="PENDING_MANUAL_REVIEW", created_at=800),
        ]
    )

    with caplog.at_level(logging.ERROR):
        provider_withdraw_expiry_reaper._emit_provider_withdrawal_timeout_alert(storage)

    assert "alert_trigger=WITHDRAWAL_TIMEOUT" in caplog.text
    assert "withdrawal_kind=provider" in caplog.text
    assert "count=2" in caplog.text
    assert "oldest_age_seconds=300" in caplog.text


def test_provider_withdrawal_timeout_alert_skips_when_none_timed_out(
    monkeypatch,
    caplog,
) -> None:
    monkeypatch.setattr(provider_withdraw_expiry_reaper.time, "time", lambda: 1_000)
    monkeypatch.setattr(
        provider_withdraw_expiry_reaper.settings,
        "withdrawal_timeout_alert_after_sec",
        500,
        raising=False,
    )
    storage = _RowsStorage(
        provider_rows=[
            SimpleNamespace(status="REQUESTED", created_at=900),
        ]
    )

    with caplog.at_level(logging.ERROR):
        provider_withdraw_expiry_reaper._emit_provider_withdrawal_timeout_alert(storage)

    assert "WITHDRAWAL_TIMEOUT" not in caplog.text


def test_postgres_advisory_job_lock_rejects_unknown_job() -> None:
    with pytest.raises(ValueError):
        with postgres_advisory_job_lock(_FakeStorage(acquired=True), "unknown-job"):
            pass


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("command", "job_name", "patch_name", "patch_result"),
    [
        (
            "deposit-indexer",
            "deposit-indexer",
            "run_indexer_blocking_step",
            {"lastReconciliationAt": 0},
        ),
        (
            "provider-withdraw-reaper",
            "provider-withdraw-reaper",
            "run_provider_withdraw_expiry_reaper_once",
            {"expired": 0},
        ),
        (
            "consumer-withdraw-processor",
            "consumer-withdraw-processor",
            "run_consumer_withdraw_processor_once",
            {"collected": 0, "processed": 0, "completedOrExpired": 0, "failed": 0},
        ),
        (
            "in-app-cleanup",
            "in-app-notification-cleanup",
            "run_in_app_notification_cleanup_once",
            {"deleted": 0},
        ),
    ],
)
async def test_worker_one_shot_jobs_use_advisory_lock(
    monkeypatch,
    caplog,
    command: str,
    job_name: str,
    patch_name: str,
    patch_result: dict[str, int],
) -> None:
    seen: list[str] = []

    @contextmanager
    def fake_lock(storage, selected_job_name):
        assert storage == "fake-storage"
        seen.append(selected_job_name)
        yield True

    monkeypatch.setattr(gateway_worker, "create_storage", lambda settings: "fake-storage")
    monkeypatch.setattr(gateway_worker, "postgres_advisory_job_lock", fake_lock)
    caplog.set_level(logging.INFO, logger=gateway_worker.__name__)
    if patch_name == "run_indexer_blocking_step":
        monkeypatch.setattr(
            gateway_worker,
            patch_name,
            lambda storage, last_reconciliation_at: patch_result,
        )
    else:
        async def fake_once(storage):
            assert storage == "fake-storage"
            return patch_result

        monkeypatch.setattr(gateway_worker, patch_name, fake_once)

    exit_code = await gateway_worker._run(
        argparse.Namespace(command=command, once=True, poll_interval_sec=1.0)
    )

    assert exit_code == 0
    assert seen == [job_name]
    assert "alert_trigger=GATEWAY_JOB_HEARTBEAT" in caplog.text
    assert f"job_name={job_name}" in caplog.text
    assert "status=ok" in caplog.text


@pytest.mark.asyncio
async def test_worker_one_shot_job_skip_returns_success(monkeypatch, caplog) -> None:
    called = False

    @contextmanager
    def fake_lock(_storage, _job_name):
        yield False

    async def fake_reaper(_storage):
        nonlocal called
        called = True
        return {"expired": 1}

    monkeypatch.setattr(gateway_worker, "create_storage", lambda settings: "fake-storage")
    monkeypatch.setattr(gateway_worker, "postgres_advisory_job_lock", fake_lock)
    monkeypatch.setattr(gateway_worker, "run_provider_withdraw_expiry_reaper_once", fake_reaper)
    caplog.set_level(logging.INFO, logger=gateway_worker.__name__)

    exit_code = await gateway_worker._run(
        argparse.Namespace(
            command="provider-withdraw-reaper",
            once=True,
            poll_interval_sec=1.0,
        )
    )

    assert exit_code == 0
    assert called is False
    assert "alert_trigger=GATEWAY_JOB_HEARTBEAT" in caplog.text
    assert "job_name=provider-withdraw-reaper" in caplog.text
    assert "status=skipped_already_running" in caplog.text


@pytest.mark.asyncio
async def test_worker_closes_storage_after_one_shot(monkeypatch) -> None:
    storage = _ClosableStorage()

    async def fake_drain(_storage):
        return {"claimed": 0, "sent": 0, "failed": 0, "quotaDeferred": 0}

    monkeypatch.setattr(gateway_worker, "create_storage", lambda settings: storage)
    monkeypatch.setattr(gateway_worker, "drain_notification_outbox_once", fake_drain)

    exit_code = await gateway_worker._run(
        argparse.Namespace(command="notification-outbox", once=True, poll_interval_sec=1.0)
    )

    assert exit_code == 0
    assert storage.closed is True


@pytest.mark.asyncio
async def test_worker_closes_storage_after_failure(monkeypatch) -> None:
    storage = _ClosableStorage()
    monkeypatch.setattr(gateway_worker, "create_storage", lambda settings: storage)

    with pytest.raises(ValueError):
        await gateway_worker._run(
            argparse.Namespace(command="unknown", once=False, poll_interval_sec=1.0)
        )

    assert storage.closed is True


@pytest.mark.asyncio
async def test_consumer_withdraw_processor_once_counts_changed_and_failed(
    monkeypatch,
) -> None:
    rows = [
        SimpleNamespace(id="completed"),
        SimpleNamespace(id="unchanged"),
        SimpleNamespace(id="failed"),
    ]

    monkeypatch.setattr(
        consumer_withdraw_processor,
        "_collect_requested_consumer_withdrawals",
        lambda storage: rows,
    )

    def fake_process_single_withdraw(_storage, row) -> bool:
        if row.id == "completed":
            return True
        if row.id == "unchanged":
            return False
        raise RuntimeError("synthetic failure")

    monkeypatch.setattr(
        consumer_withdraw_processor,
        "_process_single_withdraw",
        fake_process_single_withdraw,
    )

    result = await consumer_withdraw_processor.run_consumer_withdraw_processor_once(
        "fake-storage"
    )

    assert result.collected == 3
    assert result.processed == 2
    assert result.completedOrExpired == 1
    assert result.failed == 1


def test_collect_consumer_withdrawal_timeout_rows_filters_active_consumer_rows() -> None:
    storage = _RowsStorage(
        consumer_rows=[
            SimpleNamespace(refund_type="CONSUMER_BALANCE_WITHDRAW", status="REQUESTED"),
            SimpleNamespace(refund_type="CONSUMER_BALANCE_WITHDRAW", status="PENDING_MANUAL_REVIEW"),
            SimpleNamespace(refund_type="CONSUMER_BALANCE_WITHDRAW", status="COMPLETED"),
            SimpleNamespace(refund_type="other", status="REQUESTED"),
        ]
    )

    rows = consumer_withdraw_processor._collect_consumer_withdrawal_timeout_rows(storage)

    assert [row.status for row in rows] == ["REQUESTED", "PENDING_MANUAL_REVIEW"]


def test_consumer_withdrawal_timeout_alert_logs_timed_out_rows(
    monkeypatch,
    caplog,
) -> None:
    monkeypatch.setattr(consumer_withdraw_processor.time, "time", lambda: 1_000)
    monkeypatch.setattr(
        consumer_withdraw_processor.settings,
        "withdrawal_timeout_alert_after_sec",
        100,
        raising=False,
    )
    monkeypatch.setattr(
        consumer_withdraw_processor.settings,
        "environment",
        "staging",
        raising=False,
    )
    rows = [
        SimpleNamespace(status="COMPLETED", created_at=100),
        SimpleNamespace(status="REQUESTED", created_at=None),
        SimpleNamespace(status="REQUESTED", created_at=700),
        SimpleNamespace(status="PENDING_MANUAL_REVIEW", created_at=800),
    ]

    with caplog.at_level(logging.ERROR):
        consumer_withdraw_processor._emit_consumer_withdrawal_timeout_alert(rows)

    assert "alert_trigger=WITHDRAWAL_TIMEOUT" in caplog.text
    assert "withdrawal_kind=consumer" in caplog.text
    assert "count=2" in caplog.text
    assert "oldest_age_seconds=300" in caplog.text
