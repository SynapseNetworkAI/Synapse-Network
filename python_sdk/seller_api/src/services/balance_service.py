from typing import Dict, Any, List, Optional
import asyncio
import time
from uuid import uuid4

from fastapi import HTTPException

from src.storage.base import BaseStorage
from src.core.common import normalize_wallet
from src.core.redis_lock import RedisLockManager
from src.services.balance_mixins import (
    BalanceAuditMixin,
    BalanceRedisGuardMixin,
    BalanceWithdrawSigningMixin,
)
from src.services.buyer_finance_service import BuyerFinanceService
from src.services.seller_withdraw_service import SellerWithdrawService


class BalanceService(BalanceAuditMixin, BalanceRedisGuardMixin, BalanceWithdrawSigningMixin):
    """Financial safety service orchestrator with Redis-first idempotency/rate-limit/locks."""

    def __init__(self, storage: BaseStorage):
        self.storage = storage
        self._mutation_lock = RedisLockManager(
            redis_getter=self._get_redis_client,
            key_prefix="finance:mutation-lock",
            acquire_timeout_sec=5.0,
            poll_interval_sec=0.03,
        )
        self.buyer_finance_service = BuyerFinanceService(
            storage=storage,
            mutation_lock=self._mutation_lock,
            guard_delegate=self,
        )
        self.seller_withdraw_service = SellerWithdrawService(
            storage=storage,
            mutation_lock=self._mutation_lock,
            signing_delegate=self,
            guard_delegate=self,
        )

    def _normalize_rows(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("rows"), list):
            return [item for item in raw["rows"] if isinstance(item, dict)]
        return []

    async def get_balance(self, owner_wallet: str) -> Dict[str, Any]:
        """Only return current authenticated owner's balance summary."""
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        balance_data = self.storage.get_collection("balance_ledger") or {}
        if not isinstance(balance_data, dict):
            balance_data = {}

        buyers = balance_data.get("buyers") if isinstance(balance_data.get("buyers"), dict) else {}
        sellers = balance_data.get("sellers") if isinstance(balance_data.get("sellers"), dict) else {}
        sellers_locked = balance_data.get("sellersLocked") if isinstance(balance_data.get("sellersLocked"), dict) else {}
        platform = balance_data.get("platform") if isinstance(balance_data.get("platform"), dict) else {}

        return {
            "ownerAddress": normalized_owner,
            "buyerBalance": round(float(buyers.get(normalized_owner, 0.0)), 6),
            "sellerReceivable": round(float(sellers.get(normalized_owner, 0.0)), 6),
            "sellerLocked": round(float(sellers_locked.get(normalized_owner, 0.0)), 6),
            "platformFeeAccrued": round(float(platform.get("feeAccrued", 0.0)), 6),
            "updatedAt": int(balance_data.get("updatedAt") or 0),
        }

    async def register_deposit_intent(
        self,
        intent: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.buyer_finance_service.register_deposit_intent(
            intent=intent,
            owner_wallet=owner_wallet,
            idempotency_key=idempotency_key,
            request_meta=request_meta,
        )

    async def list_deposit_intents(self, owner_wallet: str) -> list:
        return await self.buyer_finance_service.list_deposit_intents(owner_wallet)

    async def process_refund_intent(
        self,
        payload: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.buyer_finance_service.process_refund_intent(
            payload=payload,
            owner_wallet=owner_wallet,
            idempotency_key=idempotency_key,
            request_meta=request_meta,
        )

    async def list_refunds(self, owner_wallet: str) -> List[Dict[str, Any]]:
        return await self.buyer_finance_service.list_refunds(owner_wallet)

    async def create_provider_withdraw_intent(
        self,
        payload: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.seller_withdraw_service.create_provider_withdraw_intent(
            payload=payload,
            owner_wallet=owner_wallet,
            idempotency_key=idempotency_key,
            request_meta=request_meta,
        )

    async def list_provider_withdrawals(self, owner_wallet: str) -> List[Dict[str, Any]]:
        return await self.seller_withdraw_service.list_provider_withdrawals(owner_wallet)

    async def complete_provider_withdrawal(
        self,
        owner_wallet: str,
        withdrawal_id: str,
        tx_hash: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self.seller_withdraw_service.complete_provider_withdrawal(
            owner_wallet=owner_wallet,
            withdrawal_id=withdrawal_id,
            tx_hash=tx_hash,
            request_meta=request_meta,
        )

    async def get_router_config(self, owner_wallet: str) -> Dict[str, Any]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        raw = self.storage.get_collection("router_config")
        rows: List[Dict[str, Any]]
        if isinstance(raw, list):
            rows = [item for item in raw if isinstance(item, dict)]
        elif isinstance(raw, dict) and isinstance(raw.get("rows"), list):
            rows = [item for item in raw.get("rows", []) if isinstance(item, dict)]
        else:
            rows = []

        found = next((row for row in rows if normalize_wallet(str(row.get("ownerAddress") or "")) == owner), None)
        if not found:
            return {"ownerAddress": owner, "dailyLimitUsdc": 0.0, "updatedAt": None}

        return {
            "ownerAddress": owner,
            "dailyLimitUsdc": round(float(found.get("dailyLimitUsdc") or 0.0), 6),
            "updatedAt": int(found.get("updatedAt") or 0) or None,
        }

    async def set_router_config(
        self,
        owner_wallet: str,
        daily_limit_usdc: float,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:router_config"):
            await self._enforce_owner_write_rate_limit(owner, "router_config")
            if daily_limit_usdc < 0 or daily_limit_usdc > 10_000:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INVALID_DAILY_LIMIT",
                        "message": "dailyLimitUsdc must be within [0, 10000].",
                    },
                )

            now = int(time.time())
            raw = self.storage.get_collection("router_config")
            rows: List[Dict[str, Any]]
            if isinstance(raw, list):
                rows = [item for item in raw if isinstance(item, dict)]
            elif isinstance(raw, dict) and isinstance(raw.get("rows"), list):
                rows = [item for item in raw.get("rows", []) if isinstance(item, dict)]
            else:
                rows = []

            existing = next((row for row in rows if normalize_wallet(str(row.get("ownerAddress") or "")) == owner), None)
            if existing is None:
                existing = {
                    "id": str(uuid4()),
                    "ownerAddress": owner,
                    "dailyLimitUsdc": round(float(daily_limit_usdc), 6),
                    "createdAt": now,
                    "updatedAt": now,
                }
                rows.append(existing)
            else:
                existing["dailyLimitUsdc"] = round(float(daily_limit_usdc), 6)
                existing["updatedAt"] = now

            self.storage.save_collection("router_config", {"rows": rows, "updatedAt": now})
            self._append_financial_audit(
                "ROUTER_CONFIG_UPDATED",
                owner,
                {
                    "dailyLimitUsdc": existing.get("dailyLimitUsdc"),
                    "requestMeta": request_meta or {},
                },
            )
            return {
                "ownerAddress": owner,
                "dailyLimitUsdc": existing.get("dailyLimitUsdc"),
                "updatedAt": existing.get("updatedAt"),
            }
