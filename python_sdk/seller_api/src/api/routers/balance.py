from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from src.api.deps import get_balance_service
from src.services.balance_service import BalanceService
from src.storage import get_storage, BaseStorage

router = APIRouter()

@router.get("/v2/balance")
async def get_balance(service: BalanceService = Depends(get_balance_service)):
    """
    [极速路由] 获取当前热钱包的实时额度或所有资金对账
    """
    try:
        balance_data = await service.get_balance()
        return {"status": "success", "balance": balance_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database IO blocked: {str(e)}")

@router.post("/v2/balance/deposit/intent")
async def register_deposit_intent(
    intent: Dict[str, Any], 
    service: BalanceService = Depends(get_balance_service)
):
    """
    [充值担保] 登记一笔链上即将到达的 M2M Deposit Intent。
    真正的业务防伪和 Web3 Transaction 轮询放入 Service 层执行。
    """
    tx_hash = await service.register_deposit_intent(intent)
    return {"status": "success", "tx_hash": tx_hash}

@router.get("/v2/balance/deposit/intents")
async def list_deposit_intents(service: BalanceService = Depends(get_balance_service)):
    intents = await service.list_deposit_intents()
    return {"status": "success", "intents": intents}

@router.post("/v2/refund")
async def process_refund(
    refund_req: Dict[str, Any],
    service: BalanceService = Depends(get_balance_service)
):
    return {"status": "success", "message": "Refund processed (mock)"}

@router.get("/v2/refunds")
async def list_refunds(service: BalanceService = Depends(get_balance_service)):
    return {"status": "success", "refunds": []}

@router.get("/v2/router/config")
async def get_router_config(storage: BaseStorage = Depends(get_storage)):
    router_config = storage.get_collection("router_config") or {}
    return router_config

@router.post("/v2/router/config")
async def set_router_config(config: Dict[str, Any], storage: BaseStorage = Depends(get_storage)):
    storage.save_collection("router_config", config)
    return {"status": "success"}

@router.get("/v2/usage/logs")
async def get_usage_logs(storage: BaseStorage = Depends(get_storage)):
    return {"status": "success", "logs": storage.get_collection("usage_log") or []}
