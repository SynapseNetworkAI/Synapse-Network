import json
import os
import time
from typing import Any, Dict, List
from uuid import uuid4

from .common import normalize_wallet
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
)

def load_agent_registry() -> List[Dict[str, Any]]:
    if not os.path.exists(AGENT_REGISTRY_PATH):
        return []
    try:
        with open(AGENT_REGISTRY_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            if isinstance(data, dict) and isinstance(data.get("agents"), list):
                return data["agents"]
            if isinstance(data, list):
                return data
    except Exception:
        return []
    return []

def save_agent_registry(rows: List[Dict[str, Any]]) -> None:
    payload = {"agents": rows, "updatedAt": int(time.time())}
    with open(AGENT_REGISTRY_PATH, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)

def load_service_registry() -> List[Dict[str, Any]]:
    if not os.path.exists(SERVICE_REGISTRY_PATH):
        return []
    try:
        with open(SERVICE_REGISTRY_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            if isinstance(data, dict) and isinstance(data.get("services"), list):
                return data["services"]
            if isinstance(data, list):
                return data
    except Exception:
        return []
    return []


def save_service_registry(rows: List[Dict[str, Any]]) -> None:
    payload = {"services": rows, "updatedAt": int(time.time())}
    with open(SERVICE_REGISTRY_PATH, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def load_agent_credentials() -> List[Dict[str, Any]]:
    if not os.path.exists(AGENT_CREDENTIALS_PATH):
        return []
    try:
        with open(AGENT_CREDENTIALS_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            if isinstance(data, dict) and isinstance(data.get("credentials"), list):
                return data["credentials"]
            if isinstance(data, list):
                return data
    except Exception:
        return []
    return []


def save_agent_credentials(rows: List[Dict[str, Any]]) -> None:
    payload = {"credentials": rows, "updatedAt": int(time.time())}
    with open(AGENT_CREDENTIALS_PATH, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def load_balance_ledger() -> Dict[str, Any]:
    default_payload: Dict[str, Any] = {
        "buyers": {},
        "sellers": {},
        "platform": {"feeAccrued": 0.0},
        "dailySpend": {},
        "updatedAt": int(time.time()),
    }
    if not os.path.exists(BALANCE_LEDGER_PATH):
        return default_payload
    try:
        with open(BALANCE_LEDGER_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            if isinstance(data, dict):
                data.setdefault("buyers", {})
                data.setdefault("sellers", {})
                data.setdefault("platform", {"feeAccrued": 0.0})
                data.setdefault("dailySpend", {})
                if not isinstance(data.get("platform"), dict):
                    data["platform"] = {"feeAccrued": 0.0}
                data["platform"].setdefault("feeAccrued", 0.0)
                if not isinstance(data.get("dailySpend"), dict):
                    data["dailySpend"] = {}
                data.setdefault("updatedAt", int(time.time()))
                return data
    except Exception:
        return default_payload
    return default_payload


def save_balance_ledger(payload: Dict[str, Any]) -> None:
    next_payload = dict(payload)
    next_payload["updatedAt"] = int(time.time())
    with open(BALANCE_LEDGER_PATH, "w", encoding="utf-8") as file:
        json.dump(next_payload, file, ensure_ascii=False, indent=2)


def load_usage_logs() -> List[Dict[str, Any]]:
    if not os.path.exists(USAGE_LOG_PATH):
        return []
    try:
        with open(USAGE_LOG_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            if isinstance(data, dict) and isinstance(data.get("logs"), list):
                return data["logs"]
            if isinstance(data, list):
                return data
    except Exception:
        return []
    return []


def save_usage_logs(rows: List[Dict[str, Any]]) -> None:
    payload = {"logs": rows, "updatedAt": int(time.time())}
    with open(USAGE_LOG_PATH, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def load_deposit_intents() -> List[Dict[str, Any]]:
    if not os.path.exists(DEPOSIT_INTENTS_PATH):
        return []
    try:
        with open(DEPOSIT_INTENTS_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            if isinstance(data, dict) and isinstance(data.get("intents"), list):
                return data["intents"]
            if isinstance(data, list):
                return data
    except Exception:
        return []
    return []


def save_deposit_intents(rows: List[Dict[str, Any]]) -> None:
    payload = {"intents": rows, "updatedAt": int(time.time())}
    with open(DEPOSIT_INTENTS_PATH, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def load_deposit_event_cursor() -> Dict[str, Any]:
    default_payload: Dict[str, Any] = {"lastSyncedBlock": None, "updatedAt": int(time.time())}
    if not os.path.exists(DEPOSIT_EVENT_CURSOR_PATH):
        return default_payload
    try:
        with open(DEPOSIT_EVENT_CURSOR_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            if isinstance(data, dict):
                data.setdefault("lastSyncedBlock", None)
                data.setdefault("updatedAt", int(time.time()))
                return data
    except Exception:
        return default_payload
    return default_payload


def save_deposit_event_cursor(payload: Dict[str, Any]) -> None:
    next_payload = dict(payload)
    next_payload["updatedAt"] = int(time.time())
    with open(DEPOSIT_EVENT_CURSOR_PATH, "w", encoding="utf-8") as file:
        json.dump(next_payload, file, ensure_ascii=False, indent=2)


def load_processed_deposit_event_keys() -> List[str]:
    if not os.path.exists(DEPOSIT_EVENT_PROCESSED_PATH):
        return []
    try:
        with open(DEPOSIT_EVENT_PROCESSED_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            if isinstance(data, dict) and isinstance(data.get("keys"), list):
                return [str(item) for item in data["keys"]]
            if isinstance(data, list):
                return [str(item) for item in data]
    except Exception:
        return []
    return []


def save_processed_deposit_event_keys(keys: List[str]) -> None:
    payload = {"keys": keys, "updatedAt": int(time.time())}
    with open(DEPOSIT_EVENT_PROCESSED_PATH, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def load_router_config() -> Dict[str, Any]:
    default_payload: Dict[str, Any] = {"owners": {}, "updatedAt": int(time.time())}
    if not os.path.exists(ROUTER_CONFIG_PATH):
        return default_payload
    try:
        with open(ROUTER_CONFIG_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
            if isinstance(data, dict):
                data.setdefault("owners", {})
                if not isinstance(data.get("owners"), dict):
                    data["owners"] = {}
                data.setdefault("updatedAt", int(time.time()))
                return data
    except Exception:
        return default_payload
    return default_payload


def save_router_config(payload: Dict[str, Any]) -> None:
    next_payload = dict(payload)
    next_payload.setdefault("owners", {})
    if not isinstance(next_payload.get("owners"), dict):
        next_payload["owners"] = {}
    next_payload["updatedAt"] = int(time.time())
    with open(ROUTER_CONFIG_PATH, "w", encoding="utf-8") as file:
        json.dump(next_payload, file, ensure_ascii=False, indent=2)


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
    if not os.path.exists(REFUND_INTENTS_PATH):
        return []
    try:
        with open(REFUND_INTENTS_PATH, "r", encoding="utf-8") as file:
            return json.load(file)
    except (json.JSONDecodeError, OSError):
        return []

def save_refund_intents(rows: List[Dict[str, Any]]) -> None:
    temp_path = f"{REFUND_INTENTS_PATH}.tmp.{uuid4().hex}"
    with open(temp_path, "w", encoding="utf-8") as file:
        json.dump(rows, file, indent=2)
    os.replace(temp_path, REFUND_INTENTS_PATH)



def load_wallet_roles() -> Dict[str, str]:
    from .settings import WALLET_ROLES_PATH
    import os, json
    if not os.path.exists(WALLET_ROLES_PATH):
        return {}
    try:
        with open(WALLET_ROLES_PATH, 'r', encoding='utf-8') as file:
            return json.load(file)
    except Exception:
        return {}

def save_wallet_roles(roles: Dict[str, str]) -> None:
    from .settings import WALLET_ROLES_PATH
    import json
    with open(WALLET_ROLES_PATH, 'w', encoding='utf-8') as file:
        json.dump(roles, file, ensure_ascii=False, indent=2)

def enforce_wallet_role(wallet: str, required_role: str) -> None:
    from .common import normalize_wallet
    norm_wallet = normalize_wallet(wallet)
    roles = load_wallet_roles()
    current_role = roles.get(norm_wallet)
    
    if current_role and current_role != required_role:
        raise ValueError(f"Hard Isolation Error: Wallet {norm_wallet} is already registered as {current_role}. Cannot act as {required_role}.")
        
    if not current_role:
        roles[norm_wallet] = required_role
        save_wallet_roles(roles)



def load_provider_secrets() -> List[Dict[str, Any]]:
    path = os.path.join(os.path.dirname(AGENT_REGISTRY_PATH), "provider_secrets.json")
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_provider_secrets(rows: List[Dict[str, Any]]) -> None:
    path = os.path.join(os.path.dirname(AGENT_REGISTRY_PATH), "provider_secrets.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
