from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.gateway_auth import require_gateway_signature
from app.core.log_config import logger
from app.schemas.whale_flow_monitor import (
    WhaleFlowMonitorRequest,
    WhaleFlowMonitorResponse,
)
from app.services.whale_flow_monitor_service import (
    SERVICE_ID,
    execute_whale_flow_monitor,
)


router = APIRouter(
    prefix="/provider-services/whale-flow-monitor",
    tags=["whale-flow-monitor"],
)


def _gateway_request_id(request: Request) -> str | None:
    for header_name in ("X-Synapse-Request-Id", "X-Gateway-Request-Id"):
        value = str(request.headers.get(header_name) or "").strip()
        if value:
            return value
    return None


@router.post("/invoke")
async def invoke_whale_flow_monitor(
    payload: WhaleFlowMonitorRequest,
    request: Request,
) -> WhaleFlowMonitorResponse:
    await require_gateway_signature(request, SERVICE_ID)
    req_logger = logger.bind(request_id=request.state.request_id)
    req_logger.info(
        "Provider request_enter: /provider-services/whale-flow-monitor/invoke"
        f" | payload={payload.model_dump()}"
    )

    response_data = await execute_whale_flow_monitor(
        payload,
        request_id=request.state.request_id,
        gateway_request_id=_gateway_request_id(request),
    )

    req_logger.info(
        "Provider request_exit: /provider-services/whale-flow-monitor/invoke"
        f" | response={response_data.model_dump(by_alias=True)}"
    )
    return response_data
