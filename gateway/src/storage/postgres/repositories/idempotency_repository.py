from __future__ import annotations

import time
from typing import Any, List

from src.domain.idempotency import IdempotencyRow, RateLimitRow
from src.domain.idempotency import FinanceRateLimitRow, IdempotencyKeyRow
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager


class IdempotencyRepository:
    def __init__(self, db: DatabaseManager):
        self._db = db

    def read_idempotency_rows(self) -> List[IdempotencyKeyRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT id, scope, owner_address, idempotency_key, request_hash,
                       response_code, response_digest, created_at, expires_at
                FROM synapse_idempotency_keys
                ORDER BY created_at DESC
                """
            )
            rows = cur.fetchall()
        result: List[IdempotencyKeyRow] = []
        for row in rows:
            if len(row) == 9:
                (
                    row_id,
                    scope,
                    owner,
                    key,
                    req_hash,
                    response_code,
                    response_digest,
                    created_at,
                    expires_at,
                ) = row
            elif len(row) == 8:
                (
                    row_id,
                    scope,
                    owner,
                    key,
                    req_hash,
                    response_obj,
                    created_at,
                    expires_at,
                ) = row
                if isinstance(response_obj, dict):
                    response_code = str(response_obj.get("code") or "") or None
                    response_digest = str(response_obj.get("digest") or "") or None
                else:
                    response_code = None
                    response_digest = None
            else:
                continue
            result.append(
                IdempotencyKeyRow(
                    id=str(row_id),
                    scope=str(scope),
                    ownerAddress=str(owner),
                    idempotencyKey=str(key),
                    requestHash=str(req_hash),
                    responseCode=response_code,
                    responseDigest=response_digest,
                    createdAt=to_dt_str(created_at, "") or "",
                    expiresAt=int(expires_at or 0),
                )
            )
        return result

    def write_idempotency_rows(self, rows: List[Any], updated_at: str | int) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_idempotency_keys")
            for row in rows:
                if isinstance(row, IdempotencyRow):
                    row = IdempotencyKeyRow(
                        id=row.id,
                        scope=row.scope,
                        ownerAddress=row.owner_address,
                        idempotencyKey=row.idempotency_key,
                        requestHash=row.request_hash,
                        responseCode=str((row.response or {}).get("code") or "")
                        or None,
                        responseDigest=str((row.response or {}).get("digest") or "")
                        or None,
                        createdAt=row.created_at,
                        expiresAt=row.expires_at,
                    )
                elif isinstance(row, dict):
                    row = IdempotencyKeyRow.model_validate(row)
                if not isinstance(row, IdempotencyKeyRow):
                    continue
                row_id = row.id.strip() or f"idem-{int(time.time() * 1000)}"
                if (
                    not row.owner_address
                    or not row.scope
                    or not row.idempotency_key
                    or not row.request_hash
                ):
                    continue
                cur.execute(
                    """
                    INSERT INTO synapse_idempotency_keys (
                        id, scope, owner_address, idempotency_key, request_hash,
                        response_code, response_digest, created_at, expires_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        row_id,
                        row.scope,
                        row.owner_address.lower(),
                        row.idempotency_key,
                        row.request_hash,
                        row.response_code,
                        row.response_digest,
                        to_dt_str(row.created_at or updated_at, now_dt_str()),
                        int(row.expires_at or int(time.time())),
                    ),
                )

    def read_rate_limit_rows(self) -> List[FinanceRateLimitRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT id, owner_address, action, window_start, count, updated_at FROM synapse_finance_rate_limit"
            )
            rows = cur.fetchall()
        return [
            FinanceRateLimitRow(
                id=str(row_id),
                ownerAddress=str(owner),
                action=str(action),
                windowStart=int(window_start or 0),
                count=int(count or 0),
                updatedAt=to_dt_str(updated_at, "") or "",
            )
            for row_id, owner, action, window_start, count, updated_at in rows
        ]

    def write_rate_limit_rows(self, rows: List[Any], updated_at: str | int) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_finance_rate_limit")
            for row in rows:
                if isinstance(row, RateLimitRow):
                    row = FinanceRateLimitRow(
                        id=row.id,
                        ownerAddress=row.owner_address,
                        action=row.action,
                        windowStart=row.window_start,
                        count=row.count,
                        updatedAt=row.updated_at,
                    )
                elif isinstance(row, dict):
                    row = FinanceRateLimitRow.model_validate(row)
                if not isinstance(row, FinanceRateLimitRow):
                    continue
                if not row.owner_address or not row.action:
                    continue
                row_id = row.id or f"rl-{int(time.time() * 1000)}"
                cur.execute(
                    "INSERT INTO synapse_finance_rate_limit (id, owner_address, action, window_start, count, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
                    (
                        row_id,
                        row.owner_address.lower(),
                        row.action,
                        int(row.window_start or updated_at),
                        int(row.count or 0),
                        to_dt_str(row.updated_at or updated_at, now_dt_str()),
                    ),
                )
