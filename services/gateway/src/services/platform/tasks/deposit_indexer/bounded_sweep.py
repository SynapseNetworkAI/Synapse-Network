from __future__ import annotations

import time
from dataclasses import asdict, dataclass

from src.core.config import settings
from src.services.platform.job_locks import postgres_advisory_job_lock
from src.storage import BaseStorage

from .runner import process_pending_deposit_intents_once


@dataclass(frozen=True)
class DepositPendingSweepResult:
    status: str
    attempts: int
    credited: int
    failed: int
    pending: int
    reason: str = ""

    def to_dict(self) -> dict[str, int | str]:
        return asdict(self)


def _result_from_counters(
    *,
    status: str,
    attempts: int,
    credited: int,
    failed: int,
    pending: int,
    reason: str = "",
) -> DepositPendingSweepResult:
    return DepositPendingSweepResult(
        status=status,
        attempts=attempts,
        credited=credited,
        failed=failed,
        pending=pending,
        reason=reason,
    )


def _should_finish(credited: int, failed: int, pending: int) -> bool:
    return credited > 0 or failed > 0 or pending == 0


def run_bounded_pending_confirmation_sweep(
    storage: BaseStorage,
) -> DepositPendingSweepResult:
    max_wait_sec = max(0.0, float(settings.deposit_pending_sweep_max_wait_sec))
    poll_interval_sec = max(
        0.1,
        float(settings.deposit_pending_sweep_poll_interval_sec),
    )
    deadline = time.monotonic() + max_wait_sec
    attempts = 0
    credited = 0
    failed = 0
    pending = 0

    while True:
        attempts += 1
        counters = process_pending_deposit_intents_once(storage).to_dict()
        credited = int(counters.get("credited") or 0)
        failed = int(counters.get("failed") or 0)
        pending = int(counters.get("pending") or 0)
        if _should_finish(credited, failed, pending):
            return _result_from_counters(
                status="ok",
                attempts=attempts,
                credited=credited,
                failed=failed,
                pending=pending,
            )
        if time.monotonic() >= deadline:
            return _result_from_counters(
                status="pending",
                attempts=attempts,
                credited=credited,
                failed=failed,
                pending=pending,
                reason="awaiting_chain_visibility",
            )
        time.sleep(poll_interval_sec)


def run_locked_bounded_pending_confirmation_sweep(
    storage: BaseStorage,
) -> DepositPendingSweepResult:
    with postgres_advisory_job_lock(storage, "deposit-indexer") as acquired:
        if not acquired:
            return _result_from_counters(
                status="skipped",
                attempts=0,
                credited=0,
                failed=0,
                pending=0,
                reason="already_running",
            )
        return run_bounded_pending_confirmation_sweep(storage)
