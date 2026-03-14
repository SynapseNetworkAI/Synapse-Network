from fastapi import APIRouter

from src.api.routers.credentials import router as credentials_router
from src.api.routers.forwarding import router as forwarding_router

router = APIRouter()
router.include_router(credentials_router)
router.include_router(forwarding_router)
