from fastapi import APIRouter

from app.api.v1.endpoints.quotes import router as quotes_router
from app.api.v1.endpoints.sentiment import router as sentiment_router

api_v1_router = APIRouter()
api_v1_router.include_router(quotes_router)
api_v1_router.include_router(sentiment_router)
