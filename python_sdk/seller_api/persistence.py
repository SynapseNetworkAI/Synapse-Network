import json
import os
import time
from typing import Any, Dict, List
from uuid import uuid4

from .common import normalize_wallet
from .settings import AGENT_CREDENTIALS_PATH, AUDIT_LOG_PATH, SERVICE_REGISTRY_PATH, AGENT_REGISTRY_PATH

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
