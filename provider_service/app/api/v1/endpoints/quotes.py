from fastapi import APIRouter, HTTPException, Request

from app.core.config import get_settings
from app.schemas.quote import QuoteRequest, QuoteResponse, QuoteTop3Response
from app.services.deepseek_client import request_famous_quote, request_famous_quote_top3
from app.core.log_config import logger

router = APIRouter(prefix="/api/v1/quotes", tags=["quotes"])


@router.post(
    "/famous",
    responses={
        502: {"description": "DeepSeek upstream request failed"},
        503: {"description": "DeepSeek API key missing or service unavailable"},
    },
)
async def famous_quote(payload: QuoteRequest, request: Request) -> QuoteResponse:
    req_logger = logger.bind(request_id=request.state.request_id)
    req_logger.info(f"Provider request_enter: /famous | payload={payload.model_dump()}")
    
    try:
        quote = await request_famous_quote(payload.text)
    except RuntimeError as error:
        req_logger.error(f"Provider request_error: {str(error)}")
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        req_logger.error(f"Provider request_error: DeepSeek request failed: {error}")
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {error}") from error

    settings = get_settings()
    
    response_data = QuoteResponse(
        input_text=payload.text,
        quote=quote,
        model=settings.deepseek_model,
    )
    
    req_logger.info(f"Provider request_exit: /famous | response={response_data.model_dump()}")
    return response_data


@router.post(
    "/famous/top3",
    responses={
        502: {"description": "DeepSeek upstream request failed"},
        503: {"description": "DeepSeek API key missing or service unavailable"},
    },
)
async def famous_quote_top3(payload: QuoteRequest, request: Request) -> QuoteTop3Response:
    req_logger = logger.bind(request_id=request.state.request_id)
    req_logger.info(f"Provider request_enter: /famous/top3 | payload={payload.model_dump()}")
    
    try:
        quotes = await request_famous_quote_top3(payload.text)
    except RuntimeError as error:
        req_logger.error(f"Provider request_error: {str(error)}")
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        req_logger.error(f"Provider request_error: DeepSeek request failed: {error}")
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {error}") from error

    settings = get_settings()
    
    response_data = QuoteTop3Response(
        input_text=payload.text,
        quotes=quotes,
        model=settings.deepseek_model,
    )
    
    req_logger.info(f"Provider request_exit: /famous/top3 | response={response_data.model_dump()}")
    return response_data
