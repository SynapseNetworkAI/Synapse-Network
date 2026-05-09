from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterator
from contextlib import contextmanager, suppress

from src.storage.base import BaseStorage

logger = logging.getLogger(__name__)

JOB_LOCK_KEYS = {
    "deposit-indexer",
    "consumer-withdraw-chain-recovery",
    "withdrawal-expiry-sweeper",
    "provider-withdraw-reaper",
    "consumer-withdraw-processor",
    "notification-outbox-drain",
    "in-app-notification-cleanup",
    "service-health-events-cleanup",
}


class UnknownJobLockKey(ValueError):
    pass


def advisory_lock_key(job_name: str) -> int:
    """Return a stable signed 64-bit advisory-lock key for a job name."""
    digest = hashlib.sha256(f"synapse-job-lock:{job_name}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


@contextmanager
def postgres_advisory_job_lock(
    storage: BaseStorage,
    job_name: str,
) -> Iterator[bool]:
    """Try to hold a Postgres advisory lock for one bounded job tick.

    Cloud Run Job task/parallelism settings only prevent concurrency inside one
    execution. Scheduler can still start the next execution before the previous
    one exits, so money-sensitive jobs use this DB-level lock as the cheap V1
    cross-execution guard.
    """
    if job_name not in JOB_LOCK_KEYS:
        raise UnknownJobLockKey

    get_database_manager = getattr(storage, "get_database_manager", None)
    if get_database_manager is None:
        logger.warning(
            "JOB_LOCK_UNAVAILABLE: storage has no Postgres database manager",
            extra={"jobName": job_name},
        )
        yield True
        return

    database_manager = get_database_manager()
    lock_key = advisory_lock_key(job_name)
    acquired = False
    with database_manager.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", (lock_key,))
            row = cur.fetchone()
            acquired = bool(row and row[0])
        if not acquired:
            logger.info(
                "JOB_SKIPPED_ALREADY_RUNNING",
                extra={"jobName": job_name, "lockKey": str(lock_key)},
            )
            yield False
            return
        try:
            yield True
        finally:
            with suppress(Exception), conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(%s)", (lock_key,))
