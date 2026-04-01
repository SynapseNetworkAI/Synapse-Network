from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import asyncio
import time
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.redis_lock import RedisLockManager
from src.domain.gateway import OwnerSpendLimitRow, RouterConfigRow
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

    @staticmethod
    def _q6(value: Decimal | str | int | float) -> Decimal:
        return Decimal(str(value)).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        )

    @staticmethod
    def _billing_cycle_start(now_ts: Optional[int] = None) -> int:
        now_dt = datetime.fromtimestamp(now_ts or int(time.time()), tz=timezone.utc)
        cycle_start = datetime(
            year=now_dt.year,
            month=now_dt.month,
            day=1,
            tzinfo=timezone.utc,
        )
        return int(cycle_start.timestamp())

    @staticmethod
    def _is_billable_usage_status(status: Any) -> bool:
        normalized = str(status or "").strip().lower()
        return normalized in {"accepted", "succeeded"}

    def _current_cycle_spend_usdc(self, owner_wallet: str) -> Decimal:
        owner = normalize_wallet(owner_wallet)
        cycle_start = self._billing_cycle_start()
        rows = self.storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
        current_spend = Decimal("0")
        for row in rows:
            row_owner = normalize_wallet(str(row.consumer_address or ""))
            if row_owner != owner:
                continue
            if int(row.ts or 0) < cycle_start:
                continue
            if not self._is_billable_usage_status(row.status):
                continue
            charge = row.total_charge if row.total_charge is not None else row.unit_price
            if charge is None:
                continue
            current_spend += Decimal(str(charge))
        return self._q6(current_spend)

    def _find_owner_spend_limit_row(
        self, owner_wallet: str
    ) -> Optional[OwnerSpendLimitRow]:
        owner = normalize_wallet(owner_wallet)
        rows = self.storage.get_data_manager().system.gateway_state.read_owner_spend_limit_rows()
        return next(
            (
                row
                for row in rows
                if normalize_wallet(row.owner_address or "") == owner
            ),
            None,
        )

    async def get_balance(self, owner_wallet: str) -> Dict[str, Any]:
        """Only return current authenticated owner's balance summary."""
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        balance_data = (
            self.storage.get_data_manager().finance.balance.read_balance_ledger()
        )

        return {
            "ownerAddress": normalized_owner,
            "ownerBalance": balance_data.consumer_available_balance(normalized_owner),
            "consumerAvailableBalance": balance_data.consumer_available_balance(normalized_owner),
            "consumerPendingBalance": balance_data.consumer_pending_balance(normalized_owner),
            "consumerFrozenBalance": balance_data.consumer_frozen_balance(normalized_owner),
            "providerReceivable": balance_data.provider_receivable_balance(normalized_owner),
            "providerReceivableBalance": balance_data.provider_receivable_balance(normalized_owner),
            "providerLockedBalance": balance_data.provider_locked_balance(normalized_owner),
            "platformFeeAccrued": round(balance_data.platform.fee_accrued, 6),
            "updatedAt": balance_data.updated_at,
        }

    async def get_router_config(self, owner_wallet: str) -> Dict[str, Any]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        rows = self.storage.get_data_manager().system.gateway_state.read_router_config_rows()

        found = next(
            (row for row in rows if normalize_wallet(row.owner_address or "") == owner),
            None,
        )
        if not found:
            return {"ownerAddress": owner, "dailyLimitUsdc": 0.0, "updatedAt": None}

        return {
            "ownerAddress": owner,
            "dailyLimitUsdc": round(float(found.daily_limit_usdc or 0.0), 6),
            "updatedAt": int(found.updated_at or 0) or None,
        }

    async def get_owner_spending_limit(self, owner_wallet: str) -> Dict[str, Any]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        found = self._find_owner_spend_limit_row(owner)
        spending_limit = (
            self._q6(found.spending_limit_usdc)
            if found is not None and found.spending_limit_usdc is not None
            else None
        )
        current_cycle_spend = self._current_cycle_spend_usdc(owner)
        remaining = (
            self._q6(max(Decimal("0"), spending_limit - current_cycle_spend))
            if spending_limit is not None
            else None
        )

        return {
            "ownerAddress": owner,
            "spendingLimitUsdc": float(spending_limit) if spending_limit is not None else None,
            "allowUnlimited": spending_limit is None,
            "cycleInterval": "monthly",
            "currentCycleSpendUsdc": float(current_cycle_spend),
            "remainingSpendUsdc": float(remaining) if remaining is not None else None,
            "updatedAt": found.updated_at if found is not None else None,
        }

    async def set_owner_spending_limit(
        self,
        owner_wallet: str,
        *,
        spending_limit_usdc: Optional[Decimal],
        allow_unlimited: bool,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:owner_spend_limit"):
            await self._enforce_owner_write_rate_limit(owner, "owner_spend_limit")

            normalized_limit = None
            if not allow_unlimited:
                if spending_limit_usdc is None:
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "INVALID_SPENDING_LIMIT",
                            "message": "spendingLimitUsdc is required unless allowUnlimited is true.",
                        },
                    )
                normalized_limit = self._q6(spending_limit_usdc)
                if normalized_limit <= Decimal("0"):
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "INVALID_SPENDING_LIMIT",
                            "message": "spendingLimitUsdc must be positive.",
                        },
                    )

            now_text = now_dt_str()
            rows = self.storage.get_data_manager().system.gateway_state.read_owner_spend_limit_rows()
            existing = next(
                (
                    row
                    for row in rows
                    if normalize_wallet(row.owner_address or "") == owner
                ),
                None,
            )
            if existing is None:
                existing = OwnerSpendLimitRow(
                    id=str(uuid4()),
                    ownerAddress=owner,
                    spendingLimitUsdc=normalized_limit,
                    cycleInterval="monthly",
                    createdAt=now_text,
                    updatedAt=now_text,
                )
                rows.append(existing)
            else:
                existing.spending_limit_usdc = normalized_limit
                existing.cycle_interval = "monthly"
                existing.updated_at = now_text

            self.storage.get_data_manager().system.gateway_state.write_owner_spend_limit_rows(
                rows,
                now_text,
            )
            self._append_financial_audit(
                "OWNER_SPEND_LIMIT_UPDATED",
                owner,
                {
                    "allowUnlimited": allow_unlimited,
                    "spendingLimitUsdc": float(normalized_limit) if normalized_limit is not None else None,
                    "cycleInterval": "monthly",
                    "requestMeta": request_meta or {},
                },
            )
            return await self.get_owner_spending_limit(owner)

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

            existing = next(
                (
                    row
                    for row in rows
                    if normalize_wallet(row.owner_address or "") == owner
                ),
                None,
            )
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

            self.storage.get_data_manager().system.gateway_state.write_router_config_rows(
                rows, now
            )
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
