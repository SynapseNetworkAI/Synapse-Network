# pyright: reportMissingImports=false

import copy
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Union

import pytest

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "seller_api"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src.storage.base import BaseStorage  # noqa: E402
from src.storage.normalizers import normalize_service_row  # noqa: E402


class InMemoryStorage(BaseStorage):
    def __init__(self):
        self._collections: Dict[str, Union[List[Any], Dict[str, Any]]] = {}

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


@pytest.fixture()
def temp_storage():
    return InMemoryStorage()
