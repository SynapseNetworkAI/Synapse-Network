import json
import os
import time
from typing import Any, Dict, List
from uuid import uuid4

from src.core.common import normalize_wallet
from src.core.config import settings


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
    return _extract_list_payload(_read_json(settings.agent_registry_path, []), "agents")

def save_agent_registry(rows: List[Dict[str, Any]]) -> None:
    payload = {"agents": rows, "updatedAt": int(time.time())}
    _write_json_atomic(settings.agent_registry_path, payload)

def load_service_registry() -> List[Dict[str, Any]]:
    return _extract_list_payload(_read_json(settings.service_registry_path, []), "services")


def save_service_registry(rows: List[Dict[str, Any]]) -> None:
    payload = {"services": rows, "updatedAt": int(time.time())}
    _write_json_atomic(settings.service_registry_path, payload)


def load_agent_credentials() -> List[Dict[str, Any]]:
    return _extract_list_payload(_read_json(settings.agent_credentials_path, []), "credentials")


def save_agent_credentials(rows: List[Dict[str, Any]]) -> None:
    payload = {"credentials": rows, "updatedAt": int(time.time())}
    _write_json_atomic(settings.agent_credentials_path, payload)


def load_balance_ledger() -> Dict[str, Any]:
    default_payload: Dict[str, Any] = {
        "buyers": {},
        "sellers": {},
        "platform": {"feeAccrued": 0.0},
        "dailySpend": {},
        "updatedAt": int(time.time()),
    }
    data = _read_json(settings.balance_ledger_path, default_payload)
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
    _write_json_atomic(settings.balance_ledger_path, next_payload)


def load_usage_logs() -> List[Dict[str, Any]]:
    return _extract_list_payload(_read_json(settings.usage_log_path, []), "logs")


def save_usage_logs(rows: List[Dict[str, Any]]) -> None:
    payload = {"logs": rows, "updatedAt": int(time.time())}
    _write_json_atomic(settings.usage_log_path, payload)


def load_deposit_intents() -> List[Dict[str, Any]]:
    return _extract_list_payload(_read_json(settings.deposit_intents_path, []), "intents")


def save_deposit_intents(rows: List[Dict[str, Any]]) -> None:
    payload = {"intents": rows, "updatedAt": int(time.time())}
    _write_json_atomic(settings.deposit_intents_path, payload)


def load_deposit_event_cursor() -> Dict[str, Any]:
    default_payload: Dict[str, Any] = {"lastSyncedBlock": None, "updatedAt": int(time.time())}
    data = _read_json(settings.deposit_event_cursor_path, default_payload)
    if not isinstance(data, dict):
        return default_payload
    data.setdefault("lastSyncedBlock", None)
    data.setdefault("updatedAt", int(time.time()))
    return data


def save_deposit_event_cursor(payload: Dict[str, Any]) -> None:
    next_payload = dict(payload)
    next_payload["updatedAt"] = int(time.time())
    _write_json_atomic(settings.deposit_event_cursor_path, next_payload)


def load_processed_deposit_event_keys() -> List[str]:
    data = _read_json(settings.deposit_event_processed_path, [])
    if isinstance(data, dict) and isinstance(data.get("keys"), list):
        return [str(item) for item in data["keys"]]
    if isinstance(data, list):
        return [str(item) for item in data]
    return []


def save_processed_deposit_event_keys(keys: List[str]) -> None:
    payload = {"keys": keys, "updatedAt": int(time.time())}
    _write_json_atomic(settings.deposit_event_processed_path, payload)


def load_router_config() -> Dict[str, Any]:
    default_payload: Dict[str, Any] = {"owners": {}, "updatedAt": int(time.time())}
    data = _read_json(settings.router_config_path, default_payload)
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
    _write_json_atomic(settings.router_config_path, next_payload)


def append_audit_log(action: str, owner_wallet: str, details: Dict[str, Any]) -> None:
    event = {
        "id": str(uuid4()),
        "timestamp": int(time.time()),
        "action": action,
        "ownerAddress": normalize_wallet(owner_wallet),
        "details": details,
    }
    with open(settings.audit_log_path, "a", encoding="utf-8") as file:
        file.write(json.dumps(event, ensure_ascii=False) + "\n")


def list_audit_logs(owner_wallet: str, limit: int) -> List[Dict[str, Any]]:
    owner = normalize_wallet(owner_wallet)
    if not os.path.exists(settings.audit_log_path):
        return []

    logs: List[Dict[str, Any]] = []
    with open(settings.audit_log_path, "r", encoding="utf-8") as file:
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
    data = _read_json(settings.refund_intents_path, [])
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

def save_refund_intents(rows: List[Dict[str, Any]]) -> None:
    _write_json_atomic(settings.refund_intents_path, rows)

def load_provider_secrets() -> List[Dict[str, Any]]:
    data = _read_json(settings.provider_secrets_path, [])
    return [row for row in data if isinstance(row, dict)] if isinstance(data, list) else []

def save_provider_secrets(rows: List[Dict[str, Any]]) -> None:
    _write_json_atomic(settings.provider_secrets_path, rows)
