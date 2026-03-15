from typing import Any, Dict, List, Optional
import asyncio
import time
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.redis_lock import RedisLockManager
from src.services.balance_mixins import BalanceAuditMixin, BalanceRedisGuardMixin
from src.storage.repository_provider import balance_repo, gateway_state_repo
from src.storage.base import BaseStorage


class PlatformFinanceService(BalanceAuditMixin, BalanceRedisGuardMixin):
    """Platform-side balance read and router config domain service."""

    def __init__(
        self,
        storage: BaseStorage,
        mutation_lock: RedisLockManager,
        guard_delegate: Optional[BalanceRedisGuardMixin] = None,
    ):
        self.storage = storage
        self._mutation_lock = mutation_lock
        self._guard_delegate = guard_delegate

    async def _get_redis_client(self):
        if self._guard_delegate is not None:
            return await self._guard_delegate._get_redis_client()  # type: ignore[attr-defined]
        return await super()._get_redis_client()

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
        balance_data = balance_repo(self.storage).read_balance_ledger() or {}
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

    async def get_router_config(self, owner_wallet: str) -> Dict[str, Any]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        raw_rows = gateway_state_repo(self.storage).read_router_config_rows()
        rows = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []

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
            raw_rows = gateway_state_repo(self.storage).read_router_config_rows()
            rows = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []

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

            gateway_state_repo(self.storage).write_router_config_rows(rows, now)
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
