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

    @staticmethod
    def _owner_id(wallet: str) -> str:
        return f"owner:{str(wallet or '').strip().lower()}"

    def _ensure_owner_account(self, cur: Any, wallet: str, updated_at: str) -> str:
        normalized_wallet = str(wallet or "").strip().lower()
        owner_id = self._owner_id(normalized_wallet)
        cur.execute(
            """
            INSERT INTO synapse_owner_accounts (
                owner_id, owner_wallet, status, default_currency, created_at, updated_at
            ) VALUES (%s, %s, 'active', 'USDC', %s, %s)
            ON CONFLICT (owner_id)
            DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, updated_at = EXCLUDED.updated_at
            """,
            (owner_id, normalized_wallet, updated_at, updated_at),
        )
        return owner_id

    @staticmethod
    def _normalize_idempotency_row(row: Any) -> IdempotencyKeyRow | None:
        if isinstance(row, IdempotencyKeyRow):
            return row
        if isinstance(row, IdempotencyRow):
            return IdempotencyKeyRow(
                id=row.id,
                scope=row.scope,
                ownerAddress=row.owner_address,
                idempotencyKey=row.idempotency_key,
                requestHash=row.request_hash,
                responseCode=str((row.response or {}).get("code") or "") or None,
                responseDigest=str((row.response or {}).get("digest") or "") or None,
                createdAt=row.created_at,
                expiresAt=row.expires_at,
            )
        if isinstance(row, dict):
            return IdempotencyKeyRow.model_validate(row)
        return None

    @staticmethod
    def _normalize_rate_limit_row(row: Any) -> FinanceRateLimitRow | None:
        if isinstance(row, FinanceRateLimitRow):
            return row
        if isinstance(row, RateLimitRow):
            return FinanceRateLimitRow(
                id=row.id,
                ownerAddress=row.owner_address,
                action=row.action,
                windowStart=row.window_start,
                count=row.count,
                updatedAt=row.updated_at,
            )
        if isinstance(row, dict):
            return FinanceRateLimitRow.model_validate(row)
        return None

    def read_idempotency_rows(self) -> List[IdempotencyKeyRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT ik.id, ik.scope, COALESCE(oa.owner_wallet, ''), ik.idempotency_key, ik.request_hash,
                       ik.response_code, ik.response_digest, ik.created_at, ik.expires_at
                FROM synapse_idempotency_keys ik
                LEFT JOIN synapse_owner_accounts oa ON oa.owner_id = ik.owner_id
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
                entity = self._normalize_idempotency_row(row)
                if entity is None:
                    continue
                row_id = entity.id.strip() or f"idem-{int(time.time() * 1000)}"
                if (
                    not entity.owner_address
                    or not entity.scope
                    or not entity.idempotency_key
                    or not entity.request_hash
                ):
                    continue
                timestamp = to_dt_str(entity.created_at or updated_at, now_dt_str())
                owner_id = self._ensure_owner_account(cur, entity.owner_address, timestamp)
                cur.execute(
                    """
                    INSERT INTO synapse_idempotency_keys (
                        id, scope, owner_id, idempotency_key, request_hash,
                        response_code, response_digest, created_at, expires_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        row_id,
                        entity.scope,
                        owner_id,
                        entity.idempotency_key,
                        entity.request_hash,
                        entity.response_code,
                        entity.response_digest,
                        timestamp,
                        int(entity.expires_at or int(time.time())),
                    ),
                )

    def read_rate_limit_rows(self) -> List[FinanceRateLimitRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT rl.id, COALESCE(oa.owner_wallet, ''), rl.action, rl.window_start, rl.count, rl.updated_at
                FROM synapse_finance_rate_limit rl
                LEFT JOIN synapse_owner_accounts oa ON oa.owner_id = rl.owner_id
                """
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
                entity = self._normalize_rate_limit_row(row)
                if entity is None:
                    continue
                if not entity.owner_address or not entity.action:
                    continue
                row_id = entity.id or f"rl-{int(time.time() * 1000)}"
                timestamp = to_dt_str(entity.updated_at or updated_at, now_dt_str())
                owner_id = self._ensure_owner_account(cur, entity.owner_address, timestamp)
                cur.execute(
                    "INSERT INTO synapse_finance_rate_limit (id, owner_id, action, window_start, count, updated_at) VALUES (%s, %s, %s, %s, %s, %s)",
                    (
                        row_id,
                        owner_id,
                        entity.action,
                        int(entity.window_start or updated_at),
                        int(entity.count or 0),
                        timestamp,
                    ),
                )
