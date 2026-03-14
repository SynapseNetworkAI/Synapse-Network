from fastapi import APIRouter, Depends, HTTPException, Header, Query
from typing import Dict, Any, Annotated

from src.api.deps import get_balance_service
from src.core.auth import require_owner_wallet
from src.models.pydantic_models import DepositIntentRequest, RefundIntentRequest, RouterConfigRequest
from src.services.balance_service import BalanceService
from src.services.v2_indexer import get_indexer_status
from src.storage import get_storage, BaseStorage

router = APIRouter()


@router.get("/v2/balance", responses={500: {"description": "Database IO blocked"}})
async def get_balance(
    owner_wallet: Annotated[str, Depends(require_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    """[极速路由] 获取当前会话 owner 的余额摘要。"""
    try:
        balance_data = await service.get_balance(owner_wallet)
        return {"status": "success", "balance": balance_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database IO blocked: {str(e)}")


@router.post("/v2/balance/deposit/intent")
async def register_deposit_intent(
    intent: DepositIntentRequest,
    idempotency_key: Annotated[str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)],
    owner_wallet: Annotated[str, Depends(require_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    """登记 owner 充值意图，owner 由 session 决定。"""
    stored_intent = await service.register_deposit_intent(intent.model_dump(), owner_wallet, idempotency_key)
    return {
        "status": "success",
        "tx_hash": str(stored_intent.get("txHash", "mock-tx-hash")),
        "intent": stored_intent,
    }


@router.get("/v2/balance/deposit/intents")
async def list_deposit_intents(
    owner_wallet: Annotated[str, Depends(require_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    intents = await service.list_deposit_intents(owner_wallet)
    return {"status": "success", "intents": intents[:limit]}


@router.post("/v2/refund")
async def process_refund(
    refund_req: RefundIntentRequest,
    idempotency_key: Annotated[str, Header(alias="X-Idempotency-Key", min_length=16, max_length=128)],
    owner_wallet: Annotated[str, Depends(require_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    result = await service.process_refund_intent(refund_req.model_dump(), owner_wallet, idempotency_key)
    return {"status": "success", "ownerAddress": owner_wallet, **result}


@router.get("/v2/refunds")
async def list_refunds(
    owner_wallet: Annotated[str, Depends(require_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    rows = await service.list_refunds(owner_wallet)
    return {"status": "success", "ownerAddress": owner_wallet, "refunds": rows[:limit]}


@router.get("/v2/router/config")
async def get_router_config(
    owner_wallet: Annotated[str, Depends(require_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    config = await service.get_router_config(owner_wallet)
    return {"status": "success", "ownerAddress": owner_wallet, "config": config}


@router.post("/v2/router/config")
async def set_router_config(
    config: RouterConfigRequest,
    owner_wallet: Annotated[str, Depends(require_owner_wallet)],
    service: Annotated[BalanceService, Depends(get_balance_service)],
):
    saved = await service.set_router_config(owner_wallet, config.dailyLimitUsdc)
    return {"status": "success", "ownerAddress": owner_wallet, "config": saved}


@router.get("/v2/usage/logs")
async def get_usage_logs(
    owner_wallet: Annotated[str, Depends(require_owner_wallet)],
    storage: Annotated[BaseStorage, Depends(get_storage)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    rows = storage.get_collection("usage_log") or []
    owner = owner_wallet.lower()
    filtered = []
    for row in rows:
        buyer = str(row.get("buyer") or "").lower()
        seller = str(row.get("seller") or "").lower()
        if buyer == owner or seller == owner:
            filtered.append(row)

    return {
        "status": "success",
        "logs": filtered[:limit],
        "count": len(filtered[:limit]),
    }


@router.get("/v2/indexer/status")
async def get_v2_indexer_status():
    return {
        "status": "success",
        "indexer": get_indexer_status(),
    }
