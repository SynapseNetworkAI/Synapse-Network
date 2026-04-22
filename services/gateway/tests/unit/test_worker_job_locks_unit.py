from __future__ import annotations

import argparse
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from src import worker as gateway_worker
from src.services.platform.job_locks import (
    advisory_lock_key,
    postgres_advisory_job_lock,
)
from src.services.platform.tasks import consumer_withdraw_processor


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


@pytest.mark.asyncio
async def test_worker_one_shot_job_skip_returns_success(monkeypatch) -> None:
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

    exit_code = await gateway_worker._run(
        argparse.Namespace(
            command="provider-withdraw-reaper",
            once=True,
            poll_interval_sec=1.0,
        )
    )

    assert exit_code == 0
    assert called is False


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

    assert result == {
        "collected": 3,
        "processed": 2,
        "completedOrExpired": 1,
        "failed": 1,
    }
