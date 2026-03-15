# pyright: reportMissingImports=false

from __future__ import annotations

import contextlib
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from src.storage.postgres.repositories.audit_log_repository import AuditLogRepository
from src.storage.postgres.repositories.balance_repository import BalanceRepository
from src.storage.postgres.repositories.fee_policy_repository import FeePolicyRepository
from src.storage.postgres.repositories.idempotency_repository import IdempotencyRepository


class FakeCursor:
    def __init__(
        self,
        fetchone_queue: Optional[List[Any]] = None,
        fetchall_queue: Optional[List[Any]] = None,
    ):
        self.fetchone_queue = list(fetchone_queue or [])
        self.fetchall_queue = list(fetchall_queue or [])
        self.executed: List[tuple[str, Any]] = []

    def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))

    def fetchone(self) -> Any:
        if not self.fetchone_queue:
            return None
        return self.fetchone_queue.pop(0)

    def fetchall(self) -> Any:
        if not self.fetchall_queue:
            return []
        return self.fetchall_queue.pop(0)


class FakeDB:
    def __init__(self):
        self.readonly_plan: List[Dict[str, Any]] = []
        self.readonly_cursors: List[FakeCursor] = []
        self.tx_cursors: List[FakeCursor] = []

    @contextlib.contextmanager
    def readonly_cursor(self):
        plan = self.readonly_plan.pop(0) if self.readonly_plan else {}
        cur = FakeCursor(
            fetchone_queue=plan.get("fetchone"),
            fetchall_queue=plan.get("fetchall"),
        )
        self.readonly_cursors.append(cur)
        yield cur

    @contextlib.contextmanager
    def tx_cursor(self):
        cur = FakeCursor()
        self.tx_cursors.append(cur)
        yield cur


def _q6(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def test_fee_policy_repository_read_write() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchone": [(Decimal("0.015"), 1700000000, "ops")],
            "fetchall": [[("0xabc", Decimal("0.02")), ("0xdef", Decimal("0.03"))]],
        }
    )
    repo = FeePolicyRepository(db, _q6)

    policy = repo.get_platform_fee_policy()
    assert policy["defaultRate"] == 0.015
    assert policy["ownerRates"] == {"0xabc": 0.02, "0xdef": 0.03}
    assert policy["updatedAt"] == 1700000000
    assert policy["updatedBy"] == "ops"

    repo.set_platform_fee_policy(0.05, {"0xABC": 0.04, "": 0.02}, "admin", 1700000001)
    tx_ops = db.tx_cursors[-1].executed
    assert any("DELETE FROM synapse_platform_fee_policy_owner" in sql for sql, _ in tx_ops)
    inserts = [params for sql, params in tx_ops if "INSERT INTO synapse_platform_fee_policy_owner" in sql]
    assert inserts == [("0xabc", "0.040000")]


def test_idempotency_repository_read_and_write_rows() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [[("idem-1", "refund", "0xabc", "k1", "h1", {"ok": True}, 100, 200)]],
        }
    )
    repo = IdempotencyRepository(db)

    rows = repo.read_idempotency_rows()
    assert rows == [
        {
            "id": "idem-1",
            "scope": "refund",
            "ownerAddress": "0xabc",
            "idempotencyKey": "k1",
            "requestHash": "h1",
            "response": {"ok": True},
            "createdAt": 100,
            "expiresAt": 200,
        }
    ]

    repo.write_idempotency_rows(
        [
            {
                "id": "idem-2",
                "scope": "withdraw",
                "ownerAddress": "0xDEF",
                "idempotencyKey": "k2",
                "requestHash": "h2",
                "response": {"status": "ok"},
            }
        ],
        updated_at=300,
    )
    ops = db.tx_cursors[-1].executed
    assert ops[0][0] == "DELETE FROM synapse_idempotency_keys"
    insert_params = [params for sql, params in ops if "INSERT INTO synapse_idempotency_keys" in sql][0]
    assert insert_params[2] == "0xdef"


def test_audit_log_repository_append_replace_and_read() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [[({"timestamp": 1, "msg": "a"},), ({"timestamp": 3, "msg": "c"},)]],
        }
    )
    repo = AuditLogRepository(db, "INSERT INTO synapse_audit_log (collection_name, payload) VALUES (%s, %s::jsonb)")

    repo.append_audit_row({"event": "x"})
    repo.append_to_audit_collection({"event": "y"})
    repo.replace_audit_collection([{"event": "z"}])

    combined_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "DELETE FROM synapse_audit_log WHERE collection_name = %s" in combined_sql

    rows = repo.read_audit_rows(owner_wallet="0xabc", limit=10)
    assert rows == [{"timestamp": 3, "msg": "c"}, {"timestamp": 1, "msg": "a"}]


def test_balance_repository_read_and_write() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [
                [
                    ("0xbuyer", "buyer", Decimal("10"), Decimal("1"), Decimal("2"), 100),
                    ("0xseller", "seller", Decimal("20"), Decimal("3"), Decimal("4"), 110),
                    ("__platform__", "platform_fee", Decimal("0.5"), Decimal("0"), Decimal("0"), 120),
                ]
            ]
        }
    )
    repo = BalanceRepository(db, _q6, "UPSERT")

    ledger = repo.read_balance_ledger()
    assert ledger["buyers"]["0xbuyer"] == 10.0
    assert ledger["sellers"]["0xseller"] == 20.0
    assert ledger["platform"]["feeAccrued"] == 0.5
    assert ledger["updatedAt"] == 120

    repo.write_balance_ledger(
        {
            "buyers": {"0xB": 1},
            "buyersLocked": {"0xB": 2},
            "buyersFrozen": {"0xB": 3},
            "sellers": {"0xS": 4},
            "sellersLocked": {"0xS": 5},
            "sellersFrozen": {"0xS": 6},
            "platform": {"feeAccrued": 7},
            "updatedAt": 130,
        }
    )
    ops = db.tx_cursors[-1].executed
    assert ops[0] == ("DELETE FROM synapse_balances", None)
    upserts = [params for sql, params in ops if sql == "UPSERT"]
    assert len(upserts) == 3
    assert any(params[0] == "0xb" and params[1] == "buyer" for params in upserts)
    assert any(params[0] == "0xs" and params[1] == "seller" for params in upserts)
    assert any(params[0] == "__platform__" and params[1] == "platform_fee" for params in upserts)
