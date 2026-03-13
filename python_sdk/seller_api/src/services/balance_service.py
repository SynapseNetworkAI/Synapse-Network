from typing import Dict, Any, List
from src.storage.base import BaseStorage
import asyncio
import time
from uuid import uuid4

class BalanceService:
    def __init__(self, storage: BaseStorage):
        self.storage = storage
        # 内存锁，模拟生产环境下的 Redis Redlock。
        # 在处理高频扣费时，必须警惕数据库并发带来的“超扣/漏扣”问题
        self._lock = asyncio.Lock()

    async def get_balance(self) -> Dict[str, Any]:
        """[网关防弹层] 极速获取余额对账"""
        balance_data = self.storage.get_collection("balance_ledger") or {}
        return balance_data

    def _normalize_intents(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("intents"), list):
            return [item for item in raw["intents"] if isinstance(item, dict)]
        return []

    async def register_deposit_intent(self, intent: Dict[str, Any]) -> str:
        """
        [网关防弹层] 处理买家发起的 Deposit Intent。
        所有资金写入必须加锁，防止并发重入。
        """
        async with self._lock:
            intents = self._normalize_intents(self.storage.get_collection("deposit_intents"))
            # 这里可以进行业务防伪、状态校验等
            now = int(time.time())
            next_intent = dict(intent)
            next_intent.setdefault("id", str(uuid4()))
            next_intent.setdefault("status", "PENDING")
            next_intent.setdefault("createdAt", now)
            next_intent["updatedAt"] = now
            intents.append(next_intent)
            self.storage.save_collection("deposit_intents", intents)
            return str(next_intent.get("txHash", "mock-tx-hash"))

    async def list_deposit_intents(self) -> list:
        return self._normalize_intents(self.storage.get_collection("deposit_intents"))
