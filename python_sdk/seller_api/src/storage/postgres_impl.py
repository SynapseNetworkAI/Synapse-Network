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
from .postgres.repositories.finance_atomic_repository import FinanceAtomicRepository
from .postgres.repositories.gateway_state_repository import GatewayStateRepository
from .postgres.repositories.idempotency_repository import IdempotencyRepository
from .postgres.repositories.legacy_collection_repository import LegacyCollectionRepository
from .postgres.repositories.service_registry_repository import ServiceRegistryRepository

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
        self._gateway_state_repo = GatewayStateRepository(self._db, _q6)
        self._finance_atomic_repo = FinanceAtomicRepository(
            self._db,
            _q6,
            _BALANCE_UPSERT_SQL,
            _BALANCE_FOR_UPDATE_SQL,
            _AUDIT_INSERT_SQL,
            _RISK_RESTRICTED_SESSION_STATUSES,
        )
        self._legacy_collection_repo = LegacyCollectionRepository(self._db, normalize_service_row, self._audit_repo)
        _ = ensure_schema

    def _connect(self):
        return psycopg.connect(self.dsn)

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
        return self._finance_atomic_repo.process_withdrawal_request_atomic(
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
        return self._finance_atomic_repo.register_deposit_intent_atomic(owner_wallet, tx_hash, request_id, intent_row)

    def confirm_deposit_intent_atomic(self, owner_wallet: str, deposit_intent_id: str, event_key: str, confirmations: int) -> Dict[str, Any]:
        return self._finance_atomic_repo.confirm_deposit_intent_atomic(owner_wallet, deposit_intent_id, event_key, confirmations)

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
        return self._finance_atomic_repo.charge_buyer_and_record_usage_atomic(
            owner_wallet=owner_wallet,
            seller_wallet=seller_wallet,
            total_charge=total_charge,
            seller_net=seller_net,
            platform_fee_total=platform_fee_total,
            usage_row=usage_row,
        )

    def reserve_seller_withdraw_atomic(self, owner_wallet: str, amount_usdc: Decimal) -> Dict[str, float]:
        return self._finance_atomic_repo.reserve_seller_withdraw_atomic(owner_wallet, amount_usdc)

    def complete_withdraw_tx_atomic(self, owner_wallet: str, tx_hash: str, kind: str) -> bool:
        return self._finance_atomic_repo.complete_withdraw_tx_atomic(owner_wallet, tx_hash, kind)

    def read_deposit_intents(self) -> List[Dict[str, Any]]:
        return self._gateway_state_repo.read_deposit_intents()

    def write_deposit_intents(self, rows: List[Dict[str, Any]]) -> None:
        self._gateway_state_repo.write_deposit_intents(rows)

    def read_refund_intents(self) -> List[Dict[str, Any]]:
        return self._gateway_state_repo.read_refund_intents()

    def write_refund_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._gateway_state_repo.write_refund_intents(rows, updated_at)

    def read_withdrawal_intents(self) -> List[Dict[str, Any]]:
        return self._gateway_state_repo.read_withdrawal_intents()

    def write_withdrawal_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._gateway_state_repo.write_withdrawal_intents(rows, updated_at)

    def read_balance_ledger(self) -> Dict[str, Any]:
        return self._balance_repo.read_balance_ledger()

    def write_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        self._balance_repo.write_balance_ledger(ledger)

    def read_router_config_rows(self) -> List[Dict[str, Any]]:
        return self._gateway_state_repo.read_router_config_rows()

    def write_router_config_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._gateway_state_repo.write_router_config_rows(rows, updated_at)

    def read_usage_log_rows(self) -> List[Dict[str, Any]]:
        return self._gateway_state_repo.read_usage_log_rows()

    def write_usage_log_rows(self, rows: List[Dict[str, Any]]) -> None:
        self._gateway_state_repo.write_usage_log_rows(rows)

    def append_audit_row(self, row: Dict[str, Any]) -> None:
        self._audit_repo.append_audit_row(row)

    def read_processed_deposit_event_keys(self) -> List[str]:
        return self._gateway_state_repo.read_processed_deposit_event_keys()

    def write_processed_deposit_event_keys(self, keys: List[str], updated_at: int) -> None:
        self._gateway_state_repo.write_processed_deposit_event_keys(keys, updated_at)

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
        return self._legacy_collection_repo.get_collection(collection_name)

    def save_collection(self, collection_name: str, data: Union[List[Any], Dict[str, Any]]) -> None:
        self._legacy_collection_repo.save_collection(collection_name, data)

    def append_to_collection(self, collection_name: str, item: Any) -> None:
        self._legacy_collection_repo.append_to_collection(collection_name, item)

    def read_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        return self._audit_repo.read_audit_rows(owner_wallet=owner_wallet, limit=limit)