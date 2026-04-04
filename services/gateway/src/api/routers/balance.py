"""Balance router: assembly of deposit, withdraw, and admin sub-routers."""
from fastapi import APIRouter

from src.api.routers.balance_deposit import router as deposit_router
from src.api.routers.balance_withdraw import router as withdraw_router
from src.api.routers.balance_admin import router as admin_router

router = APIRouter()
router.include_router(deposit_router)
router.include_router(withdraw_router)
router.include_router(admin_router)
