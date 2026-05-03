"""Balance maturity SQL read model tests."""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from src.storage.postgres.repositories.balance_maturity_mixin import (
    BalanceMaturityMixin,
)


class _Cursor:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = list(rows)
        self.executed: list[tuple[str, tuple[Any, ...]]] = []

    def execute(self, sql: str, params: tuple[Any, ...]) -> None:
        self.executed.append((sql, params))

    def fetchone(self) -> tuple[Any, ...] | None:
        return self._rows.pop(0) if self._rows else None


class _CursorContext:
    def __init__(self, cursor: _Cursor) -> None:
        self.cursor = cursor

    def __enter__(self) -> _Cursor:
        return self.cursor

    def __exit__(self, *_args: object) -> None:
        return None


class _Db:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self.cursor = _Cursor(rows)

    def readonly_cursor(self) -> _CursorContext:
        return _CursorContext(self.cursor)


class _Repo(BalanceMaturityMixin):
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._db = _Db(rows)

    def _owner_id(self, owner: str) -> str:
        return f"owner:{owner}"

    def _account_identity(self, owner: str, kind: str) -> tuple[str, str]:
        return f"{kind}:{owner}", kind

    def _q6(self, value: Any) -> Decimal:
        return Decimal(str(value)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def test_consumer_mature_withdrawable_uses_aggregate_fifo_formula() -> None:
    repo = _Repo([(Decimal("100"),), (Decimal("20"),), (Decimal("30"),)])

    mature = repo.read_consumer_mature_withdrawable("0xABC", 86400)

    assert mature == Decimal("50.000000")
    assert repo._db.cursor.executed[0][1] == ("owner:0xabc", 86400)
    assert repo._db.cursor.executed[1][1] == ("consumer:0xabc",)
    assert repo._db.cursor.executed[2][1] == ("owner:0xabc",)


def test_consumer_mature_withdrawable_clamps_negative_to_zero() -> None:
    repo = _Repo([(Decimal("10"),), (Decimal("20"),), (Decimal("5"),)])

    assert repo.read_consumer_mature_withdrawable("0xabc", -1) == Decimal("0.000000")
    assert repo._db.cursor.executed[0][1] == ("owner:0xabc", 0)


def test_consumer_sliding_window_stats_use_db_window_seconds() -> None:
    repo = _Repo([(3, Decimal("30.1234564"))])

    count, amount = repo.read_consumer_withdrawal_window_stats("0xABC", 0)

    assert count == 3
    assert amount == Decimal("30.123456")
    assert repo._db.cursor.executed[0][1] == ("owner:0xabc", 1)
    assert "created_at >= NOW()" in repo._db.cursor.executed[0][0]


def test_provider_mature_withdrawable_subtracts_locked_withdrawals() -> None:
    repo = _Repo([(Decimal("70"),), (Decimal("25"),)])

    mature = repo.read_provider_mature_withdrawable("0xABC", 604800)

    assert mature == Decimal("45.000000")
    assert repo._db.cursor.executed[0][1] == ("provider:0xabc", 604800)
    assert repo._db.cursor.executed[1][1] == ("owner:0xabc",)


def test_provider_mature_withdrawable_clamps_negative_to_zero() -> None:
    repo = _Repo([(Decimal("10"),), (Decimal("20"),)])

    assert repo.read_provider_mature_withdrawable("0xabc", -10) == Decimal("0.000000")
    assert repo._db.cursor.executed[0][1] == ("provider:0xabc", 0)
