# pyright: reportMissingImports=false

import pytest

from src.api.schemas.pydantic_models import CredentialIssueRequest
from src.services.platform import credential_service
from src.services.seller import secret_service


@pytest.mark.asyncio
async def test_issue_seller_secret_persists_string_timestamps(temp_storage):
    req = CredentialIssueRequest(name="seller-key", rpm=60)
    captured_rows = []

    def _capture_write(_credential_type, rows):
        captured_rows.extend(rows)

    temp_storage.get_data_manager().system.credential_auth.write_credential_rows = _capture_write

    result = await secret_service.issue_seller_secret_for_owner(temp_storage, "0xabc", req)

    secret = result["secret"]
    assert isinstance(secret["createdAt"], str)
    assert len(captured_rows) == 1
    assert isinstance(captured_rows[0].created_at, str)
    assert isinstance(captured_rows[0].updated_at, str)


def test_list_seller_secrets_accepts_datetime_string_created_at(temp_storage):
    temp_storage.get_data_manager().system.credential_auth.read_credential_rows = lambda _credential_type: [
        {
            "id": "s-1",
            "credentialType": "seller",
            "ownerAddress": "0xabc",
            "name": "new",
            "tokenPrefix": "agt_new",
            "status": "active",
            "createdAt": "2026-03-15 12:00:00",
            "updatedAt": "2026-03-15 12:00:00",
        },
        {
            "id": "s-0",
            "credentialType": "seller",
            "ownerAddress": "0xabc",
            "name": "old",
            "tokenPrefix": "agt_old",
            "status": "active",
            "createdAt": "2026-03-15 11:00:00",
            "updatedAt": "2026-03-15 11:00:00",
        },
    ]

    rows = secret_service.list_seller_secrets_by_owner(temp_storage, "0xabc")

    assert [item["id"] for item in rows] == ["s-1", "s-0"]


def test_list_seller_secrets_hides_revoked_rows(temp_storage):
    temp_storage.get_data_manager().system.credential_auth.read_credential_rows = lambda _credential_type: [
        {
            "id": "active-1",
            "credentialType": "seller",
            "ownerAddress": "0xabc",
            "name": "active",
            "tokenPrefix": "agt_active",
            "status": "active",
            "createdAt": "2026-03-15 12:00:00",
            "updatedAt": "2026-03-15 12:00:00",
            "revokedAt": None,
        },
        {
            "id": "revoked-1",
            "credentialType": "seller",
            "ownerAddress": "0xabc",
            "name": "revoked",
            "tokenPrefix": "agt_revoked",
            "status": "revoked",
            "createdAt": "2026-03-15 11:00:00",
            "updatedAt": "2026-03-15 12:30:00",
            "revokedAt": 1773579000,
        },
    ]

    rows = secret_service.list_seller_secrets_by_owner(temp_storage, "0xabc")

    assert [item["id"] for item in rows] == ["active-1"]


@pytest.mark.asyncio
async def test_issue_buyer_credential_persists_string_timestamps(temp_storage):
    req = CredentialIssueRequest(name="buyer-key", rpm=120)
    captured_rows = []

    def _capture_write(_credential_type, rows):
        captured_rows.extend(rows)

    temp_storage.get_data_manager().system.credential_auth.write_credential_rows = _capture_write

    result = await credential_service.issue_credential_for_owner(temp_storage, "0xabc", req)

    credential = result["credential"]
    assert isinstance(credential["createdAt"], str)
    assert isinstance(credential["updatedAt"], str)
    assert len(captured_rows) == 1
    assert isinstance(captured_rows[0].created_at, str)
    assert isinstance(captured_rows[0].updated_at, str)
