from __future__ import annotations

from contextlib import contextmanager, suppress
from dataclasses import dataclass
from typing import Any, Callable, Generator, Optional

try:
    from psycopg_pool import ConnectionPool
except Exception:  # pragma: no cover: optional dependency import guard emits an actionable startup error below.
    ConnectionPool = None  # type: ignore[assignment]  # reason: optional import guard raises an actionable startup error.


MAX_SAFE_POOL_SIZE = 10


@dataclass(frozen=True)
class PostgresPoolStats:
    pool_max: int
    pool_available: int | None
    pool_size: int | None
    requests_waiting: int | None
    closed: bool

    def to_response_dict(self) -> dict[str, int | bool | None]:
        return {
            "poolMax": self.pool_max,
            "poolAvailable": self.pool_available,
            "poolSize": self.pool_size,
            "requestsWaiting": self.requests_waiting,
            "closed": self.closed,
        }


def normalize_pool_max(pool_max: int) -> int:
    try:
        value = int(pool_max)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(  # noqa: TRY003 - startup errors must include operator-ready remediation.
            "FATAL DB-CONFIG-001: POSTGRES_POOL_MAX must be an integer between 1 and 10.\n"
            "Agent fix: set POSTGRES_POOL_MAX between 1 and 10; staging default is 5."
        ) from exc
    if value < 1 or value > MAX_SAFE_POOL_SIZE:
        raise RuntimeError(  # noqa: TRY003 - startup errors must include operator-ready remediation.
            f"FATAL DB-CONFIG-001: POSTGRES_POOL_MAX={value} exceeds safe Cloud SQL MVP limit.\n"
            "Agent fix: set POSTGRES_POOL_MAX between 1 and 10; staging default is 5."
        )
    return value


class DatabaseManager:
    """Connection/transaction manager backed by psycopg's official pool."""

    def __init__(
        self,
        connect_factory: Callable[[], Any],
        dsn: Optional[str] = None,
        pool_max: int = 5,
        pool_timeout_sec: float = 5.0,
        pool_max_lifetime_sec: float = 1800.0,
        pool_max_idle_sec: float = 300.0,
        connection_kwargs: Optional[dict[str, Any]] = None,
    ):
        if ConnectionPool is None:
            raise RuntimeError(  # noqa: TRY003 - startup error must be operator-actionable.
                "FATAL DB-CONFIG-002: psycopg_pool is not installed.\n"
                "Agent fix: install dependency 'psycopg-pool>=3.2.0' in services/gateway/.venv."
            )
        if not str(dsn or "").strip():
            raise RuntimeError(  # noqa: TRY003 - startup error must be operator-actionable.
                "POSTGRES_DSN is required to initialize the Postgres connection pool"
            )

        self._pool_max = normalize_pool_max(pool_max)
        self._closed = False
        self._pool_timeout_sec = max(0.1, float(pool_timeout_sec or 5.0))
        self._pool = ConnectionPool(
            conninfo=str(dsn).strip(),
            kwargs=dict(connection_kwargs or {}),
            min_size=0,
            max_size=self._pool_max,
            timeout=self._pool_timeout_sec,
            max_lifetime=max(1.0, float(pool_max_lifetime_sec or 1800.0)),
            max_idle=max(1.0, float(pool_max_idle_sec or 300.0)),
            configure=self._configure_connection,
            check=ConnectionPool.check_connection,
            open=True,
        )

    @staticmethod
    def _configure_connection(conn: Any) -> None:
        conn.autocommit = False

    def close(self) -> None:
        self._closed = True
        self._pool.close()

    def stats(self) -> PostgresPoolStats:
        raw_stats: dict[str, Any] = {}
        with suppress(Exception):
            raw_stats = dict(self._pool.get_stats())
        return PostgresPoolStats(
            pool_max=self._pool_max,
            pool_available=_first_int(
                raw_stats,
                "pool_available",
                "pool_available_count",
                "available",
            ),
            pool_size=_first_int(raw_stats, "pool_size", "pool_size_count", "size"),
            requests_waiting=_first_int(
                raw_stats,
                "requests_waiting",
                "requests_waiting_count",
                "waiting",
            ),
            closed=self._closed,
        )

    @contextmanager
    def connect(self) -> Generator[Any, None, None]:
        if self._closed:
            raise RuntimeError("POSTGRES_POOL_CLOSED")
        with self._pool.connection(timeout=self._pool_timeout_sec) as conn:
            try:
                yield conn
            finally:
                with suppress(Exception):
                    conn.rollback()

    @contextmanager
    def readonly_cursor(self) -> Generator[Any, None, None]:
        with self.connect() as conn, conn.cursor() as cur:
            yield cur

    @contextmanager
    def tx_cursor(self) -> Generator[Any, None, None]:
        with self.connect() as conn:
            try:
                with conn.cursor() as cur:
                    yield cur
                conn.commit()
            except Exception:
                conn.rollback()
                raise


def _first_int(raw_stats: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = raw_stats.get(key)
        if value is None:
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    return None
