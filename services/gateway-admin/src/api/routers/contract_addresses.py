from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends

from src.api.deps import get_dashboard_service, get_gateway_dashboard_projection_repository, get_request_id, require_permission
from src.api.schemas.common import ApiResponse
from src.api.schemas.contract_addresses import ContractAddressRegistry
from src.core.config import get_settings
from src.services.auth.service import AdminIdentity
from src.services.dashboard.service import DashboardService
from src.services.finance_admin import ContractAddressRegistryService, JsonRpcContractRegistryChainReader
from src.storage.analytics import GatewayDashboardProjectionRepository

router = APIRouter(prefix="/api/admin/v1/contract-addresses", tags=["admin-contract-addresses"])


@lru_cache(maxsize=1)
def get_contract_address_registry_chain_reader() -> JsonRpcContractRegistryChainReader:
    settings = get_settings()
    return JsonRpcContractRegistryChainReader(
        settings.chain_rpc_url,
        timeout_sec=settings.gateway_internal_timeout_sec,
    )


def get_contract_address_registry_service(
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
    gateway_projection: Annotated[GatewayDashboardProjectionRepository, Depends(get_gateway_dashboard_projection_repository)],
) -> ContractAddressRegistryService:
    return ContractAddressRegistryService(
        get_settings(),
        dashboard_service,
        get_contract_address_registry_chain_reader(),
        gateway_projection,
    )


@router.get("", response_model=ApiResponse)
def get_contract_address_registry(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    service: Annotated[ContractAddressRegistryService, Depends(get_contract_address_registry_service)],
):
    _ = admin
    return ApiResponse(
        data=ContractAddressRegistry(**service.get_registry()),
        request_id=request_id,
    )
