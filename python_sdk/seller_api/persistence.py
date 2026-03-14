import json
import os
import time
from typing import Any, Dict, List
from uuid import uuid4

from src.core.common import normalize_wallet
from .settings import (
    AGENT_CREDENTIALS_PATH,
    AGENT_REGISTRY_PATH,
    AUDIT_LOG_PATH,
    BALANCE_LEDGER_PATH,
    DEPOSIT_EVENT_CURSOR_PATH,
    DEPOSIT_EVENT_PROCESSED_PATH,
    DEPOSIT_INTENTS_PATH,
    REFUND_INTENTS_PATH,
    ROUTER_CONFIG_PATH,
    SERVICE_REGISTRY_PATH,
    USAGE_LOG_PATH,
    PROVIDER_SECRETS_PATH,
)


def _read_json(path: str, default: Any) -> Any:
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except Exception:
        return default


def _write_json_atomic(path: str, payload: Any) -> None:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    temp_path = f"{path}.tmp.{uuid4().hex}"
    with open(temp_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    os.replace(temp_path, path)


def _extract_list_payload(raw: Any, wrapped_key: str) -> List[Dict[str, Any]]:
    if isinstance(raw, dict) and isinstance(raw.get(wrapped_key), list):
        return [row for row in raw[wrapped_key] if isinstance(row, dict)]
    if isinstance(raw, list):
        return [row for row in raw if isinstance(row, dict)]
    return []

def load_agent_registry() -> List[Dict[str, Any]]:
    return _extract_list_payload(_read_json(AGENT_REGISTRY_PATH, []), "agents")

def save_agent_registry(rows: List[Dict[str, Any]]) -> None:
    payload = {"agents": rows, "updatedAt": int(time.time())}
    _write_json_atomic(AGENT_REGISTRY_PATH, payload)

def load_service_registry() -> List[Dict[str, Any]]:
    return _extract_list_payload(_read_json(SERVICE_REGISTRY_PATH, []), "services")


def save_service_registry(rows: List[Dict[str, Any]]) -> None:
    payload = {"services": rows, "updatedAt": int(time.time())}
    _write_json_atomic(SERVICE_REGISTRY_PATH, payload)


def load_agent_credentials() -> List[Dict[str, Any]]:
    return _extract_list_payload(_read_json(AGENT_CREDENTIALS_PATH, []), "credentials")


def save_agent_credentials(rows: List[Dict[str, Any]]) -> None:
    payload = {"credentials": rows, "updatedAt": int(time.time())}
    _write_json_atomic(AGENT_CREDENTIALS_PATH, payload)


def load_balance_ledger() -> Dict[str, Any]:
    default_payload: Dict[str, Any] = {
        "buyers": {},
        "sellers": {},
        "platform": {"feeAccrued": 0.0},
        "dailySpend": {},
        "updatedAt": int(time.time()),
    }
    data = _read_json(BALANCE_LEDGER_PATH, default_payload)
    if not isinstance(data, dict):
        return default_payload

    data.setdefault("buyers", {})
    data.setdefault("sellers", {})
    data.setdefault("platform", {"feeAccrued": 0.0})
    data.setdefault("dailySpend", {})
    if not isinstance(data.get("buyers"), dict):
        data["buyers"] = {}
    if not isinstance(data.get("sellers"), dict):
        data["sellers"] = {}
    if not isinstance(data.get("platform"), dict):
        data["platform"] = {"feeAccrued": 0.0}
    if not isinstance(data.get("dailySpend"), dict):
        data["dailySpend"] = {}
    data["platform"].setdefault("feeAccrued", 0.0)
    data.setdefault("updatedAt", int(time.time()))
    return data


def save_balance_ledger(payload: Dict[str, Any]) -> None:
    next_payload = dict(payload)
    next_payload["updatedAt"] = int(time.time())
    _write_json_atomic(BALANCE_LEDGER_PATH, next_payload)


def load_usage_logs() -> List[Dict[str, Any]]:
    return _extract_list_payload(_read_json(USAGE_LOG_PATH, []), "logs")


def save_usage_logs(rows: List[Dict[str, Any]]) -> None:
    payload = {"logs": rows, "updatedAt": int(time.time())}
    _write_json_atomic(USAGE_LOG_PATH, payload)


def load_deposit_intents() -> List[Dict[str, Any]]:
    return _extract_list_payload(_read_json(DEPOSIT_INTENTS_PATH, []), "intents")


def save_deposit_intents(rows: List[Dict[str, Any]]) -> None:
    payload = {"intents": rows, "updatedAt": int(time.time())}
    _write_json_atomic(DEPOSIT_INTENTS_PATH, payload)


def load_deposit_event_cursor() -> Dict[str, Any]:
    default_payload: Dict[str, Any] = {"lastSyncedBlock": None, "updatedAt": int(time.time())}
    data = _read_json(DEPOSIT_EVENT_CURSOR_PATH, default_payload)
    if not isinstance(data, dict):
        return default_payload
    data.setdefault("lastSyncedBlock", None)
    data.setdefault("updatedAt", int(time.time()))
    return data


def save_deposit_event_cursor(payload: Dict[str, Any]) -> None:
    next_payload = dict(payload)
    next_payload["updatedAt"] = int(time.time())
    _write_json_atomic(DEPOSIT_EVENT_CURSOR_PATH, next_payload)


def load_processed_deposit_event_keys() -> List[str]:
    data = _read_json(DEPOSIT_EVENT_PROCESSED_PATH, [])
    if isinstance(data, dict) and isinstance(data.get("keys"), list):
        return [str(item) for item in data["keys"]]
    if isinstance(data, list):
        return [str(item) for item in data]
    return []


def save_processed_deposit_event_keys(keys: List[str]) -> None:
    payload = {"keys": keys, "updatedAt": int(time.time())}
    _write_json_atomic(DEPOSIT_EVENT_PROCESSED_PATH, payload)


def load_router_config() -> Dict[str, Any]:
    default_payload: Dict[str, Any] = {"owners": {}, "updatedAt": int(time.time())}
    data = _read_json(ROUTER_CONFIG_PATH, default_payload)
    if not isinstance(data, dict):
        return default_payload
    data.setdefault("owners", {})
    if not isinstance(data.get("owners"), dict):
        data["owners"] = {}
    data.setdefault("updatedAt", int(time.time()))
    return data


def save_router_config(payload: Dict[str, Any]) -> None:
    next_payload = dict(payload)
    next_payload.setdefault("owners", {})
    if not isinstance(next_payload.get("owners"), dict):
        next_payload["owners"] = {}
    next_payload["updatedAt"] = int(time.time())
    _write_json_atomic(ROUTER_CONFIG_PATH, next_payload)


def append_audit_log(action: str, owner_wallet: str, details: Dict[str, Any]) -> None:
    event = {
        "id": str(uuid4()),
        "timestamp": int(time.time()),
        "action": action,
        "ownerAddress": normalize_wallet(owner_wallet),
        "details": details,
    }
    with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as file:
        file.write(json.dumps(event, ensure_ascii=False) + "\n")


def list_audit_logs(owner_wallet: str, limit: int) -> List[Dict[str, Any]]:
    owner = normalize_wallet(owner_wallet)
    if not os.path.exists(AUDIT_LOG_PATH):
        return []

    logs: List[Dict[str, Any]] = []
    with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except Exception:
                continue
            if normalize_wallet(str(parsed.get("ownerAddress", ""))) == owner:
                logs.append(parsed)

    logs.sort(key=lambda row: int(row.get("timestamp", 0)), reverse=True)
    return logs[:limit]

def load_refund_intents() -> List[Dict[str, Any]]:
    data = _read_json(REFUND_INTENTS_PATH, [])
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

def save_refund_intents(rows: List[Dict[str, Any]]) -> None:
    _write_json_atomic(REFUND_INTENTS_PATH, rows)



def load_wallet_roles() -> Dict[str, str]:
    from .settings import WALLET_ROLES_PATH
    raw = _read_json(WALLET_ROLES_PATH, {})
    if not isinstance(raw, dict):
        return {}
    # Keep only normalized string mappings to prevent runtime key/type issues.
    return {str(k): str(v) for k, v in raw.items()}

def save_wallet_roles(roles: Dict[str, str]) -> None:
    from .settings import WALLET_ROLES_PATH
    _write_json_atomic(WALLET_ROLES_PATH, roles)

def enforce_wallet_role(wallet: str, required_role: str) -> None:
    norm_wallet = normalize_wallet(wallet)
    roles = load_wallet_roles()
    current_role = roles.get(norm_wallet)
    
    if current_role and current_role != required_role:
        raise ValueError(f"Hard Isolation Error: Wallet {norm_wallet} is already registered as {current_role}. Cannot act as {required_role}.")
        
    if not current_role:
        roles[norm_wallet] = required_role
        save_wallet_roles(roles)



def load_provider_secrets() -> List[Dict[str, Any]]:
    data = _read_json(PROVIDER_SECRETS_PATH, [])
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

def save_provider_secrets(rows: List[Dict[str, Any]]) -> None:
    _write_json_atomic(PROVIDER_SECRETS_PATH, rows)
