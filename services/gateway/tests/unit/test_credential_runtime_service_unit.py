import asyncio
import os
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.api.schemas.pydantic_models import (
    CredentialIssueRequest,
    CredentialQuotaUpdateRequest,
)
from src.core.common import normalize_wallet
from src.domain.identity import RuntimeCredentialRecord
from src.domain.runtime_state import AuthSessionState
from src.services.platform import credential_service
from src.services.provider import secret_service
from src.utils.datetime_utils import to_dt_str


class InMemoryCredentialAuthRepository:
    def __init__(self) -> None:
        self._credential_rows = {"agent": [], "provider": []}
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
        updated = credential_service.clone_runtime_credential(
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
        self._credential_rows[credential_type][idx] = updated
        return True

    def revoke_runtime_credential(self, credential_id, owner_wallet, revoked_at):
        found = self._find_row(credential_id)
        if found is None:
            return False
        credential_type, idx, row = found
        if self._credential_owner(row) != normalize_wallet(owner_wallet):
            return False
        updated = credential_service.clone_runtime_credential(
            row,
            credential_service.CredentialPatch(
                status="revoked",
                updated_at=to_dt_str(revoked_at),
                revoked_at=int(revoked_at),
            ),
        )
        self._credential_rows[credential_type][idx] = updated
        return True

    def increment_credential_usage(self, credential_id, delta=1):
        found = self._find_row(credential_id)
        if found is None:
            return None
        credential_type, idx, row = found
        updated = credential_service.clone_runtime_credential(
            row,
            credential_service.CredentialPatch(
                calls_used=int(row.metadata.calls_used or 0) + abs(int(delta or 1))
            ),
        )
        self._credential_rows[credential_type][idx] = updated
        return updated

    def decrement_credential_usage(self, credential_id, delta=1):
        found = self._find_row(credential_id)
        if found is None:
            return None
        credential_type, idx, row = found
        updated = credential_service.clone_runtime_credential(
            row,
            credential_service.CredentialPatch(
                calls_used=max(
                    0,
                    int(row.metadata.calls_used or 0) - abs(int(delta or 1)),
                )
            ),
        )
        self._credential_rows[credential_type][idx] = updated
        return updated

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


def test_agent_credential_service_uses_runtime_models() -> None:
    storage = FakeStorage()

    issued = asyncio.run(
        credential_service.issue_credential_for_owner(
            storage,
            "0xABC",
            CredentialIssueRequest(
                name="Agent Key",
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
    assert rows[0].metadata.name == "Agent Key"

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


def test_agent_credential_datetime_round_trip_treats_naive_strings_as_utc() -> None:
    if not hasattr(time, "tzset"):
        pytest.skip("tzset is not available on this platform")

    original_tz = os.environ.get("TZ")
    target_epoch = 1_743_328_800

    try:
        os.environ["TZ"] = "Asia/Kuala_Lumpur"
        time.tzset()
        assert credential_service._dt_str_to_epoch(to_dt_str(target_epoch)) == target_epoch
        assert credential_service._dt_str_to_epoch("2026-03-30T12:00:00Z") == int(
            datetime(2026, 3, 30, 12, 0, 0, tzinfo=timezone.utc).timestamp()
        )
    finally:
        if original_tz is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = original_tz
        time.tzset()


def test_list_credentials_by_owner_supports_revoked_at_datetime_strings() -> None:
    storage = FakeStorage()

    issued = asyncio.run(
        credential_service.issue_credential_for_owner(
            storage,
            "0xABC",
            CredentialIssueRequest(name="Revoked Agent"),
        )
    )

    credential_id = issued["credential"]["id"]
    asyncio.run(
        credential_service.revoke_credential_for_owner(
            storage,
            "0xabc",
            credential_id,
            "CREDENTIAL_NOT_FOUND",
        )
    )

    rows = credential_service.list_credentials_by_owner(storage, "0xabc")

    assert len(rows) == 1
    assert rows[0]["status"] == "revoked"
    assert isinstance(rows[0]["revokedAt"], int)
    assert rows[0]["revokedAt"] > 0


def test_rotate_credential_for_owner_updates_same_runtime_record() -> None:
    storage = FakeStorage()

    issued = asyncio.run(
        credential_service.issue_credential_for_owner(
            storage,
            "0xABC",
            CredentialIssueRequest(name="Rotate Me", maxCalls=7, rpm=13, creditLimit=9.9),
        )
    )

    credential_id = issued["credential"]["id"]
    old_token = issued["credential"]["token"]
    old_prefix = issued["credential"]["tokenPrefix"]

    rotated = asyncio.run(
        credential_service.rotate_credential_for_owner(
            storage,
            "0xabc",
            credential_id,
        )
    )

    rows = credential_service.load_credential_rows(storage)
    assert len(rows) == 1
    assert rotated["credential"]["id"] == credential_id
    assert rotated["credential"]["token"] != old_token
    assert rotated["credential"]["tokenPrefix"] != old_prefix
    assert rotated["credential"]["status"] == "active"
    assert rows[0].credential.credential_id == credential_id
    assert rows[0].credential.status == "active"
    assert rows[0].credential.revoked_at is None
    assert rows[0].policy.rpm_limit == 13
    assert rows[0].metadata.max_calls == 7


def test_rotate_credential_for_owner_reactivates_revoked_record_in_place() -> None:
    storage = FakeStorage()

    issued = asyncio.run(
        credential_service.issue_credential_for_owner(
            storage,
            "0xABC",
            CredentialIssueRequest(name="Revive Me"),
        )
    )
    credential_id = issued["credential"]["id"]

    asyncio.run(
        credential_service.revoke_credential_for_owner(
            storage,
            "0xabc",
            credential_id,
            "CREDENTIAL_NOT_FOUND",
        )
    )

    rotated = asyncio.run(
        credential_service.rotate_credential_for_owner(
            storage,
            "0xabc",
            credential_id,
        )
    )

    rows = credential_service.load_credential_rows(storage)
    assert len(rows) == 1
    assert rotated["credential"]["id"] == credential_id
    assert rotated["credential"]["status"] == "active"
    assert rows[0].credential.credential_id == credential_id
    assert rows[0].credential.status == "active"
    assert rows[0].credential.revoked_at is None


def test_issue_credential_for_owner_rejects_sixth_active_agent() -> None:
    storage = FakeStorage()

    for index in range(5):
        issued = asyncio.run(
            credential_service.issue_credential_for_owner(
                storage,
                "0xABC",
                CredentialIssueRequest(name=f"Agent {index + 1}"),
            )
        )
        assert issued["status"] == "success"

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            credential_service.issue_credential_for_owner(
                storage,
                "0xabc",
                CredentialIssueRequest(name="Agent 6"),
            )
        )

    err = exc_info.value
    assert getattr(err, "status_code", None) == 409
    assert getattr(err, "detail", {}).get("code") == "AGENT_CREDENTIAL_LIMIT_REACHED"
    assert len(credential_service.load_credential_rows(storage)) == 5

    asyncio.run(
        credential_service.delete_credential_for_owner(
            storage,
            "0xabc",
            issued["credential"]["id"],
        )
    )
    replacement = asyncio.run(
        credential_service.issue_credential_for_owner(
            storage,
            "0xabc",
            CredentialIssueRequest(name="Replacement Agent"),
        )
    )
    assert replacement["status"] == "success"


def test_delete_credential_for_owner_revokes_runtime_record() -> None:
    storage = FakeStorage()

    issued = asyncio.run(
        credential_service.issue_credential_for_owner(
            storage,
            "0xABC",
            CredentialIssueRequest(name="Delete Me"),
        )
    )

    credential_id = issued["credential"]["id"]

    deleted = asyncio.run(
        credential_service.delete_credential_for_owner(
            storage,
            "0xabc",
            credential_id,
        )
    )

    assert deleted["credential"]["id"] == credential_id
    assert deleted["credential"]["name"] == "Delete Me"
    assert deleted["credential"]["status"] == "revoked"
    rows = credential_service.load_credential_rows(storage)
    assert [row.credential.credential_id for row in rows] == [credential_id]
    assert rows[0].credential.status == "revoked"
    assert storage.audit_logs.rows[-1].action == "CREDENTIAL_DELETED"


def test_provider_secret_service_uses_runtime_models() -> None:
    storage = FakeStorage()

    issued = asyncio.run(
        secret_service.issue_provider_secret_for_owner(
            storage,
            "0xDEF",
            CredentialIssueRequest(
                name="Provider Key",
                maxCalls=7,
                rpm=12,
                creditLimit=4.2,
                resetInterval="weekly",
            ),
        )
    )

    assert issued["status"] == "success"
    assert issued["secret"]["ownerAddress"] == "0xDEF"

    rows = secret_service.load_provider_secret_rows(storage)
    assert len(rows) == 1
    assert isinstance(rows[0], RuntimeCredentialRecord)
    assert rows[0].metadata.credential_type == "provider"

    visible = secret_service.list_provider_secrets_by_owner(storage, "0xdef")
    assert len(visible) == 1
    assert visible[0]["name"] == "Provider Key"
    assert visible[0]["rpm"] == 12

    deleted = asyncio.run(
        secret_service.revoke_provider_secret_for_owner(
            storage, "0xdef", rows[0].credential.credential_id
        )
    )
    assert deleted["status"] == "success"
    assert secret_service.list_provider_secrets_by_owner(storage, "0xdef") == []
