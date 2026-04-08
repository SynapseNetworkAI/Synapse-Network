from __future__ import annotations

from contextlib import contextmanager
from collections import deque
from typing import Any, Callable, Generator, Optional
import threading


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
        self._pool_max = pool_max
        self._lock = threading.Lock()

    def _get_conn(self) -> Any:
        with self._lock:
            while self._pool:
                conn = self._pool.popleft()
                try:
                    conn.execute("SELECT 1")
                    return conn
                except Exception:
                    try:
                        conn.close()
                    except Exception:
                        pass
        return self._connect_factory()

    def _return_conn(self, conn: Any) -> None:
        with self._lock:
            if len(self._pool) < self._pool_max:
                try:
                    conn.rollback()
                    self._pool.append(conn)
                    return
                except Exception:
                    pass
        try:
            conn.close()
        except Exception:
            pass

    @contextmanager
    def connect(self) -> Generator[Any, None, None]:
        conn = self._get_conn()
        try:
            yield conn
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            raise
        else:
            self._return_conn(conn)

    @contextmanager
    def readonly_cursor(self) -> Generator[Any, None, None]:
        with self.connect() as conn:
            with conn.cursor() as cur:
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
