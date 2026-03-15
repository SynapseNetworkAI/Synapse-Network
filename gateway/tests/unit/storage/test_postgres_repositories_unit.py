# pyright: reportMissingImports=false

from __future__ import annotations

import contextlib
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from src.storage.postgres.repositories.audit_log_repository import AuditLogRepository
from src.storage.postgres.repositories.balance_repository import BalanceRepository
from src.storage.postgres.repositories.credential_auth_repository import CredentialAuthRepository
from src.storage.postgres.repositories.fee_policy_repository import FeePolicyRepository
from src.storage.postgres.repositories.finance_atomic_repository import FinanceAtomicRepository
from src.storage.postgres.repositories.gateway_state_repository import GatewayStateRepository
from src.storage.postgres.repositories.idempotency_repository import IdempotencyRepository
from src.storage.postgres.repositories.legacy_collection_repository import LegacyCollectionRepository
from src.storage.postgres.repositories.service_registry_repository import ServiceRegistryRepository


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

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeConnection:
    def __init__(self, plan: Optional[Dict[str, Any]] = None):
        plan = plan or {}
        self.cursor_obj = FakeCursor(
            fetchone_queue=plan.get("fetchone"),
            fetchall_queue=plan.get("fetchall"),
        )
        self.commits = 0
        self.rollbacks = 0

    def cursor(self) -> FakeCursor:
        return self.cursor_obj

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        return None


class FakeDB:
    def __init__(self):
        self.readonly_plan: List[Dict[str, Any]] = []
        self.readonly_cursors: List[FakeCursor] = []
        self.tx_cursors: List[FakeCursor] = []
        self.connect_plan: List[Dict[str, Any]] = []
        self.connections: List[FakeConnection] = []

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

    @contextlib.contextmanager
    def connect(self):
        plan = self.connect_plan.pop(0) if self.connect_plan else {}
        conn = FakeConnection(plan)
        self.connections.append(conn)
        yield conn


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
    assert abs(policy.default_rate - 0.015) < 1e-9
    assert policy.owner_rates == {"0xabc": 0.02, "0xdef": 0.03}
    assert policy.updated_at == 1700000000
    assert policy.updated_by == "ops"

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
    assert len(rows) == 1
    assert rows[0].id == "idem-1"
    assert rows[0].scope == "refund"
    assert rows[0].owner_address == "0xabc"
    assert rows[0].idempotency_key == "k1"
    assert rows[0].request_hash == "h1"
    assert rows[0].response == {"ok": True}
    assert rows[0].created_at == 100
    assert rows[0].expires_at == 200

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
            "fetchall": [[
                (
                    1,
                    "FINANCE_RATE_LIMIT_HIT",
                    "charge",
                    "yellow",
                    "0xabc",
                    "system",
                    "req-1",
                    "0xtx1",
                    "trace-1",
                    "0xdef",
                    "debit",
                    "REJECTED",
                    "RATE_LIMIT",
                    "ledger-1",
                    "127.0.0.1",
                    "pytest",
                    Decimal("0.100000"),
                    Decimal("1.000000"),
                    Decimal("0.900000"),
                    "rejected",
                    "RATE_LIMIT",
                    "blocked",
                    100,
                )
            ]],
        }
    )
    db.readonly_plan.append(
        {
            "fetchall": [[
                (
                    9,
                    "SELLER_SECRET_ISSUED",
                    "0xabc",
                    "owner",
                    "req-2",
                    "trace-2",
                    "credential",
                    "cred-1",
                    "success",
                    None,
                    "127.0.0.2",
                    "pytest",
                    {"secretId": "cred-1"},
                    200,
                )
            ]],
        }
    )
    repo = AuditLogRepository(db, "INSERT INTO synapse_audit_log (collection_name, payload) VALUES (%s, %s::jsonb)")

    from src.domain.audit import AuditLogEntry
    repo.append_audit_row(
        AuditLogEntry(
            action="FINANCE_RATE_LIMIT_HIT",
            ownerAddress="0xabc",
            details={"businessType": "charge", "riskLevel": "yellow", "requestId": "req-1"},
        )
    )
    repo.append_audit_row(
        AuditLogEntry(
            action="SELLER_SECRET_ISSUED",
            domain="system",
            ownerAddress="0xabc",
            details={"requestId": "req-2", "resourceType": "credential", "resourceId": "cred-1"},
        )
    )

    combined_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "INSERT INTO synapse_audit_log" in combined_sql
    assert "INSERT INTO synapse_system_activity_log" in combined_sql

    rows = repo.read_audit_rows(owner_wallet="0xabc", limit=10)
    assert len(rows) == 1
    assert rows[0].domain == "finance"
    assert rows[0].details["requestId"] == "req-1"
    assert rows[0].details["riskReasonCode"] == "RATE_LIMIT"

    system_rows = repo.read_system_audit_rows(owner_wallet="0xabc", limit=10)
    assert len(system_rows) == 1
    assert system_rows[0].domain == "system"
    assert system_rows[0].details["resourceType"] == "credential"


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
    assert abs(ledger.buyers["0xbuyer"] - 10.0) < 1e-9
    assert abs(ledger.sellers["0xseller"] - 20.0) < 1e-9
    assert abs(ledger.platform.fee_accrued - 0.5) < 1e-9
    assert ledger.updated_at == 120

    from src.domain.finance import BalanceLedger, PlatformFees
    repo.write_balance_ledger(
        BalanceLedger(
            buyers={"0xB": 1},
            buyers_locked={"0xB": 2},
            buyers_frozen={"0xB": 3},
            sellers={"0xS": 4},
            sellers_locked={"0xS": 5},
            sellers_frozen={"0xS": 6},
            platform=PlatformFees(fee_accrued=7),
            updated_at=130,
        )
    )
    ops = db.tx_cursors[-1].executed
    assert ops[0] == ("DELETE FROM synapse_balances", None)
    upserts = [params for sql, params in ops if sql == "UPSERT"]
    assert len(upserts) == 3
    assert any(params[0] == "0xb" and params[1] == "buyer" for params in upserts)
    assert any(params[0] == "0xs" and params[1] == "seller" for params in upserts)
    assert any(params[0] == "__platform__" and params[1] == "platform_fee" for params in upserts)


def test_service_registry_repository_read_and_write() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchone": [(1,)],
        }
    )
    db.readonly_plan.append(
        {
            "fetchall": [[({"serviceId": "svc-1", "ownerAddress": "0xabc", "name": "SVC"},)]],
        }
    )
    db.readonly_plan.append(
        {
            "fetchall": [[("svc-1", "0xabc", "https://a", 100, "ap", "up", "green", 200, 12, 3, 1, "https://a/health", 10, 9, None)]],
        }
    )
    db.readonly_plan.append(
        {
            "fetchall": [[("svc-1", "0xabc", "https://a", "up", 200, 12, "https://a/health", 3, 1, 11, 9, None)]],
        }
    )
    db.readonly_plan.append(
        {
            "fetchone": [(1,)],
        }
    )
    repo = ServiceRegistryRepository(db)

    services = repo.read_service_registry_rows()
    assert services[0]["serviceId"] == "svc-1"

    target_rows = repo.read_service_target_health_rows()
    assert target_rows[0].consecutive_successes == 3

    history_rows = repo.read_service_target_health_history_rows()
    assert history_rows[0].checked_at == 11

    repo.write_service_registry_rows([{"serviceId": "svc-2", "ownerAddress": "0xDEF", "createdAt": 1, "updatedAt": 2}])
    repo.write_service_target_health_rows([{"serviceId": "svc-2", "ownerAddress": "0xDEF", "targetUrl": "https://b"}])
    repo.write_service_target_health_history_rows([{"serviceId": "svc-2", "ownerAddress": "0xDEF", "targetUrl": "https://b", "checkedAt": 3}])

    all_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "DELETE FROM synapse_service_registry" in all_sql
    assert "DELETE FROM synapse_service_target_health" in all_sql
    assert "DELETE FROM synapse_service_target_health_history" in all_sql


def test_service_registry_repository_legacy_schema_compatibility() -> None:
    db = FakeDB()
    db.readonly_plan.append({"fetchone": [None]})
    db.readonly_plan.append(
        {
            "fetchall": [
                [
                    (
                        "svc-legacy",
                        "0xabc",
                        "Legacy API",
                        "legacy summary",
                        "https://legacy.example.com/invoke",
                        "active",
                        True,
                        Decimal("0.005"),
                        "USD",
                        18000,
                        50,
                        4096,
                        8192,
                        100,
                        120,
                    )
                ]
            ]
        }
    )
    db.readonly_plan.append({"fetchone": [None]})

    repo = ServiceRegistryRepository(db)
    rows = repo.read_service_registry_rows()

    assert rows[0]["serviceId"] == "svc-legacy"
    assert rows[0]["serviceName"] == "Legacy API"
    assert rows[0]["invoke"]["targets"][0]["url"] == "https://legacy.example.com/invoke"
    assert rows[0]["pricing"]["currency"] == "USD"

    repo.write_service_registry_rows(rows)
    sql = "\n".join(stmt for stmt, _ in db.tx_cursors[-1].executed)
    assert "INSERT INTO synapse_service_registry" in sql
    assert "service_name" in sql
    assert "payload" not in sql


def test_credential_auth_repository_read_write_and_roles() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [[({"id": "cred-1", "ownerAddress": "0xabc"},)]],
        }
    )
    db.readonly_plan.append(
        {
            "fetchone": [("admin",)],
        }
    )
    repo = CredentialAuthRepository(db, _q6)

    creds = repo.read_credential_rows("seller")
    assert creds == [{"id": "cred-1", "ownerAddress": "0xabc"}]

    role = repo.get_wallet_role("0xABC")
    assert role == "admin"

    repo.write_credential_rows(
        "seller",
        [{"id": "cred-2", "ownerAddress": "0xDEF", "creditLimit": 1.25}],
    )
    repo.set_wallet_role("0xABC", "operator")
    repo.upsert_auth_session("0xABC", 100, 200, "active")

    tx_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "DELETE FROM synapse_credentials WHERE credential_type = %s" in tx_sql
    assert "INSERT INTO synapse_wallet_roles" in tx_sql
    assert "INSERT INTO synapse_auth_sessions" in tx_sql


def test_gateway_state_repository_read_and_write() -> None:
    db = FakeDB()
    db.readonly_plan.append({"fetchall": [[({"id": "dep-1"},)]]})
    db.readonly_plan.append({"fetchall": [[({"id": "ref-1"},)]]})
    db.readonly_plan.append({"fetchall": [[({"id": "wd-1"},)]]})
    db.readonly_plan.append({"fetchall": [[("0xabc", Decimal("100"), 1, 2)]]})
    db.readonly_plan.append({"fetchall": [[({"id": "usage-1"},)]]})
    db.readonly_plan.append({"fetchall": [[("ek-1",)]]})
    repo = GatewayStateRepository(db, _q6)

    assert repo.read_deposit_intents() == [{"id": "dep-1"}]
    assert repo.read_refund_intents() == [{"id": "ref-1"}]
    assert repo.read_withdrawal_intents() == [{"id": "wd-1"}]
    router_rows = repo.read_router_config_rows()
    assert router_rows[0].owner_address == "0xabc"
    assert abs(router_rows[0].daily_limit_usdc - 100.0) < 1e-9
    assert repo.read_usage_log_rows() == [{"id": "usage-1"}]
    assert repo.read_processed_deposit_event_keys() == ["ek-1"]

    repo.write_deposit_intents([{"id": "dep-2", "ownerAddress": "0xA", "txHash": "0xT"}])
    repo.write_refund_intents([{"id": "ref-2", "ownerAddress": "0xA", "amountUsdc": 1}], updated_at=9)
    repo.write_withdrawal_intents([{"id": "wd-2", "ownerAddress": "0xA", "amountUsdc": 2}], updated_at=9)
    repo.write_router_config_rows([{"ownerAddress": "0xA", "dailyLimitUsdc": 10}], updated_at=9)
    repo.write_usage_log_rows([{"id": "usage-2", "buyer": "0xA", "seller": "0xB", "totalCharge": 1}])
    repo.write_processed_deposit_event_keys(["ek-2"], updated_at=9)

    tx_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "DELETE FROM synapse_deposit_intents" in tx_sql
    assert "DELETE FROM synapse_refund_intents" in tx_sql
    assert "DELETE FROM synapse_withdrawal_intents" in tx_sql
    assert "DELETE FROM synapse_router_config" in tx_sql
    assert "DELETE FROM synapse_usage_log" in tx_sql
    assert "DELETE FROM synapse_processed_deposit_events" in tx_sql


def test_finance_atomic_repository_reserve_and_complete() -> None:
    db = FakeDB()
    db.connect_plan.append({"fetchone": [(Decimal("10"), Decimal("1"), Decimal("2"))]})
    db.connect_plan.append({})
    repo = FinanceAtomicRepository(
        db,
        _q6,
        "UPSERT",
        "BAL_FOR_UPDATE",
        "AUDIT_INSERT",
        ("restricted", "suspended", "blocked"),
    )

    result = repo.reserve_seller_withdraw_atomic("0xabc", Decimal("2"))
    assert abs(result["beforeBalance"] - 10.0) < 1e-9
    assert abs(result["afterBalance"] - 8.0) < 1e-9

    first_conn_sql = "\n".join(sql for sql, _ in db.connections[0].cursor_obj.executed)
    assert "BAL_FOR_UPDATE" in first_conn_sql
    assert "UPSERT" in first_conn_sql

    ok = repo.complete_withdraw_tx_atomic("0xabc", "0xtx", "seller")
    assert ok is True
    second_conn_sql = "\n".join(sql for sql, _ in db.connections[1].cursor_obj.executed)
    assert "INSERT INTO synapse_withdraw_tx_dedup" in second_conn_sql


def test_legacy_collection_repository_read_save_append() -> None:
    class FakeAuditRepo:
        def __init__(self):
            self.append_calls: List[Any] = []
            self.replace_calls: List[Any] = []

        def append_to_audit_collection(self, item: Any) -> None:
            self.append_calls.append(item)

        def replace_audit_collection(self, rows: List[Dict[str, Any]]) -> None:
            self.replace_calls.append(rows)

    db = FakeDB()
    db.readonly_plan.append({"fetchone": [None]})
    db.readonly_plan.append({"fetchone": [({"services": [{"serviceId": "svc-1"}]},)]})
    audit_repo = FakeAuditRepo()
    repo = LegacyCollectionRepository(db, lambda row: row, audit_repo)

    assert repo.get_collection("missing_list") == []
    assert repo.get_collection("service_registry") == [{"serviceId": "svc-1"}]

    repo.save_collection("service_registry", [{"serviceId": "svc-2"}])
    repo.save_collection("audit_log", [{"event": "x"}])
    repo.append_to_collection("audit_log", {"event": "y"})

    assert audit_repo.replace_calls == [[{"event": "x"}]]
    assert audit_repo.append_calls == [{"event": "y"}]

    tx_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "INSERT INTO synapse_collections" in tx_sql
