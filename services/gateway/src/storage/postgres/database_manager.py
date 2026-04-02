from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Callable, Generator


class DatabaseManager:
    """Connection/transaction manager with no domain SQL."""

    def __init__(self, connect_factory: Callable[[], Any]):
        self._connect_factory = connect_factory

    @contextmanager
    def connect(self) -> Generator[Any, None, None]:
        conn = self._connect_factory()
        try:
            yield conn
        finally:
            conn.close()

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
