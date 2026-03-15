# pyright: reportMissingImports=false

import copy
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Union

import pytest

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "gateway"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src.storage.base import BaseStorage  # noqa: E402
from src.storage.normalizers import normalize_service_row  # noqa: E402
from src.storage.base import (  # noqa: E402
    AuditDomain,
    FinanceDomain,
    SynapseDataManager,
    SynapseUnitOfWork,
    SystemDomain,
)
from src.domain.finance import BalanceLedger, FeePolicyEntity  # noqa: E402
from src.domain.audit import AuditLogEntry  # noqa: E402
from src.domain.gateway import RouterConfigRow  # noqa: E402
from src.domain.idempotency import IdempotencyRow, RateLimitRow  # noqa: E402
from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory  # noqa: E402
from src.domain.storage_entities import AuthSessionRow, DepositIntentRow  # noqa: E402


class InMemoryStorage(BaseStorage):
    def __init__(self):
        self._collections: Dict[str, Union[List[Any], Dict[str, Any]]] = {}
        self._data_manager = SynapseDataManager(
            uow=SynapseUnitOfWork(db=self),
            finance=FinanceDomain(
                balance=self,
                atomic=self,
                fee_policy=self,
            ),
            system=SystemDomain(
                gateway_state=self,
                idempotency=self,
                registry=self,
                credential_auth=self,
            ),
            audit=AuditDomain(logs=self),
        )

    def get_data_manager(self) -> SynapseDataManager:
        return self._data_manager

    def tx_cursor(self):
        raise NotImplementedError("tx_cursor not supported in InMemoryStorage test double")

    def readonly_cursor(self):
        raise NotImplementedError("readonly_cursor not supported in InMemoryStorage test double")

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

    def _wrap_payload(self, collection_name: str, data: Union[List[Any], Dict[str, Any]]) -> Union[List[Any], Dict[str, Any]]:
        if collection_name == "service_registry" and isinstance(data, list):
            return {"services": data, "updatedAt": int(time.time())}
        if collection_name == "agent_registry" and isinstance(data, list):
            return {"agents": data, "updatedAt": int(time.time())}
        return data

    def get_collection(self, collection_name: str) -> Union[List[Any], Dict[str, Any]]:
        value = self._collections.get(collection_name)
        if value is None:
            return copy.deepcopy(self._default_collection(collection_name))

        payload = copy.deepcopy(value)
        if isinstance(payload, dict):
            if collection_name == "service_registry" and "services" in payload and isinstance(payload["services"], list):
                return [normalize_service_row(item) for item in payload["services"]]
            if collection_name == "agent_registry" and isinstance(payload.get("agents"), list):
                return payload["agents"]
            if collection_name == "deposit_intents" and isinstance(payload.get("intents"), list):
                return payload["intents"]
            if collection_name == "usage_log" and isinstance(payload.get("logs"), list):
                return payload["logs"]
        return payload

    def save_collection(self, collection_name: str, data: Union[List[Any], Dict[str, Any]]) -> None:
        self._collections[collection_name] = copy.deepcopy(self._wrap_payload(collection_name, data))

    def append_to_collection(self, collection_name: str, item: Any) -> None:
        current = self.get_collection(collection_name)
        if isinstance(current, list):
            current.append(copy.deepcopy(item))
            self.save_collection(collection_name, current)
            return

        existing = self._collections.get(collection_name)
        if isinstance(existing, dict) and isinstance(existing.get("rows"), list):
            next_value = copy.deepcopy(existing)
            next_value["rows"].append(copy.deepcopy(item))
            next_value["updatedAt"] = int(time.time())
            self._collections[collection_name] = next_value
            return

        self._collections[collection_name] = [copy.deepcopy(item)]

    # Typed APIs used by postgres-backed runtime paths.
    def read_deposit_intents(self) -> List[Dict[str, Any]]:
        rows = self.get_collection("deposit_intents")
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def write_deposit_intents(self, rows: List[Dict[str, Any]]) -> None:
        serialized = [
            row.model_dump(by_alias=True, mode="json") if isinstance(row, DepositIntentRow) else row
            for row in rows
        ]
        self.save_collection("deposit_intents", serialized)

    def read_refund_intents(self) -> List[Dict[str, Any]]:
        rows = self.get_collection("refund_intents")
        if isinstance(rows, dict):
            rows = rows.get("rows")
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def write_refund_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self.save_collection("refund_intents", {"rows": rows, "updatedAt": int(updated_at)})

    def read_withdrawal_intents(self) -> List[Dict[str, Any]]:
        rows = self.get_collection("provider_withdrawal_intents")
        if isinstance(rows, dict):
            rows = rows.get("rows")
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def write_withdrawal_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self.save_collection("provider_withdrawal_intents", {"rows": rows, "updatedAt": int(updated_at)})

    def read_balance_ledger(self) -> BalanceLedger:
        raw = self.get_collection("balance_ledger")
        if isinstance(raw, dict):
            return BalanceLedger.model_validate(raw)
        return BalanceLedger()

    def write_balance_ledger(self, ledger: BalanceLedger) -> None:
        self.save_collection("balance_ledger", ledger.model_dump(by_alias=True))

    def read_router_config_rows(self) -> List[RouterConfigRow]:
        raw = self.get_collection("router_config")
        if isinstance(raw, dict):
            raw = raw.get("rows")
        rows = [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []
        return [RouterConfigRow.model_validate(r) for r in rows]

    def write_router_config_rows(self, rows: List, updated_at: int) -> None:
        serialized = [r.model_dump(by_alias=True) if isinstance(r, RouterConfigRow) else r for r in rows]
        self.save_collection("router_config", {"rows": serialized, "updatedAt": int(updated_at)})

    def read_usage_log_rows(self) -> List[Dict[str, Any]]:
        raw = self.get_collection("usage_log")
        return [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []

    def write_usage_log_rows(self, rows: List[Dict[str, Any]]) -> None:
        self.save_collection("usage_log", rows)

    def append_audit_row(self, entry: Any) -> None:
        if isinstance(entry, AuditLogEntry):
            target = "system_audit_log" if str(entry.domain or "finance") == "system" else "audit_log"
            self.append_to_collection(target, entry.model_dump(by_alias=True))
            return
        self.append_to_collection("audit_log", entry)

    def read_audit_rows(self, owner_wallet: str = "", limit: int = 200) -> List[AuditLogEntry]:
        raw = self.get_collection("audit_log")
        rows = [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []
        if owner_wallet:
            from src.core.common import normalize_wallet
            normalized = normalize_wallet(owner_wallet)
            rows = [r for r in rows if normalize_wallet(str(r.get("ownerAddress", ""))) == normalized]
        entries = [AuditLogEntry.model_validate(r) for r in rows]
        entries.sort(key=lambda e: e.timestamp, reverse=True)
        return entries[:max(1, min(limit, 1000))]

    def read_system_audit_rows(self, owner_wallet: str = "", limit: int = 200) -> List[AuditLogEntry]:
        raw = self.get_collection("system_audit_log")
        rows = [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []
        if owner_wallet:
            from src.core.common import normalize_wallet
            normalized = normalize_wallet(owner_wallet)
            rows = [r for r in rows if normalize_wallet(str(r.get("ownerAddress", ""))) == normalized]
        entries = [AuditLogEntry.model_validate(r) for r in rows]
        entries.sort(key=lambda e: e.timestamp, reverse=True)
        return entries[:max(1, min(limit, 1000))]

    def read_processed_deposit_event_keys(self) -> List[str]:
        raw = self.get_collection("deposit_event_processed")
        if isinstance(raw, dict):
            raw = raw.get("keys")
        return [str(item) for item in raw] if isinstance(raw, list) else []

    def write_processed_deposit_event_keys(self, keys: List[str], updated_at: int) -> None:
        self.save_collection("deposit_event_processed", {"keys": keys, "updatedAt": int(updated_at)})

    def read_service_registry_rows(self) -> List[Dict[str, Any]]:
        raw = self.get_collection("service_registry")
        return [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []

    def write_service_registry_rows(self, rows: List[Dict[str, Any]]) -> None:
        self.save_collection("service_registry", rows)

    def read_service_target_health_rows(self) -> List[ServiceTargetHealth]:
        raw = self.get_collection("service_target_health")
        rows = [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []
        return [ServiceTargetHealth.model_validate(r) for r in rows]

    def write_service_target_health_rows(self, rows: List) -> None:
        serialized = [r.model_dump(by_alias=True) if isinstance(r, ServiceTargetHealth) else r for r in rows]
        self.save_collection("service_target_health", serialized)

    def read_service_target_health_history_rows(self) -> List[ServiceTargetHealthHistory]:
        raw = self.get_collection("service_target_health_history")
        rows = [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []
        return [ServiceTargetHealthHistory.model_validate(r) for r in rows]

    def write_service_target_health_history_rows(self, rows: List) -> None:
        serialized = [r.model_dump(by_alias=True) if isinstance(r, ServiceTargetHealthHistory) else r for r in rows]
        self.save_collection("service_target_health_history", serialized)

    def read_credential_rows(self, credential_type: str) -> List[Dict[str, Any]]:
        if credential_type == "seller":
            raw = self.get_collection("seller_secrets")
        else:
            raw = self.get_collection("buyer_credentials")
        rows = raw.get("credentials") if isinstance(raw, dict) else raw
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def write_credential_rows(self, credential_type: str, rows: List[Dict[str, Any]]) -> None:
        payload = {"credentials": rows, "updatedAt": int(time.time())}
        if credential_type == "seller":
            self.save_collection("seller_secrets", payload)
        else:
            self.save_collection("buyer_credentials", payload)

    def get_wallet_role(self, wallet: str) -> Union[str, None]:
        roles = self.get_collection("wallet_roles")
        return roles.get(wallet) if isinstance(roles, dict) else None

    def set_wallet_role(self, wallet: str, role: str) -> None:
        roles = self.get_collection("wallet_roles")
        if not isinstance(roles, dict):
            roles = {}
        roles[wallet] = role
        self.save_collection("wallet_roles", roles)

    def upsert_auth_session(self, wallet: str, registered_at: int, last_login: int, status: str) -> None:
        rows = self.get_collection("auth_sessions")
        if not isinstance(rows, dict):
            rows = {}
        rows[wallet] = {
            "registered_at": int(registered_at),
            "last_login": int(last_login),
            "status": str(status),
        }
        self.save_collection("auth_sessions", rows)

    def read_auth_session(self, wallet: str) -> Union[AuthSessionRow, None]:
        rows = self.get_collection("auth_sessions")
        if not isinstance(rows, dict):
            return None
        payload = rows.get(str(wallet or "").lower())
        if not isinstance(payload, dict):
            return None
        return AuthSessionRow(
            walletAddress=str(wallet or "").lower(),
            registeredAt=int(payload.get("registered_at") or 0),
            lastLogin=int(payload.get("last_login") or 0),
            status=str(payload.get("status") or ""),
            updatedAt=str(payload.get("updated_at") or ""),
        )

    def save_auth_session(self, row: AuthSessionRow) -> None:
        self.upsert_auth_session(
            wallet=row.wallet_address,
            registered_at=int(row.registered_at),
            last_login=int(row.last_login),
            status=str(row.status or "active"),
        )

    def read_runtime_state(self, state_key: str) -> Dict[str, Any]:
        raw = self.get_collection("runtime_state")
        if not isinstance(raw, dict):
            return {}
        payload = raw.get(str(state_key or ""))
        return dict(payload) if isinstance(payload, dict) else {}

    def write_runtime_state(self, state_key: str, payload: Dict[str, Any]) -> None:
        key = str(state_key or "").strip()
        if not key:
            return
        raw = self.get_collection("runtime_state")
        current = dict(raw) if isinstance(raw, dict) else {}
        current[key] = dict(payload or {})
        self.save_collection("runtime_state", current)

    def get_platform_fee_policy(self) -> FeePolicyEntity:
        raw = self.get_collection("platform_fee_policy")
        if isinstance(raw, dict) and raw:
            return FeePolicyEntity.model_validate(raw)
        return FeePolicyEntity()

    def set_platform_fee_policy(self, default_rate: float, owner_rates: Dict[str, Any], updated_by: str, updated_at: int) -> None:
        self.save_collection(
            "platform_fee_policy",
            {
                "defaultRate": float(default_rate),
                "ownerRates": dict(owner_rates or {}),
                "updatedAt": int(updated_at),
                "updatedBy": str(updated_by or ""),
            },
        )

    def read_idempotency_rows(self) -> List[IdempotencyRow]:
        raw = self.get_collection("idempotency_keys")
        if isinstance(raw, dict):
            raw = raw.get("rows")
        rows = [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []
        return [IdempotencyRow.model_validate(r) for r in rows]

    def write_idempotency_rows(self, rows: List, updated_at: int) -> None:
        serialized = [r.model_dump(by_alias=True) if isinstance(r, IdempotencyRow) else r for r in rows]
        self.save_collection("idempotency_keys", {"rows": serialized, "updatedAt": int(updated_at)})

    def read_rate_limit_rows(self) -> List[RateLimitRow]:
        raw = self.get_collection("finance_write_rate_limit")
        if isinstance(raw, dict):
            raw = raw.get("rows")
        rows = [row for row in raw if isinstance(row, dict)] if isinstance(raw, list) else []
        return [RateLimitRow.model_validate(r) for r in rows]

    def write_rate_limit_rows(self, rows: List, updated_at: int) -> None:
        serialized = [r.model_dump(by_alias=True) if isinstance(r, RateLimitRow) else r for r in rows]
        self.save_collection("finance_write_rate_limit", {"rows": serialized, "updatedAt": int(updated_at)})


@pytest.fixture()
def temp_storage():
    return InMemoryStorage()
