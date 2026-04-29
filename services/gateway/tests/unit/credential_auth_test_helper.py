from __future__ import annotations

from src.core.common import normalize_wallet
from src.domain.runtime_state import AuthSessionState
from src.services.platform import credential_service
from src.utils.datetime_utils import to_dt_str


class InMemoryCredentialAuthRepository:
    def __init__(self, *, agent_rows=None, provider_rows=None) -> None:
        self._credential_rows = {
            "agent": list(agent_rows or []),
            "provider": list(provider_rows or []),
        }
        self._auth_sessions: dict[str, AuthSessionState] = {}

    def read_credential_rows(self, credential_type: str):
        return list(self._credential_rows.get(credential_type, []))

    @staticmethod
    def _runtime_type(row):
        if row.agent.runtime_label:
            return str(row.agent.runtime_label)
        if row.metadata and row.metadata.credential_type:
            return str(row.metadata.credential_type)
        return "agent"

    @staticmethod
    def _credential_owner(row):
        return normalize_wallet(row.owner.owner_wallet)

    def _replace_row(self, row):
        credential_type = self._runtime_type(row)
        rows = list(self._credential_rows.setdefault(credential_type, []))
        credential_id = str(row.credential.credential_id)
        index = next(
            (
                idx
                for idx, existing in enumerate(rows)
                if str(existing.credential.credential_id) == credential_id
            ),
            -1,
        )
        if index >= 0:
            rows[index] = row
        else:
            rows.append(row)
        self._credential_rows[credential_type] = rows
        return row

    def _find_row(self, credential_id: str):
        for credential_type, rows in self._credential_rows.items():
            for idx, row in enumerate(rows):
                if str(row.credential.credential_id) == str(credential_id):
                    return credential_type, idx, row
        return None

    def create_runtime_credential(self, record):
        return self._replace_row(record)

    def update_runtime_credential_policy(self, record):
        return self._replace_row(record)

    def update_runtime_credential_metadata(self, record):
        return self._replace_row(record)

    def rotate_runtime_credential(
        self, credential_id, owner_wallet, secret_hash, secret_prefix, issued_at
    ):
        found = self._find_row(credential_id)
        if found is None:
            return False
        credential_type, idx, row = found
        if self._credential_owner(row) != normalize_wallet(owner_wallet):
            return False
        self._credential_rows[credential_type][idx] = credential_service.clone_runtime_credential(
            row,
            credential_service.CredentialPatch(
                secret_hash=secret_hash,
                secret_prefix=secret_prefix,
                status="active",
                issued_at=to_dt_str(issued_at),
                updated_at=to_dt_str(issued_at),
                clear_revoked_at=True,
            ),
        )
        return True

    def revoke_runtime_credential(self, credential_id, owner_wallet, revoked_at):
        found = self._find_row(credential_id)
        if found is None:
            return False
        credential_type, idx, row = found
        if self._credential_owner(row) != normalize_wallet(owner_wallet):
            return False
        self._credential_rows[credential_type][idx] = credential_service.clone_runtime_credential(
            row,
            credential_service.CredentialPatch(
                status="revoked",
                updated_at=to_dt_str(revoked_at),
                revoked_at=int(revoked_at),
            ),
        )
        return True

    def increment_credential_usage(self, credential_id, delta=1):
        return self._change_usage(credential_id, abs(int(delta or 1)))

    def decrement_credential_usage(self, credential_id, delta=1):
        return self._change_usage(credential_id, -abs(int(delta or 1)))

    def _change_usage(self, credential_id, delta):
        found = self._find_row(credential_id)
        if found is None:
            return None
        credential_type, idx, row = found
        self._credential_rows[credential_type][idx] = credential_service.clone_runtime_credential(
            row,
            credential_service.CredentialPatch(
                calls_used=max(0, int(row.metadata.calls_used or 0) + int(delta))
            ),
        )
        return self._credential_rows[credential_type][idx]

    def read_auth_session(self, wallet: str):
        return self._auth_sessions.get(normalize_wallet(wallet))

    def save_auth_session(self, row: AuthSessionState):
        self._auth_sessions[normalize_wallet(row.wallet_address)] = row
