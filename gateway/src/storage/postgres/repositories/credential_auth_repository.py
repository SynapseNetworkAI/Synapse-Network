from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable, List, Optional

from src.domain.auth import AuthSessionRow, CredentialRow, WalletRoleRow
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager


class CredentialAuthRepository:
    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6

    def read_credential_rows(self, credential_type: str) -> List[CredentialRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT id, credential_type, owner_address, name, token_hash, token_prefix, status,
                       max_calls, calls_used, rpm, credit_limit, reset_interval, expiration,
                       expires_at, created_at, updated_at, revoked_at
                FROM synapse_credentials
                WHERE credential_type = %s
                ORDER BY created_at DESC
                """,
                (str(credential_type or ""),),
            )
            rows = cur.fetchall()
        return [
            CredentialRow(
                id=str(row_id),
                credentialType=str(c_type),
                ownerAddress=str(owner).lower(),
                name=name,
                tokenHash=token_hash,
                tokenPrefix=token_prefix,
                status=status,
                maxCalls=max_calls,
                callsUsed=calls_used,
                rpm=rpm,
                creditLimit=self._q6(credit_limit)
                if credit_limit is not None
                else None,
                resetInterval=reset_interval,
                expiration=expiration,
                expiresAt=expires_at,
                createdAt=to_dt_str(created_at),
                updatedAt=to_dt_str(updated_at),
                revokedAt=revoked_at,
            )
            for (
                row_id,
                c_type,
                owner,
                name,
                token_hash,
                token_prefix,
                status,
                max_calls,
                calls_used,
                rpm,
                credit_limit,
                reset_interval,
                expiration,
                expires_at,
                created_at,
                updated_at,
                revoked_at,
            ) in rows
        ]

    def write_credential_rows(
        self, credential_type: str, rows: List[CredentialRow]
    ) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute(
                "DELETE FROM synapse_credentials WHERE credential_type = %s",
                (str(credential_type or ""),),
            )
            for row in rows:
                if not isinstance(row, CredentialRow):
                    continue
                row_id = str(row.id or "").strip()
                if not row_id:
                    continue
                cur.execute(
                    """
                    INSERT INTO synapse_credentials (
                        id, credential_type, owner_address, name, token_hash, token_prefix, status,
                        max_calls, calls_used, rpm, credit_limit, reset_interval, expiration,
                        expires_at, created_at, updated_at, revoked_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        row_id,
                        str(credential_type or ""),
                        str(row.owner_address or "").lower(),
                        row.name,
                        row.token_hash,
                        row.token_prefix,
                        row.status,
                        row.max_calls,
                        row.calls_used,
                        row.rpm,
                        str(self._q6(row.credit_limit or Decimal("0")))
                        if row.credit_limit is not None
                        else None,
                        row.reset_interval,
                        row.expiration,
                        row.expires_at,
                        to_dt_str(row.created_at, now_dt_str()),
                        to_dt_str(row.updated_at, now_dt_str()),
                        row.revoked_at,
                    ),
                )

    def get_wallet_role(self, wallet: str) -> Optional[str]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT role FROM synapse_wallet_roles WHERE wallet_address = %s",
                (str(wallet or "").lower(),),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return str(row[0] or "")

    def set_wallet_role(self, wallet: str, role: str) -> None:
        self.upsert_wallet_role(
            WalletRoleRow(
                walletAddress=str(wallet or "").lower(),
                role=str(role or ""),
                updatedAt=now_dt_str(),
            )
        )

    def upsert_wallet_role(self, row: WalletRoleRow) -> None:
        now = now_dt_str()
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_wallet_roles (wallet_address, role, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (wallet_address)
                DO UPDATE SET role = EXCLUDED.role, updated_at = EXCLUDED.updated_at
                """,
                (
                    str(row.wallet_address or "").lower(),
                    str(row.role or ""),
                    to_dt_str(row.updated_at or now, now),
                ),
            )

    def upsert_auth_session(
        self, wallet: str, registered_at: int, last_login: int, status: str
    ) -> None:
        self.save_auth_session(
            AuthSessionRow(
                walletAddress=str(wallet or "").lower(),
                registeredAt=int(registered_at),
                lastLogin=int(last_login),
                status=str(status or "active"),
                updatedAt=now_dt_str(),
            )
        )

    def read_auth_session(self, wallet: str) -> Optional[AuthSessionRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT wallet_address, registered_at, last_login, status, updated_at FROM synapse_auth_sessions WHERE wallet_address = %s",
                (str(wallet or "").lower(),),
            )
            row = cur.fetchone()
        if row is None:
            return None
        return AuthSessionRow(
            walletAddress=str(row[0] or ""),
            registeredAt=int(row[1] or 0),
            lastLogin=int(row[2] or 0),
            status=str(row[3] or ""),
            updatedAt=to_dt_str(row[4], "") or "",
        )

    def save_auth_session(self, row: AuthSessionRow) -> None:
        now = now_dt_str()
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
                (
                    str(row.wallet_address or "").lower(),
                    int(row.registered_at),
                    int(row.last_login),
                    str(row.status or "active"),
                    to_dt_str(row.updated_at or now, now),
                ),
            )
