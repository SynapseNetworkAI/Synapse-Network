from typing import Any, Dict, List, Optional
import asyncio
import time
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.redis_lock import RedisLockManager
from src.domain.finance import BalanceLedger
from src.domain.gateway import RouterConfigRow
from src.services.balance_mixins import BalanceAuditMixin, BalanceRedisGuardMixin
from src.storage.base import BaseStorage
from src.utils.datetime_utils import now_dt_str


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
        balance_data = self.storage.get_data_manager().finance.balance.read_balance_ledger()

        return {
            "ownerAddress": normalized_owner,
            "buyerBalance": round(float(balance_data.buyers.get(normalized_owner, 0.0)), 6),
            "sellerReceivable": round(float(balance_data.sellers.get(normalized_owner, 0.0)), 6),
            "sellerLocked": round(float(balance_data.sellers_locked.get(normalized_owner, 0.0)), 6),
            "platformFeeAccrued": round(balance_data.platform.fee_accrued, 6),
            "updatedAt": balance_data.updated_at,
        }

    async def get_router_config(self, owner_wallet: str) -> Dict[str, Any]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        rows = self.storage.get_data_manager().system.gateway_state.read_router_config_rows()

        found = next((row for row in rows if normalize_wallet(row.owner_address or "") == owner), None)
        if not found:
            return {"ownerAddress": owner, "dailyLimitUsdc": 0.0, "updatedAt": None}

        return {
            "ownerAddress": owner,
            "dailyLimitUsdc": round(float(found.daily_limit_usdc or 0.0), 6),
            "updatedAt": int(found.updated_at or 0) or None,
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
            rows = self.storage.get_data_manager().system.gateway_state.read_router_config_rows()

            existing = next((row for row in rows if normalize_wallet(row.owner_address or "") == owner), None)
            if existing is None:
                existing = RouterConfigRow(
                    id=str(uuid4()),
                    owner_address=owner,
                    daily_limit_usdc=round(float(daily_limit_usdc), 6),
                    created_at=now_dt_str(),
                    updated_at=now_dt_str(),
                )
                rows.append(existing)
            else:
                existing.daily_limit_usdc = round(float(daily_limit_usdc), 6)
                existing.updated_at = now_dt_str()

            self.storage.get_data_manager().system.gateway_state.write_router_config_rows(rows, now)
            self._append_financial_audit(
                "ROUTER_CONFIG_UPDATED",
                owner,
                {
                    "dailyLimitUsdc": existing.daily_limit_usdc,
                    "requestMeta": request_meta or {},
                },
            )
            return {
                "ownerAddress": owner,
                "dailyLimitUsdc": existing.daily_limit_usdc,
                "updatedAt": existing.updated_at,
            }
