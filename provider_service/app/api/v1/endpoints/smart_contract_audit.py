from __future__ import annotations

from fastapi import HTTPException
from fastapi import APIRouter, Request

from app.core.gateway_auth import require_gateway_signature
from app.core.log_config import logger
from app.schemas.smart_contract_audit import (
    SmartContractAuditRequest,
    SmartContractAuditResponse,
)
from app.services.smart_contract_audit.domain import ProviderInvocationRecord
from app.services.smart_contract_audit.repository import (
    get_smart_contract_audit_repository,
)
from app.services.smart_contract_audit_service import (
    SERVICE_ID,
    execute_smart_contract_audit,
)


router = APIRouter(
    prefix="/provider-services/smart-contract-audit",
    tags=["smart-contract-audit"],
)


def _gateway_request_id(request: Request) -> str | None:
    for header_name in ("X-Synapse-Request-Id", "X-Gateway-Request-Id"):
        value = str(request.headers.get(header_name) or "").strip()
        if value:
            return value
    return None


@router.post("/invoke")
async def invoke_smart_contract_audit(
    payload: SmartContractAuditRequest,
    request: Request,
) -> SmartContractAuditResponse:
    req_logger = logger.bind(request_id=request.state.request_id)
    repository = get_smart_contract_audit_repository()
    gateway_request_id = _gateway_request_id(request)
    try:
        await require_gateway_signature(request, SERVICE_ID)
    except HTTPException as exc:
        repository.append_invocation(
            ProviderInvocationRecord.build(
                service_id=SERVICE_ID,
                input_payload=payload.model_dump(mode="json"),
                response_status=exc.status_code,
                request_id=request.state.request_id,
                gateway_request_id=gateway_request_id,
                error_code=(
                    exc.detail.get("code")
                    if isinstance(exc.detail, dict)
                    else "GATEWAY_SIGNATURE_REQUIRED"
                ),
                upstream_status=None,
                latency_ms=0,
                cache_hit=False,
            )
        )
        raise

    req_logger.info(
        "Provider request_enter: /provider-services/smart-contract-audit/invoke"
        f" | payload={payload.model_dump()}"
    )

    response_data = await execute_smart_contract_audit(
        payload,
        request_id=request.state.request_id,
        gateway_request_id=gateway_request_id,
        repository=repository,
    )

    req_logger.info(
        "Provider request_exit: /provider-services/smart-contract-audit/invoke"
        f" | response={response_data.model_dump(by_alias=True)}"
    )
    return response_data
