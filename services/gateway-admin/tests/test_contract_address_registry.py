from decimal import Decimal
from types import SimpleNamespace

from fastapi.testclient import TestClient

from src.api.routers import contract_addresses
from src.app import create_app
from src.core.config import Settings
from src.core.csrf import build_admin_csrf_token
from src.core.security import hash_password
from src.core.totp import generate_totp_code
from src.core.totp_secret_store import factor_totp_secret
from src.services.auth.service import AdminAuthService
from src.services.finance_admin import ContractAddressRegistryService
from src.storage import InMemoryAdminStore

PLACEHOLDER_PASSWORD = "phase1-placeholder"
SYNAPSE_CORE_ADDRESS = "0x4967d23cAbe3881f809677932Cc30c11de6957B0"
USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
TREASURY_SAFE_ADDRESS = "0xA8A49dcd8AC6319ca789316Cc8022e316aF13C33"
LEDGER_SIGNER_ADDRESS = "0x121a2aDbe1b7d3aA41C47058af790439897a9034"
WITHDRAW_SIGNER_ADDRESS = "0x0d0b4b2F8d49e5210e2f023f0508e2fAB6b6c0Ee"


class FakeContractRegistryChainReader:
    def __init__(
        self,
        *,
        owner: str = TREASURY_SAFE_ADDRESS,
        platform_signer: str = WITHDRAW_SIGNER_ADDRESS,
        usdc: str = USDC_ADDRESS,
        vault_usdc: int = 2_000 * 10**6,
        platform_fee_pool: int = 123 * 10**6,
    ) -> None:
        self.owner = owner.lower()
        self.platform_signer = platform_signer.lower()
        self.usdc = usdc.lower()
        self.vault_usdc = vault_usdc
        self.platform_fee_pool = platform_fee_pool

    def block_number(self) -> int:
        return 1234567

    def read_address(self, contract_address: str, selector: str) -> str:
        _ = contract_address
        if selector == "0x8da5cb5b":
            return self.owner
        if selector == "0xba92ddbc":
            return self.platform_signer
        if selector == "0x3e413bee":
            return self.usdc
        raise AssertionError(f"unexpected selector {selector}")

    def read_uint(self, contract_address: str, selector: str) -> int:
        _ = contract_address
        if selector == "0x622aef9e":
            return self.platform_fee_pool
        raise AssertionError(f"unexpected selector {selector}")

    def native_balance(self, address: str) -> int:
        if address.lower() == LEDGER_SIGNER_ADDRESS.lower():
            return 2 * 10**18
        if address.lower() == WITHDRAW_SIGNER_ADDRESS.lower():
            return 1 * 10**18
        return 0

    def erc20_balance(self, token_address: str, holder_address: str) -> int:
        assert token_address.lower() == USDC_ADDRESS.lower()
        if holder_address.lower() == SYNAPSE_CORE_ADDRESS.lower():
            return self.vault_usdc
        return 0

    def erc20_decimals(self, token_address: str) -> int:
        assert token_address.lower() == USDC_ADDRESS.lower()
        return 6


class FailingContractRegistryChainReader(FakeContractRegistryChainReader):
    def block_number(self) -> int:
        raise RuntimeError("RPC exploded with secret value")


class FakeDashboardService:
    def get_finance_overview(self) -> dict[str, str]:
        return {
            "platformFeeBalanceUsdc": "120.000000",
            "todayPlatformFeeEarnedUsdc": "3.500000",
            "vaultLedgerDeltaUsdc": "50.000000",
        }

    def get_reconciliation_detail(self) -> dict[str, str]:
        return {
            "ledgerObligationUsdc": "1950.000000",
            "reconciliationDeltaUsdc": "50.000000",
        }

    def get_analytics_invocation_revenue(self, window: str) -> dict[str, str]:
        return {"platformFeeUsdc": "17.000000" if window == "7d" else "53.000000"}


class RoundedDashboardService(FakeDashboardService):
    def get_finance_overview(self) -> dict[str, str]:
        return {
            "platformFeeBalanceUsdc": "120.00",
            "todayPlatformFeeEarnedUsdc": "3.50",
            "vaultLedgerDeltaUsdc": "50.00",
        }

    def get_reconciliation_detail(self) -> dict[str, str]:
        return {
            "ledgerObligationUsdc": "1950.00",
            "reconciliationDeltaUsdc": "50.00",
        }


class FakeGatewayProjection:
    def get_finance_snapshot(self) -> SimpleNamespace:
        return SimpleNamespace(
            platform_fee_balance_usdc=Decimal("120.123456"),
            today_platform_fee_earned_usdc=Decimal("3.654321"),
        )

    def get_reconciliation_runtime_state(self) -> SimpleNamespace:
        return SimpleNamespace(
            ledger_obligation_usdc=Decimal("1950.987654"),
            delta_usdc=Decimal("50.111111"),
        )


def _settings() -> Settings:
    settings = Settings()
    settings.environment = "production"
    settings.chain_id = 42161
    settings.chain_name = "Arbitrum One"
    settings.explorer_base_url = "https://arbiscan.io"
    settings.synapse_core_address = SYNAPSE_CORE_ADDRESS
    settings.usdc_token_address = USDC_ADDRESS
    settings.platform_treasury_safe_address = TREASURY_SAFE_ADDRESS
    settings.platform_treasury_ledger_signer_address = LEDGER_SIGNER_ADDRESS
    settings.withdraw_signer_address = WITHDRAW_SIGNER_ADDRESS
    settings.platform_fee_token_decimals = 6
    settings.contract_registry_min_signer_native_balance = "0.010000"
    return settings


def _service(
    *,
    chain_reader: FakeContractRegistryChainReader | None = None,
    dashboard_service: FakeDashboardService | None = None,
    gateway_projection: FakeGatewayProjection | None = None,
) -> ContractAddressRegistryService:
    return ContractAddressRegistryService(
        _settings(),
        dashboard_service or FakeDashboardService(),  # type: ignore[arg-type] - test fake implements the dashboard methods used by this service
        chain_reader or FakeContractRegistryChainReader(),
        gateway_projection,  # type: ignore[arg-type] - test fake implements the projection methods used by this service
    )


def _test_store() -> InMemoryAdminStore:
    store = InMemoryAdminStore.seed_demo()
    user = store.identity.get_user_by_email("cliff@synapse-network.ai")
    assert user is not None
    store.identity.update_password_hash(user.admin_id, hash_password(PLACEHOLDER_PASSWORD))
    return store


def _otp_code_for(store: InMemoryAdminStore, email: str) -> str:
    user = store.identity.get_user_by_email(email)
    assert user is not None
    factors = store.identity.list_mfa_factors(user.admin_id)
    secret = next(factor_totp_secret(factor) for factor in factors if factor_totp_secret(factor))
    return generate_totp_code(secret)


def _create_client(
    service: ContractAddressRegistryService | None = None,
) -> tuple[TestClient, InMemoryAdminStore]:
    store = _test_store()
    app = create_app()
    app.dependency_overrides[contract_addresses.get_contract_address_registry_service] = lambda: service or _service()
    from src.api import deps

    app.dependency_overrides[deps.get_store] = lambda: store
    app.dependency_overrides[deps.get_auth_service] = lambda: AdminAuthService(store)
    return TestClient(app), store


def _login(client: TestClient, store: InMemoryAdminStore) -> dict[str, str]:
    response = client.post(
        "/api/admin/v1/auth/login",
        json={
            "email": "cliff@synapse-network.ai",
            "password": PLACEHOLDER_PASSWORD,
            "otpCode": _otp_code_for(store, "cliff@synapse-network.ai"),
        },
    )
    assert response.status_code == 200
    session_token = client.cookies.get("synapse_admin_session")
    assert session_token is not None
    return {"X-CSRF-Token": build_admin_csrf_token(session_token)}


def test_contract_registry_service_returns_public_addresses_and_balances() -> None:
    registry = _service().get_registry()

    assert registry["network"]["env"] == "prod"
    assert registry["network"]["chainId"] == 42161
    assert registry["network"]["latestBlock"] == 1234567
    assert registry["network"]["rpcStatus"] == "healthy"
    assert registry["balances"]["vaultUsdc"] == "2000.000000"
    assert registry["balances"]["platformFeePoolUsdc"] == "123.000000"
    assert registry["balances"]["ledgerObligationUsdc"] == "1950.000000"
    assert registry["feeSummary"]["sevenDayPlatformFeeUsdc"] == "17.000000"
    assert all(check["status"] == "ok" for check in registry["contractChecks"])

    serialized = str(registry).lower()
    assert "private key" not in serialized
    assert "secret" not in serialized


def test_contract_registry_service_uses_precise_projection_values_for_evidence() -> None:
    registry = _service(
        dashboard_service=RoundedDashboardService(),
        gateway_projection=FakeGatewayProjection(),
    ).get_registry()

    assert registry["balances"]["ledgerPlatformFeeUsdc"] == "120.123456"
    assert registry["balances"]["ledgerObligationUsdc"] == "1950.987654"
    assert registry["balances"]["vaultLedgerDeltaUsdc"] == "50.111111"
    assert registry["feeSummary"]["todayPlatformFeeUsdc"] == "3.654321"


def test_contract_registry_service_flags_owner_mismatch_as_critical() -> None:
    registry = _service(
        chain_reader=FakeContractRegistryChainReader(
            owner="0x9999999999999999999999999999999999999999"
        )
    ).get_registry()

    owner_check = next(check for check in registry["contractChecks"] if check["key"] == "owner")
    assert owner_check["expected"] == TREASURY_SAFE_ADDRESS
    assert owner_check["actual"] == "0x9999999999999999999999999999999999999999"
    assert owner_check["status"] == "critical"


def test_contract_registry_service_degrades_when_rpc_is_unavailable() -> None:
    registry = _service(chain_reader=FailingContractRegistryChainReader()).get_registry()

    assert registry["network"]["rpcStatus"] == "degraded"
    assert registry["network"]["latestBlock"] is None
    assert registry["balances"]["vaultUsdc"] == "unavailable"
    assert all(check["status"] == "critical" for check in registry["contractChecks"])


def test_contract_registry_api_requires_dashboard_read_and_returns_registry() -> None:
    client, store = _create_client()

    unauthorized = client.get("/api/admin/v1/contract-addresses")
    assert unauthorized.status_code == 401

    response = client.get("/api/admin/v1/contract-addresses", headers=_login(client, store))
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["contracts"][0]["label"] == "SynapseCore"
    assert data["contractChecks"][0]["label"] == "SynapseCore.owner()"
    assert data["roles"][0]["label"] == "Ledger deployer / Safe owner signer"
    assert data["balances"]["ledgerPlatformFeeUsdc"] == "120.000000"
