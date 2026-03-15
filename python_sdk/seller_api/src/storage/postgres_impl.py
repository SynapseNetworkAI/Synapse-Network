import json
import time
from typing import Any, Callable, Dict, List, Optional, Union
from decimal import Decimal, ROUND_HALF_UP

from .base import BaseStorage
from .normalizers import normalize_service_row
from .postgres.database_manager import DatabaseManager
from .postgres.repositories.audit_log_repository import AuditLogRepository
from .postgres.repositories.balance_repository import BalanceRepository
from .postgres.repositories.credential_auth_repository import CredentialAuthRepository
from .postgres.repositories.fee_policy_repository import FeePolicyRepository
from .postgres.repositories.idempotency_repository import IdempotencyRepository
from .postgres.repositories.service_registry_repository import ServiceRegistryRepository

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional dependency at import time
    psycopg = None


_COLLECTION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_collections (
    collection_name TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_AUDIT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_audit_log (
    id BIGSERIAL PRIMARY KEY,
    collection_name TEXT NOT NULL DEFAULT 'audit_log',
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_AUDIT_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_created_at
ON synapse_audit_log (created_at DESC);
"""

_AUDIT_OWNER_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_owner
ON synapse_audit_log ((payload->>'ownerAddress'));
"""

_AUDIT_INSERT_SQL = "INSERT INTO synapse_audit_log (collection_name, payload) VALUES (%s, %s::jsonb)"
_BALANCE_FOR_UPDATE_SQL = (
    "SELECT available_balance, pending_balance, frozen_balance "
    "FROM synapse_balances WHERE owner_address = %s AND account_type = %s FOR UPDATE"
)
_RISK_RESTRICTED_SESSION_STATUSES = ("restricted", "suspended", "blocked")

_DEPOSIT_DEDUP_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_deposit_dedup (
    tx_hash TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_WITHDRAW_TX_DEDUP_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_withdraw_tx_dedup (
    owner_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_address, tx_hash, kind)
);
"""

_DEPOSIT_DEDUP_OWNER_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_deposit_dedup_owner
ON synapse_deposit_dedup (owner_address, created_at DESC);
"""

_WITHDRAW_TX_DEDUP_OWNER_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_withdraw_tx_dedup_owner
ON synapse_withdraw_tx_dedup (owner_address, created_at DESC);
"""

_BUSINESS_TYPE_ENUM_SQL = """
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_business_type') THEN
        CREATE TYPE synapse_business_type AS ENUM ('deposit', 'charge', 'refund', 'withdraw', 'freeze', 'unfreeze');
    END IF;
END $$;
"""

_RISK_LEVEL_ENUM_SQL = """
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_risk_level') THEN
        CREATE TYPE synapse_risk_level AS ENUM ('green', 'yellow', 'red');
    END IF;
END $$;
"""

_WITHDRAW_STATUS_ENUM_SQL = """
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'synapse_withdraw_status') THEN
        CREATE TYPE synapse_withdraw_status AS ENUM ('REQUESTED', 'APPROVED_AUTO', 'PENDING_MANUAL_REVIEW', 'REJECTED', 'COMPLETED');
    END IF;
END $$;
"""

_BALANCE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_balances (
    owner_address TEXT NOT NULL,
    account_type TEXT NOT NULL,
    available_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
    pending_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
    frozen_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_address, account_type),
    CHECK (account_type IN ('buyer', 'seller', 'platform_fee')),
    CHECK (available_balance >= 0),
    CHECK (pending_balance >= 0),
    CHECK (frozen_balance >= 0)
);
"""

_DEPOSIT_INTENTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_deposit_intents (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    payload JSONB NOT NULL
);
"""

_REFUND_INTENTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_refund_intents (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL,
    amount_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    payload JSONB NOT NULL
);
"""

_WITHDRAWAL_INTENTS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_withdrawal_intents (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    tx_hash TEXT,
    status synapse_withdraw_status NOT NULL DEFAULT 'REQUESTED',
    amount_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    payload JSONB NOT NULL
);
"""

_ROUTER_CONFIG_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_router_config (
    owner_address TEXT PRIMARY KEY,
    daily_limit_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);
"""

_USAGE_LOG_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_usage_log (
    id TEXT PRIMARY KEY,
    ts BIGINT NOT NULL,
    buyer_address TEXT,
    seller_address TEXT,
    status TEXT,
    total_charge NUMERIC(36, 6),
    business_type synapse_business_type NOT NULL DEFAULT 'charge',
    risk_level synapse_risk_level NOT NULL DEFAULT 'green',
    payload JSONB NOT NULL
);
"""

_USAGE_LOG_OWNER_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_usage_log_owner
ON synapse_usage_log (lower(buyer_address), lower(seller_address), ts DESC);
"""

_PROCESSED_DEPOSIT_EVENT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_processed_deposit_events (
    dedup_key TEXT PRIMARY KEY,
    updated_at BIGINT NOT NULL
);
"""

_SERVICE_REGISTRY_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_service_registry (
    service_id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    payload JSONB NOT NULL
);
"""

_SERVICE_TARGET_HEALTH_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_service_target_health (
    service_id TEXT NOT NULL,
    target_url TEXT NOT NULL,
    owner_address TEXT,
    status TEXT,
    overall_status TEXT,
    http_status INTEGER,
    latency_ms INTEGER,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    probe_url TEXT,
    last_checked_at BIGINT,
    last_healthy_at BIGINT,
    error TEXT,
    weight INTEGER,
    region TEXT,
    PRIMARY KEY (service_id, target_url)
);
"""

_SERVICE_TARGET_HEALTH_HISTORY_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_service_target_health_history (
    id BIGSERIAL PRIMARY KEY,
    service_id TEXT NOT NULL,
    owner_address TEXT,
    target_url TEXT NOT NULL,
    status TEXT,
    http_status INTEGER,
    latency_ms INTEGER,
    probe_url TEXT,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    checked_at BIGINT NOT NULL,
    last_healthy_at BIGINT,
    error TEXT
);
"""

_CREDENTIALS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_credentials (
    id TEXT PRIMARY KEY,
    credential_type TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    name TEXT,
    token_hash TEXT,
    token_prefix TEXT,
    status TEXT,
    max_calls INTEGER,
    calls_used INTEGER,
    rpm INTEGER,
    credit_limit NUMERIC(36, 6),
    reset_interval TEXT,
    expiration BIGINT,
    expires_at BIGINT,
    created_at BIGINT,
    updated_at BIGINT,
    revoked_at BIGINT,
    payload JSONB NOT NULL
);
"""

_CREDENTIALS_TYPE_OWNER_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_credentials_type_owner
ON synapse_credentials (credential_type, lower(owner_address), created_at DESC);
"""

_WALLET_ROLE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_wallet_roles (
    wallet_address TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    updated_at BIGINT NOT NULL
);
"""

_AUTH_SESSION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_auth_sessions (
    wallet_address TEXT PRIMARY KEY,
    registered_at BIGINT NOT NULL,
    last_login BIGINT NOT NULL,
    status TEXT NOT NULL,
    updated_at BIGINT NOT NULL
);
"""

_FEE_POLICY_DEFAULT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_platform_fee_policy_default (
    singleton_id SMALLINT PRIMARY KEY,
    default_rate NUMERIC(10, 6) NOT NULL,
    updated_at BIGINT,
    updated_by TEXT
);
"""

_FEE_POLICY_OWNER_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_platform_fee_policy_owner (
    owner_address TEXT PRIMARY KEY,
    fee_rate NUMERIC(10, 6) NOT NULL
);
"""

_IDEMPOTENCY_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_idempotency_keys (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response JSONB,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    UNIQUE (scope, owner_address, idempotency_key)
);
"""

_RATE_LIMIT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_finance_rate_limit (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    action TEXT NOT NULL,
    window_start BIGINT NOT NULL,
    count INTEGER NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE (owner_address, action)
);
"""

_SELLER_RISK_FLAGS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_seller_risk_flags (
    owner_address TEXT PRIMARY KEY,
    risk_tag TEXT NOT NULL,
    is_high_risk BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at BIGINT NOT NULL DEFAULT 0
);
"""

_BALANCE_UPSERT_SQL = """
INSERT INTO synapse_balances (
    owner_address,
    account_type,
    available_balance,
    pending_balance,
    frozen_balance,
    updated_at
) VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT (owner_address, account_type)
DO UPDATE SET
    available_balance = EXCLUDED.available_balance,
    pending_balance = EXCLUDED.pending_balance,
    frozen_balance = EXCLUDED.frozen_balance,
    updated_at = EXCLUDED.updated_at
"""


def _d(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0")


def _q6(value: Any) -> Decimal:
    return _d(value).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)


def _json_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _json_rows(value: Any) -> List[Dict[str, Any]]:
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if isinstance(value, dict) and isinstance(value.get("rows"), list):
        return [row for row in value["rows"] if isinstance(row, dict)]
    return []


class PostgresStorage(BaseStorage):
    def __init__(self, dsn: str, ensure_schema: bool = True):
        if psycopg is None:
            raise RuntimeError(
                "psycopg is not installed. Install dependency 'psycopg[binary]' before using PostgreSQL storage."
            )
        if not dsn.strip():
            raise RuntimeError("POSTGRES_DSN is required when STORAGE_BACKEND=postgres")

        self.dsn = dsn.strip()
        self._db = DatabaseManager(self._connect)
        self._fee_policy_repo = FeePolicyRepository(self._db, _q6)
        self._idempotency_repo = IdempotencyRepository(self._db)
        self._audit_repo = AuditLogRepository(self._db, _AUDIT_INSERT_SQL)
        self._balance_repo = BalanceRepository(self._db, _q6, _BALANCE_UPSERT_SQL)
        self._service_registry_repo = ServiceRegistryRepository(self._db)
        self._credential_auth_repo = CredentialAuthRepository(self._db, _q6)
        if ensure_schema:
            self._ensure_schema()

    def _connect(self):
        return psycopg.connect(self.dsn)

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(_BUSINESS_TYPE_ENUM_SQL)
                cur.execute(_RISK_LEVEL_ENUM_SQL)
                cur.execute(_WITHDRAW_STATUS_ENUM_SQL)
                cur.execute(_COLLECTION_TABLE_SQL)
                cur.execute(_AUDIT_TABLE_SQL)
                cur.execute(_AUDIT_IDX_SQL)
                cur.execute(_AUDIT_OWNER_IDX_SQL)
                cur.execute(_DEPOSIT_DEDUP_TABLE_SQL)
                cur.execute(_WITHDRAW_TX_DEDUP_TABLE_SQL)
                cur.execute(_DEPOSIT_DEDUP_OWNER_IDX_SQL)
                cur.execute(_WITHDRAW_TX_DEDUP_OWNER_IDX_SQL)
                cur.execute(_BALANCE_TABLE_SQL)
                cur.execute(_DEPOSIT_INTENTS_TABLE_SQL)
                cur.execute(_REFUND_INTENTS_TABLE_SQL)
                cur.execute(_WITHDRAWAL_INTENTS_TABLE_SQL)
                cur.execute(_ROUTER_CONFIG_TABLE_SQL)
                cur.execute(_USAGE_LOG_TABLE_SQL)
                cur.execute(_USAGE_LOG_OWNER_IDX_SQL)
                cur.execute(_PROCESSED_DEPOSIT_EVENT_TABLE_SQL)
                cur.execute(_SERVICE_REGISTRY_TABLE_SQL)
                cur.execute(_SERVICE_TARGET_HEALTH_TABLE_SQL)
                cur.execute(_SERVICE_TARGET_HEALTH_HISTORY_TABLE_SQL)
                cur.execute(_CREDENTIALS_TABLE_SQL)
                cur.execute(_CREDENTIALS_TYPE_OWNER_IDX_SQL)
                cur.execute(_WALLET_ROLE_TABLE_SQL)
                cur.execute(_AUTH_SESSION_TABLE_SQL)
                cur.execute(_FEE_POLICY_DEFAULT_TABLE_SQL)
                cur.execute(_FEE_POLICY_OWNER_TABLE_SQL)
                cur.execute(_IDEMPOTENCY_TABLE_SQL)
                cur.execute(_RATE_LIMIT_TABLE_SQL)
                cur.execute(_SELLER_RISK_FLAGS_TABLE_SQL)
            conn.commit()

    def _load_locked_balance_triplet(self, cur: Any, owner: str, account_type: str, now: int) -> tuple[Decimal, Decimal, Decimal]:
        cur.execute(_BALANCE_FOR_UPDATE_SQL, (owner, account_type))
        hit = cur.fetchone()
        if hit is None:
            cur.execute(_BALANCE_UPSERT_SQL, (owner, account_type, "0", "0", "0", now))
            return (Decimal("0"), Decimal("0"), Decimal("0"))
        return (_q6(hit[0]), _q6(hit[1]), _q6(hit[2]))

    def _compute_withdrawal_risk_metrics(self, cur: Any, owner: str, now: int, window_seconds: int) -> tuple[Decimal, Decimal, bool]:
        window_start = now - max(1, int(window_seconds))
        cur.execute(
            """
            SELECT COALESCE(SUM(amount_usdc), 0)
            FROM synapse_withdrawal_intents
            WHERE owner_address = %s
              AND created_at >= %s
              AND status <> 'REJECTED'
            """,
            (owner, window_start),
        )
        rolling_24h = _q6((cur.fetchone() or [0])[0])

        cur.execute(
            """
            SELECT COALESCE(SUM(
                CASE
                    WHEN (payload->>'sellerNet') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                        THEN (payload->>'sellerNet')::numeric
                    WHEN total_charge IS NOT NULL
                        THEN total_charge
                    ELSE 0
                END
            ), 0)
            FROM synapse_usage_log
            WHERE lower(seller_address) = %s
              AND lower(status) IN ('accepted', 'succeeded', 'success', 'completed')
            """,
            (owner,),
        )
        historical_net_income = _q6((cur.fetchone() or [0])[0])

        cur.execute(
            "SELECT 1 FROM synapse_seller_risk_flags WHERE owner_address = %s AND is_high_risk = TRUE LIMIT 1",
            (owner,),
        )
        high_risk_from_db = cur.fetchone() is not None
        return rolling_24h, historical_net_income, high_risk_from_db

    def _upsert_withdrawal_intent(
        self,
        cur: Any,
        *,
        withdrawal_id: str,
        owner: str,
        status: str,
        amount: Decimal,
        now: int,
        payload: Dict[str, Any],
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_withdrawal_intents (id, owner_address, tx_hash, status, amount_usdc, created_at, updated_at, payload)
            VALUES (%s, %s, NULL, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id)
            DO UPDATE SET status = EXCLUDED.status, amount_usdc = EXCLUDED.amount_usdc,
                          updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
            """,
            (withdrawal_id, owner, status, str(amount), now, now, json.dumps(payload, ensure_ascii=False)),
        )

    def _append_withdrawal_audit(
        self,
        cur: Any,
        *,
        withdrawal_id: str,
        now: int,
        action: str,
        owner: str,
        details: Dict[str, Any],
    ) -> None:
        cur.execute(
            _AUDIT_INSERT_SQL,
            (
                "audit_log",
                json.dumps(
                    {
                        "id": f"audit-{withdrawal_id}",
                        "timestamp": now,
                        "action": action,
                        "ownerAddress": owner,
                        "details": details,
                    },
                    ensure_ascii=False,
                ),
            ),
        )

    def _resolve_red_reason(self, amount: Decimal, historical_net_income: Decimal, is_high_risk: bool) -> Optional[str]:
        if amount > historical_net_income:
            return "WITHDRAW_EXCEEDS_HISTORICAL_NET_INCOME"
        if is_high_risk:
            return "HIGH_RISK_SELLER_TAGGED"
        return None

    def _persist_red_withdrawal(
        self,
        cur: Any,
        *,
        withdrawal_id: str,
        owner: str,
        amount: Decimal,
        now: int,
        request_id: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]],
        red_reason: str,
        rolling_24h: Decimal,
        historical_net_income: Decimal,
    ) -> Dict[str, Any]:
        payload = {
            "id": withdrawal_id,
            "ownerAddress": owner,
            "amountUsdc": float(amount),
            "status": "REJECTED",
            "businessType": "withdraw",
            "riskLevel": "red",
            "riskReasonCode": red_reason,
            "requestId": request_id,
            "idempotencyKey": idempotency_key,
            "requestMeta": request_meta or {},
            "createdAt": now,
            "updatedAt": now,
        }
        self._upsert_withdrawal_intent(
            cur,
            withdrawal_id=withdrawal_id,
            owner=owner,
            status="REJECTED",
            amount=amount,
            now=now,
            payload=payload,
        )
        self._append_withdrawal_audit(
            cur,
            withdrawal_id=withdrawal_id,
            now=now,
            action="PROVIDER_WITHDRAW_REJECTED",
            owner=owner,
            details={
                "businessType": "withdraw",
                "riskLevel": "red",
                "riskReasonCode": red_reason,
                "amountUsdc": float(amount),
                "rolling24hWithdrawUsdc": float(rolling_24h),
                "historicalNetIncomeUsdc": float(historical_net_income),
                "requestId": request_id,
            },
        )
        return {
            "decision": "red",
            "withdrawalId": withdrawal_id,
            "status": "REJECTED",
            "riskReasonCode": red_reason,
            "message": "Withdrawal blocked by risk policy.",
        }

    def _persist_non_red_withdrawal(
        self,
        cur: Any,
        *,
        withdrawal_id: str,
        owner: str,
        amount: Decimal,
        now: int,
        request_context: Dict[str, Any],
        balances: tuple[Decimal, Decimal, Decimal],
        thresholds: tuple[Decimal, Decimal],
        risk_metrics: tuple[Decimal, Decimal],
        sign_ticket_factory: Optional[Callable[[Decimal], Dict[str, Any]]],
    ) -> Dict[str, Any]:
        request_id = str(request_context.get("requestId") or "")
        idempotency_key = str(request_context.get("idempotencyKey") or "")
        request_meta = request_context.get("requestMeta") if isinstance(request_context.get("requestMeta"), dict) else {}
        available_balance, pending_balance, frozen_balance = balances
        single_limit_usdc, rolling_24h_limit_usdc = thresholds
        rolling_24h, historical_net_income = risk_metrics
        is_yellow = amount >= _q6(single_limit_usdc) or (rolling_24h + amount) >= _q6(rolling_24h_limit_usdc)
        next_available = _q6(available_balance - amount)
        if is_yellow:
            status = "PENDING_MANUAL_REVIEW"
            ticket: Dict[str, Any] = {}
            message = "Withdrawal requested. Amounts over $100 require manual security review (ETA: 12-24 hrs)."
            cur.execute(
                _BALANCE_UPSERT_SQL,
                (owner, "seller", str(next_available), str(pending_balance), str(_q6(frozen_balance + amount)), now),
            )
        else:
            status = "APPROVED_AUTO"
            ticket = sign_ticket_factory(amount) if sign_ticket_factory is not None else {}
            message = ""
            cur.execute(
                _BALANCE_UPSERT_SQL,
                (owner, "seller", str(next_available), str(_q6(pending_balance + amount)), str(frozen_balance), now),
            )

        payload = {
            "id": withdrawal_id,
            "ownerAddress": owner,
            "amountUsdc": float(amount),
            "status": status,
            "businessType": "withdraw",
            "riskLevel": "yellow" if is_yellow else "green",
            "requestId": request_id,
            "idempotencyKey": idempotency_key,
            "requestMeta": request_meta or {},
            "ticket": ticket,
            "message": message,
            "createdAt": now,
            "updatedAt": now,
        }
        self._upsert_withdrawal_intent(
            cur,
            withdrawal_id=withdrawal_id,
            owner=owner,
            status=status,
            amount=amount,
            now=now,
            payload=payload,
        )
        self._append_withdrawal_audit(
            cur,
            withdrawal_id=withdrawal_id,
            now=now,
            action="PROVIDER_WITHDRAW_INTENT_CREATED",
            owner=owner,
            details={
                "businessType": "withdraw",
                "riskLevel": "yellow" if is_yellow else "green",
                "amountUsdc": float(amount),
                "rolling24hWithdrawUsdc": float(rolling_24h),
                "historicalNetIncomeUsdc": float(historical_net_income),
                "requestId": request_id,
            },
        )
        return {
            "decision": "yellow" if is_yellow else "green",
            "withdrawalId": withdrawal_id,
            "status": status,
            "amountUsdc": float(amount),
            "ticket": ticket,
            "message": message,
        }

    def _is_wallet_restricted(self, cur: Any, wallet: str) -> bool:
        cur.execute("SELECT status FROM synapse_auth_sessions WHERE wallet_address = %s", (wallet,))
        row = cur.fetchone()
        if row is None:
            return False
        return str(row[0] or "").strip().lower() in _RISK_RESTRICTED_SESSION_STATUSES

    def _is_account_restricted_for_charge(self, cur: Any, wallet: str, account_type: str, now: int) -> bool:
        _, _, frozen_balance = self._load_locked_balance_triplet(cur, wallet, account_type, now)
        if frozen_balance <= Decimal("0"):
            return False
        return self._is_wallet_restricted(cur, wallet)

    def process_withdrawal_request_atomic(
        self,
        *,
        seller_address: str,
        amount_usdc: Decimal,
        request_id: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]],
        single_limit_usdc: Decimal,
        rolling_24h_limit_usdc: Decimal,
        window_seconds: int,
        high_risk_override: bool,
        sign_ticket_factory: Optional[Callable[[Decimal], Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        owner = str(seller_address or "").strip().lower()
        now = int(time.time())
        amount = _q6(amount_usdc)
        if amount <= Decimal("0"):
            raise RuntimeError("INVALID_WITHDRAW_AMOUNT")

        with self._connect() as conn:
            try:
                with conn.cursor() as cur:
                    available_balance, pending_balance, frozen_balance = self._load_locked_balance_triplet(cur, owner, "seller", now)

                    if available_balance < amount:
                        raise RuntimeError("INSUFFICIENT_SELLER_RECEIVABLE")

                    rolling_24h, historical_net_income, high_risk_from_db = self._compute_withdrawal_risk_metrics(
                        cur, owner, now, window_seconds
                    )
                    is_high_risk = bool(high_risk_override or high_risk_from_db)

                    red_reason = self._resolve_red_reason(amount, historical_net_income, is_high_risk)
                    withdrawal_id = f"wd-{now}-{owner[-8:]}"
                    if red_reason:
                        response = self._persist_red_withdrawal(
                            cur,
                            withdrawal_id=withdrawal_id,
                            owner=owner,
                            amount=amount,
                            now=now,
                            request_id=request_id,
                            idempotency_key=idempotency_key,
                            request_meta=request_meta,
                            red_reason=red_reason,
                            rolling_24h=rolling_24h,
                            historical_net_income=historical_net_income,
                        )
                        conn.commit()
                        return response

                    response = self._persist_non_red_withdrawal(
                        cur,
                        withdrawal_id=withdrawal_id,
                        owner=owner,
                        amount=amount,
                        now=now,
                        request_context={
                            "requestId": request_id,
                            "idempotencyKey": idempotency_key,
                            "requestMeta": request_meta or {},
                        },
                        balances=(available_balance, pending_balance, frozen_balance),
                        thresholds=(single_limit_usdc, rolling_24h_limit_usdc),
                        risk_metrics=(rolling_24h, historical_net_income),
                        sign_ticket_factory=sign_ticket_factory,
                    )
                conn.commit()
                return response
            except Exception:
                conn.rollback()
                raise

    def _load_collection_for_update(self, cur: Any, collection_name: str) -> Any:
        cur.execute(
            "SELECT payload FROM synapse_collections WHERE collection_name = %s FOR UPDATE",
            (collection_name,),
        )
        row = cur.fetchone()
        if row is None:
            default_payload = self._default_collection(collection_name)
            cur.execute(
                "INSERT INTO synapse_collections (collection_name, payload, updated_at) VALUES (%s, %s::jsonb, NOW())",
                (collection_name, json.dumps(default_payload, ensure_ascii=False)),
            )
            return default_payload
        return row[0]

    def _save_collection_in_tx(self, cur: Any, collection_name: str, payload: Any) -> None:
        cur.execute(
            """
            INSERT INTO synapse_collections (collection_name, payload, updated_at)
            VALUES (%s, %s::jsonb, NOW())
            ON CONFLICT (collection_name)
            DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
            """,
            (collection_name, json.dumps(payload, ensure_ascii=False)),
        )

    def register_deposit_intent_atomic(self, owner_wallet: str, tx_hash: str, request_id: str, intent_row: Dict[str, Any]) -> Dict[str, Any]:
        owner = str(owner_wallet or "").strip().lower()
        tx = str(tx_hash or "").strip().lower()
        now = int(time.time())
        row = dict(intent_row)
        row.setdefault("ownerAddress", owner)
        row.setdefault("txHash", tx)
        row.setdefault("status", "PENDING_CONFIRMATION")
        row.setdefault("createdAt", now)
        row["updatedAt"] = now
        amount_usdc = _q6(row.get("amountUsdc") or 0)
        if amount_usdc <= Decimal("0"):
            raise RuntimeError("INVALID_DEPOSIT_AMOUNT")
        row_id = str(row.get("id") or "").strip() or f"dep-{now}-{tx[-8:]}"
        row["id"] = row_id

        # ACID + UNIQUE: tx_hash duplicate replay is blocked physically.
        with self._connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_deposit_dedup (tx_hash, owner_address, request_id) VALUES (%s, %s, %s)",
                        (tx, owner, request_id or None),
                    )
                except psycopg.IntegrityError:
                    conn.rollback()
                    with self._connect() as lookup_conn:
                        with lookup_conn.cursor() as lookup_cur:
                            lookup_cur.execute(
                                "SELECT payload FROM synapse_deposit_intents WHERE tx_hash = %s AND owner_address = %s",
                                (tx, owner),
                            )
                            hit = lookup_cur.fetchone()
                            if hit and isinstance(hit[0], dict):
                                return hit[0]
                    return {}

                available_balance, pending_balance, frozen_balance = self._load_locked_balance_triplet(cur, owner, "buyer", now)
                cur.execute(
                    _BALANCE_UPSERT_SQL,
                    (
                        owner,
                        "buyer",
                        str(available_balance),
                        str(_q6(pending_balance + amount_usdc)),
                        str(frozen_balance),
                        now,
                    ),
                )

                cur.execute(
                    """
                    INSERT INTO synapse_deposit_intents (id, owner_address, tx_hash, status, created_at, updated_at, payload)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        owner_address = EXCLUDED.owner_address,
                        tx_hash = EXCLUDED.tx_hash,
                        status = EXCLUDED.status,
                        updated_at = EXCLUDED.updated_at,
                        payload = EXCLUDED.payload
                    """,
                    (
                        row_id,
                        owner,
                        tx,
                        str(row.get("status") or "PENDING_CONFIRMATION"),
                        int(row.get("createdAt") or now),
                        int(row.get("updatedAt") or now),
                        json.dumps(row, ensure_ascii=False),
                    ),
                )
            conn.commit()
        return row

    def confirm_deposit_intent_atomic(self, owner_wallet: str, deposit_intent_id: str, event_key: str, confirmations: int) -> Dict[str, Any]:
        owner = str(owner_wallet or "").strip().lower()
        intent_id = str(deposit_intent_id or "").strip()
        if not intent_id:
            raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")
        now = int(time.time())

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, status, amount_usdc, payload FROM synapse_deposit_intents WHERE id = %s AND owner_address = %s FOR UPDATE",
                    (intent_id, owner),
                )
                hit = cur.fetchone()
                if hit is None:
                    raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")

                row_id = str(hit[0] or intent_id)
                status = str(hit[1] or "").upper()
                amount = _q6(hit[2] or 0)
                payload = hit[3] if isinstance(hit[3], dict) else {}

                if status == "CONFIRMED":
                    return payload

                if status not in {"PENDING_CONFIRMATION", "PENDING"}:
                    raise RuntimeError("DEPOSIT_STATUS_INVALID")

                available_balance, pending_balance, frozen_balance = self._load_locked_balance_triplet(cur, owner, "buyer", now)
                if pending_balance < amount:
                    raise RuntimeError("DEPOSIT_PENDING_BALANCE_INCONSISTENT")

                next_available = _q6(available_balance + amount)
                next_pending = _q6(pending_balance - amount)
                cur.execute(
                    _BALANCE_UPSERT_SQL,
                    (owner, "buyer", str(next_available), str(next_pending), str(frozen_balance), now),
                )

                next_payload = dict(payload)
                next_payload["status"] = "CONFIRMED"
                next_payload["confirmedAt"] = now
                next_payload["confirmations"] = int(confirmations)
                next_payload["eventKey"] = str(event_key or "")
                next_payload["creditedAmountUsdc"] = float(amount)
                next_payload["availableAfter"] = float(next_available)
                next_payload["pendingAfter"] = float(next_pending)
                next_payload["updatedAt"] = now

                cur.execute(
                    """
                    UPDATE synapse_deposit_intents
                    SET status = %s, updated_at = %s, payload = %s::jsonb
                    WHERE id = %s AND owner_address = %s
                    """,
                    ("CONFIRMED", now, json.dumps(next_payload, ensure_ascii=False), row_id, owner),
                )
            conn.commit()
        return next_payload

    def charge_buyer_and_record_usage_atomic(
        self,
        *,
        owner_wallet: str,
        seller_wallet: str,
        total_charge: Decimal,
        seller_net: Decimal,
        platform_fee_total: Decimal,
        usage_row: Dict[str, Any],
    ) -> Dict[str, Any]:
        now = int(time.time())
        owner = str(owner_wallet or "").strip().lower()
        seller = str(seller_wallet or "").strip().lower()

        def _load_balance(cur: Any, wallet: str, account_type: str, column_name: str) -> Decimal:
            hit = self._load_locked_balance_triplet(cur, wallet, account_type, now)
            idx = {"available_balance": 0, "pending_balance": 1, "frozen_balance": 2}[column_name]
            return _q6(hit[idx])

        def _set_available(cur: Any, wallet: str, account_type: str, available_value: Decimal) -> None:
            current_pending = _load_balance(cur, wallet, account_type, "pending_balance")
            current_frozen = _load_balance(cur, wallet, account_type, "frozen_balance")
            cur.execute(
                _BALANCE_UPSERT_SQL,
                (wallet, account_type, str(_q6(available_value)), str(_q6(current_pending)), str(_q6(current_frozen)), now),
            )

        with self._connect() as conn:
            with conn.cursor() as cur:
                if self._is_account_restricted_for_charge(cur, owner, "buyer", now):
                    raise RuntimeError("BUYER_RESTRICTED_RISK_BLOCK")
                if self._is_account_restricted_for_charge(cur, seller, "seller", now):
                    raise RuntimeError("SELLER_RESTRICTED_RISK_BLOCK")

                before_buyer = _load_balance(cur, owner, "buyer", "available_balance")
                if before_buyer < _q6(total_charge):
                    raise RuntimeError("INSUFFICIENT_BALANCE")

                seller_before = _load_balance(cur, seller, "seller", "available_balance")
                platform_before = _load_balance(cur, "__platform__", "platform_fee", "available_balance")
                buyer_after = _q6(before_buyer - _q6(total_charge))
                seller_after = _q6(seller_before + _q6(seller_net))
                platform_after = _q6(platform_before + _q6(platform_fee_total))

                _set_available(cur, owner, "buyer", buyer_after)
                _set_available(cur, seller, "seller", seller_after)
                _set_available(cur, "__platform__", "platform_fee", platform_after)

                usage_id = str(usage_row.get("id") or f"usage-{now}-{owner[-6:]}")
                payload = dict(usage_row)
                payload.setdefault("id", usage_id)
                payload.setdefault("timestamp", int(usage_row.get("timestamp") or now))
                payload.setdefault("buyer", owner)
                payload.setdefault("seller", seller)
                payload.setdefault("status", str(usage_row.get("status") or "accepted"))
                payload.setdefault("totalCharge", float(_q6(total_charge)))
                cur.execute(
                    """
                    INSERT INTO synapse_usage_log (
                        id,
                        ts,
                        buyer_address,
                        seller_address,
                        status,
                        total_charge,
                        business_type,
                        risk_level,
                        payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s::synapse_business_type, %s::synapse_risk_level, %s::jsonb)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        ts = EXCLUDED.ts,
                        buyer_address = EXCLUDED.buyer_address,
                        seller_address = EXCLUDED.seller_address,
                        status = EXCLUDED.status,
                        total_charge = EXCLUDED.total_charge,
                        business_type = EXCLUDED.business_type,
                        risk_level = EXCLUDED.risk_level,
                        payload = EXCLUDED.payload
                    """,
                    (
                        usage_id,
                        int(payload.get("timestamp") or now),
                        str(payload.get("buyer") or owner),
                        str(payload.get("seller") or seller),
                        str(payload.get("status") or "accepted"),
                        str(_q6(payload.get("totalCharge") or total_charge)),
                        "charge",
                        str(payload.get("riskLevel") or "green").lower(),
                        json.dumps(payload, ensure_ascii=False),
                    ),
                )

                audit_payload = {
                    "id": usage_row.get("id") or "",
                    "timestamp": now,
                    "action": "BUYER_CHARGE_ATOMIC",
                    "ownerAddress": owner,
                    "details": {
                        "beforeBalance": float(before_buyer),
                        "deltaAmount": float(-_q6(total_charge)),
                        "afterBalance": float(_q6(before_buyer - _q6(total_charge))),
                        "seller": seller,
                    },
                }
                cur.execute(
                    _AUDIT_INSERT_SQL,
                    ("audit_log", json.dumps(audit_payload, ensure_ascii=False)),
                )

            conn.commit()
        return {"buyerBalanceAfter": float(_q6(before_buyer - _q6(total_charge)))}

    def reserve_seller_withdraw_atomic(self, owner_wallet: str, amount_usdc: Decimal) -> Dict[str, float]:
        owner = str(owner_wallet or "").strip().lower()
        now = int(time.time())

        def _load_balances(cur: Any, wallet: str, account_type: str) -> tuple[Decimal, Decimal, Decimal]:
            return self._load_locked_balance_triplet(cur, wallet, account_type, now)

        with self._connect() as conn:
            with conn.cursor() as cur:
                before_available, before_pending, before_frozen = _load_balances(cur, owner, "seller")
                if before_available < _q6(amount_usdc):
                    raise RuntimeError("INSUFFICIENT_SELLER_RECEIVABLE")
                after_available = _q6(before_available - _q6(amount_usdc))
                after_pending = _q6(before_pending + _q6(amount_usdc))

                cur.execute(
                    _BALANCE_UPSERT_SQL,
                    (
                        owner,
                        "seller",
                        str(after_available),
                        str(after_pending),
                        str(before_frozen),
                        now,
                    ),
                )

            conn.commit()
        return {
            "beforeBalance": float(before_available),
            "afterBalance": float(_q6(before_available - _q6(amount_usdc))),
        }

    def complete_withdraw_tx_atomic(self, owner_wallet: str, tx_hash: str, kind: str) -> bool:
        with self._connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_withdraw_tx_dedup (owner_address, tx_hash, kind) VALUES (%s, %s, %s)",
                        (owner_wallet, tx_hash, kind),
                    )
                except psycopg.IntegrityError:
                    conn.rollback()
                    return False
            conn.commit()
        return True

    def _replace_table_with_payload(self, table_name: str, rows: List[Dict[str, Any]], id_sql: str, value_sql_builder) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM {table_name}")
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    values = value_sql_builder(row)
                    if values is None:
                        continue
                    cur.execute(id_sql, values)
            conn.commit()

    def read_deposit_intents(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT payload FROM synapse_deposit_intents ORDER BY created_at ASC")
                rows = cur.fetchall()
        return [row[0] for row in rows if isinstance(row[0], dict)]

    def write_deposit_intents(self, rows: List[Dict[str, Any]]) -> None:
        self._replace_table_with_payload(
            "synapse_deposit_intents",
            rows,
            """
            INSERT INTO synapse_deposit_intents (id, owner_address, tx_hash, status, created_at, updated_at, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id)
            DO UPDATE SET owner_address = EXCLUDED.owner_address, tx_hash = EXCLUDED.tx_hash, status = EXCLUDED.status,
                          created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
            """,
            lambda row: (
                str(row.get("id") or ""),
                str(row.get("ownerAddress") or "").lower(),
                str(row.get("txHash") or "").lower(),
                str(row.get("status") or "PENDING_CONFIRMATION"),
                int(row.get("createdAt") or 0),
                int(row.get("updatedAt") or 0),
                json.dumps(row, ensure_ascii=False),
            ) if str(row.get("id") or "").strip() else None,
        )

    def read_refund_intents(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT payload FROM synapse_refund_intents ORDER BY created_at ASC")
                rows = cur.fetchall()
        return [row[0] for row in rows if isinstance(row[0], dict)]

    def write_refund_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._replace_table_with_payload(
            "synapse_refund_intents",
            rows,
            """
            INSERT INTO synapse_refund_intents (id, owner_address, tx_hash, status, amount_usdc, created_at, updated_at, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id)
            DO UPDATE SET owner_address = EXCLUDED.owner_address, tx_hash = EXCLUDED.tx_hash, status = EXCLUDED.status,
                          amount_usdc = EXCLUDED.amount_usdc, created_at = EXCLUDED.created_at,
                          updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
            """,
            lambda row: (
                str(row.get("id") or ""),
                str(row.get("ownerAddress") or "").lower(),
                str(row.get("txHash") or "").lower() or None,
                str(row.get("status") or "REQUESTED").upper(),
                str(_q6(row.get("amountUsdc") or 0)),
                int(row.get("createdAt") or updated_at),
                int(row.get("updatedAt") or updated_at),
                json.dumps(row, ensure_ascii=False),
            ) if str(row.get("id") or "").strip() else None,
        )

    def read_withdrawal_intents(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT payload FROM synapse_withdrawal_intents ORDER BY created_at ASC")
                rows = cur.fetchall()
        return [row[0] for row in rows if isinstance(row[0], dict)]

    def write_withdrawal_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._replace_table_with_payload(
            "synapse_withdrawal_intents",
            rows,
            """
            INSERT INTO synapse_withdrawal_intents (id, owner_address, tx_hash, status, amount_usdc, created_at, updated_at, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id)
            DO UPDATE SET owner_address = EXCLUDED.owner_address, tx_hash = EXCLUDED.tx_hash, status = EXCLUDED.status,
                          amount_usdc = EXCLUDED.amount_usdc, created_at = EXCLUDED.created_at,
                          updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
            """,
            lambda row: (
                str(row.get("id") or ""),
                str(row.get("ownerAddress") or "").lower(),
                str(row.get("txHash") or "").lower() or None,
                str(row.get("status") or "PENDING"),
                str(_q6(row.get("amountUsdc") or 0)),
                int(row.get("createdAt") or updated_at),
                int(row.get("updatedAt") or updated_at),
                json.dumps(row, ensure_ascii=False),
            ) if str(row.get("id") or "").strip() else None,
        )

    def read_balance_ledger(self) -> Dict[str, Any]:
        return self._balance_repo.read_balance_ledger()

    def write_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        self._balance_repo.write_balance_ledger(ledger)

    def read_router_config_rows(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT owner_address, daily_limit_usdc, created_at, updated_at FROM synapse_router_config ORDER BY updated_at DESC")
                rows = cur.fetchall()
        return [{"ownerAddress": str(owner), "dailyLimitUsdc": float(_q6(limit)), "createdAt": int(created), "updatedAt": int(updated)} for owner, limit, created, updated in rows]

    def write_router_config_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM synapse_router_config")
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    owner = str(row.get("ownerAddress") or "").lower()
                    if not owner:
                        continue
                    cur.execute(
                        "INSERT INTO synapse_router_config (owner_address, daily_limit_usdc, created_at, updated_at) VALUES (%s, %s, %s, %s)",
                        (owner, str(_q6(row.get("dailyLimitUsdc") or 0)), int(row.get("createdAt") or updated_at), int(row.get("updatedAt") or updated_at)),
                    )
            conn.commit()

    def read_usage_log_rows(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT payload FROM synapse_usage_log ORDER BY ts DESC")
                rows = cur.fetchall()
        return [row[0] for row in rows if isinstance(row[0], dict)]

    def write_usage_log_rows(self, rows: List[Dict[str, Any]]) -> None:
        self._replace_table_with_payload(
            "synapse_usage_log",
            rows,
            """
            INSERT INTO synapse_usage_log (
                id,
                ts,
                buyer_address,
                seller_address,
                status,
                total_charge,
                business_type,
                risk_level,
                payload
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::synapse_business_type, %s::synapse_risk_level, %s::jsonb)
            ON CONFLICT (id)
            DO UPDATE SET ts = EXCLUDED.ts, buyer_address = EXCLUDED.buyer_address, seller_address = EXCLUDED.seller_address,
                          status = EXCLUDED.status, total_charge = EXCLUDED.total_charge,
                          business_type = EXCLUDED.business_type, risk_level = EXCLUDED.risk_level,
                          payload = EXCLUDED.payload
            """,
            lambda row: (
                str(row.get("id") or f"usage-{int(time.time())}"),
                int(row.get("timestamp") or int(time.time())),
                str(row.get("buyer") or "").lower() or None,
                str(row.get("seller") or "").lower() or None,
                str(row.get("status") or ""),
                str(_q6(row.get("totalCharge") or 0)),
                str(row.get("businessType") or "charge").lower(),
                str(row.get("riskLevel") or "green").lower(),
                json.dumps(row, ensure_ascii=False),
            ),
        )

    def append_audit_row(self, row: Dict[str, Any]) -> None:
        self._audit_repo.append_audit_row(row)

    def read_processed_deposit_event_keys(self) -> List[str]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT dedup_key FROM synapse_processed_deposit_events ORDER BY updated_at DESC")
                rows = cur.fetchall()
        return [str(row[0]) for row in rows if row and row[0] is not None]

    def write_processed_deposit_event_keys(self, keys: List[str], updated_at: int) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM synapse_processed_deposit_events")
                for key in keys:
                    dedup_key = str(key or "").strip()
                    if not dedup_key:
                        continue
                    cur.execute("INSERT INTO synapse_processed_deposit_events (dedup_key, updated_at) VALUES (%s, %s)", (dedup_key, int(updated_at)))
            conn.commit()

    def read_service_registry_rows(self) -> List[Dict[str, Any]]:
        return self._service_registry_repo.read_service_registry_rows()

    def write_service_registry_rows(self, rows: List[Dict[str, Any]]) -> None:
        self._service_registry_repo.write_service_registry_rows(rows)

    def read_service_target_health_rows(self) -> List[Dict[str, Any]]:
        return self._service_registry_repo.read_service_target_health_rows()

    def write_service_target_health_rows(self, rows: List[Dict[str, Any]]) -> None:
        self._service_registry_repo.write_service_target_health_rows(rows)

    def read_service_target_health_history_rows(self) -> List[Dict[str, Any]]:
        return self._service_registry_repo.read_service_target_health_history_rows()

    def write_service_target_health_history_rows(self, rows: List[Dict[str, Any]]) -> None:
        self._service_registry_repo.write_service_target_health_history_rows(rows)

    def read_credential_rows(self, credential_type: str) -> List[Dict[str, Any]]:
        return self._credential_auth_repo.read_credential_rows(credential_type)

    def write_credential_rows(self, credential_type: str, rows: List[Dict[str, Any]]) -> None:
        self._credential_auth_repo.write_credential_rows(credential_type, rows)

    def get_wallet_role(self, wallet: str) -> Optional[str]:
        return self._credential_auth_repo.get_wallet_role(wallet)

    def set_wallet_role(self, wallet: str, role: str) -> None:
        self._credential_auth_repo.set_wallet_role(wallet, role)

    def upsert_auth_session(self, wallet: str, registered_at: int, last_login: int, status: str) -> None:
        self._credential_auth_repo.upsert_auth_session(wallet, registered_at, last_login, status)

    def get_platform_fee_policy(self) -> Dict[str, Any]:
        return self._fee_policy_repo.get_platform_fee_policy()

    def set_platform_fee_policy(self, default_rate: float, owner_rates: Dict[str, Any], updated_by: str, updated_at: int) -> None:
        self._fee_policy_repo.set_platform_fee_policy(default_rate, owner_rates, updated_by, updated_at)

    def read_idempotency_rows(self) -> List[Dict[str, Any]]:
        return self._idempotency_repo.read_idempotency_rows()

    def _to_idempotency_insert_values(self, row: Dict[str, Any], updated_at: int) -> Optional[tuple[Any, ...]]:
        row_id = str(row.get("id") or "").strip() or f"idem-{int(time.time()*1000)}"
        owner = str(row.get("ownerAddress") or "").lower()
        scope = str(row.get("scope") or "")
        key = str(row.get("idempotencyKey") or "")
        req_hash = str(row.get("requestHash") or "")
        if not owner or not scope or not key or not req_hash:
            return None
        return (
            row_id,
            scope,
            owner,
            key,
            req_hash,
            json.dumps(row.get("response") if isinstance(row.get("response"), dict) else None, ensure_ascii=False),
            int(row.get("createdAt") or updated_at),
            int(row.get("expiresAt") or updated_at),
        )

    def write_idempotency_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._idempotency_repo.write_idempotency_rows(rows, updated_at)

    def read_rate_limit_rows(self) -> List[Dict[str, Any]]:
        return self._idempotency_repo.read_rate_limit_rows()

    def write_rate_limit_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._idempotency_repo.write_rate_limit_rows(rows, updated_at)

    def _default_collection(self, collection_name: str) -> Union[List[Any], Dict[str, Any]]:
        if collection_name in {
            "credentials",
            "agent_credentials",
            "buyer_credentials",
            "seller_secrets",
            "provider_secrets",
        }:
            return {}
        return {} if "ledger" in collection_name or "config" in collection_name else []

    def _normalize_loaded_payload(self, collection_name: str, payload: Any) -> Union[List[Any], Dict[str, Any]]:
        if not isinstance(payload, dict):
            return payload

        if collection_name == "service_registry" and "services" in payload:
            services = payload["services"]
            if isinstance(services, list):
                return [normalize_service_row(svc) for svc in services]
            return services

        list_keys = {
            "agent_registry": "agents",
            "deposit_intents": "intents",
            "usage_log": "logs",
        }
        key = list_keys.get(collection_name)
        if key and key in payload:
            return payload[key]

        return payload

    def get_collection(self, collection_name: str) -> Union[List[Any], Dict[str, Any]]:
        if collection_name == "audit_log":
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT payload FROM synapse_audit_log WHERE collection_name = %s ORDER BY id ASC",
                        (collection_name,),
                    )
                    rows = cur.fetchall()
            return [row[0] for row in rows if isinstance(row[0], dict)]

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT payload FROM synapse_collections WHERE collection_name = %s",
                    (collection_name,),
                )
                row = cur.fetchone()

        if row is None:
            return self._default_collection(collection_name)

        payload = row[0]
        return self._normalize_loaded_payload(collection_name, payload)

    def save_collection(self, collection_name: str, data: Union[List[Any], Dict[str, Any]]) -> None:
        payload: Union[List[Any], Dict[str, Any]] = data

        if collection_name == "service_registry" and isinstance(data, list):
            payload = {"services": data, "updatedAt": int(time.time())}
        elif collection_name == "agent_registry" and isinstance(data, list):
            payload = {"agents": data, "updatedAt": int(time.time())}

        if collection_name == "audit_log":
            rows: List[Dict[str, Any]]
            if isinstance(payload, list):
                rows = [row for row in payload if isinstance(row, dict)]
            elif isinstance(payload, dict):
                rows = [payload]
            else:
                rows = []

            self._audit_repo.replace_audit_collection(rows)
            return

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO synapse_collections (collection_name, payload, updated_at)
                    VALUES (%s, %s::jsonb, NOW())
                    ON CONFLICT (collection_name)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                    """,
                    (collection_name, json.dumps(payload, ensure_ascii=False)),
                )
            conn.commit()

    def append_to_collection(self, collection_name: str, item: Any) -> None:
        if collection_name == "audit_log":
            self._audit_repo.append_to_audit_collection(item)
            return

        data = self.get_collection(collection_name)
        if isinstance(data, list):
            data.append(item)
            self.save_collection(collection_name, data)

    def read_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        return self._audit_repo.read_audit_rows(owner_wallet=owner_wallet, limit=limit)