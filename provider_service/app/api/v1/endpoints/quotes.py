from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.schemas.quote import QuoteRequest, QuoteResponse, QuoteTop3Response
from app.services.deepseek_client import request_famous_quote, request_famous_quote_top3

router = APIRouter(prefix="/api/v1/quotes", tags=["quotes"])


@router.post(
    "/famous",
    responses={
        502: {"description": "DeepSeek upstream request failed"},
        503: {"description": "DeepSeek API key missing or service unavailable"},
    },
)
async def famous_quote(payload: QuoteRequest) -> QuoteResponse:
    try:
        quote = await request_famous_quote(payload.text)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {error}") from error

    settings = get_settings()
    return QuoteResponse(
        input_text=payload.text,
        quote=quote,
        model=settings.deepseek_model,
    )


@router.post(
    "/famous/top3",
    responses={
        502: {"description": "DeepSeek upstream request failed"},
        503: {"description": "DeepSeek API key missing or service unavailable"},
    },
)
async def famous_quote_top3(payload: QuoteRequest) -> QuoteTop3Response:
    try:
        quotes = await request_famous_quote_top3(payload.text)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"DeepSeek request failed: {error}") from error

    settings = get_settings()
    return QuoteTop3Response(
        input_text=payload.text,
        quotes=quotes,
        model=settings.deepseek_model,
    )
