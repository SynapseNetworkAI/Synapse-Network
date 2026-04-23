from __future__ import annotations

from contextlib import contextmanager, suppress
from collections import deque
from typing import Any, Callable, Generator, Optional
import threading


MAX_SAFE_POOL_SIZE = 10


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
    """Connection/transaction manager with simple connection pooling."""

    def __init__(
        self,
        connect_factory: Callable[[], Any],
        dsn: Optional[str] = None,
        pool_max: int = 5,
    ):
        self._connect_factory = connect_factory
        self._pool: deque[Any] = deque()
        self._pool_max = normalize_pool_max(pool_max)
        self._lock = threading.Lock()

    def _get_conn(self) -> Any:
        with self._lock:
            while self._pool:
                conn = self._pool.popleft()
                try:
                    conn.execute("SELECT 1")
                except Exception:
                    with suppress(Exception):
                        conn.close()
                else:
                    return conn
        return self._connect_factory()

    def _return_conn(self, conn: Any) -> None:
        with self._lock:
            if len(self._pool) < self._pool_max:
                close_after_failure = False
                try:
                    conn.rollback()
                    self._pool.append(conn)
                except Exception:
                    close_after_failure = True
                else:
                    return
                if not close_after_failure:
                    return
        with suppress(Exception):
            conn.close()

    @contextmanager
    def connect(self) -> Generator[Any, None, None]:
        conn = self._get_conn()
        try:
            yield conn
        except Exception:
            with suppress(Exception):
                conn.close()
            raise
        else:
            self._return_conn(conn)

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
