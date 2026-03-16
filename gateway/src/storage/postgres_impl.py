from typing import Any, Callable, Dict, List, Optional
from decimal import Decimal, ROUND_HALF_UP

from .base import (
    AuditDomain,
    BaseStorage,
    FinanceDomain,
    SynapseDataManager,
    SynapseUnitOfWork,
    SystemDomain,
)
from .postgres.database_manager import DatabaseManager
from .postgres.schema_contracts import POSTGRES_TABLE_SCHEMA_CONTRACTS, TableSchemaContract
from .postgres.repositories.audit_log_repository import AuditLogRepository
from .postgres.repositories.balance_repository import BalanceRepository
from .postgres.repositories.credential_auth_repository import CredentialAuthRepository
from .postgres.repositories.deposit_attempt_repository import DepositAttemptRepository
from .postgres.repositories.fee_policy_repository import FeePolicyRepository
from .postgres.repositories.finance_atomic_repository import FinanceAtomicRepository
from .postgres.repositories.gateway_state_repository import GatewayStateRepository
from .postgres.repositories.idempotency_repository import IdempotencyRepository
from .postgres.repositories.service_registry_repository import ServiceRegistryRepository
from src.domain.audit import AuditLogEntry
from src.domain.finance import BuyerChargeResult, DepositAttemptRow, DepositIntentRow, UsageLogRow

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional dependency at import time
    psycopg = None

_AUDIT_INSERT_SQL = (
    "INSERT INTO synapse_audit_log ("
    "action_type, business_type, risk_level, owner_address, actor, request_id, trace_id, tx_hash, "
    "counterparty_address, direction, status, risk_reason_code, ledger_id, client_ip, user_agent, "
    "amount_delta, before_balance, after_balance, result_status, error_code, message"
    ") VALUES ("
    "%s, %s::synapse_business_type, %s::synapse_risk_level, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s"
    ")"
)
_BALANCE_FOR_UPDATE_SQL = (
    "SELECT available_balance, pending_balance, frozen_balance "
    "FROM synapse_balances WHERE owner_address = %s AND account_type = %s FOR UPDATE"
)
_RISK_RESTRICTED_SESSION_STATUSES = ("restricted", "suspended", "blocked")

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
        if ensure_schema:
            self._validate_schema_contract()

        # -- Build repository set (inlined from former repository_factory.py) --
        q6 = _q6
        fee_policy = FeePolicyRepository(self._db, q6)
        idempotency = IdempotencyRepository(self._db)
        audit = AuditLogRepository(self._db, _AUDIT_INSERT_SQL)
        balance = BalanceRepository(self._db, q6, _BALANCE_UPSERT_SQL)
        service_registry = ServiceRegistryRepository(self._db)
        credential_auth = CredentialAuthRepository(self._db, q6)
        gateway_state = GatewayStateRepository(self._db, q6)
        deposit_attempts = DepositAttemptRepository(self._db, q6)
        finance_atomic = FinanceAtomicRepository(
            self._db,
            q6,
            _BALANCE_UPSERT_SQL,
            _BALANCE_FOR_UPDATE_SQL,
            _AUDIT_INSERT_SQL,
            _RISK_RESTRICTED_SESSION_STATUSES,
        )
        self._deposit_attempts = deposit_attempts
        self._data_manager = SynapseDataManager(
            uow=SynapseUnitOfWork(db=self._db),
            finance=FinanceDomain(
                balance=balance, atomic=finance_atomic, fee_policy=fee_policy
            ),
            system=SystemDomain(
                gateway_state=gateway_state,
                idempotency=idempotency,
                registry=service_registry,
                credential_auth=credential_auth,
            ),
            audit=AuditDomain(logs=audit),
        )

    def _validate_schema_contract(self) -> None:
        for contract in POSTGRES_TABLE_SCHEMA_CONTRACTS:
            self._validate_table_schema_contract(contract)

    def _validate_table_schema_contract(self, contract: TableSchemaContract) -> None:
        self._validate_required_columns(contract.table_name, set(contract.required_columns))
        self._validate_required_indexes(contract.table_name, set(contract.required_indexes))
        self._validate_required_constraints(contract)

    def _read_table_indexes(self, table_name: str) -> set[str]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename = %s
                """,
                (table_name,),
            )
            rows = cur.fetchall()
        return {str(row[0]).strip().lower() for row in rows if row and row[0]}

    def _read_table_constraint_definitions(self, table_name: str) -> List[str]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT pg_get_constraintdef(c.oid)
                FROM pg_constraint c
                INNER JOIN pg_class t ON t.oid = c.conrelid
                INNER JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = current_schema()
                  AND t.relname = %s
                """,
                (table_name,),
            )
            rows = cur.fetchall()
        return [str(row[0]).strip() for row in rows if row and row[0]]

    def _normalize_schema_text(self, value: str) -> str:
        return " ".join(str(value).strip().lower().split())

    def _validate_required_indexes(
        self, table_name: str, required_indexes: set[str]
    ) -> None:
        if not required_indexes:
            return
        actual = self._read_table_indexes(table_name)
        missing = sorted(index_name for index_name in required_indexes if index_name.lower() not in actual)
        if missing:
            raise RuntimeError(
                f"PostgreSQL schema mismatch: {table_name} is missing required indexes "
                f"{', '.join(missing)}. Reapply the bootstrap SQL in infra/docker/postgres/init/."
            )

    def _validate_required_constraints(self, contract: TableSchemaContract) -> None:
        if not contract.required_constraints:
            return
        actual_definitions = [
            self._normalize_schema_text(value)
            for value in self._read_table_constraint_definitions(contract.table_name)
        ]
        missing = []
        for required_constraint in contract.required_constraints:
            fragments = [
                self._normalize_schema_text(fragment)
                for fragment in required_constraint.required_fragments
            ]
            matched = any(
                all(fragment in definition for fragment in fragments)
                for definition in actual_definitions
            )
            if not matched:
                missing.append(required_constraint.description)
        if missing:
            raise RuntimeError(
                f"PostgreSQL schema mismatch: {contract.table_name} is missing required constraints "
                f"{', '.join(missing)}. Reapply the bootstrap SQL in infra/docker/postgres/init/."
            )

    def _validate_required_columns(
        self, table_name: str, required_columns: set[str]
    ) -> None:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = %s
                """,
                (table_name,),
            )
            rows = cur.fetchall()

        actual = {str(row[0]).strip().lower() for row in rows if row and row[0]}
        missing = sorted(required_columns - actual)
        if missing:
            raise RuntimeError(
                f"PostgreSQL schema mismatch: {table_name} is missing required columns "
                f"{', '.join(missing)}. "
                "Reapply the bootstrap SQL in infra/docker/postgres/init/."
            )

    def _connect(self):
        return psycopg.connect(self.dsn)

    def get_database_manager(self) -> DatabaseManager:
        return self._db

    def get_data_manager(self) -> SynapseDataManager:
        return self._data_manager

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
        return self._data_manager.finance.atomic.process_withdrawal_request_atomic(
            seller_address=seller_address,
            amount_usdc=amount_usdc,
            request_id=request_id,
            idempotency_key=idempotency_key,
            request_meta=request_meta,
            single_limit_usdc=single_limit_usdc,
            rolling_24h_limit_usdc=rolling_24h_limit_usdc,
            window_seconds=window_seconds,
            high_risk_override=high_risk_override,
            sign_ticket_factory=sign_ticket_factory,
        )

    def register_deposit_intent_atomic(
        self,
        owner_wallet: str,
        tx_hash: str,
        request_id: str,
        intent_row: DepositIntentRow,
    ) -> DepositIntentRow:
        return self._data_manager.finance.atomic.register_deposit_intent_atomic(
            owner_wallet, tx_hash, request_id, intent_row
        )

    def confirm_deposit_intent_atomic(
        self,
        owner_wallet: str,
        deposit_intent_id: str,
        event_key: str,
        confirmations: int,
    ) -> DepositIntentRow:
        return self._data_manager.finance.atomic.confirm_deposit_intent_atomic(
            owner_wallet, deposit_intent_id, event_key, confirmations
        )

    def record_deposit_attempt(
        self,
        attempt_row: DepositAttemptRow,
    ) -> DepositAttemptRow:
        return self._deposit_attempts.upsert_attempt(attempt_row)

    def charge_buyer_and_record_usage_atomic(
        self,
        *,
        owner_wallet: str,
        seller_wallet: str,
        total_charge: Decimal,
        seller_net: Decimal,
        platform_fee_total: Decimal,
        usage_row: UsageLogRow,
    ) -> BuyerChargeResult:
        return self._data_manager.finance.atomic.charge_buyer_and_record_usage_atomic(
            owner_wallet=owner_wallet,
            seller_wallet=seller_wallet,
            total_charge=total_charge,
            seller_net=seller_net,
            platform_fee_total=platform_fee_total,
            usage_row=usage_row,
        )

    def read_audit_rows(
        self, owner_wallet: Optional[str] = None, limit: int = 200
    ) -> List[AuditLogEntry]:
        return self._data_manager.audit.logs.read_audit_rows(
            owner_wallet=owner_wallet, limit=limit
        )
