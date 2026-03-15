from __future__ import annotations

import json
import time
from typing import Any, Callable, Dict, List, Union

from ..database_manager import DatabaseManager


class LegacyCollectionRepository:
    def __init__(self, db: DatabaseManager, service_row_normalizer: Callable[[Dict[str, Any]], Dict[str, Any]], audit_repo: Any):
        self._db = db
        self._normalize_service_row = service_row_normalizer
        self._audit_repo = audit_repo

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
                return [self._normalize_service_row(svc) for svc in services if isinstance(svc, dict)]
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
        if collection_name == "audit_log":
            with self._db.readonly_cursor() as cur:
                cur.execute(
                    "SELECT payload FROM synapse_audit_log WHERE collection_name = %s ORDER BY id ASC",
                    (collection_name,),
                )
                rows = cur.fetchall()
            return [row[0] for row in rows if isinstance(row[0], dict)]

        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT payload FROM synapse_collections WHERE collection_name = %s",
                (collection_name,),
            )
            row = cur.fetchone()

        if row is None:
            return self._default_collection(collection_name)

        payload = row[0]
        return self._normalize_loaded_payload(collection_name, payload)

    def save_collection(self, collection_name: str, data: Union[List[Any], Dict[str, Any]]) -> None:
        payload: Union[List[Any], Dict[str, Any]] = data

        if collection_name == "service_registry" and isinstance(data, list):
            payload = {"services": data, "updatedAt": int(time.time())}
        elif collection_name == "agent_registry" and isinstance(data, list):
            payload = {"agents": data, "updatedAt": int(time.time())}

        if collection_name == "audit_log":
            rows: List[Dict[str, Any]]
            if isinstance(payload, list):
                rows = [row for row in payload if isinstance(row, dict)]
            elif isinstance(payload, dict):
                rows = [payload]
            else:
                rows = []
            self._audit_repo.replace_audit_collection(rows)
            return

        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_collections (collection_name, payload, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (collection_name)
                DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                """,
                (collection_name, json.dumps(payload, ensure_ascii=False)),
            )

    def append_to_collection(self, collection_name: str, item: Any) -> None:
        if collection_name == "audit_log":
            self._audit_repo.append_to_audit_collection(item)
            return

        data = self.get_collection(collection_name)
        if isinstance(data, list):
            data.append(item)
            self.save_collection(collection_name, data)
