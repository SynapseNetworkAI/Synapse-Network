import json
import time
from typing import Any, Dict, List, Optional, Union

from .base import BaseStorage
from .json_impl import _normalize_service_row

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - optional dependency at import time
    psycopg = None


_COLLECTION_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_collections (
    collection_name TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_AUDIT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS synapse_audit_log (
    id BIGSERIAL PRIMARY KEY,
    collection_name TEXT NOT NULL DEFAULT 'audit_log',
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_AUDIT_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_created_at
ON synapse_audit_log (created_at DESC);
"""

_AUDIT_OWNER_IDX_SQL = """
CREATE INDEX IF NOT EXISTS idx_synapse_audit_log_owner
ON synapse_audit_log ((payload->>'ownerAddress'));
"""


class PostgresStorage(BaseStorage):
    def __init__(self, dsn: str, ensure_schema: bool = True):
        if psycopg is None:
            raise RuntimeError(
                "psycopg is not installed. Install dependency 'psycopg[binary]' before using PostgreSQL storage."
            )
        if not dsn.strip():
            raise RuntimeError("POSTGRES_DSN is required when STORAGE_BACKEND=postgres")

        self.dsn = dsn.strip()
        if ensure_schema:
            self._ensure_schema()

    def _connect(self):
        return psycopg.connect(self.dsn)

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(_COLLECTION_TABLE_SQL)
                cur.execute(_AUDIT_TABLE_SQL)
                cur.execute(_AUDIT_IDX_SQL)
                cur.execute(_AUDIT_OWNER_IDX_SQL)
            conn.commit()

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
                return [_normalize_service_row(svc) for svc in services]
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
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT payload FROM synapse_audit_log WHERE collection_name = %s ORDER BY id ASC",
                        (collection_name,),
                    )
                    rows = cur.fetchall()
            return [row[0] for row in rows if isinstance(row[0], dict)]

        with self._connect() as conn:
            with conn.cursor() as cur:
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

            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM synapse_audit_log WHERE collection_name = %s",
                        (collection_name,),
                    )
                    for row in rows:
                        cur.execute(
                            "INSERT INTO synapse_audit_log (collection_name, payload) VALUES (%s, %s::jsonb)",
                            (collection_name, json.dumps(row, ensure_ascii=False)),
                        )
                conn.commit()
            return

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO synapse_collections (collection_name, payload, updated_at)
                    VALUES (%s, %s::jsonb, NOW())
                    ON CONFLICT (collection_name)
                    DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                    """,
                    (collection_name, json.dumps(payload, ensure_ascii=False)),
                )
            conn.commit()

    def append_to_collection(self, collection_name: str, item: Any) -> None:
        if collection_name == "audit_log":
            row = item if isinstance(item, dict) else {"raw": item}
            with self._connect() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO synapse_audit_log (collection_name, payload) VALUES (%s, %s::jsonb)",
                        (collection_name, json.dumps(row, ensure_ascii=False)),
                    )
                conn.commit()
            return

        data = self.get_collection(collection_name)
        if isinstance(data, list):
            data.append(item)
            self.save_collection(collection_name, data)

    def read_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
        sql = "SELECT payload FROM synapse_audit_log WHERE collection_name = %s"
        params: List[Any] = ["audit_log"]

        if owner_wallet:
            sql += " AND lower(payload->>'ownerAddress') = lower(%s)"
            params.append(owner_wallet)

        sql += " ORDER BY id DESC LIMIT %s"
        params.append(max(1, min(limit, 1000)))

        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()

        result = [row[0] for row in rows if isinstance(row[0], dict)]
        result.sort(key=lambda item: int(item.get("timestamp") or 0), reverse=True)
        return result
