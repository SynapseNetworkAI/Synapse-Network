from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.gateway_auth import require_gateway_signature
from app.core.log_config import logger
from app.schemas.twitter_video_download import (
    TwitterVideoDownloadRequest,
    TwitterVideoDownloadResponse,
)
from app.services.twitter_video_download_service import (
    SERVICE_ID,
    execute_twitter_video_download,
)


router = APIRouter(
    prefix="/provider-services/twitter-video-download",
    tags=["twitter-video-download"],
)


def _gateway_request_id(request: Request) -> str | None:
    for header_name in ("X-Synapse-Request-Id", "X-Gateway-Request-Id"):
        value = str(request.headers.get(header_name) or "").strip()
        if value:
            return value
    return None


@router.post("/invoke")
async def invoke_twitter_video_download(
    payload: TwitterVideoDownloadRequest,
    request: Request,
) -> TwitterVideoDownloadResponse:
    await require_gateway_signature(request, SERVICE_ID)
    req_logger = logger.bind(request_id=request.state.request_id)
    req_logger.info(
        "Provider request_enter: /provider-services/twitter-video-download/invoke"
        f" | payload={payload.model_dump(by_alias=True)}"
    )

    response_data = await execute_twitter_video_download(
        payload,
        request_id=request.state.request_id,
        gateway_request_id=_gateway_request_id(request),
        disconnect_checker=request.is_disconnected,
    )

    req_logger.info(
        "Provider request_exit: /provider-services/twitter-video-download/invoke"
        f" | response={response_data.model_dump(by_alias=True)}"
    )
    return response_data
