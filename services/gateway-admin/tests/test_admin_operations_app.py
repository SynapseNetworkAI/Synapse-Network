from decimal import Decimal

import pytest

from src.api import deps
from src.domain import AdminRolePermission
from src.services.admin_operations import AdminOperationsService
from src.storage.analytics.admin_operations_models import (
    ConsumerDepositDetail,
    ConsumerDepositPage,
    ConsumerDepositRecord,
    OwnerAccountDetail,
    OwnerAccountPage,
    OwnerAccountRecord,
    OwnerBalanceSummary,
    Pagination,
    ProviderWithdrawalDetail,
    ProviderWithdrawalPage,
    ProviderWithdrawalRecord,
)

from test_app import TEST_STORE, app, client, _login_as


OWNER_READ = "owner:read"
OWNER_PII_READ = "owner:pii:read"
FINANCE_READ = "finance:read"
FINANCE_EXPORT = "finance:export"


class FakeAdminOperationsRepository:
    def __init__(self) -> None:
        self.owner = OwnerAccountRecord(
            owner_id="own_demo",
            owner_wallet="0x8f3a2c6d4b1180e6ac93d55aefe34c81a8d6d111",
            account_name="Demo owner",
            email="owner@example.com",
            email_verified=True,
            pending_email=None,
            status="active",
            roles=("consumer", "provider"),
            agent_count=2,
            provider_service_count=1,
            support_case_count=1,
            created_at="2026-04-01T00:00:00Z",
            updated_at="2026-04-02T00:00:00Z",
            last_active_at="2026-04-03T00:00:00Z",
        )
        self.deposit = ConsumerDepositRecord(
            deposit_id="dep_demo",
            owner_id="own_demo",
            owner_wallet=self.owner.owner_wallet,
            owner_email="owner@example.com",
            tx_hash="0xdeposit",
            amount_usdc=Decimal("25.000000"),
            network="Arbitrum Sepolia",
            status="CONFIRMED",
            confirmations=12,
            credited_at="2026-04-02T00:00:00Z",
            created_at="2026-04-02T00:00:00Z",
            updated_at="2026-04-02T00:00:00Z",
        )
        self.withdrawal = ProviderWithdrawalRecord(
            withdrawal_id="wd_demo",
            provider_id="prov_demo",
            provider_name="Demo provider",
            owner_id="own_demo",
            owner_wallet=self.owner.owner_wallet,
            owner_email="owner@example.com",
            amount_usdc=Decimal("10.000000"),
            fee_usdc=Decimal("1.000000"),
            status="COMPLETED",
            tx_hash="0xwithdraw",
            ticket_id="ticket_demo",
            request_id="req_demo",
            review_decision="APPROVE",
            funds_state="claimed",
            created_at="2026-04-03T00:00:00Z",
            updated_at="2026-04-03T00:00:00Z",
        )

    def list_owner_accounts(self, **kwargs) -> OwnerAccountPage:
        _ = kwargs
        return OwnerAccountPage(items=(self.owner,), pagination=Pagination(1, 50, 1, 1))

    def get_owner_account(self, owner_id: str) -> OwnerAccountDetail | None:
        if owner_id != self.owner.owner_id:
            return None
        return OwnerAccountDetail(
            account=self.owner,
            balances=OwnerBalanceSummary(
                consumer_available_usdc=Decimal("15.000000"),
                consumer_frozen_usdc=Decimal("0.000000"),
                provider_available_usdc=Decimal("9.000000"),
                provider_frozen_usdc=Decimal("0.000000"),
            ),
            recent_deposits=(self.deposit,),
            recent_provider_withdrawals=(self.withdrawal,),
            recent_invocations=(),
            support_cases=(),
        )

    def list_consumer_deposits(self, **kwargs) -> ConsumerDepositPage:
        _ = kwargs
        return ConsumerDepositPage(items=(self.deposit,), pagination=Pagination(1, 50, 1, 1))

    def get_consumer_deposit(self, deposit_id: str) -> ConsumerDepositDetail | None:
        if deposit_id != self.deposit.deposit_id:
            return None
        return ConsumerDepositDetail(
            deposit=self.deposit,
            ledger_entries=(),
            audit_events=(),
            notification_events=(),
        )

    def list_provider_withdrawals(self, **kwargs) -> ProviderWithdrawalPage:
        _ = kwargs
        return ProviderWithdrawalPage(items=(self.withdrawal,), pagination=Pagination(1, 50, 1, 1))

    def get_provider_withdrawal(self, withdrawal_id: str) -> ProviderWithdrawalDetail | None:
        if withdrawal_id != self.withdrawal.withdrawal_id:
            return None
        return ProviderWithdrawalDetail(
            withdrawal=self.withdrawal,
            ledger_entries=(),
            audit_events=(),
            notification_events=(),
            review_history=(),
        )


def _grant_role_permissions(role_key: str, permission_keys: tuple[str, ...]) -> None:
    existing = TEST_STORE.authorization.list_role_permissions(role_key)
    existing_keys = {permission.permission_key for permission in existing}
    additions = [
        AdminRolePermission(role_key, permission_key)
        for permission_key in permission_keys
        if permission_key not in existing_keys
    ]
    TEST_STORE.authorization.replace_role_permissions(role_key, [*existing, *additions])


app.dependency_overrides[deps.get_admin_operations_service] = lambda: AdminOperationsService(
    FakeAdminOperationsRepository(), TEST_STORE
)


@pytest.fixture(autouse=True)
def _admin_operations_permissions():
    original_super = TEST_STORE.authorization.list_role_permissions("super_admin")
    original_finance = TEST_STORE.authorization.list_role_permissions("finance_admin")
    _grant_role_permissions("super_admin", (OWNER_READ, OWNER_PII_READ, FINANCE_READ, FINANCE_EXPORT))
    _grant_role_permissions("finance_admin", (OWNER_READ, FINANCE_READ, FINANCE_EXPORT))
    yield
    TEST_STORE.authorization.replace_role_permissions("super_admin", original_super)
    TEST_STORE.authorization.replace_role_permissions("finance_admin", original_finance)


def test_admin_operations_owner_accounts_mask_pii_by_default() -> None:
    _login_as("finance@synapse-network.ai")

    response = client.get("/api/admin/v1/owner-accounts")

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["items"][0]["ownerId"] == "own_demo"
    assert body["items"][0]["email"] == "o***r@example.com"
    assert body["items"][0]["emailVerified"] is True
    assert body["pagination"]["total"] == 1


def test_admin_operations_pii_reveal_requires_permission_and_audits() -> None:
    _login_as("finance@synapse-network.ai")
    denied = client.get("/api/admin/v1/owner-accounts?includeEmail=true")
    assert denied.status_code == 403

    _login_as("cliff@synapse-network.ai")
    response = client.get("/api/admin/v1/owner-accounts?includeEmail=true")

    assert response.status_code == 200
    assert response.json()["data"]["items"][0]["email"] == "owner@example.com"
    assert TEST_STORE.audit.list_actions(
        action_type="owner_account.pii_reveal",
        operator_id="adm_super_admin",
    )


def test_admin_operations_finance_lists_include_deposits_and_provider_withdrawals() -> None:
    _login_as("finance@synapse-network.ai")

    deposits = client.get("/api/admin/v1/finance/consumer-deposits?txHash=0xdeposit")
    withdrawals = client.get("/api/admin/v1/finance/provider-withdrawals?status=COMPLETED")

    assert deposits.status_code == 200
    assert deposits.json()["data"]["items"][0]["depositId"] == "dep_demo"
    assert deposits.json()["data"]["items"][0]["ownerEmail"] == "o***r@example.com"
    assert withdrawals.status_code == 200
    assert withdrawals.json()["data"]["items"][0]["withdrawalId"] == "wd_demo"
    assert withdrawals.json()["data"]["items"][0]["fundsState"] == "claimed"


def test_admin_operations_detail_endpoints_mask_pii_and_return_evidence() -> None:
    _login_as("finance@synapse-network.ai")

    owner = client.get("/api/admin/v1/owner-accounts/own_demo")
    deposit = client.get("/api/admin/v1/finance/consumer-deposits/dep_demo")
    withdrawal = client.get("/api/admin/v1/finance/provider-withdrawals/wd_demo")

    assert owner.status_code == 200
    assert owner.json()["data"]["account"]["email"] == "o***r@example.com"
    assert owner.json()["data"]["balances"]["consumerAvailableUsdc"] == "15.000000"
    assert deposit.status_code == 200
    assert deposit.json()["data"]["deposit"]["ownerEmail"] == "o***r@example.com"
    assert withdrawal.status_code == 200
    assert withdrawal.json()["data"]["withdrawal"]["ownerEmail"] == "o***r@example.com"


def test_admin_operations_detail_endpoints_return_not_found() -> None:
    _login_as("finance@synapse-network.ai")

    owner = client.get("/api/admin/v1/owner-accounts/missing")
    deposit = client.get("/api/admin/v1/finance/consumer-deposits/missing")
    withdrawal = client.get("/api/admin/v1/finance/provider-withdrawals/missing")

    assert owner.status_code == 404
    assert deposit.status_code == 404
    assert withdrawal.status_code == 404
