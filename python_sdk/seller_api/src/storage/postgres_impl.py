from typing import Any, Callable, Dict, List, Optional, Union
from decimal import Decimal, ROUND_HALF_UP

from .base import BaseStorage
from .repository_provider import SynapseDataManager
from .postgres.database_manager import DatabaseManager
from .postgres.repository_factory import build_postgres_repository_set
from src.domain.audit import AuditLogEntry

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional dependency at import time
    psycopg = None

_AUDIT_INSERT_SQL = "INSERT INTO synapse_audit_log (collection_name, payload) VALUES (%s, %s::jsonb)"
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
        repositories = build_postgres_repository_set(
            self._db,
            quantize6=_q6,
            balance_upsert_sql=_BALANCE_UPSERT_SQL,
            balance_for_update_sql=_BALANCE_FOR_UPDATE_SQL,
            audit_insert_sql=_AUDIT_INSERT_SQL,
            risk_restricted_statuses=_RISK_RESTRICTED_SESSION_STATUSES,
        )
        self._data_manager = repositories.data_manager
        self._legacy_collection_repo = repositories.legacy_collection
        _ = ensure_schema

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

    def register_deposit_intent_atomic(self, owner_wallet: str, tx_hash: str, request_id: str, intent_row: Dict[str, Any]) -> Dict[str, Any]:
        return self._data_manager.finance.atomic.register_deposit_intent_atomic(owner_wallet, tx_hash, request_id, intent_row)

    def confirm_deposit_intent_atomic(self, owner_wallet: str, deposit_intent_id: str, event_key: str, confirmations: int) -> Dict[str, Any]:
        return self._data_manager.finance.atomic.confirm_deposit_intent_atomic(owner_wallet, deposit_intent_id, event_key, confirmations)

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
        return self._data_manager.finance.atomic.charge_buyer_and_record_usage_atomic(
            owner_wallet=owner_wallet,
            seller_wallet=seller_wallet,
            total_charge=total_charge,
            seller_net=seller_net,
            platform_fee_total=platform_fee_total,
            usage_row=usage_row,
        )

    def get_collection(self, collection_name: str) -> Union[List[Any], Dict[str, Any]]:
        return self._legacy_collection_repo.get_collection(collection_name)

    def save_collection(self, collection_name: str, data: Union[List[Any], Dict[str, Any]]) -> None:
        self._legacy_collection_repo.save_collection(collection_name, data)

    def append_to_collection(self, collection_name: str, item: Any) -> None:
        self._legacy_collection_repo.append_to_collection(collection_name, item)

    def read_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[AuditLogEntry]:
        return self._data_manager.audit.logs.read_audit_rows(owner_wallet=owner_wallet, limit=limit)