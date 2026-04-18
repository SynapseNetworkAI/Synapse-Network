# pyright: reportMissingImports=false

from __future__ import annotations

import contextlib
import time
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, List, Optional

import pytest

from src.storage.postgres.repositories.audit_log_repository import AuditLogRepository
from src.storage.postgres.repositories.balance_repository import BalanceRepository
from src.storage.postgres.repositories.credential_auth_repository import CredentialAuthRepository
from src.storage.postgres.repositories.deposit_attempt_repository import DepositAttemptRepository
from src.storage.postgres.repositories.execution_repository import ExecutionRepository
from src.storage.postgres.repositories.fee_policy_repository import FeePolicyRepository
from src.storage.postgres.repositories.finance_atomic_repository import FinanceAtomicRepository
from src.storage.postgres.repositories.gateway_state_repository import GatewayStateRepository
from src.storage.postgres.repositories.idempotency_repository import IdempotencyRepository
from src.storage.postgres.repositories.service_registry_repository import ServiceRegistryRepository
from src.domain.execution import (
    CompleteWithdrawTxCommand,
    DepositIntentConfirmCommand,
    DepositIntentRegisterCommand,
    InvocationRecord,
    PreparedWithdrawTicket,
    ReserveProviderWithdrawCommand,
    ServiceQuoteRecord,
    WithdrawalAtomicRequestCommand,
)
from src.domain.service_contract import ServiceDefinitionRecord
from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.domain.gateway import OwnerSpendLimitRow
from src.domain.finance import (
    ChargeConsumerUsageCommand,
    DepositAttemptRow,
    RefundIntentRow,
    UsageLogRow,
)
from src.domain.ledger import DepositIntentRow, WithdrawalIntentRow
from src.services.balance_mixins.redis_guard import BalanceRedisGuardMixin
from src.services.platform.tasks.deposit_indexer.persistence import _load_deposit_intents


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
    def __init__(self, plan: Optional[dict[str, Any]] = None):
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
        self.readonly_plan: List[dict[str, Any]] = []
        self.tx_plan: List[dict[str, Any]] = []
        self.readonly_cursors: List[FakeCursor] = []
        self.tx_cursors: List[FakeCursor] = []
        self.connect_plan: List[dict[str, Any]] = []
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
        plan = self.tx_plan.pop(0) if self.tx_plan else {}
        cur = FakeCursor(
            fetchone_queue=plan.get("fetchone"),
            fetchall_queue=plan.get("fetchall"),
        )
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


def _raise_insufficient_vault_liquidity(_amount: Decimal) -> None:
    raise RuntimeError("INSUFFICIENT_VAULT_LIQUIDITY")


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
    assert policy.default_rate == Decimal("0.015000")
    assert policy.owner_rates == {
        "0xabc": Decimal("0.020000"),
        "0xdef": Decimal("0.030000"),
    }
    assert policy.updated_at == "2023-11-14 22:13:20"
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
    assert rows[0].response_code is None
    assert rows[0].response_digest is None
    assert rows[0].created_at == "1970-01-01 00:01:40"
    assert rows[0].expires_at == 200

    repo.write_idempotency_rows(
        [
            {
                "id": "idem-2",
                "scope": "withdraw",
                "ownerAddress": "0xDEF",
                "idempotencyKey": "k2",
                "requestHash": "h2",
                "responseCode": "ok",
                "responseDigest": "digest-2",
            }
        ],
        updated_at=300,
    )
    ops = db.tx_cursors[-1].executed
    assert ops[0][0] == "DELETE FROM synapse_idempotency_keys"
    owner_insert_params = [params for sql, params in ops if "INSERT INTO synapse_owner_accounts" in sql][0]
    assert owner_insert_params[0] == "owner:0xdef"
    assert owner_insert_params[1] == "0xdef"
    insert_params = [params for sql, params in ops if "INSERT INTO synapse_idempotency_keys" in sql][0]
    assert insert_params[2] == "owner:0xdef"


def test_idempotency_repository_rate_limit_rows_use_owner_mapping() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [[("rl-1", "0xabc", "deposit_intent", 1710000000, 2, "2026-03-18 10:00:00")]],
        }
    )
    repo = IdempotencyRepository(db)

    rows = repo.read_rate_limit_rows()
    assert len(rows) == 1
    assert rows[0].owner_address == "0xabc"
    assert rows[0].action == "deposit_intent"
    assert rows[0].count == 2

    repo.write_rate_limit_rows(
        [
            {
                "id": "rl-2",
                "ownerAddress": "0xDEF",
                "action": "deposit_intent",
                "windowStart": 1710000300,
                "count": 1,
            }
        ],
        updated_at=1710000300,
    )

    ops = db.tx_cursors[-1].executed
    assert ops[0][0] == "DELETE FROM synapse_finance_rate_limit"
    owner_insert_params = [params for sql, params in ops if "INSERT INTO synapse_owner_accounts" in sql][0]
    assert owner_insert_params[0] == "owner:0xdef"
    insert_params = [params for sql, params in ops if "INSERT INTO synapse_finance_rate_limit" in sql][0]
    assert insert_params[1] == "owner:0xdef"


def test_audit_log_repository_append_replace_and_read() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {"fetchone": [None]}
    )
    db.readonly_plan.append(
        {
            "fetchall": [[
                (
                    "audit-1",
                    "FINANCE_RATE_LIMIT_HIT",
                    "anomaly",
                    "owner:0xabc",
                    Decimal("0.100000"),
                    "rejected",
                    "RATE_LIMIT",
                    {
                        "domain": "finance",
                        "businessType": "anomaly",
                        "riskLevel": "yellow",
                        "requestId": "req-1",
                        "traceId": "trace-1",
                        "txHash": "0xtx1",
                        "action": "deposit_intent",
                        "backend": "redis",
                        "rateLimitBucket": "28500005",
                        "counterpartyAddress": "0xdef",
                        "direction": "debit",
                        "status": "REJECTED",
                        "riskReasonCode": "RATE_LIMIT",
                        "ledgerId": "ledger-1",
                        "clientIp": "127.0.0.1",
                        "userAgent": "pytest",
                        "beforeBalance": "1.000000",
                        "afterBalance": "0.900000",
                        "message": "blocked",
                    },
                    100,
                )
            ]],
        }
    )
    db.readonly_plan.append(
        {
            "fetchall": [[
                (
                    "system-9",
                    "PROVIDER_SECRET_ISSUED",
                    "owner:0xabc",
                    "success",
                    None,
                    {
                        "actor": "owner",
                        "requestId": "req-2",
                        "traceId": "trace-2",
                        "resourceType": "credential",
                        "resourceId": "cred-1",
                        "clientIp": "127.0.0.2",
                        "userAgent": "pytest",
                        "secretId": "cred-1",
                    },
                    200,
                )
            ]],
        }
    )
    repo = AuditLogRepository(
        db,
        "unused",
    )

    from src.domain.audit import AuditLogEntry
    repo.append_audit_row(
        AuditLogEntry(
            action="FINANCE_RATE_LIMIT_HIT",
            ownerAddress="0xabc",
            details={
                "businessType": "anomaly",
                "riskLevel": "yellow",
                "requestId": "req-1",
                "action": "deposit_intent",
                "backend": "redis",
                "rateLimitBucket": "28500005",
            },
        )
    )
    repo.append_audit_row(
        AuditLogEntry(
            action="PROVIDER_SECRET_ISSUED",
            domain="system",
            ownerAddress="0xabc",
            details={"requestId": "req-2", "resourceType": "credential", "resourceId": "cred-1"},
        )
    )

    combined_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert combined_sql.count("INSERT INTO synapse_audit_events") == 2
    first_params = db.tx_cursors[0].executed[0][1]
    second_params = db.tx_cursors[1].executed[0][1]
    assert first_params[3] == "owner:0xabc"
    assert first_params[2] == "anomaly"
    assert second_params[3] == "owner:0xabc"
    assert '"action": "deposit_intent"' in first_params[12]
    assert '"backend": "redis"' in first_params[12]
    assert '"rateLimitBucket": "28500005"' in first_params[12]

    rows = repo.read_audit_rows(owner_wallet="0xabc", limit=10)
    assert len(rows) == 1
    assert rows[0].domain == "finance"
    assert rows[0].owner_address == "0xabc"
    assert rows[0].details["requestId"] == "req-1"
    assert rows[0].details["riskReasonCode"] == "RATE_LIMIT"
    assert rows[0].details["action"] == "deposit_intent"
    assert rows[0].details["backend"] == "redis"
    assert rows[0].details["rateLimitBucket"] == "28500005"
    dedupe_query_params = db.readonly_cursors[0].executed[0][1]
    assert dedupe_query_params[:2] == ("FINANCE_RATE_LIMIT_HIT", "owner:0xabc")
    finance_query_params = db.readonly_cursors[1].executed[0][1]
    assert finance_query_params[:2] == ["owner:0xabc", "0xabc"]

    system_rows = repo.read_system_audit_rows(owner_wallet="0xabc", limit=10)
    assert len(system_rows) == 1
    assert system_rows[0].domain == "system"
    assert system_rows[0].details["resourceType"] == "credential"
    system_query_params = db.readonly_cursors[2].executed[0][1]
    assert system_query_params[:2] == ["owner:0xabc", "0xabc"]


def test_audit_log_repository_skips_duplicate_deposit_intent_registered_by_tx_hash() -> None:
    db = FakeDB()
    db.readonly_plan.append({"fetchone": [None]})
    db.readonly_plan.append({"fetchone": [(1,)]})
    repo = AuditLogRepository(db, "unused")

    from src.domain.audit import AuditLogEntry

    payload = AuditLogEntry(
        action="DEPOSIT_INTENT_REGISTERED",
        ownerAddress="0xabc",
        details={"businessType": "deposit", "txHash": "0x" + "1" * 64},
    )
    repo.append_audit_row(payload)
    repo.append_audit_row(payload)

    combined_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert combined_sql.count("INSERT INTO synapse_audit_events") == 1


def test_audit_log_repository_skips_duplicate_rate_limit_hits_in_same_bucket() -> None:
    db = FakeDB()
    db.readonly_plan.append({"fetchone": [None]})
    db.readonly_plan.append({"fetchone": [(1,)]})
    repo = AuditLogRepository(db, "unused")

    from src.domain.audit import AuditLogEntry

    payload = AuditLogEntry(
        action="FINANCE_RATE_LIMIT_HIT",
        ownerAddress="0xabc",
        details={
            "businessType": "anomaly",
            "action": "deposit_intent",
            "backend": "redis",
            "rateLimitBucket": "28500005",
        },
    )
    repo.append_audit_row(payload)
    repo.append_audit_row(payload)

    combined_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert combined_sql.count("INSERT INTO synapse_audit_events") == 1


def test_balance_repository_read_and_write() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [
                [
                    ("0xowner", "consumer_wallet", Decimal("10"), Decimal("1"), Decimal("2"), 100),
                    ("0xprovider", "provider_wallet", Decimal("20"), Decimal("3"), Decimal("4"), 110),
                    ("__platform__", "platform_revenue", Decimal("0.5"), Decimal("0"), Decimal("0"), 120),
                ]
            ]
        }
    )
    repo = BalanceRepository(db, _q6, "UPSERT")

    ledger = repo.read_balance_ledger()
    assert ledger.consumer_available_balance("0xowner") == Decimal("10.000000")
    assert ledger.provider_receivable_balance("0xprovider") == Decimal("20.000000")
    assert ledger.platform.fee_accrued == Decimal("0.500000")
    assert ledger.updated_at == "1970-01-01 00:02:00"

    from src.domain.finance import (
        BalanceLedger,
        ConsumerWalletRecord,
        PlatformFees,
        ProviderWalletRecord,
    )
    repo.write_balance_ledger(
        BalanceLedger(
            consumerWallets=[
                ConsumerWalletRecord(
                    ownerAddress="0xB",
                    availableBalance=1,
                    pendingBalance=2,
                    frozenBalance=3,
                )
            ],
            providerWallets=[
                ProviderWalletRecord(
                    ownerAddress="0xS",
                    availableBalance=4,
                    pendingBalance=5,
                    frozenBalance=6,
                )
            ],
            platform=PlatformFees(fee_accrued=7),
            updated_at="2026-03-15 14:24:30",
        )
    )
    ops = db.tx_cursors[-1].executed
    available_only_upserts = [sql for sql, _ in ops if "INSERT INTO synapse_account_balances" in sql]
    assert len(available_only_upserts) == 2
    assert any("GREATEST(EXCLUDED.available_balance" in sql for sql in available_only_upserts)
    upserts = [params for sql, params in ops if sql == "UPSERT"]
    assert len(upserts) == 1
    assert any(params[0] == "platform_revenue::main" for params in upserts)


def test_service_registry_repository_read_and_write() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [[(
                "svc-1",
                "0xabc",
                "SVC",
                "summary",
                "https://a",
                "active",
                True,
                Decimal("0.005"),
                "USDC",
                3000,
                ["quotes", "top3"],
                "2026-03-15 14:24:00",
                "2026-03-15 14:24:01",
                {
                    "id": "rec-1",
                    "schemaVersion": 2,
                    "role": "provider",
                    "address": "0xabc",
                    "maxQps": 50,
                    "maxRequestBytes": 4096,
                    "maxResponseBytes": 8192,
                    "auth": {"type": "service_key", "headerName": "X-Credential"},
                    "healthCheck": {"path": "/health", "method": "GET"},
                    "forwarding": {"requestIdHeader": "X-Synapse-Request-Id"},
                    "metering": {"billingUnit": "per_call", "billOnError": False},
                    "invoke": {"method": "POST", "targets": [{"url": "https://a", "weight": 100}]},
                },
                "active",
                4096,
                "svc-1:ep:0:abcdef0123",
                "gateway_signed",
            )]],
        }
    )
    db.readonly_plan.append(
        {
            "fetchall": [[("svc-1", "0xabc", "https://a", {"weight": 100, "region": "ap", "status": "up", "overallStatus": "green", "httpStatus": 200, "consecutiveSuccesses": 3, "consecutiveFailures": 1, "probeUrl": "https://a/health", "lastCheckedAt": 10, "lastHealthyAt": 9}, 95, 12, 0.99, 10, None)]],
        }
    )
    db.readonly_plan.append(
        {
            "fetchall": [[("service_health_history::svc-1", {"rows": [{"serviceId": "svc-1", "ownerAddress": "0xabc", "targetUrl": "https://a", "status": "up", "httpStatus": 200, "latencyMs": 12, "probeUrl": "https://a/health", "consecutiveSuccesses": 3, "consecutiveFailures": 1, "checkedAt": 11, "lastHealthyAt": 9}]})]],
        }
    )
    repo = ServiceRegistryRepository(db)

    services = repo.read_service_registry_rows()
    assert services[0].service_id == "svc-1"
    assert services[0].id == "rec-1"
    assert services[0].health_check.path == "/health"
    assert services[0].invoke.method == "POST"
    assert services[0].invoke.targets[0].url == "https://a"
    assert services[0].primary_endpoint is not None
    assert services[0].primary_endpoint.auth_mode == "gateway_signed"

    target_rows = repo.read_service_target_health_rows()
    assert target_rows[0].consecutive_successes == 3

    history_rows = repo.read_service_target_health_history_rows()
    assert history_rows[0].checked_at == 11

    repo.write_service_registry_rows([
        ServiceDefinitionRecord.model_validate(
            {
                "serviceId": "svc-2",
                "ownerAddress": "0xDEF",
                "serviceName": "svc-two",
                "summary": "demo",
                "status": "active",
                "isActive": True,
                "pricingAmount": "0.010000",
                "pricingCurrency": "USDC",
                "constraints": {
                    "timeoutMs": 3000,
                    "maxQps": 50,
                    "maxRequestBytes": 4096,
                    "maxResponseBytes": 8192,
                },
                "id": "rec-2",
                "schemaVersion": 2,
                "role": "provider",
                "address": "0xdef",
                "tags": ["a"],
                "auth": {"type": "gateway_signed"},
                "providerProfile": {"displayName": "Sentiment Desk"},
                "payoutAccount": {
                    "payoutAddress": "0x1234567890abcdef1234567890abcdef12345678",
                    "chainId": 8453,
                    "settlementCurrency": "USDC",
                },
                "governance": {"termsAccepted": True, "riskAcknowledged": True},
                "healthCheck": {"path": "/health", "method": "GET"},
                "forwarding": {"requestIdHeader": "X-Synapse-Request-Id"},
                "metering": {"billingUnit": "per_call"},
                "invoke": {"method": "POST", "targets": [{"url": "https://b"}]},
                "createdAt": "2026-03-15 14:24:00",
                "updatedAt": "2026-03-15 14:24:01",
            }
        )
    ])
    repo.write_service_target_health_rows([
        ServiceTargetHealth(serviceId="svc-2", ownerAddress="0xDEF", targetUrl="https://b")
    ])
    repo.write_service_target_health_history_rows([
        ServiceTargetHealthHistory(serviceId="svc-2", ownerAddress="0xDEF", targetUrl="https://b", checkedAt=3)
    ])

    all_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "DELETE FROM synapse_service_manifests" not in all_sql
    assert "ON CONFLICT (service_id)" in all_sql
    assert "UPDATE synapse_service_endpoints" in all_sql
    assert "ON CONFLICT (service_id, endpoint_id)" in all_sql
    assert "DELETE FROM synapse_service_health_snapshots WHERE (service_id, endpoint_id) NOT IN" in all_sql
    assert "DELETE FROM synapse_runtime_state WHERE state_key LIKE 'service_health_meta::%%' AND state_key NOT IN" in all_sql
    assert "INSERT INTO synapse_service_search_index" in all_sql
    assert "INSERT INTO synapse_runtime_state" in all_sql
    assert "INSERT INTO synapse_provider_payout_accounts" in all_sql


def test_service_registry_repository_normalizes_datetime_health_timestamps() -> None:
    db = FakeDB()
    last_checked_at = datetime(2026, 3, 18, 14, 36, 37, tzinfo=timezone.utc)
    last_healthy_at = datetime(2026, 3, 18, 14, 35, 0, tzinfo=timezone.utc)
    db.readonly_plan.append(
        {
            "fetchall": [[(
                "svc-1",
                "0xabc",
                "https://a",
                {
                    "weight": 100,
                    "region": "ap",
                    "status": "healthy",
                    "overallStatus": "healthy",
                    "httpStatus": 200,
                    "consecutiveSuccesses": 3,
                    "consecutiveFailures": 0,
                    "probeUrl": "https://a/health",
                    "lastHealthyAt": last_healthy_at,
                },
                95,
                12,
                0.99,
                last_checked_at,
                None,
            )]],
        }
    )
    repo = ServiceRegistryRepository(db)

    target_rows = repo.read_service_target_health_rows()

    assert target_rows[0].last_checked_at == int(last_checked_at.timestamp() * 1000)
    assert target_rows[0].last_healthy_at == int(last_healthy_at.timestamp() * 1000)


def test_service_registry_repository_deactivates_old_endpoints_with_paused_status() -> None:
    db = FakeDB()
    repo = ServiceRegistryRepository(db)

    repo.write_service_registry_rows([
        ServiceDefinitionRecord.model_validate(
            {
                "serviceId": "svc-1",
                "ownerAddress": "0xABC",
                "serviceName": "svc-one",
                "summary": "demo",
                "status": "active",
                "isActive": True,
                "pricingAmount": "0.010000",
                "pricingCurrency": "USDC",
                "constraints": {
                    "timeoutMs": 3000,
                    "maxQps": 50,
                    "maxRequestBytes": 4096,
                    "maxResponseBytes": 8192,
                },
                "id": "rec-1",
                "schemaVersion": 1,
                "role": "provider",
                "address": "0xabc",
                "tags": ["a"],
                "auth": {"type": "service_key"},
                "healthCheck": {"path": "/health", "method": "GET"},
                "forwarding": {"requestIdHeader": "X-Synapse-Request-Id"},
                "metering": {"billingUnit": "per_call"},
                "invoke": {"method": "POST", "targets": [{"url": "https://a"}]},
                "createdAt": "2026-03-15 14:23:00",
                "updatedAt": "2026-03-15 14:23:01",
            }
        )
    ])

    update_sql, update_params = next(
        (sql, params)
        for cur in db.tx_cursors
        for sql, params in cur.executed
        if "UPDATE synapse_service_endpoints" in sql
    )

    assert "status = 'paused'" in update_sql
    assert update_params[1] == "svc-1"


def test_credential_auth_repository_read_write_and_roles() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [[(
                "owner:0xabc",
                "0xabc",
                "active",
                "USDC",
                "2026-03-15 14:23:00",
                "2026-03-15 14:23:01",
                "agent:provider:0xabc",
                "provider-runtime",
                "provider runtime credential holder",
                "active",
                "provider",
                "2026-03-15 14:23:00",
                "2026-03-15 14:23:01",
                "cred-1",
                "hash-1",
                "sk_live",
                "active",
                "2026-03-15 14:24:00",
                None,
                None,
                "2026-03-15 14:24:05",
                "policy:cred-1",
                Decimal("1.250000"),
                Decimal("1.250000"),
                Decimal("1.250000"),
                10,
                10,
                ["tag-a"],
                ["svc-1"],
                [],
                {
                    "credentialType": "provider",
                    "ownerAddress": "0xabc",
                    "name": "cred-name",
                    "maxCalls": 100,
                    "callsUsed": 1,
                    "resetInterval": "daily",
                    "expiration": 0,
                    "createdAt": "2026-03-15 14:24:00",
                    "updatedAt": "2026-03-15 14:24:05",
                },
                "2026-03-15 14:24:05",
            )]],
        }
    )
    db.readonly_plan.append(
        {
            "fetchone": [({
                "walletAddress": "0xabc",
                "registeredAt": 100,
                "lastLogin": 200,
                "status": "active",
                "updatedAt": "2026-03-15 14:24:06",
            },)],
        }
    )
    repo = CredentialAuthRepository(db, _q6)

    from src.domain.identity import RuntimeCredentialRecord
    from src.domain.runtime_state import AuthSessionState

    creds = repo.read_credential_rows("provider")
    assert len(creds) == 1
    assert isinstance(creds[0], RuntimeCredentialRecord)
    assert creds[0].credential.credential_id == "cred-1"
    assert creds[0].owner.owner_wallet == "0xabc"
    assert creds[0].metadata.name == "cred-name"
    assert creds[0].policy.lifetime_cap_usdc == Decimal("1.250000")

    session = repo.read_auth_session("0xABC")
    assert isinstance(session, AuthSessionState)
    assert session.last_login == 200

    repo.write_credential_rows(
        "provider",
        [
            RuntimeCredentialRecord.model_validate(
                {
                    "owner": {
                        "ownerId": "owner:0xdef",
                        "ownerWallet": "0xdef",
                        "createdAt": "2026-03-15 14:25:00",
                        "updatedAt": "2026-03-15 14:25:01",
                    },
                    "agent": {
                        "agentId": "agent:provider:0xdef",
                        "ownerId": "owner:0xdef",
                        "name": "provider-runtime",
                        "purpose": "provider runtime credential holder",
                        "runtimeLabel": "provider",
                        "createdAt": "2026-03-15 14:25:00",
                        "updatedAt": "2026-03-15 14:25:01",
                    },
                    "credential": {
                        "credentialId": "cred-2",
                        "agentId": "agent:provider:0xdef",
                        "secretHash": "hash-2",
                        "secretPrefix": "sk_test",
                        "status": "active",
                        "issuedAt": "2026-03-15 14:25:00",
                        "lastUsedAt": "2026-03-15 14:25:01",
                    },
                    "policy": {
                        "policyId": "policy:cred-2",
                        "credentialId": "cred-2",
                        "lifetimeCapUsdc": "1.250000",
                        "dailyCapUsdc": "1.250000",
                        "perInvocationCapUsdc": "1.250000",
                        "rpmLimit": 12,
                        "qpsLimit": 12,
                        "createdAt": "2026-03-15 14:25:00",
                        "updatedAt": "2026-03-15 14:25:01",
                    },
                    "metadata": {
                        "credentialType": "provider",
                        "ownerAddress": "0xdef",
                        "name": "cred-two",
                        "maxCalls": 100,
                        "callsUsed": 0,
                        "resetInterval": "daily",
                        "createdAt": "2026-03-15 14:25:00",
                        "updatedAt": "2026-03-15 14:25:01",
                    },
                }
            )
        ],
    )
    repo.upsert_auth_session("0xABC", 100, 200, "active")

    tx_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "DELETE FROM synapse_runtime_state WHERE state_key LIKE %s AND state_key NOT IN" in tx_sql
    assert "DELETE FROM synapse_budget_policies AS bp" in tx_sql
    assert "DELETE FROM synapse_agent_credentials AS ac" in tx_sql
    assert "ac.credential_id NOT IN" in tx_sql
    assert "DELETE FROM synapse_agent_profiles AS ap" in tx_sql


def test_credential_auth_repository_normalizes_datetime_metadata_state() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [[(
                "owner:0xabc",
                "0xabc",
                "active",
                "USDC",
                "2026-03-15 14:23:00",
                "2026-03-15 14:23:01",
                "agent:agent:0xabc",
                "buyer-agent-01",
                "buyer runtime credential holder",
                "active",
                "agent",
                "2026-03-15 14:23:00",
                "2026-03-15 14:23:01",
                "cred-1",
                "hash-1",
                "sk_live",
                "active",
                "2026-03-15 14:24:00",
                None,
                None,
                "2026-03-15 14:24:05",
                "policy:cred-1",
                Decimal("1.250000"),
                Decimal("1.250000"),
                Decimal("1.250000"),
                10,
                10,
                ["tag-a"],
                ["svc-1"],
                [],
                {
                    "credentialType": "agent",
                    "ownerAddress": "0xabc",
                    "name": "cred-name",
                    "maxCalls": 100,
                    "callsUsed": 1,
                    "resetInterval": "daily",
                    "expiration": 0,
                    "createdAt": "2026-03-15 14:24:00",
                    "updatedAt": datetime(2026, 3, 15, 14, 24, 5, tzinfo=timezone.utc),
                },
                datetime(2026, 3, 15, 14, 24, 5, tzinfo=timezone.utc),
            )]],
        }
    )

    repo = CredentialAuthRepository(db, _q6)

    creds = repo.read_credential_rows("agent")

    assert len(creds) == 1
    assert creds[0].metadata is not None
    assert creds[0].metadata.updated_at == "2026-03-15 14:24:05"


def test_credential_auth_repository_reads_owner_profile_with_defaults() -> None:
    db = FakeDB()
    db.tx_plan.append(
        {
            "fetchone": [
                (
                    "owner:0xabc",
                    "0xabc",
                    "Infra Desk",
                    "ops@synapse.test",
                    False,
                    True,
                    False,
                    "active",
                    "USDC",
                    "2026-04-03 10:00:00",
                    "2026-04-03 10:05:00",
                )
            ]
        }
    )
    repo = CredentialAuthRepository(db, _q6)

    profile = repo.read_owner_profile("0xABC", ensure_exists=True)

    assert profile is not None
    assert profile.owner_wallet == "0xabc"
    assert profile.display_name == "Infra Desk"
    assert profile.notify_alerts is False
    executed = db.tx_cursors[-1].executed
    assert any("INSERT INTO synapse_owner_accounts" in sql for sql, _ in executed)
    assert any("FROM synapse_owner_accounts" in sql for sql, _ in executed)


def test_credential_auth_repository_updates_owner_profile_without_touching_shell_upsert() -> None:
    db = FakeDB()
    db.tx_plan.append({"fetchone": [None, (
        "owner:0xabc",
        "0xabc",
        "Infra Desk",
        "infra@synapse.test",
        False,
        False,
        True,
        "active",
        "USDC",
        "2026-04-03 10:00:00",
        "2026-04-03 10:06:00",
    )]})
    repo = CredentialAuthRepository(db, _q6)

    profile = repo.update_owner_profile(
        "0xabc",
        display_name="Infra Desk",
        email="infra@synapse.test",
        notify_marketing=False,
        notify_alerts=True,
    )

    assert profile.email == "infra@synapse.test"
    executed = db.tx_cursors[-1].executed
    owner_upsert_sql = [sql for sql, _ in executed if "INSERT INTO synapse_owner_accounts" in sql][0]
    assert "display_name" not in owner_upsert_sql.lower()
    update_sql = [sql for sql, _ in executed if "UPDATE synapse_owner_accounts" in sql][0]
    assert "display_name = %s" in update_sql
    assert "email_verified = CASE" in update_sql


def test_gateway_state_repository_read_and_write() -> None:
    db = FakeDB()
    db.readonly_plan.append({"fetchall": [[(
        "dep-1", "0xabc", "0xtx1", "req-1", {"consumerAddress": "0xabc", "idempotencyKey": "idem-1"}, Decimal("5.0"), "CONFIRMED", "2026-03-15 14:24:00", "2026-03-15 14:24:01"
    )]]})
    db.readonly_plan.append({"fetchall": [[(
        "ref-1", "0xabc", "0xtx2", "REQUESTED", "req-2", Decimal("0.5"), "sig-r", 9, 999, "2026-03-15 14:24:02", "2026-03-15 14:24:03", {"flowStatus": "PENDING", "consumerAddress": "0xabc", "idempotencyKey": "idem-2", "originRequestId": "req-1", "requestMeta": {"requestId": "req-2", "traceId": "trace-refund-1"}, "reviewDecision": "APPROVE", "reviewerAddress": "0xreviewer", "reviewerNote": "ok", "reviewedAt": 1711111111, "completeMeta": {"requestId": "req-complete-ref-1"}}
    )]]})
    db.readonly_plan.append({"fetchall": [[(
        "wd-1", "0xabc", "0xtx3", "SIGNED", "req-3", Decimal("2.0"), "sig", 1, 0, "2026-03-15 14:24:04", "2026-03-15 14:24:05", {"flowStatus": "APPROVED_AUTO", "idempotencyKey": "idem-3", "amountWei": "2000000", "feeWei": "0", "chainId": 31337, "contractAddress": "0xcontract", "signerAddress": "0xsigner", "businessType": "withdraw", "riskLevel": "yellow", "riskReasonCode": "LARGE_WITHDRAWAL_REQUIRES_REVIEW", "requestMeta": {"requestId": "req-3", "review": {"decision": "APPROVE", "reviewerAddress": "0xreviewer"}}, "reviewDecision": "APPROVE", "reviewerAddress": "0xreviewer", "reviewerNote": "approved", "reviewedAt": 1711112222, "ticket": {"amount": "2000000", "fee": "0", "nonce": 1, "deadline": 0, "signature": "sig", "chainId": 31337, "contractAddress": "0xcontract"}, "completeMeta": {"requestId": "req-complete-wd-1"}}
    )]]})
    db.readonly_plan.append({"fetchall": [[(
        "usage-1", "agent-1", "req-u", "svc-1", "SUCCEEDED", Decimal("1.11"), "2026-03-15 14:24:08", "2026-03-15 14:24:10", "2026-03-15 14:24:08", {"ownerAddress": "0xb", "providerAddress": "0xs", "requestId": "req-u", "unitPrice": "1", "protocolFee": "0.1", "routingTax": "0.01", "totalCharge": "1.11", "businessType": "charge", "riskLevel": "green"}
    )]]})
    db.readonly_plan.append({"fetchall": [[("ek-1",)]]})
    repo = GatewayStateRepository(db, _q6)

    deposit_rows = repo.read_deposit_intents()
    assert len(deposit_rows) == 1 and deposit_rows[0].id == "dep-1"
    refund_rows = repo.read_consumer_refund_rows()
    assert len(refund_rows) == 1 and refund_rows[0].id == "ref-1"
    assert refund_rows[0].origin_request_id == "req-1"
    assert refund_rows[0].request_meta.trace_id == "trace-refund-1"
    assert refund_rows[0].review_decision == "APPROVE"
    withdraw_rows = repo.read_provider_withdrawal_rows()
    assert len(withdraw_rows) == 1 and withdraw_rows[0].id == "wd-1"
    assert withdraw_rows[0].status == "APPROVED_AUTO"
    assert withdraw_rows[0].risk_reason_code == "LARGE_WITHDRAWAL_REQUIRES_REVIEW"
    assert withdraw_rows[0].ticket.contract_address == "0xcontract"
    assert withdraw_rows[0].request_meta.review.reviewer_address == "0xreviewer"
    usage_rows = repo.read_invocation_billing_rows()
    assert len(usage_rows) == 1 and usage_rows[0].id == "usage-1"
    assert usage_rows[0].agent_id == "agent-1"
    assert usage_rows[0].latency_ms == 2000
    assert repo.read_processed_deposit_event_keys() == ["ek-1"]


def test_execution_repository_read_and_write() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchone": [(
                "quote-1",
                "svc-1",
                "cred-1",
                "agent-1",
                Decimal("1.300000"),
                "fixed",
                "OPEN",
                "fp-1",
                "sync",
                {"body": {"text": {"type": "string"}}, "timeoutMs": 15000},
                "2026-03-17 10:00:00",
                "2026-03-17 09:55:00",
            )],
        }
    )
    db.readonly_plan.append(
        {
            "fetchone": [(
                "inv-1",
                "quote-1",
                "svc-1",
                None,
                "cred-1",
                "agent-1",
                "idem-1",
                "req-digest-1",
                "sync",
                "SUCCEEDED",
                Decimal("1.300000"),
                None,
                None,
                200,
                "digest-1",
                {"ok": True},
                "2026-03-17 09:56:00",
                "2026-03-17 09:56:01",
                "2026-03-17 09:55:30",
                "2026-03-17 09:56:01",
            )],
        }
    )
    db.readonly_plan.append(
        {
            "fetchone": [(
                "inv-1",
                "quote-1",
                "svc-1",
                None,
                "cred-1",
                "agent-1",
                "idem-1",
                "req-digest-1",
                "sync",
                "SUCCEEDED",
                Decimal("1.300000"),
                None,
                None,
                200,
                "digest-1",
                {"ok": True},
                "2026-03-17 09:56:00",
                "2026-03-17 09:56:01",
                "2026-03-17 09:55:30",
                "2026-03-17 09:56:01",
            )],
        }
    )
    repo = ExecutionRepository(db)

    quote = repo.read_quote("quote-1")
    assert quote is not None
    assert quote.quote_id == "quote-1"
    assert quote.invoke_constraints.body["text"]["type"] == "string"

    invocation = repo.read_invocation("inv-1")
    assert invocation is not None
    assert invocation.invocation_id == "inv-1"
    assert invocation.result.payload == {"ok": True}

    replay = repo.read_invocation_by_idempotency("cred-1", "idem-1")
    assert replay is not None
    assert replay.request_digest == "req-digest-1"

    repo.upsert_quote(
        ServiceQuoteRecord.model_validate(
            {
                "quoteId": "quote-2",
                "serviceId": "svc-2",
                "credentialId": "cred-2",
                "agentId": "agent-2",
                "quotedPriceUsdc": "0.500000",
                "priceModel": "fixed",
                "status": "OPEN",
                "requestFingerprint": "fp-2",
                "responseMode": "sync",
                "invokeConstraints": {"body": {"text": {"type": "string"}}},
                "expiresAt": "2026-03-17 10:10:00",
                "createdAt": "2026-03-17 10:00:00",
            }
        )
    )
    repo.upsert_invocation(
        InvocationRecord.model_validate(
            {
                "invocationId": "inv-2",
                "quoteId": "quote-2",
                "serviceId": "svc-2",
                "credentialId": "cred-2",
                "agentId": "agent-2",
                "idempotencyKey": "idem-2",
                "requestDigest": "req-digest-2",
                "responseMode": "sync",
                "status": "RUNNING",
                "chargedUsdc": "0.000000",
                "result": {"digest": None, "payload": {}},
                "createdAt": "2026-03-17 10:00:01",
                "updatedAt": "2026-03-17 10:00:02",
            }
        )
    )

    all_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "INSERT INTO synapse_service_quotes" in all_sql
    assert "INSERT INTO synapse_invocations" in all_sql


def test_gateway_state_repository_write_paths() -> None:
    db = FakeDB()
    repo = GatewayStateRepository(db, _q6)

    repo.write_deposit_intents([
        DepositIntentRow(
            id="dep-2",
            ownerAddress="0xA",
            txHash="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            createdAt="2026-03-15 14:26:00",
            updatedAt="2026-03-15 14:26:01",
        )
    ])
    repo.write_consumer_refund_rows([
        RefundIntentRow(id="ref-2", ownerAddress="0xA", amountUsdc=1, requestMeta={"requestId": "req-ref-2", "review": {"decision": "APPROVE", "reviewerAddress": "0xrev"}}, reviewDecision="APPROVE", reviewerAddress="0xrev", reviewerNote="clear", reviewedAt=1711113333, completeMeta={"requestId": "req-ref-2-complete"}, createdAt="2026-03-15 14:26:00", updatedAt="2026-03-15 14:26:01")
    ], updated_at="2026-03-15 14:26:00")
    repo.write_provider_withdrawal_rows([
        WithdrawalIntentRow(id="wd-2", ownerAddress="0xA", amountUsdc=2, riskLevel="yellow", riskReasonCode="MANUAL_REVIEW", requestMeta={"requestId": "req-wd-2", "review": {"decision": "APPROVE", "reviewerAddress": "0xrev-w"}}, reviewDecision="APPROVE", reviewerAddress="0xrev-w", reviewerNote="ok", reviewedAt=1711114444, ticket={"amount": "2000000", "fee": "0", "nonce": 1, "deadline": 999, "signature": "sig-wd-2", "chainId": 31337, "contractAddress": "0xrouter"}, completeMeta={"requestId": "req-wd-2-complete"}, createdAt="2026-03-15 14:26:01", updatedAt="2026-03-15 14:26:02")
    ], updated_at="2026-03-15 14:26:01")
    repo.write_invocation_billing_rows([
        UsageLogRow(id="usage-2", ts=124, agentId="agent-2", consumerAddress="0xA", providerAddress="0xB", totalCharge=1, latencyMs=875, businessType="charge", riskLevel="green")
    ])
    repo.write_processed_deposit_event_keys(["ek-2"], updated_at="2026-03-15 14:26:03")

    tx_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    assert "DELETE FROM synapse_deposit_intents" not in tx_sql
    assert "INSERT INTO synapse_vault_deposits" in tx_sql
    assert "owner_address, target_account_id, tx_hash" in tx_sql
    assert "client_request_id,\n                        client_ip, user_agent" in tx_sql
    assert "vault_deposit_meta::dep-2" in str([params for cur in db.tx_cursors for _, params in cur.executed if params is not None])
    assert "ON CONFLICT (tx_hash)" in tx_sql
    assert "INSERT INTO synapse_vault_withdrawals" in tx_sql
    assert "withdrawal_id, owner_id, provider_id, withdrawal_kind" in tx_sql
    assert "vault_withdrawal_meta::ref-2" in str([params for cur in db.tx_cursors for _, params in cur.executed if params is not None])
    assert "vault_withdrawal_meta::wd-2" in str([params for cur in db.tx_cursors for _, params in cur.executed if params is not None])
    assert "MANUAL_REVIEW" in str([params for cur in db.tx_cursors for _, params in cur.executed if params is not None])
    assert "sig-wd-2" in str([params for cur in db.tx_cursors for _, params in cur.executed if params is not None])
    assert "invocation_billing::usage-2" in str([params for cur in db.tx_cursors for _, params in cur.executed if params is not None])
    assert "agent-2" in str([params for cur in db.tx_cursors for _, params in cur.executed if params is not None])
    assert "875" in str([params for cur in db.tx_cursors for _, params in cur.executed if params is not None])
    assert "DELETE FROM synapse_processed_deposit_events" in tx_sql


def test_gateway_state_repository_reads_owner_spend_limit_rows() -> None:
    db = FakeDB()
    db.readonly_plan.append(
        {
            "fetchall": [
                [
                    (
                        "0xabc",
                        Decimal("25.500000"),
                        "monthly",
                        "2026-04-01 00:00:00",
                        "2026-04-01 12:00:00",
                    )
                ]
            ]
        }
    )
    repo = GatewayStateRepository(db, _q6)

    rows = repo.read_owner_spend_limit_rows()

    assert len(rows) == 1
    assert rows[0].owner_address == "0xabc"
    assert rows[0].spending_limit_usdc == Decimal("25.500000")
    assert rows[0].cycle_interval == "monthly"


def test_gateway_state_repository_writes_owner_spend_limit_rows() -> None:
    db = FakeDB()
    repo = GatewayStateRepository(db, _q6)

    repo.write_owner_spend_limit_rows(
        [
            OwnerSpendLimitRow(
                ownerAddress="0xA",
                spendingLimitUsdc=Decimal("12.500000"),
                cycleInterval="monthly",
                createdAt="2026-04-01 00:00:00",
                updatedAt="2026-04-01 12:00:00",
            ),
            OwnerSpendLimitRow(
                ownerAddress="0xB",
                spendingLimitUsdc=None,
                cycleInterval="monthly",
                createdAt="2026-04-01 00:00:00",
                updatedAt="2026-04-01 12:00:00",
            ),
        ],
        updated_at="2026-04-01 12:00:00",
    )

    tx_sql = "\n".join(sql for cur in db.tx_cursors for sql, _ in cur.executed)
    tx_params = [
        params for cur in db.tx_cursors for _, params in cur.executed if params is not None
    ]
    assert "DELETE FROM synapse_owner_spend_limits" in tx_sql
    assert "INSERT INTO synapse_owner_spend_limits" in tx_sql
    assert any(params[0] == "0xa" and params[1] == "12.500000" for params in tx_params)
    assert any(params[0] == "0xb" and params[1] is None for params in tx_params)


def test_gateway_state_repository_skips_invalid_deposit_intents() -> None:
    db = FakeDB()
    repo = GatewayStateRepository(db, _q6)

    repo.write_deposit_intents([
        DepositIntentRow(
            id="dep-bad",
            ownerAddress="0xabc",
            txHash="",
            amountUsdc=Decimal("1"),
        ),
        DepositIntentRow(
            id="dep-good",
            ownerAddress="0xabc",
            txHash="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            amountUsdc=Decimal("1"),
            createdAt="2026-03-15 14:26:00",
            updatedAt="2026-03-15 14:26:01",
        ),
    ])

    executed = [sql for cur in db.tx_cursors for sql, _ in cur.executed]
    inserts = [sql for sql in executed if "INSERT INTO synapse_vault_deposits" in sql]
    assert len(inserts) == 1


def test_gateway_state_repository_accepts_dict_deposit_intents() -> None:
    db = FakeDB()
    repo = GatewayStateRepository(db, _q6)

    repo.write_deposit_intents([
        {
            "id": "dep-dict",
            "ownerAddress": "0xabc",
            "txHash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            "amountUsdc": "2.5",
            "status": "PENDING",
            "createdAt": "2026-03-18 11:00:00",
            "updatedAt": "2026-03-18 11:00:01",
        }
    ])

    executed = [sql for cur in db.tx_cursors for sql, _ in cur.executed]
    assert any("INSERT INTO synapse_vault_deposits" in sql for sql in executed)


def test_gateway_state_repository_reads_withdrawals_from_owner_accounts() -> None:
    db = FakeDB()
    repo = GatewayStateRepository(db, _q6)

    db.readonly_plan.append({"fetchall": []})
    repo.read_consumer_refund_rows()

    read_sql = "\n".join(sql for cur in db.readonly_cursors for sql, _ in cur.executed)
    assert "JOIN synapse_owner_accounts owner" in read_sql
    assert "JOIN synapse_owners owner" not in read_sql


def test_gateway_state_repository_normalizes_epoch_string_withdraw_timestamps() -> None:
    db = FakeDB()
    repo = GatewayStateRepository(db, _q6)

    repo.write_provider_withdrawal_rows(
        [
            WithdrawalIntentRow(
                id="wd-epoch-text",
                ownerAddress="0xabc",
                amountUsdc=Decimal("2.5"),
                status="APPROVED_AUTO",
                createdAt="1774012466",
                updatedAt="1774012466",
            )
        ],
        updated_at="1774012466",
    )

    params_list = [
        params for cur in db.tx_cursors for _, params in cur.executed if params is not None
    ]
    flat_text = "\n".join(str(params) for params in params_list)
    assert "1774012466" not in flat_text
    assert "2026-03-20 13:14:26" in flat_text


def test_balance_redis_guard_accepts_typed_deposit_rows_for_replay_check() -> None:
    class _Guard(BalanceRedisGuardMixin):
        def __init__(self):
            self.audit_calls = []

        def _append_financial_audit(self, action: str, owner_wallet: str, details: dict[str, Any]) -> None:
            self.audit_calls.append((action, owner_wallet, details))

        def _parse_created_at_epoch(self, value: Any) -> int:
            return int(time.time())

    guard = _Guard()

    existing = guard._validate_unique_recent_deposit(
        [
            DepositIntentRow(
                id="dep-typed",
                ownerAddress="0xabc",
                txHash="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                amountUsdc=Decimal("1"),
                status="PENDING_CONFIRMATION",
                createdAt="2024-03-22 12:00:00",
            )
        ],
        "0xabc",
        "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    )

    assert existing is not None
    assert existing["id"] == "dep-typed"
    assert existing["status"] == "PENDING_CONFIRMATION"
    assert guard.audit_calls == [
        (
            "DEPOSIT_REPLAY_RETURNED_EXISTING",
            "0xabc",
            {
                "txHash": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                "replayWindowSec": 900,
                "depositIntentId": "dep-typed",
                "status": "PENDING_CONFIRMATION",
            },
        )
    ]


def test_deposit_indexer_load_intents_returns_mutable_dicts() -> None:
    class _GatewayState:
        @staticmethod
        def read_deposit_intents() -> List[Any]:
            return [
                DepositIntentRow(
                    id="dep-typed",
                    ownerAddress="0xabc",
                    txHash="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                    amountUsdc=Decimal("2.5"),
                    status="PENDING_CONFIRMATION",
                    createdAt="2026-03-18 11:00:00",
                    updatedAt="2026-03-18 11:00:01",
                )
            ]

    class _System:
        gateway_state = _GatewayState()

    class _DataManager:
        system = _System()

    class _Storage:
        @staticmethod
        def get_data_manager() -> Any:
            return _DataManager()

    rows = _load_deposit_intents(_Storage())
    assert isinstance(rows, list)
    assert isinstance(rows[0], dict)
    assert rows[0]["ownerAddress"] == "0xabc"
    assert rows[0]["status"] == "PENDING_CONFIRMATION"


def test_deposit_attempt_repository_upserts_stage_rows() -> None:
    db = FakeDB()
    db.connect_plan.append({
        "fetchone": [
            (
                1,
                "attempt-1",
                "0xabc",
                "client-1",
                "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
                Decimal("10.000000"),
                "TX_BROADCASTED",
                None,
                "req-1",
                "127.0.0.1",
                "pytest",
                "2026-03-16 10:00:00",
                "2026-03-16 10:00:01",
            )
        ]
    })
    repo = DepositAttemptRepository(db, _q6)

    saved = repo.upsert_attempt(
        DepositAttemptRow(
            attemptId="attempt-1",
            ownerAddress="0xABC",
            clientRequestId="client-1",
            txHash="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            amountUsdc=Decimal("10"),
            stage="TX_BROADCASTED",
            requestId="req-1",
            clientIp="127.0.0.1",
            userAgent="pytest",
            createdAt="2026-03-16 10:00:00",
            updatedAt="2026-03-16 10:00:01",
        )
    )

    assert saved.id == 1
    assert saved.attempt_id == "attempt-1"
    assert saved.stage == "TX_BROADCASTED"

    executed_sql = "\n".join(sql for sql, _ in db.connections[0].cursor_obj.executed)
    assert "INSERT INTO synapse_deposit_attempts" in executed_sql
    assert "ON CONFLICT (attempt_id, stage)" in executed_sql


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

    result = repo.reserve_provider_withdraw_atomic(
        ReserveProviderWithdrawCommand(
            owner_wallet="0xabc",
            amount_usdc=Decimal("2"),
        )
    )
    assert result.before_balance == Decimal("10.000000")
    assert result.after_balance == Decimal("8.000000")

    first_conn_sql = "\n".join(sql for sql, _ in db.connections[0].cursor_obj.executed)
    assert "BAL_FOR_UPDATE" in first_conn_sql
    assert "UPSERT" in first_conn_sql

    ok = repo.complete_withdraw_tx_atomic(
        CompleteWithdrawTxCommand(
            owner_wallet="0xabc",
            tx_hash="0xtx",
            kind="provider",
        )
    )
    assert ok is True
    second_conn_sql = "\n".join(sql for sql, _ in db.connections[1].cursor_obj.executed)
    assert "INSERT INTO synapse_withdraw_tx_dedup" in second_conn_sql


def test_finance_atomic_repository_processes_typed_charge_command() -> None:
    db = FakeDB()
    db.connect_plan.append(
        {
            "fetchone": [
                (Decimal("0"), Decimal("0"), Decimal("0")),
                (Decimal("0"), Decimal("0"), Decimal("0")),
                (Decimal("10"), Decimal("0"), Decimal("0")),
                (Decimal("5"), Decimal("0"), Decimal("0")),
                (Decimal("1"), Decimal("0"), Decimal("0")),
                (Decimal("0"), Decimal("0"), Decimal("0")),
                (Decimal("0"), Decimal("0"), Decimal("0")),
                (Decimal("5"), Decimal("0"), Decimal("0")),
                (Decimal("0"), Decimal("0"), Decimal("0")),
                (Decimal("1"), Decimal("0"), Decimal("0")),
                (Decimal("0"), Decimal("0"), Decimal("0")),
                (Decimal("0"), Decimal("0"), Decimal("0")),
                (Decimal("0"), Decimal("0"), Decimal("0")),
            ]
        }
    )
    repo = FinanceAtomicRepository(
        db,
        _q6,
        "UPSERT",
        "BAL_FOR_UPDATE",
        "AUDIT_INSERT",
        ("restricted", "suspended", "blocked"),
    )

    result = repo.charge_consumer_and_record_usage_atomic(
        ChargeConsumerUsageCommand(
            owner_wallet="0xowner",
            provider_wallet="0xprovider",
            total_charge=Decimal("1.110000"),
            provider_net=Decimal("1.000000"),
            platform_fee_total=Decimal("0.110000"),
            usage_row=UsageLogRow(
                id="usage-1",
                ts=123,
                consumerAddress="0xowner",
                providerAddress="0xprovider",
                status="accepted",
                totalCharge=Decimal("1.110000"),
                businessType="charge",
                riskLevel="green",
            ),
        )
    )

    assert result.consumer_available_balance_after == Decimal("8.890000")
    executed_sql = "\n".join(sql for sql, _ in db.connections[0].cursor_obj.executed)
    assert "INSERT INTO synapse_ledger_entries" in executed_sql
    assert "INSERT INTO synapse_runtime_state" in executed_sql
    assert "UPSERT" in executed_sql


def test_finance_atomic_repository_confirm_deposit_writes_canonical_audit_evidence() -> None:
    db = FakeDB()
    db.connect_plan.append(
        {
            "fetchone": [
                (
                    "dep-1",
                    "0xabc",
                    "0x1111111111111111111111111111111111111111111111111111111111111111",
                    "req-1",
                    Decimal("12.500000"),
                    "PENDING_CONFIRMATION",
                    "2026-03-18 08:22:39",
                    "2026-03-18 08:22:39",
                ),
                ({"consumerAddress": "0xabc", "idempotencyKey": "idem-1"},),
                (Decimal("1.000000"), Decimal("12.500000"), Decimal("0.000000")),
            ]
        }
    )
    repo = FinanceAtomicRepository(
        db,
        _q6,
        "UPSERT",
        "BAL_FOR_UPDATE",
        "AUDIT_INSERT",
        ("restricted", "suspended", "blocked"),
    )

    confirmed = repo.confirm_deposit_intent_atomic(
        DepositIntentConfirmCommand(
            owner_wallet="0xabc",
            deposit_intent_id="dep-1",
            event_key="evt-confirm-1",
            confirmations=12,
        )
    )

    assert confirmed.status == "CONFIRMED"
    executed = db.connections[0].cursor_obj.executed
    _, audit_params = next(
        (sql, params)
        for sql, params in executed
        if "INSERT INTO synapse_audit_events" in sql
    )
    assert audit_params[3] == "owner:0xabc"
    assert audit_params[4] == "12.500000"
    detail_json = audit_params[7]
    assert '"txHash": "0x1111111111111111111111111111111111111111111111111111111111111111"' in detail_json
    assert '"beforeBalance": "1.000000"' in detail_json
    assert '"afterBalance": "13.500000"' in detail_json
    assert '"ledgerId": "dep-1"' in detail_json
    assert '"traceId": "evt-confirm-1"' in detail_json


def test_finance_atomic_repository_confirmed_deposit_is_idempotent_without_balance_repair() -> None:
    db = FakeDB()
    db.connect_plan.append(
        {
            "fetchone": [
                (
                    "dep-1",
                    "0xabc",
                    "0x1111111111111111111111111111111111111111111111111111111111111111",
                    "req-1",
                    Decimal("20.000000"),
                    "CONFIRMED",
                    "2026-03-18 08:22:39",
                    "2026-03-18 08:22:39",
                ),
                ({"consumerAddress": "0xabc", "idempotencyKey": "idem-1"},),
                (Decimal("0.000000"), Decimal("20.000000"), Decimal("0.000000")),
            ]
        }
    )
    repo = FinanceAtomicRepository(
        db,
        _q6,
        "UPSERT",
        "BAL_FOR_UPDATE",
        "AUDIT_INSERT",
        ("restricted", "suspended", "blocked"),
    )

    confirmed = repo.confirm_deposit_intent_atomic(
        DepositIntentConfirmCommand(
            owner_wallet="0xabc",
            deposit_intent_id="dep-1",
            event_key="evt-confirm-1",
            confirmations=12,
        )
    )

    assert confirmed.status == "CONFIRMED"
    executed_sql = "\n".join(sql for sql, _ in db.connections[0].cursor_obj.executed)
    assert "UPSERT" not in executed_sql
    assert "CONSUMER_DEPOSIT_CONFIRMED_REPAIRED" not in executed_sql


def test_finance_atomic_repository_processes_typed_withdraw_command() -> None:
    db = FakeDB()
    db.connect_plan.append(
        {
            "fetchone": [
                (Decimal("50"), Decimal("0"), Decimal("0")),
                (Decimal("0"),),
                (Decimal("100"),),
                None,
            ]
        }
    )
    repo = FinanceAtomicRepository(
        db,
        _q6,
        "UPSERT",
        "BAL_FOR_UPDATE",
        "AUDIT_INSERT",
        ("restricted", "suspended", "blocked"),
    )

    result = repo.process_withdrawal_request_atomic(
        WithdrawalAtomicRequestCommand(
            provider_address="0xabc",
            amount_usdc=Decimal("12.000000"),
            request_id="req-1",
            idempotency_key="idem-1",
            request_meta={"requestId": "req-1"},
            single_limit_usdc=Decimal("100"),
            rolling_24h_limit_usdc=Decimal("500"),
            window_seconds=86400,
            high_risk_override=False,
            sign_ticket_factory=lambda amount: PreparedWithdrawTicket(
                requires_manual_review=False,
                amount_wei=int(amount * Decimal("1000000")),
                fee_wei=0,
                nonce=7,
                chain_id=31337,
                deadline=9999999999,
                signature="sig-1",
                signer_address="0xsigner",
                ticket={
                    "amount": str(int(amount * Decimal("1000000"))),
                    "fee": "0",
                    "nonce": 7,
                    "deadline": 9999999999,
                    "signature": "sig-1",
                    "chainId": 31337,
                    "contractAddress": "0xrouter",
                },
            ),
        )
    )

    assert result.decision == "green"
    assert result.status == "APPROVED_AUTO"
    assert abs(result.amount_usdc - 12.0) < 1e-9
    assert result.ticket["signature"] == "sig-1"

    executed_sql = "\n".join(sql for sql, _ in db.connections[0].cursor_obj.executed)
    assert "INSERT INTO synapse_vault_withdrawals" in executed_sql
    assert "INSERT INTO synapse_runtime_state" in executed_sql
    assert "UPSERT" in executed_sql


def test_finance_atomic_repository_rejects_withdraw_before_lock_when_precheck_fails() -> None:
    db = FakeDB()
    db.connect_plan.append(
        {
            "fetchone": [
                (Decimal("50"), Decimal("0"), Decimal("0")),
                (Decimal("0"),),
                (Decimal("100"),),
            ]
        }
    )
    repo = FinanceAtomicRepository(
        db,
        _q6,
        "UPSERT",
        "BAL_FOR_UPDATE",
        "AUDIT_INSERT",
        ("restricted", "suspended", "blocked"),
    )

    with pytest.raises(RuntimeError, match="INSUFFICIENT_VAULT_LIQUIDITY"):
        repo.process_withdrawal_request_atomic(
            WithdrawalAtomicRequestCommand(
                provider_address="0xabc",
                amount_usdc=Decimal("8.500000"),
                request_id="req-liquidity-1",
                idempotency_key="idem-liquidity-1",
                request_meta={"requestId": "req-liquidity-1"},
                single_limit_usdc=Decimal("100"),
                rolling_24h_limit_usdc=Decimal("500"),
                window_seconds=86400,
                high_risk_override=False,
                pre_reserve_check=_raise_insufficient_vault_liquidity,
                sign_ticket_factory=lambda amount: PreparedWithdrawTicket(
                    requires_manual_review=False,
                    amount_wei=int(amount * Decimal("1000000")),
                    fee_wei=0,
                    nonce=7,
                    chain_id=31337,
                    deadline=9999999999,
                    signature="sig-1",
                    signer_address="0xsigner",
                    ticket={},
                ),
            )
        )

    conn = db.connections[0]
    assert conn.commits == 0
    assert conn.rollbacks == 1
    executed_sql = "\n".join(sql for sql, _ in conn.cursor_obj.executed)
    assert "INSERT INTO synapse_vault_withdrawals" not in executed_sql
    assert "UPSERT" not in executed_sql
