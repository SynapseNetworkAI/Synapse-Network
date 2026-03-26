from fastapi import APIRouter

from app.api.v1.endpoints.protocol_fundamental_brief import (
	router as protocol_fundamental_brief_router,
)
from app.api.v1.endpoints.quotes import router as quotes_router
from app.api.v1.endpoints.smart_contract_audit import (
    router as smart_contract_audit_router,
)
from app.api.v1.endpoints.sentiment import router as sentiment_router

api_v1_router = APIRouter()
api_v1_router.include_router(quotes_router)
api_v1_router.include_router(sentiment_router)
api_v1_router.include_router(protocol_fundamental_brief_router)
api_v1_router.include_router(smart_contract_audit_router)
