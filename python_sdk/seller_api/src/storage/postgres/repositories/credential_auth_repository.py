from __future__ import annotations

import json
import time
from typing import Any, Callable, Dict, List, Optional

from ..database_manager import DatabaseManager


class CredentialAuthRepository:
    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6

    def read_credential_rows(self, credential_type: str) -> List[Dict[str, Any]]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT payload FROM synapse_credentials WHERE credential_type = %s ORDER BY created_at DESC",
                (str(credential_type or ""),),
            )
            rows = cur.fetchall()
        return [row[0] for row in rows if isinstance(row[0], dict)]

    def write_credential_rows(self, credential_type: str, rows: List[Dict[str, Any]]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_credentials WHERE credential_type = %s", (str(credential_type or ""),))
            for row in rows:
                if not isinstance(row, dict):
                    continue
                row_id = str(row.get("id") or "").strip()
                if not row_id:
                    continue
                cur.execute(
                    """
                    INSERT INTO synapse_credentials (
                        id, credential_type, owner_address, name, token_hash, token_prefix, status,
                        max_calls, calls_used, rpm, credit_limit, reset_interval, expiration,
                        expires_at, created_at, updated_at, revoked_at, payload
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        row_id,
                        str(credential_type or ""),
                        str(row.get("ownerAddress") or "").lower(),
                        row.get("name"),
                        row.get("tokenHash"),
                        row.get("tokenPrefix"),
                        row.get("status"),
                        row.get("maxCalls"),
                        row.get("callsUsed"),
                        row.get("rpm"),
                        str(self._q6(row.get("creditLimit") or 0)) if row.get("creditLimit") is not None else None,
                        row.get("resetInterval"),
                        row.get("expiration"),
                        row.get("expiresAt"),
                        row.get("createdAt"),
                        row.get("updatedAt"),
                        row.get("revokedAt"),
                        json.dumps(row, ensure_ascii=False),
                    ),
                )

    def get_wallet_role(self, wallet: str) -> Optional[str]:
        with self._db.readonly_cursor() as cur:
            cur.execute("SELECT role FROM synapse_wallet_roles WHERE wallet_address = %s", (str(wallet or "").lower(),))
            row = cur.fetchone()
        if row is None:
            return None
        return str(row[0] or "")

    def set_wallet_role(self, wallet: str, role: str) -> None:
        now = int(time.time())
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_wallet_roles (wallet_address, role, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (wallet_address)
                DO UPDATE SET role = EXCLUDED.role, updated_at = EXCLUDED.updated_at
                """,
                (str(wallet or "").lower(), str(role or ""), now),
            )

    def upsert_auth_session(self, wallet: str, registered_at: int, last_login: int, status: str) -> None:
        now = int(time.time())
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_auth_sessions (wallet_address, registered_at, last_login, status, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (wallet_address)
                DO UPDATE SET
                    registered_at = LEAST(synapse_auth_sessions.registered_at, EXCLUDED.registered_at),
                    last_login = EXCLUDED.last_login,
                    status = EXCLUDED.status,
                    updated_at = EXCLUDED.updated_at
                """,
                (str(wallet or "").lower(), int(registered_at), int(last_login), str(status or "active"), now),
            )
