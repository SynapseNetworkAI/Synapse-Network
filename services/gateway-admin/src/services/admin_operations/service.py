from dataclasses import replace
from datetime import datetime, timezone

from src.core.errors import AuthorizationError, ResourceNotFoundError
from src.domain import AdminActionAudit
from src.domain.enums import AuditResultStatus
from src.services.auth.service import AdminIdentity
from src.storage.analytics.admin_operations_models import (
    ConsumerDepositDetail,
    ConsumerDepositPage,
    ConsumerDepositRecord,
    OwnerAccountDetail,
    OwnerAccountPage,
    OwnerAccountRecord,
    ProviderWithdrawalDetail,
    ProviderWithdrawalPage,
    ProviderWithdrawalRecord,
)
from src.storage.analytics.admin_operations_repository import AdminOperationsRepository
from src.storage.base import AdminStore


PII_READ_PERMISSION = "owner:pii:read"
SHORT_EMAIL_LOCAL_PART_MAX = 2
OWNER_ACCOUNT_NOT_FOUND = "Owner account not found"
CONSUMER_DEPOSIT_NOT_FOUND = "Consumer deposit not found"
PROVIDER_WITHDRAWAL_NOT_FOUND = "Provider withdrawal not found"
OWNER_PII_PERMISSION_MISSING = "Missing permission: owner:pii:read"


def _mask_email(value: str | None) -> str | None:
    if not value:
        return None
    local, sep, domain = value.partition("@")
    if not sep:
        return "***"
    masked_local = (
        local[0] + "***"
        if len(local) <= SHORT_EMAIL_LOCAL_PART_MAX
        else f"{local[0]}***{local[-1]}"
    )
    return f"{masked_local}@{domain}"


def _mask_owner(item: OwnerAccountRecord, include_pii: bool) -> OwnerAccountRecord:
    if include_pii:
        return item
    return replace(
        item,
        email=_mask_email(item.email),
        pending_email=_mask_email(item.pending_email),
    )


def _mask_deposit(item: ConsumerDepositRecord, include_pii: bool) -> ConsumerDepositRecord:
    return item if include_pii else replace(item, owner_email=_mask_email(item.owner_email))


def _mask_withdrawal(item: ProviderWithdrawalRecord, include_pii: bool) -> ProviderWithdrawalRecord:
    return item if include_pii else replace(item, owner_email=_mask_email(item.owner_email))


class AdminOperationsService:
    def __init__(self, repository: AdminOperationsRepository, store: AdminStore) -> None:
        self._repository = repository
        self._store = store

    def list_owner_accounts(
        self,
        *,
        operator: AdminIdentity,
        include_pii: bool,
        q: str | None,
        wallet: str | None,
        email: str | None,
        status: str | None,
        page: int,
        page_size: int,
        sort: str,
    ) -> OwnerAccountPage:
        self._ensure_pii_allowed(operator, include_pii, "owner_accounts")
        result = self._repository.list_owner_accounts(
            q=q,
            wallet=wallet,
            email=email,
            status=status,
            page=page,
            page_size=page_size,
            sort=sort,
        )
        return replace(result, items=tuple(_mask_owner(item, include_pii) for item in result.items))

    def get_owner_account(self, *, operator: AdminIdentity, owner_id: str, include_pii: bool) -> OwnerAccountDetail:
        self._ensure_pii_allowed(operator, include_pii, owner_id)
        result = self._repository.get_owner_account(owner_id)
        if result is None:
            raise ResourceNotFoundError(OWNER_ACCOUNT_NOT_FOUND)
        return replace(
            result,
            account=_mask_owner(result.account, include_pii),
            recent_deposits=tuple(_mask_deposit(item, include_pii) for item in result.recent_deposits),
            recent_provider_withdrawals=tuple(
                _mask_withdrawal(item, include_pii) for item in result.recent_provider_withdrawals
            ),
        )

    def list_consumer_deposits(
        self,
        *,
        operator: AdminIdentity,
        wallet: str | None,
        tx_hash: str | None,
        status: str | None,
        date_from: str | None,
        date_to: str | None,
        page: int,
        page_size: int,
        sort: str,
    ) -> ConsumerDepositPage:
        _ = operator
        result = self._repository.list_consumer_deposits(
            wallet=wallet,
            tx_hash=tx_hash,
            status=status,
            date_from=date_from,
            date_to=date_to,
            page=page,
            page_size=page_size,
            sort=sort,
        )
        return replace(result, items=tuple(_mask_deposit(item, False) for item in result.items))

    def get_consumer_deposit(self, *, operator: AdminIdentity, deposit_id: str) -> ConsumerDepositDetail:
        _ = operator
        result = self._repository.get_consumer_deposit(deposit_id)
        if result is None:
            raise ResourceNotFoundError(CONSUMER_DEPOSIT_NOT_FOUND)
        return replace(result, deposit=_mask_deposit(result.deposit, False))

    def list_provider_withdrawals(
        self,
        *,
        operator: AdminIdentity,
        wallet: str | None,
        tx_hash: str | None,
        status: str | None,
        date_from: str | None,
        date_to: str | None,
        page: int,
        page_size: int,
        sort: str,
    ) -> ProviderWithdrawalPage:
        _ = operator
        result = self._repository.list_provider_withdrawals(
            wallet=wallet,
            tx_hash=tx_hash,
            status=status,
            date_from=date_from,
            date_to=date_to,
            page=page,
            page_size=page_size,
            sort=sort,
        )
        return replace(result, items=tuple(_mask_withdrawal(item, False) for item in result.items))

    def get_provider_withdrawal(self, *, operator: AdminIdentity, withdrawal_id: str) -> ProviderWithdrawalDetail:
        _ = operator
        result = self._repository.get_provider_withdrawal(withdrawal_id)
        if result is None:
            raise ResourceNotFoundError(PROVIDER_WITHDRAWAL_NOT_FOUND)
        return replace(result, withdrawal=_mask_withdrawal(result.withdrawal, False))

    def _ensure_pii_allowed(self, operator: AdminIdentity, include_pii: bool, resource_id: str) -> None:
        if not include_pii:
            return
        if PII_READ_PERMISSION not in operator.permissions:
            raise AuthorizationError(OWNER_PII_PERMISSION_MISSING)
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="owner_account.pii_reveal",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                resource_type="owner_account",
                resource_id=resource_id,
                detail={"scope": "full_email"},
                created_at=datetime.now(timezone.utc),
            )
        )
