from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends

from src.api.deps import (
    get_store,
    get_request_id,
    require_super_admin_high_risk_permission,
)
from src.api.schemas.common import ApiResponse
from src.api.schemas.platform_fee_treasury import (
    PlatformFeeTreasuryDraftRequest,
    PlatformFeeTreasuryDraftResponse,
    SafeTransactionDraftResponse,
)
from src.core.config import get_settings
from src.services.auth.service import AdminIdentity
from src.services.finance_admin import JsonRpcPlatformFeeChainReader, PlatformFeeTreasuryService

router = APIRouter(prefix="/api/admin/v1/platform-fee-withdrawals", tags=["admin-platform-fee-withdrawals"])


@lru_cache(maxsize=1)
def get_platform_fee_treasury_service() -> PlatformFeeTreasuryService:
    settings = get_settings()
    return PlatformFeeTreasuryService(
        get_store(),
        settings,
        JsonRpcPlatformFeeChainReader(
            settings.chain_rpc_url,
            timeout_sec=settings.gateway_internal_timeout_sec,
        ),
    )


@router.post("/safe-draft", response_model=ApiResponse)
def create_platform_fee_safe_draft(
    payload: PlatformFeeTreasuryDraftRequest,
    admin: Annotated[AdminIdentity, Depends(require_super_admin_high_risk_permission("approval:decide"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[PlatformFeeTreasuryService, Depends(get_platform_fee_treasury_service)],
):
    draft = service.create_safe_draft(
        amount_usdc=payload.amount_usdc,
        reason=payload.reason,
        operator=admin,
        request_id=payload.request_id,
        http_request_id=request_id,
    )
    return ApiResponse(
        data=PlatformFeeTreasuryDraftResponse(
            status="ready_for_safe",
            requestId=draft.request_id,
            amountUsdc=draft.amount_usdc,
            amountAtomic=draft.amount_atomic,
            safeAddress=draft.safe_address,
            ledgerSignerAddress=draft.ledger_signer_address,
            synapseCoreAddress=draft.synapse_core_address,
            selector=draft.selector,
            calldataHash=draft.calldata_hash,
            platformFeePoolAtomic=draft.platform_fee_pool_atomic,
            safeTx=SafeTransactionDraftResponse(
                to=draft.safe_tx.to,
                value=draft.safe_tx.value,
                data=draft.safe_tx.data,
                operation=draft.safe_tx.operation,
            ),
        ),
        request_id=request_id,
    )
