import asyncio
from types import SimpleNamespace

from src.api.schemas.pydantic_models import (
    CredentialIssueRequest,
    CredentialQuotaUpdateRequest,
)
from src.core.common import normalize_wallet
from src.domain.identity import RuntimeCredentialRecord
from src.domain.runtime_state import AuthSessionState, WalletRoleState
from src.services.platform import credential_service
from src.services.seller import secret_service


class InMemoryCredentialAuthRepository:
    def __init__(self) -> None:
        self._credential_rows = {"buyer": [], "seller": []}
        self._wallet_roles: dict[str, WalletRoleState] = {}
        self._auth_sessions: dict[str, AuthSessionState] = {}

    def read_credential_rows(self, credential_type: str):
        return list(self._credential_rows.get(credential_type, []))

    def write_credential_rows(self, credential_type: str, rows):
        self._credential_rows[credential_type] = list(rows)

    def read_wallet_role(self, wallet: str):
        return self._wallet_roles.get(normalize_wallet(wallet))

    def upsert_wallet_role(self, row: WalletRoleState):
        self._wallet_roles[normalize_wallet(row.wallet_address)] = row

    def read_auth_session(self, wallet: str):
        return self._auth_sessions.get(normalize_wallet(wallet))

    def save_auth_session(self, row: AuthSessionState):
        self._auth_sessions[normalize_wallet(row.wallet_address)] = row


class InMemoryAuditRepository:
    def __init__(self) -> None:
        self.rows = []

    def append_audit_row(self, row):
        self.rows.append(row)


class FakeStorage:
    def __init__(self) -> None:
        self.credential_auth = InMemoryCredentialAuthRepository()
        self.audit_logs = InMemoryAuditRepository()
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(credential_auth=self.credential_auth),
            audit=SimpleNamespace(logs=self.audit_logs),
        )

    def get_data_manager(self):
        return self.data_manager


def test_buyer_credential_service_uses_runtime_models() -> None:
    storage = FakeStorage()

    issued = asyncio.run(
        credential_service.issue_credential_for_owner(
            storage,
            "0xABC",
            CredentialIssueRequest(
                name="Buyer Key",
                maxCalls=5,
                rpm=10,
                creditLimit=2.5,
                resetInterval="daily",
            ),
        )
    )

    assert issued["status"] == "success"
    assert issued["credential"]["ownerAddress"] == "0xabc"

    rows = credential_service.load_credential_rows(storage)
    assert len(rows) == 1
    assert isinstance(rows[0], RuntimeCredentialRecord)
    assert rows[0].metadata.name == "Buyer Key"

    resolved = credential_service.resolve_active_credential(
        storage, issued["credential"]["token"]
    )
    assert resolved.credential.credential_id == rows[0].credential.credential_id
    assert resolved.policy.rpm_limit == 10

    updated = asyncio.run(
        credential_service.update_credential_quota_for_owner(
            storage,
            "0xabc",
            resolved.credential.credential_id,
            CredentialQuotaUpdateRequest(rpm=20, maxCalls=9, creditLimit=3.5),
        )
    )
    assert updated["credential"]["rpm"] == 20
    assert updated["credential"]["maxCalls"] == 9
    assert credential_service.load_credential_rows(storage)[0].policy.rpm_limit == 20

    revoked = asyncio.run(
        credential_service.revoke_credential_for_owner(
            storage,
            "0xabc",
            resolved.credential.credential_id,
            "CREDENTIAL_NOT_FOUND",
        )
    )
    assert revoked["credential"]["status"] == "revoked"
    assert len(storage.audit_logs.rows) == 3


def test_seller_secret_service_uses_runtime_models() -> None:
    storage = FakeStorage()

    issued = asyncio.run(
        secret_service.issue_seller_secret_for_owner(
            storage,
            "0xDEF",
            CredentialIssueRequest(
                name="Seller Key",
                maxCalls=7,
                rpm=12,
                creditLimit=4.2,
                resetInterval="weekly",
            ),
        )
    )

    assert issued["status"] == "success"
    assert issued["secret"]["ownerAddress"] == "0xDEF"

    rows = secret_service.load_seller_secret_rows(storage)
    assert len(rows) == 1
    assert isinstance(rows[0], RuntimeCredentialRecord)
    assert rows[0].metadata.credential_type == "seller"

    visible = secret_service.list_seller_secrets_by_owner(storage, "0xdef")
    assert len(visible) == 1
    assert visible[0]["name"] == "Seller Key"
    assert visible[0]["rpm"] == 12

    deleted = asyncio.run(
        secret_service.revoke_seller_secret_for_owner(
            storage, "0xdef", rows[0].credential.credential_id
        )
    )
    assert deleted["status"] == "success"
    assert secret_service.list_seller_secrets_by_owner(storage, "0xdef") == []