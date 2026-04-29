"""Credential auth repository — auth session and credential row read/write mixin."""
from __future__ import annotations

from typing import Any, Optional, TypeVar

from pydantic import BaseModel

from src.domain.identity import RuntimeCredentialRecord
from src.domain.runtime_state import (
    AuthSessionState,
    CredentialMetadataState,
)
from src.utils.datetime_utils import now_dt_str, to_dt_str

StateModel = TypeVar("StateModel", bound=BaseModel)



class CredentialAuthQueryMixin:
    """Credential row and auth session operations."""

    def _read_runtime_credential_by_id(
        self, credential_type: str, credential_id: str
    ) -> Optional[Any]:
        for row in self.read_credential_rows(credential_type):
            if str(row.credential.credential_id) == str(credential_id):
                return row
        return None

    def create_runtime_credential(
        self, record: RuntimeCredentialRecord
    ) -> RuntimeCredentialRecord:
        normalized = self._materialize_runtime_record(record)
        with self._db.tx_cursor() as cur:
            self._insert_credential_row(cur, normalized)
        return normalized

    def update_runtime_credential_policy(
        self, record: RuntimeCredentialRecord
    ) -> RuntimeCredentialRecord:
        normalized = self._materialize_runtime_record(record)
        with self._db.tx_cursor() as cur:
            self._insert_credential_row(cur, normalized)
        return normalized

    def update_runtime_credential_metadata(
        self, record: RuntimeCredentialRecord
    ) -> RuntimeCredentialRecord:
        normalized = self._materialize_runtime_record(record)
        with self._db.tx_cursor() as cur:
            self._insert_credential_row(cur, normalized)
        return normalized

    def _touch_credential_metadata(
        self,
        cur: Any,
        runtime_label: str,
        credential_id: str,
        updated_at: str,
    ) -> None:
        cur.execute(
            """
            UPDATE synapse_runtime_state
               SET payload = jsonb_set(
                       COALESCE(payload, '{}'::jsonb),
                       '{updatedAt}',
                       to_jsonb(%s::text),
                       true
                   ),
                   updated_at = %s
             WHERE state_key = %s
            """,
            (
                updated_at,
                updated_at,
                self._credential_state_key(runtime_label, credential_id),
            ),
        )

    def rotate_runtime_credential(
        self,
        credential_id: str,
        owner_wallet: str,
        secret_hash: str,
        secret_prefix: str,
        issued_at: int,
    ) -> bool:
        updated_at = to_dt_str(int(issued_at), now_dt_str())
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_agent_credentials AS ac
                   SET secret_hash = %s,
                       secret_prefix = %s,
                       status = 'active',
                       issued_at = to_timestamp(%s),
                       revoked_at = NULL,
                       last_used_at = to_timestamp(%s)
                  FROM synapse_agent_profiles AS ap
                  JOIN synapse_owner_accounts AS oa ON oa.owner_id = ap.owner_id
                 WHERE ac.agent_id = ap.agent_id
                   AND ac.credential_id = %s
                   AND lower(oa.owner_wallet) = lower(%s)
                RETURNING ap.runtime_label
                """,
                (
                    secret_hash,
                    secret_prefix,
                    int(issued_at),
                    int(issued_at),
                    credential_id,
                    owner_wallet,
                ),
            )
            row = cur.fetchone()
            if row is None:
                return False
            runtime_label = row[0] if isinstance(row, (list, tuple)) else row
            self._touch_credential_metadata(
                cur, str(runtime_label or "").lower(), credential_id, updated_at
            )
        return True

    def revoke_runtime_credential(
        self,
        credential_id: str,
        owner_wallet: str,
        revoked_at: int,
    ) -> bool:
        updated_at = to_dt_str(int(revoked_at), now_dt_str())
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_agent_credentials AS ac
                   SET status = 'revoked',
                       revoked_at = COALESCE(revoked_at, to_timestamp(%s)),
                       last_used_at = to_timestamp(%s)
                  FROM synapse_agent_profiles AS ap
                  JOIN synapse_owner_accounts AS oa ON oa.owner_id = ap.owner_id
                 WHERE ac.agent_id = ap.agent_id
                   AND ac.credential_id = %s
                   AND lower(oa.owner_wallet) = lower(%s)
                RETURNING ap.runtime_label
                """,
                (int(revoked_at), int(revoked_at), credential_id, owner_wallet),
            )
            row = cur.fetchone()
            if row is None:
                return False
            runtime_label = row[0] if isinstance(row, (list, tuple)) else row
            self._touch_credential_metadata(
                cur, str(runtime_label or "").lower(), credential_id, updated_at
            )
        return True

    def _change_credential_usage(
        self, credential_id: str, delta: int
    ) -> Optional[RuntimeCredentialRecord]:
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                SELECT ap.runtime_label, ac.issued_at, ac.last_used_at, rs.payload
                  FROM synapse_agent_credentials AS ac
                  JOIN synapse_agent_profiles AS ap ON ap.agent_id = ac.agent_id
                  JOIN synapse_owner_accounts AS oa ON oa.owner_id = ap.owner_id
                  LEFT JOIN synapse_runtime_state AS rs
                    ON rs.state_key = CONCAT('credential_meta::', ap.runtime_label, '::', ac.credential_id)
                 WHERE ac.credential_id = %s
                 FOR UPDATE OF ac
                """,
                (credential_id,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            runtime_label, issued_at, last_used_at, payload = row
            runtime_label = str(runtime_label or "").lower()
            updated_at = now_dt_str()
            metadata = self._parse_state_model(
                payload,
                CredentialMetadataState,
                fallback={
                    "credentialType": runtime_label,
                    "ownerAddress": "",
                    "createdAt": to_dt_str(issued_at),
                    "updatedAt": to_dt_str(last_used_at, issued_at),
                },
            )
            current = int(metadata.calls_used or 0) if metadata is not None else 0
            updated = (metadata or CredentialMetadataState(
                credentialType=runtime_label,
                ownerAddress="",
                createdAt=to_dt_str(issued_at),
                updatedAt=updated_at,
            )).model_copy(
                update={
                    "calls_used": max(0, current + int(delta)),
                    "updated_at": updated_at,
                }
            )
            self._upsert_runtime_state(
                cur,
                self._credential_state_key(runtime_label, credential_id),
                updated,
                updated_at,
            )
            cur.execute(
                """
                UPDATE synapse_agent_credentials
                   SET last_used_at = %s
                 WHERE credential_id = %s
                """,
                (updated_at, credential_id),
            )
        return self._read_runtime_credential_by_id(runtime_label, credential_id)

    def increment_credential_usage(
        self, credential_id: str, delta: int = 1
    ) -> Optional[RuntimeCredentialRecord]:
        return self._change_credential_usage(credential_id, abs(int(delta or 1)))

    def decrement_credential_usage(
        self, credential_id: str, delta: int = 1
    ) -> Optional[RuntimeCredentialRecord]:
        return self._change_credential_usage(credential_id, -abs(int(delta or 1)))

    def upsert_auth_session(
        self, wallet: str, registered_at: int, last_login: int, status: str
    ) -> None:
        self.save_auth_session(
            AuthSessionState(
                walletAddress=str(wallet or "").lower(),
                registeredAt=int(registered_at),
                lastLogin=int(last_login),
                status=str(status or "active"),
                updatedAt=now_dt_str(),
            )
        )

    def read_auth_session(self, wallet: str) -> Optional[AuthSessionState]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT payload FROM synapse_runtime_state WHERE state_key = %s",
                (self._auth_session_state_key(wallet),),
            )
            row = cur.fetchone()
        if row is None:
            return None
        payload = row
        if isinstance(row, (list, tuple)) and row:
            payload = row[0]
        return self._parse_state_model(
            payload,
            AuthSessionState,
            fallback={
                "walletAddress": str(wallet or "").lower(),
                "registeredAt": 0,
                "lastLogin": 0,
                "status": "active",
            },
        )

    def save_auth_session(self, row: AuthSessionState) -> None:
        now = now_dt_str()
        wallet = str(row.wallet_address or "").lower()
        existing = self.read_auth_session(wallet)
        registered_at = int(row.registered_at)
        if existing is not None and int(existing.registered_at or 0) > 0:
            registered_at = min(int(existing.registered_at), registered_at)
        normalized = row.model_copy(
            update={
                "wallet_address": wallet,
                "registered_at": registered_at,
                "updated_at": to_dt_str(row.updated_at or now, now),
            }
        )
        with self._db.tx_cursor() as cur:
            self._upsert_runtime_state(
                cur,
                self._auth_session_state_key(wallet),
                normalized,
                normalized.updated_at,
            )
