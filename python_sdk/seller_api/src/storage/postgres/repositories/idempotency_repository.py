from __future__ import annotations

import json
import time
from typing import Any, Callable, Dict, List, Optional

from ..database_manager import DatabaseManager


class IdempotencyRepository:
    def __init__(self, db: DatabaseManager):
        self._db = db

    def read_idempotency_rows(self) -> List[Dict[str, Any]]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT id, scope, owner_address, idempotency_key, request_hash, response, created_at, expires_at FROM synapse_idempotency_keys ORDER BY created_at DESC"
            )
            rows = cur.fetchall()
        result: List[Dict[str, Any]] = []
        for row_id, scope, owner, key, req_hash, response, created_at, expires_at in rows:
            result.append(
                {
                    "id": row_id,
                    "scope": scope,
                    "ownerAddress": owner,
                    "idempotencyKey": key,
                    "requestHash": req_hash,
                    "response": response if isinstance(response, dict) else None,
                    "createdAt": int(created_at or 0),
                    "expiresAt": int(expires_at or 0),
                }
            )
        return result

    def write_idempotency_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_idempotency_keys")
            for row in rows:
                if not isinstance(row, dict):
                    continue
                values = self._to_idempotency_insert_values(row, updated_at)
                if values is None:
                    continue
                cur.execute(
                    """
                    INSERT INTO synapse_idempotency_keys (id, scope, owner_address, idempotency_key, request_hash, response, created_at, expires_at)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    """,
                    values,
                )

    def read_rate_limit_rows(self) -> List[Dict[str, Any]]:
        with self._db.readonly_cursor() as cur:
            cur.execute("SELECT id, owner_address, action, window_start, count, updated_at FROM synapse_finance_rate_limit")
            rows = cur.fetchall()
        return [
            {
                "id": row_id,
                "ownerAddress": owner,
                "action": action,
                "windowStart": int(window_start or 0),
                "count": int(count or 0),
                "updatedAt": int(updated_at or 0),
            }
            for row_id, owner, action, window_start, count, updated_at in rows
        ]

    def write_rate_limit_rows(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_finance_rate_limit")
            for row in rows:
                if not isinstance(row, dict):
                    continue
                row_id = str(row.get("id") or "").strip() or f"rl-{int(time.time()*1000)}"
                owner = str(row.get("ownerAddress") or "").lower()
                action = str(row.get("action") or "")
                if not owner or not action:
                    continue
                cur.execute(
                    "INSERT INTO synapse_finance_rate_limit (id, owner_address, action, window_start, count, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
                    (
                        row_id,
                        owner,
                        action,
                        int(row.get("windowStart") or updated_at),
                        int(row.get("count") or 0),
                        int(row.get("updatedAt") or updated_at),
                    ),
                )

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
