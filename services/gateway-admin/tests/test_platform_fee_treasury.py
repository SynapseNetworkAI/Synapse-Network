from uuid import uuid4

from fastapi.testclient import TestClient

from src.api.routers import platform_fee_treasury
from src.app import create_app
from src.core.config import Settings
from src.core.csrf import build_admin_csrf_token
from src.core.security import hash_password
from src.core.totp import generate_totp_code
from src.services.auth.service import AdminAuthService
from src.services.finance_admin import PlatformFeeTreasuryService
from src.storage import InMemoryAdminStore

PLACEHOLDER_PASSWORD = "phase1-placeholder"
PLATFORM_SAFE_ADDRESS = "0x1111111111111111111111111111111111111111"
PLATFORM_LEDGER_ADDRESS = "0x2222222222222222222222222222222222222222"
SYNAPSE_CORE_ADDRESS = "0x3333333333333333333333333333333333333333"
TOKEN_UNIT = 10**18


class FakePlatformFeeChainReader:
    def __init__(
        self,
        *,
        owner: str = PLATFORM_SAFE_ADDRESS,
        platform_fee_pool: int = 10 * TOKEN_UNIT,
    ) -> None:
        self.owner = owner.lower()
        self.platform_fee_pool = platform_fee_pool

    def read_owner(self, contract_address: str) -> str:
        _ = contract_address
        return self.owner

    def read_platform_fee_pool(self, contract_address: str) -> int:
        _ = contract_address
        return self.platform_fee_pool


def _platform_fee_settings() -> Settings:
    settings = Settings()
    settings.synapse_core_address = SYNAPSE_CORE_ADDRESS
    settings.platform_treasury_safe_address = PLATFORM_SAFE_ADDRESS
    settings.platform_treasury_ledger_signer_address = PLATFORM_LEDGER_ADDRESS
    settings.platform_fee_token_decimals = 18
    return settings


def _test_store() -> InMemoryAdminStore:
    store = InMemoryAdminStore.seed_demo()
    for email in ("cliff@synapse-network.ai", "finance-review@synapse-network.ai"):
        user = store.identity.get_user_by_email(email)
        assert user is not None
        store.identity.update_password_hash(user.admin_id, hash_password(PLACEHOLDER_PASSWORD))
    return store


def _otp_code_for(store: InMemoryAdminStore, email: str) -> str:
    user = store.identity.get_user_by_email(email)
    assert user is not None
    factors = store.identity.list_mfa_factors(user.admin_id)
    secret = next(str(factor.payload.get("totpSecret") or "") for factor in factors if factor.payload.get("totpSecret"))
    return generate_totp_code(secret)


def _create_client(
    *,
    chain_reader: FakePlatformFeeChainReader | None = None,
) -> tuple[TestClient, InMemoryAdminStore]:
    store = _test_store()
    app = create_app()
    app.dependency_overrides[platform_fee_treasury.get_store] = lambda: store
    app.dependency_overrides[platform_fee_treasury.get_platform_fee_treasury_service] = lambda: PlatformFeeTreasuryService(
        store,
        _platform_fee_settings(),
        chain_reader or FakePlatformFeeChainReader(),
    )
    from src.api import deps

    app.dependency_overrides[deps.get_store] = lambda: store
    app.dependency_overrides[deps.get_auth_service] = lambda: AdminAuthService(store)
    return TestClient(app), store


def _login(client: TestClient, store: InMemoryAdminStore, email: str = "cliff@synapse-network.ai") -> dict[str, str]:
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": email,
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": _otp_code_for(store, email),
        },
    )
    assert response.status_code == 200
    session_token = client.cookies.get("synapse_admin_session")
    assert session_token is not None
    return {"X-CSRF-Token": build_admin_csrf_token(session_token)}


def _high_risk_headers(
    client: TestClient,
    store: InMemoryAdminStore,
    email: str = "cliff@synapse-network.ai",
) -> dict[str, str]:
    return {
        **_login(client, store, email),
        "X-Admin-OTP-Code": _otp_code_for(store, email),
    }


def test_platform_fee_safe_draft_builds_hardcoded_safe_transaction() -> None:
    client, store = _create_client()
    request_id = f"platform-fee-test-{uuid4().hex}"

    response = client.post(
        "/api/admin/v1/platform-fee-withdrawals/safe-draft",
        headers=_high_risk_headers(client, store),
        json={
            "requestId": request_id,
            "amountUsdc": "1.250000",
            "reason": "Move accrued platform fees to Safe treasury.",
        },
    )

    assert response.status_code == 200
    draft = response.json()["data"]
    assert draft["status"] == "ready_for_safe"
    assert draft["requestId"] == request_id
    assert draft["amountAtomic"] == str(125 * TOKEN_UNIT // 100)
    assert draft["safeAddress"] == PLATFORM_SAFE_ADDRESS
    assert draft["ledgerSignerAddress"] == PLATFORM_LEDGER_ADDRESS
    assert draft["synapseCoreAddress"] == SYNAPSE_CORE_ADDRESS
    assert draft["selector"] == "0x6aa21416"
    assert draft["safeTx"]["to"] == SYNAPSE_CORE_ADDRESS
    assert draft["safeTx"]["value"] == "0"
    assert draft["safeTx"]["operation"] == 0
    assert draft["safeTx"]["data"].startswith("0x6aa21416")

    audit = store.audit.list_actions(
        action_type="platform_fee_withdrawal.safe_draft_created",
        result_status="success",
        limit=1,
    )[0]
    assert audit.resource_id == request_id
    assert audit.detail["safeAddress"] == PLATFORM_SAFE_ADDRESS
    assert audit.detail["selector"] == "0x6aa21416"
    assert audit.after["safeTx"]["to"] == SYNAPSE_CORE_ADDRESS


def test_platform_fee_safe_draft_requires_super_admin_role() -> None:
    client, store = _create_client()

    response = client.post(
        "/api/admin/v1/platform-fee-withdrawals/safe-draft",
        headers=_high_risk_headers(client, store, "finance-review@synapse-network.ai"),
        json={
            "requestId": f"platform-fee-test-{uuid4().hex}",
            "amountUsdc": "1.000000",
            "reason": "Finance reviewer should not draft treasury Safe transactions.",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["message"] == "Super admin role required"


def test_platform_fee_safe_draft_rejects_frontend_execution_intent_fields() -> None:
    client, store = _create_client()

    response = client.post(
        "/api/admin/v1/platform-fee-withdrawals/safe-draft",
        headers=_high_risk_headers(client, store),
        json={
            "requestId": f"platform-fee-test-{uuid4().hex}",
            "amountUsdc": "1.000000",
            "reason": "Attempt to smuggle frontend tx fields.",
            "to": "0x9999999999999999999999999999999999999999",
            "data": "0xdeadbeef",
            "functionName": "transferOwnership",
            "recipient": "0x9999999999999999999999999999999999999999",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_platform_fee_safe_draft_is_idempotent_by_request_id() -> None:
    client, store = _create_client()
    request_id = f"platform-fee-test-{uuid4().hex}"
    payload = {
        "requestId": request_id,
        "amountUsdc": "0.500000",
        "reason": "Draft once for Safe execution.",
    }
    headers = _high_risk_headers(client, store)

    first_response = client.post(
        "/api/admin/v1/platform-fee-withdrawals/safe-draft",
        headers=headers,
        json=payload,
    )
    second_response = client.post(
        "/api/admin/v1/platform-fee-withdrawals/safe-draft",
        headers=headers,
        json=payload,
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 400
    assert second_response.json()["error"]["message"] == "Platform fee withdrawal request was already drafted"


def test_platform_fee_safe_draft_requires_safe_to_own_synapse_core() -> None:
    client, store = _create_client(
        chain_reader=FakePlatformFeeChainReader(owner="0x4444444444444444444444444444444444444444"),
    )

    response = client.post(
        "/api/admin/v1/platform-fee-withdrawals/safe-draft",
        headers=_high_risk_headers(client, store),
        json={
            "requestId": f"platform-fee-test-{uuid4().hex}",
            "amountUsdc": "1.000000",
            "reason": "Should fail because Safe is not SynapseCore owner.",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "SynapseCore.owner() must equal PLATFORM_TREASURY_SAFE_ADDRESS"


def test_platform_fee_safe_draft_rejects_amount_above_platform_fee_pool() -> None:
    client, store = _create_client(
        chain_reader=FakePlatformFeeChainReader(platform_fee_pool=TOKEN_UNIT // 10),
    )

    response = client.post(
        "/api/admin/v1/platform-fee-withdrawals/safe-draft",
        headers=_high_risk_headers(client, store),
        json={
            "requestId": f"platform-fee-test-{uuid4().hex}",
            "amountUsdc": "1.000000",
            "reason": "Should fail because fee pool is too small.",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "Requested amount exceeds SynapseCore.platformFeePool()"
