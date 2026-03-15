from __future__ import annotations

import json
import time
from typing import Any, Callable, Dict, List, Optional

from src.domain.idempotency import IdempotencyRow, RateLimitRow

from ..database_manager import DatabaseManager


class IdempotencyRepository:
    def __init__(self, db: DatabaseManager):
        self._db = db

    def read_idempotency_rows(self) -> List[IdempotencyRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT id, scope, owner_address, idempotency_key, request_hash, response, created_at, expires_at FROM synapse_idempotency_keys ORDER BY created_at DESC"
            )
            rows = cur.fetchall()
        return [
            IdempotencyRow(
                id=row_id,
                scope=scope,
                owner_address=owner,
                idempotency_key=key,
                request_hash=req_hash,
                response=response if isinstance(response, dict) else None,
                created_at=int(created_at or 0),
                expires_at=int(expires_at or 0),
            )
            for row_id, scope, owner, key, req_hash, response, created_at, expires_at in rows
        ]

    def write_idempotency_rows(self, rows: List[IdempotencyRow], updated_at: int) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_idempotency_keys")
            for row in rows:
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

    def read_rate_limit_rows(self) -> List[RateLimitRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute("SELECT id, owner_address, action, window_start, count, updated_at FROM synapse_finance_rate_limit")
            rows = cur.fetchall()
        return [
            RateLimitRow(
                id=row_id,
                owner_address=owner,
                action=action,
                window_start=int(window_start or 0),
                count=int(count or 0),
                updated_at=int(updated_at or 0),
            )
            for row_id, owner, action, window_start, count, updated_at in rows
        ]

    def write_rate_limit_rows(self, rows: List[RateLimitRow], updated_at: int) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_finance_rate_limit")
            for row in rows:
                owner = row.owner_address.lower() if isinstance(row, RateLimitRow) else str(row.get("ownerAddress") or "").lower()
                action = row.action if isinstance(row, RateLimitRow) else str(row.get("action") or "")
                if not owner or not action:
                    continue
                row_id = row.id if isinstance(row, RateLimitRow) else str(row.get("id") or "")
                if not row_id:
                    row_id = f"rl-{int(time.time()*1000)}"
                ws = row.window_start if isinstance(row, RateLimitRow) else int(row.get("windowStart") or updated_at)
                cnt = row.count if isinstance(row, RateLimitRow) else int(row.get("count") or 0)
                ua = row.updated_at if isinstance(row, RateLimitRow) else int(row.get("updatedAt") or updated_at)
                cur.execute(
                    "INSERT INTO synapse_finance_rate_limit (id, owner_address, action, window_start, count, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
                    (row_id, owner, action, int(ws), int(cnt), int(ua)),
                )

    def _to_idempotency_insert_values(self, row: IdempotencyRow, updated_at: int) -> Optional[tuple[Any, ...]]:
        row_id = row.id.strip() if isinstance(row, IdempotencyRow) else str(row.get("id") or "").strip()
        if not row_id:
            row_id = f"idem-{int(time.time()*1000)}"
        if isinstance(row, IdempotencyRow):
            owner = row.owner_address.lower()
            scope = row.scope
            key = row.idempotency_key
            req_hash = row.request_hash
            response = row.response
            created = row.created_at or updated_at
            expires = row.expires_at or updated_at
        else:
            owner = str(row.get("ownerAddress") or "").lower()
            scope = str(row.get("scope") or "")
            key = str(row.get("idempotencyKey") or "")
            req_hash = str(row.get("requestHash") or "")
            response = row.get("response") if isinstance(row.get("response"), dict) else None
            created = int(row.get("createdAt") or updated_at)
            expires = int(row.get("expiresAt") or updated_at)
        if not owner or not scope or not key or not req_hash:
            return None
        return (
            row_id,
            scope,
            owner,
            key,
            req_hash,
            json.dumps(response, ensure_ascii=False),
            int(created),
            int(expires),
        )
