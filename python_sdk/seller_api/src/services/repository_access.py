from __future__ import annotations

from typing import Any, Dict, List, Optional

from src.storage import BaseStorage


class _GatewayStateAdapter:
    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def read_deposit_intents(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_deposit_intents")()

    def write_deposit_intents(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_deposit_intents")(rows)

    def read_refund_intents(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_refund_intents")()

    def write_refund_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        getattr(self._storage, "write_refund_intents")(rows, updated_at)

    def read_withdrawal_intents(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_withdrawal_intents")()

    def write_withdrawal_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        getattr(self._storage, "write_withdrawal_intents")(rows, updated_at)

    def read_router_config_rows(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_router_config_rows")()

    def write_router_config_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        getattr(self._storage, "write_router_config_rows")(rows, updated_at)

    def read_usage_log_rows(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_usage_log_rows")()

    def write_usage_log_rows(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_usage_log_rows")(rows)

    def read_processed_deposit_event_keys(self) -> List[str]:
        return getattr(self._storage, "read_processed_deposit_event_keys")()

    def write_processed_deposit_event_keys(self, keys: List[str], updated_at: int) -> None:
        getattr(self._storage, "write_processed_deposit_event_keys")(keys, updated_at)


class _BalanceAdapter:
    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def read_balance_ledger(self) -> Dict[str, Any]:
        return getattr(self._storage, "read_balance_ledger")()

    def write_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        getattr(self._storage, "write_balance_ledger")(ledger)


class _AuditAdapter:
    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def append_audit_row(self, row: Dict[str, Any]) -> None:
        getattr(self._storage, "append_audit_row")(row)

    def read_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_audit_rows")(owner_wallet=owner_wallet, limit=limit)


class _ServiceRegistryAdapter:
    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def read_service_registry_rows(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_service_registry_rows")()

    def write_service_registry_rows(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_service_registry_rows")(rows)

    def read_service_target_health_rows(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_service_target_health_rows")()

    def write_service_target_health_rows(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_service_target_health_rows")(rows)

    def read_service_target_health_history_rows(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_service_target_health_history_rows")()

    def write_service_target_health_history_rows(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_service_target_health_history_rows")(rows)


class _CredentialAuthAdapter:
    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def read_credential_rows(self, credential_type: str) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_credential_rows")(credential_type)

    def write_credential_rows(self, credential_type: str, rows: List[Dict[str, Any]]) -> None:
        getattr(self._storage, "write_credential_rows")(credential_type, rows)

    def get_wallet_role(self, wallet: str) -> Optional[str]:
        return getattr(self._storage, "get_wallet_role")(wallet)

    def set_wallet_role(self, wallet: str, role: str) -> None:
        getattr(self._storage, "set_wallet_role")(wallet, role)

    def upsert_auth_session(self, wallet: str, registered_at: int, last_login: int, status: str) -> None:
        getattr(self._storage, "upsert_auth_session")(wallet, registered_at, last_login, status)


class _FeePolicyAdapter:
    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def get_platform_fee_policy(self) -> Dict[str, Any]:
        return getattr(self._storage, "get_platform_fee_policy")()

    def set_platform_fee_policy(self, default_rate: float, owner_rates: Dict[str, Any], updated_by: str, updated_at: int) -> None:
        getattr(self._storage, "set_platform_fee_policy")(default_rate, owner_rates, updated_by, updated_at)


class _IdempotencyAdapter:
    def __init__(self, storage: BaseStorage):
        self._storage = storage

    def read_idempotency_rows(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_idempotency_rows")()

    def write_idempotency_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        getattr(self._storage, "write_idempotency_rows")(rows, updated_at)

    def read_rate_limit_rows(self) -> List[Dict[str, Any]]:
        return getattr(self._storage, "read_rate_limit_rows")()

    def write_rate_limit_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        getattr(self._storage, "write_rate_limit_rows")(rows, updated_at)


def gateway_state_repo(storage: BaseStorage) -> Any:
    repo = getattr(storage, "_gateway_state_repo", None)
    return repo if repo is not None else _GatewayStateAdapter(storage)


def balance_repo(storage: BaseStorage) -> Any:
    repo = getattr(storage, "_balance_repo", None)
    return repo if repo is not None else _BalanceAdapter(storage)


def audit_repo(storage: BaseStorage) -> Any:
    repo = getattr(storage, "_audit_repo", None)
    return repo if repo is not None else _AuditAdapter(storage)


def service_registry_repo(storage: BaseStorage) -> Any:
    repo = getattr(storage, "_service_registry_repo", None)
    return repo if repo is not None else _ServiceRegistryAdapter(storage)


def credential_auth_repo(storage: BaseStorage) -> Any:
    repo = getattr(storage, "_credential_auth_repo", None)
    return repo if repo is not None else _CredentialAuthAdapter(storage)


def fee_policy_repo(storage: BaseStorage) -> Any:
    repo = getattr(storage, "_fee_policy_repo", None)
    return repo if repo is not None else _FeePolicyAdapter(storage)


def idempotency_repo(storage: BaseStorage) -> Any:
    repo = getattr(storage, "_idempotency_repo", None)
    return repo if repo is not None else _IdempotencyAdapter(storage)
