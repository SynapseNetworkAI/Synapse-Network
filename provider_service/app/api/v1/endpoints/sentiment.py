from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.gateway_auth import require_gateway_signature
from app.core.log_config import logger
from app.schemas.sentiment import SentimentRequest, SentimentResponse
from app.services.sentiment_service import SERVICE_ID, build_sentiment_snapshot


router = APIRouter(
    prefix="/provider-services/web3-sentiment-index",
    tags=["web3-sentiment-index"],
)


@router.post("/invoke")
async def invoke_web3_sentiment_index(
    payload: SentimentRequest, request: Request
) -> SentimentResponse:
    await require_gateway_signature(request, SERVICE_ID)
    req_logger = logger.bind(request_id=request.state.request_id)
    req_logger.info(
        f"Provider request_enter: /provider-services/web3-sentiment-index/invoke | payload={payload.model_dump()}"
    )

    response_data = await build_sentiment_snapshot(payload)

    req_logger.info(
        "Provider request_exit: /provider-services/web3-sentiment-index/invoke"
        f" | response={response_data.model_dump(by_alias=True)}"
    )
    return response_data
