from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.gateway_auth import require_gateway_signature
from app.core.log_config import logger
from app.schemas.protocol_fundamental_brief import (
    ProtocolFundamentalBriefRequest,
    ProtocolFundamentalBriefResponse,
)
from app.services.protocol_fundamental_brief_service import (
    SERVICE_ID,
    build_protocol_fundamental_brief,
)


router = APIRouter(
    prefix="/provider-services/protocol-fundamental-brief",
    tags=["protocol-fundamental-brief"],
)


@router.post("/invoke")
async def invoke_protocol_fundamental_brief(
    payload: ProtocolFundamentalBriefRequest,
    request: Request,
) -> ProtocolFundamentalBriefResponse:
    await require_gateway_signature(request, SERVICE_ID)
    req_logger = logger.bind(request_id=request.state.request_id)
    req_logger.info(
        "Provider request_enter: /provider-services/protocol-fundamental-brief/invoke"
        f" | payload={payload.model_dump()}"
    )

    response_data = await build_protocol_fundamental_brief(payload)

    req_logger.info(
        "Provider request_exit: /provider-services/protocol-fundamental-brief/invoke"
        f" | response={response_data.model_dump(by_alias=True)}"
    )
    return response_data