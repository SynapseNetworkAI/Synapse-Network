# ruff: noqa: TRY003
from typing import Any, List, Optional
from decimal import Decimal, ROUND_HALF_UP

from .base import (
    AuditDomain,
    BaseStorage,
    FinanceDomain,
    SynapseDataManager,
    SynapseUnitOfWork,
    SystemDomain,
)
from .postgres.database_manager import DatabaseManager, normalize_pool_max
from .postgres.schema_contracts import (
    POSTGRES_TABLE_SCHEMA_CONTRACTS,
    TableSchemaContract,
)
from .postgres.repositories.audit_log_repository import AuditLogRepository
from .postgres.repositories.analytics_outbox_repository import AnalyticsOutboxRepository
from .postgres.repositories.balance_repository import BalanceRepository
from .postgres.repositories.business_policy_repository import BusinessPolicyRepository
from .postgres.repositories.credential_auth_repository import CredentialAuthRepository
from .postgres.repositories.deposit_attempt_repository import DepositAttemptRepository
from .postgres.repositories.execution_repository import ExecutionRepository
from .postgres.repositories.fee_policy_repository import FeePolicyRepository
from .postgres.repositories.finance_atomic_repository import FinanceAtomicRepository
from .postgres.repositories.gateway_state_repository import GatewayStateRepository
from .postgres.repositories.idempotency_repository import IdempotencyRepository
from .postgres.repositories.in_app_notification_repository import InAppNotificationRepository
from .postgres.repositories.notification_outbox_repository import NotificationOutboxRepository
from .postgres.repositories.service_registry_repository import ServiceRegistryRepository
from src.services.notifications.models import NotificationIntent
from src.domain.audit import AuditLogEntry
from src.domain.execution import (
    CompleteWithdrawTxCommand,
    DepositIntentConfirmCommand,
    DepositIntentRegisterCommand,
    ReserveProviderWithdrawCommand,
    WithdrawalAtomicRequestCommand,
    WithdrawalDecision,
)
from src.domain.finance import (
    BalanceMutationResult,
    ChargeConsumerUsageCommand,
    ConsumerChargeResult,
    DepositAttemptRow,
    SettleConsumerHoldUsageCommand,
)
from src.domain.ledger import DepositIntentRow
from src.domain.voucher import VoucherRedeemCommand, VoucherRedemptionResult

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional dependency at import time
    psycopg = None

_AUDIT_INSERT_SQL = (
    "INSERT INTO synapse_audit_events ("
    "event_id, event_type, business_type, owner_id, amount_delta, result_status, error_code, detail_json"
    ") VALUES ("
    "%s, %s, %s, %s, %s, %s, %s, %s::jsonb"
    ")"
)
_BALANCE_FOR_UPDATE_SQL = (
    "SELECT available_balance, pending_balance, frozen_balance "
    "FROM synapse_account_balances WHERE account_id = %s FOR UPDATE"
)
_RISK_RESTRICTED_SESSION_STATUSES = ("restricted", "suspended", "blocked")

_BALANCE_UPSERT_SQL = """
INSERT INTO synapse_account_balances (
    account_id,
    available_balance,
    pending_balance,
    frozen_balance,
    updated_at
) VALUES (%s, %s, %s, %s, %s)
ON CONFLICT (account_id)
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
    def __init__(
        self,
        dsn: str,
        ensure_schema: bool = True,
        connect_timeout_sec: int = 5,
        pool_max: int = 5,
        pool_timeout_sec: float = 5.0,
        pool_max_lifetime_sec: float = 1800.0,
        pool_max_idle_sec: float = 300.0,
    ):
        if psycopg is None:
            raise RuntimeError(
                "psycopg is not installed. Install dependency 'psycopg[binary]' before using PostgreSQL storage."
            )
        if not dsn.strip():
            raise RuntimeError("POSTGRES_DSN is required when STORAGE_BACKEND=postgres")

        self.dsn = dsn.strip()
        self._connect_timeout_sec = max(1, int(connect_timeout_sec or 5))
        self._db = DatabaseManager(
            self._connect,
            dsn=self.dsn,
            pool_max=normalize_pool_max(5 if pool_max in (None, "") else pool_max),
            pool_timeout_sec=pool_timeout_sec,
            pool_max_lifetime_sec=pool_max_lifetime_sec,
            pool_max_idle_sec=pool_max_idle_sec,
            connection_kwargs={
                "connect_timeout": self._connect_timeout_sec,
                "application_name": "synapse-gateway",
            },
        )
        if ensure_schema:
            self._validate_schema_contract()

        # -- Build repository set (inlined from former repository_factory.py) --
        q6 = _q6
        business_policy = BusinessPolicyRepository(self._db, q6)
        fee_policy = FeePolicyRepository(self._db, q6)
        idempotency = IdempotencyRepository(self._db)
        audit = AuditLogRepository(self._db, _AUDIT_INSERT_SQL)
        balance = BalanceRepository(self._db, q6, _BALANCE_UPSERT_SQL)
        service_registry = ServiceRegistryRepository(self._db)
        execution = ExecutionRepository(self._db)
        credential_auth = CredentialAuthRepository(self._db, q6)
        gateway_state = GatewayStateRepository(self._db, q6)
        analytics_outbox = AnalyticsOutboxRepository(self._db)
        notification_outbox = NotificationOutboxRepository(self._db)
        in_app_notifications = InAppNotificationRepository(self._db)
        deposit_attempts = DepositAttemptRepository(self._db, q6)
        finance_atomic = FinanceAtomicRepository(
            self._db,
            q6,
            _BALANCE_UPSERT_SQL,
            _BALANCE_FOR_UPDATE_SQL,
            _AUDIT_INSERT_SQL,
            _RISK_RESTRICTED_SESSION_STATUSES,
            business_policy_repository=business_policy,
        )
        self._deposit_attempts = deposit_attempts
        self.analytics_outbox = analytics_outbox
        self.notification_outbox = notification_outbox
        self.in_app_notifications = in_app_notifications
        self._data_manager = SynapseDataManager(
            uow=SynapseUnitOfWork(db=self._db),
            finance=FinanceDomain(
                balance=balance,
                atomic=finance_atomic,
                fee_policy=fee_policy,
                business_policy=business_policy,
            ),
            system=SystemDomain(
                gateway_state=gateway_state,
                idempotency=idempotency,
                registry=service_registry,
                credential_auth=credential_auth,
                execution=execution,
                in_app_notifications=in_app_notifications,
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
                f"{', '.join(missing)}. Reapply the bootstrap SQL in docker-compose/postgres/init/."
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
                f"{', '.join(missing)}. Reapply the bootstrap SQL in docker-compose/postgres/init/."
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
                "Reapply the bootstrap SQL in docker-compose/postgres/init/."
            )

    def _connect(self):
        if psycopg is None:
            raise RuntimeError("psycopg is not installed")
        return psycopg.connect(
            self.dsn,
            connect_timeout=self._connect_timeout_sec,
            application_name="synapse-gateway",
        )

    def get_database_manager(self) -> DatabaseManager:
        return self._db

    def close(self) -> None:
        self._db.close()

    def get_data_manager(self) -> SynapseDataManager:
        return self._data_manager

    def enqueue_analytics_outbox_event(self, event: dict[str, Any]) -> None:
        self.analytics_outbox.enqueue_event(event)

    def claim_analytics_outbox_batch(self, batch_size: int):
        return self.analytics_outbox.claim_batch(batch_size)

    def delete_sent_analytics_outbox_rows(self, lease_id: str, row_ids: list[int]) -> None:
        self.analytics_outbox.delete_sent(lease_id, row_ids)

    def mark_analytics_outbox_retry(
        self,
        lease_id: str,
        row: Any,
        *,
        error: str,
        max_attempts: int,
        retry_base_sec: int,
    ) -> None:
        self.analytics_outbox.mark_retry(
            lease_id,
            row,
            error=error,
            max_attempts=max_attempts,
            retry_base_sec=retry_base_sec,
        )

    def read_analytics_outbox_stats(self) -> dict[str, int | str | None]:
        return self.analytics_outbox.stats()

    def enqueue_notification_outbox(self, intent: NotificationIntent) -> None:
        self.notification_outbox.enqueue(intent)

    def claim_notification_outbox_batch(self, batch_size: int):
        return self.notification_outbox.claim_batch(batch_size)

    def record_sent_notification_and_delete(
        self,
        lease_id: str,
        row: Any,
        *,
        message_id: str | None,
        provider_response: dict[str, Any],
    ) -> None:
        self.notification_outbox.record_sent_and_delete(
            lease_id,
            row,
            message_id=message_id,
            provider_response=provider_response,
        )

    def mark_notification_outbox_retry(
        self,
        lease_id: str,
        row: Any,
        *,
        error: str,
        max_attempts: int,
        retry_base_sec: int,
    ) -> None:
        self.notification_outbox.mark_retry(
            lease_id,
            row,
            error=error,
            max_attempts=max_attempts,
            retry_base_sec=retry_base_sec,
        )

    def read_notification_delivery_count_today(self) -> int:
        return self.notification_outbox.delivery_count_today()

    def read_notification_outbox_stats(self) -> dict[str, int | str | None]:
        return self.notification_outbox.stats()

    def enqueue_in_app_notification(self, intent: Any) -> None:
        self.in_app_notifications.enqueue(intent)

    def list_in_app_notifications(
        self,
        *,
        owner_wallet: str,
        limit: int,
        cursor: str | None,
        unread_only: bool,
    ):
        return self.in_app_notifications.list_for_owner(
            owner_wallet=owner_wallet,
            limit=limit,
            cursor=cursor,
            unread_only=unread_only,
        )

    def read_in_app_notification_unread_count(self, *, owner_wallet: str) -> int:
        return self.in_app_notifications.unread_count_for_owner(owner_wallet=owner_wallet)

    def mark_in_app_notification_read(self, *, owner_wallet: str, notification_id: str) -> bool:
        return self.in_app_notifications.mark_read_for_owner(
            owner_wallet=owner_wallet,
            notification_id=notification_id,
        )

    def mark_all_in_app_notifications_read(self, *, owner_wallet: str) -> int:
        return self.in_app_notifications.mark_all_read_for_owner(owner_wallet=owner_wallet)

    def archive_in_app_notification(self, *, owner_wallet: str, notification_id: str) -> bool:
        return self.in_app_notifications.archive_for_owner(
            owner_wallet=owner_wallet,
            notification_id=notification_id,
        )

    def cleanup_in_app_notifications(
        self,
        *,
        retention_days: int,
        security_retention_days: int,
        batch_size: int,
    ) -> int:
        return self.in_app_notifications.cleanup_expired(
            retention_days=retention_days,
            security_retention_days=security_retention_days,
            batch_size=batch_size,
        )

    def process_withdrawal_request_atomic(
        self,
        command: WithdrawalAtomicRequestCommand,
    ) -> WithdrawalDecision:
        return self._data_manager.finance.atomic.process_withdrawal_request_atomic(command)

    def register_deposit_intent_atomic(
        self, command: DepositIntentRegisterCommand,
    ) -> DepositIntentRow:
        return self._data_manager.finance.atomic.register_deposit_intent_atomic(command)

    def confirm_deposit_intent_atomic(
        self, command: DepositIntentConfirmCommand,
    ) -> DepositIntentRow:
        return self._data_manager.finance.atomic.confirm_deposit_intent_atomic(command)

    def complete_withdraw_tx_atomic(self, command: CompleteWithdrawTxCommand) -> bool:
        return self._data_manager.finance.atomic.complete_withdraw_tx_atomic(command)

    def record_deposit_attempt(
        self,
        attempt_row: DepositAttemptRow,
    ) -> DepositAttemptRow:
        return self._deposit_attempts.upsert_attempt(attempt_row)

    def charge_consumer_and_record_usage_atomic(
        self,
        command: ChargeConsumerUsageCommand,
    ) -> ConsumerChargeResult:
        return self._data_manager.finance.atomic.charge_consumer_and_record_usage_atomic(
            command
        )

    def settle_consumer_llm_hold_atomic(
        self,
        command: SettleConsumerHoldUsageCommand,
    ) -> ConsumerChargeResult:
        return self._data_manager.finance.atomic.settle_consumer_llm_hold_atomic(
            command
        )

    def reserve_provider_withdraw_atomic(
        self, command: ReserveProviderWithdrawCommand
    ) -> BalanceMutationResult:
        return self._data_manager.finance.atomic.reserve_provider_withdraw_atomic(command)

    def redeem_credit_voucher_atomic(
        self, command: VoucherRedeemCommand
    ) -> VoucherRedemptionResult:
        return self._data_manager.finance.atomic.redeem_credit_voucher_atomic(command)

    def read_audit_rows(
        self, owner_wallet: Optional[str] = None, limit: int = 200
    ) -> List[AuditLogEntry]:
        return self._data_manager.audit.logs.read_audit_rows(
            owner_wallet=owner_wallet, limit=limit
        )
