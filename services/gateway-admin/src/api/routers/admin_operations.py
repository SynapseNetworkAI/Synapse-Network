from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from src.api.deps import get_admin_operations_service, get_request_id, require_permission
from src.api.schemas.admin_operations import (
    BalanceSummarySchema,
    ConsumerDepositDetailResponse,
    ConsumerDepositItem,
    ConsumerDepositListResponse,
    OwnerAccountDetailResponse,
    OwnerAccountItem,
    OwnerAccountListResponse,
    PaginationSchema,
    ProviderWithdrawalDetailResponse,
    ProviderWithdrawalItem,
    ProviderWithdrawalListResponse,
)
from src.api.schemas.common import ApiResponse
from src.services.admin_operations import AdminOperationsService
from src.services.auth.service import AdminIdentity
from src.storage.analytics.admin_operations_models import (
    ConsumerDepositDetail,
    ConsumerDepositPage,
    ConsumerDepositRecord,
    OwnerAccountDetail,
    OwnerAccountPage,
    OwnerAccountRecord,
    Pagination,
    ProviderWithdrawalDetail,
    ProviderWithdrawalPage,
    ProviderWithdrawalRecord,
)

router = APIRouter(prefix="/api/admin/v1", tags=["admin-operations"])


def _money(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return f"{value:.6f}"


def _pagination(value: Pagination) -> PaginationSchema:
    return PaginationSchema(
        page=value.page,
        pageSize=value.page_size,
        total=value.total,
        totalPages=value.total_pages,
        hasNextPage=value.page < value.total_pages,
        hasPreviousPage=value.page > 1,
    )


def _owner_item(value: OwnerAccountRecord) -> OwnerAccountItem:
    return OwnerAccountItem(
        ownerId=value.owner_id,
        ownerWallet=value.owner_wallet,
        accountName=value.account_name,
        email=value.email,
        emailVerified=value.email_verified,
        pendingEmail=value.pending_email,
        status=value.status,
        roles=list(value.roles),
        agentCount=value.agent_count,
        providerServiceCount=value.provider_service_count,
        supportCaseCount=value.support_case_count,
        createdAt=value.created_at,
        updatedAt=value.updated_at,
        lastActiveAt=value.last_active_at,
    )


def _deposit_item(value: ConsumerDepositRecord) -> ConsumerDepositItem:
    return ConsumerDepositItem(
        depositId=value.deposit_id,
        ownerId=value.owner_id,
        ownerWallet=value.owner_wallet,
        ownerEmail=value.owner_email,
        txHash=value.tx_hash,
        amountUsdc=_money(value.amount_usdc) or "0.000000",
        network=value.network,
        status=value.status,
        confirmations=value.confirmations,
        creditedAt=value.credited_at,
        createdAt=value.created_at,
        updatedAt=value.updated_at,
    )


def _withdrawal_item(value: ProviderWithdrawalRecord) -> ProviderWithdrawalItem:
    return ProviderWithdrawalItem(
        withdrawalId=value.withdrawal_id,
        providerId=value.provider_id,
        providerName=value.provider_name,
        ownerId=value.owner_id,
        ownerWallet=value.owner_wallet,
        ownerEmail=value.owner_email,
        amountUsdc=_money(value.amount_usdc) or "0.000000",
        feeUsdc=_money(value.fee_usdc),
        status=value.status,
        txHash=value.tx_hash,
        ticketId=value.ticket_id,
        requestId=value.request_id,
        reviewDecision=value.review_decision,
        fundsState=value.funds_state,
        createdAt=value.created_at,
        updatedAt=value.updated_at,
    )


def _owner_page(value: OwnerAccountPage) -> OwnerAccountListResponse:
    return OwnerAccountListResponse(
        items=[_owner_item(item) for item in value.items],
        pagination=_pagination(value.pagination),
    )


def _owner_detail(value: OwnerAccountDetail) -> OwnerAccountDetailResponse:
    return OwnerAccountDetailResponse(
        account=_owner_item(value.account),
        balances=BalanceSummarySchema(
            consumerAvailableUsdc=_money(value.balances.consumer_available_usdc) or "0.000000",
            consumerFrozenUsdc=_money(value.balances.consumer_frozen_usdc) or "0.000000",
            providerAvailableUsdc=_money(value.balances.provider_available_usdc) or "0.000000",
            providerFrozenUsdc=_money(value.balances.provider_frozen_usdc) or "0.000000",
        ),
        recentDeposits=[_deposit_item(item) for item in value.recent_deposits],
        recentProviderWithdrawals=[_withdrawal_item(item) for item in value.recent_provider_withdrawals],
        recentInvocations=list(value.recent_invocations),
        supportCases=list(value.support_cases),
    )


def _deposit_page(value: ConsumerDepositPage) -> ConsumerDepositListResponse:
    return ConsumerDepositListResponse(
        items=[_deposit_item(item) for item in value.items],
        pagination=_pagination(value.pagination),
    )


def _deposit_detail(value: ConsumerDepositDetail) -> ConsumerDepositDetailResponse:
    return ConsumerDepositDetailResponse(
        deposit=_deposit_item(value.deposit),
        ledgerEntries=list(value.ledger_entries),
        auditEvents=list(value.audit_events),
        notificationEvents=list(value.notification_events),
    )


def _withdrawal_page(value: ProviderWithdrawalPage) -> ProviderWithdrawalListResponse:
    return ProviderWithdrawalListResponse(
        items=[_withdrawal_item(item) for item in value.items],
        pagination=_pagination(value.pagination),
    )


def _withdrawal_detail(value: ProviderWithdrawalDetail) -> ProviderWithdrawalDetailResponse:
    return ProviderWithdrawalDetailResponse(
        withdrawal=_withdrawal_item(value.withdrawal),
        ledgerEntries=list(value.ledger_entries),
        auditEvents=list(value.audit_events),
        notificationEvents=list(value.notification_events),
        reviewHistory=list(value.review_history),
    )


@router.get("/owner-accounts", response_model=ApiResponse)
def list_owner_accounts(
    admin: Annotated[AdminIdentity, Depends(require_permission("owner:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminOperationsService, Depends(get_admin_operations_service)],
    q: Annotated[str | None, Query(max_length=128)] = None,
    wallet: Annotated[str | None, Query(max_length=128)] = None,
    email: Annotated[str | None, Query(max_length=128)] = None,
    status: Annotated[str | None, Query(max_length=32)] = None,
    include_email: Annotated[bool, Query(alias="includeEmail")] = False,
    sort: Annotated[str, Query(max_length=32)] = "created_desc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=200)] = 50,
):
    result = service.list_owner_accounts(
        operator=admin,
        include_pii=include_email,
        q=q,
        wallet=wallet,
        email=email,
        status=status,
        page=page,
        page_size=page_size,
        sort=sort,
    )
    return ApiResponse(data=_owner_page(result).model_dump(by_alias=True), request_id=request_id)


@router.get("/owner-accounts/{owner_id}", response_model=ApiResponse)
def get_owner_account(
    owner_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("owner:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminOperationsService, Depends(get_admin_operations_service)],
    include_email: Annotated[bool, Query(alias="includeEmail")] = False,
):
    result = service.get_owner_account(operator=admin, owner_id=owner_id, include_pii=include_email)
    return ApiResponse(data=_owner_detail(result).model_dump(by_alias=True), request_id=request_id)


@router.get("/finance/consumer-deposits", response_model=ApiResponse)
def list_consumer_deposits(
    admin: Annotated[AdminIdentity, Depends(require_permission("finance:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminOperationsService, Depends(get_admin_operations_service)],
    wallet: Annotated[str | None, Query(max_length=128)] = None,
    tx_hash: Annotated[str | None, Query(alias="txHash", max_length=128)] = None,
    status: Annotated[str | None, Query(max_length=32)] = None,
    date_from: Annotated[str | None, Query(alias="dateFrom", max_length=64)] = None,
    date_to: Annotated[str | None, Query(alias="dateTo", max_length=64)] = None,
    sort: Annotated[str, Query(max_length=32)] = "created_desc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=200)] = 50,
):
    result = service.list_consumer_deposits(
        operator=admin,
        wallet=wallet,
        tx_hash=tx_hash,
        status=status,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
        sort=sort,
    )
    return ApiResponse(data=_deposit_page(result).model_dump(by_alias=True), request_id=request_id)


@router.get("/finance/consumer-deposits/{deposit_id}", response_model=ApiResponse)
def get_consumer_deposit(
    deposit_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("finance:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminOperationsService, Depends(get_admin_operations_service)],
):
    result = service.get_consumer_deposit(operator=admin, deposit_id=deposit_id)
    return ApiResponse(data=_deposit_detail(result).model_dump(by_alias=True), request_id=request_id)


@router.get("/finance/provider-withdrawals", response_model=ApiResponse)
def list_provider_withdrawals(
    admin: Annotated[AdminIdentity, Depends(require_permission("finance:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminOperationsService, Depends(get_admin_operations_service)],
    wallet: Annotated[str | None, Query(max_length=128)] = None,
    tx_hash: Annotated[str | None, Query(alias="txHash", max_length=128)] = None,
    status: Annotated[str | None, Query(max_length=32)] = None,
    date_from: Annotated[str | None, Query(alias="dateFrom", max_length=64)] = None,
    date_to: Annotated[str | None, Query(alias="dateTo", max_length=64)] = None,
    sort: Annotated[str, Query(max_length=32)] = "created_desc",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(alias="pageSize", ge=1, le=200)] = 50,
):
    result = service.list_provider_withdrawals(
        operator=admin,
        wallet=wallet,
        tx_hash=tx_hash,
        status=status,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
        sort=sort,
    )
    return ApiResponse(data=_withdrawal_page(result).model_dump(by_alias=True), request_id=request_id)


@router.get("/finance/provider-withdrawals/{withdrawal_id}", response_model=ApiResponse)
def get_provider_withdrawal(
    withdrawal_id: str,
    admin: Annotated[AdminIdentity, Depends(require_permission("finance:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[AdminOperationsService, Depends(get_admin_operations_service)],
):
    result = service.get_provider_withdrawal(operator=admin, withdrawal_id=withdrawal_id)
    return ApiResponse(data=_withdrawal_detail(result).model_dump(by_alias=True), request_id=request_id)
