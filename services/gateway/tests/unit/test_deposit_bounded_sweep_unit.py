from __future__ import annotations

from types import SimpleNamespace

from src.services.platform.tasks.deposit_indexer.bounded_sweep import (
    run_bounded_pending_confirmation_sweep,
    run_locked_bounded_pending_confirmation_sweep,
)


class _FakeStorage:
    pass


def test_bounded_pending_sweep_retries_until_credit(monkeypatch) -> None:
    calls: list[int] = []

    def fake_process(_storage):
        calls.append(len(calls) + 1)
        if len(calls) == 1:
            return SimpleNamespace(to_dict=lambda: {"credited": 0, "failed": 0, "pending": 1})
        return SimpleNamespace(to_dict=lambda: {"credited": 1, "failed": 0, "pending": 0})

    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.bounded_sweep.process_pending_deposit_intents_once",
        fake_process,
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.bounded_sweep.settings",
        SimpleNamespace(
            deposit_pending_sweep_max_wait_sec=20.0,
            deposit_pending_sweep_poll_interval_sec=2.0,
        ),
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.bounded_sweep.time.sleep",
        lambda _seconds: None,
    )
    monotonic_values = iter([0.0, 1.0])
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.bounded_sweep.time.monotonic",
        lambda: next(monotonic_values),
    )

    result = run_bounded_pending_confirmation_sweep(_FakeStorage())

    assert result.status == "ok"
    assert result.attempts == 2
    assert result.credited == 1
    assert result.pending == 0


def test_bounded_pending_sweep_returns_pending_after_timeout(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.bounded_sweep.process_pending_deposit_intents_once",
        lambda _storage: SimpleNamespace(
            to_dict=lambda: {"credited": 0, "failed": 0, "pending": 1}
        ),
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.bounded_sweep.settings",
        SimpleNamespace(
            deposit_pending_sweep_max_wait_sec=2.0,
            deposit_pending_sweep_poll_interval_sec=1.0,
        ),
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.bounded_sweep.time.sleep",
        lambda _seconds: None,
    )
    monotonic_values = iter([0.0, 3.0])
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.bounded_sweep.time.monotonic",
        lambda: next(monotonic_values),
    )

    result = run_bounded_pending_confirmation_sweep(_FakeStorage())

    assert result.status == "pending"
    assert result.attempts == 1
    assert result.pending == 1
    assert result.reason == "awaiting_chain_visibility"


def test_locked_bounded_pending_sweep_returns_skipped_when_lock_busy(monkeypatch) -> None:
    class _BusyLock:
        def __enter__(self):
            return False

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.bounded_sweep.postgres_advisory_job_lock",
        lambda _storage, _job_name: _BusyLock(),
    )

    result = run_locked_bounded_pending_confirmation_sweep(_FakeStorage())

    assert result.status == "skipped"
    assert result.reason == "already_running"
