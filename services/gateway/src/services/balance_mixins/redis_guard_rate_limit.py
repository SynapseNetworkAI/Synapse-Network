"""Redis-backed rate-limit helpers for the balance mixin chain.

Extracted from redis_guard to keep each module under 500 lines.
BalanceRedisGuardMixin in redis_guard.py inherits from this class.
"""
import time
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.idempotency import RateLimitRow
from src.utils.datetime_utils import now_dt_str

REDIS_RATE_LIMIT_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
"""


class BalanceRedisRateLimitMixin:
    def _rate_limit_context(self, owner_wallet: str) -> tuple[str, int, int, int]:
        owner = normalize_wallet(owner_wallet)
        now = int(time.time())
        window_sec = 60
        max_per_min = max(1, int(settings.finance_write_rate_limit_per_min))
        return owner, now, window_sec, max_per_min

    async def _enforce_owner_write_rate_limit_redis(
        self,
        owner: str,
        action: str,
        now: int,
        window_sec: int,
        max_per_min: int,
    ) -> bool:
        redis_client = await self._get_redis_client()
        if redis_client is None:
            return False

        window_bucket = now // window_sec
        redis_key = f"finance:rl:{owner}:{action}:{window_bucket}"
        try:
            current = int(
                await redis_client.eval(
                    REDIS_RATE_LIMIT_LUA, 1, redis_key, window_sec + 5
                )
            )
        except Exception:
            current = int(await redis_client.incr(redis_key))
            if current == 1:
                await redis_client.expire(redis_key, window_sec + 5)

        if current > max_per_min:
            self._append_financial_audit(
                "FINANCE_RATE_LIMIT_HIT",
                owner,
                {
                    "businessType": "anomaly",
                    "action": action,
                    "limitPerMin": max_per_min,
                    "windowBucket": window_bucket,
                    "rateLimitBucket": str(window_bucket),
                    "backend": "redis",
                },
            )
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "FINANCE_RATE_LIMIT_EXCEEDED",
                    "message": f"Finance write rate limit exceeded for action={action}.",
                },
            )
        return True

    def _enforce_owner_write_rate_limit_fallback(
        self,
        owner: str,
        action: str,
        now: int,
        max_per_min: int,
    ) -> None:
        rows = self.storage.get_data_manager().system.idempotency.read_rate_limit_rows()

        matched = next(
            (
                row
                for row in rows
                if normalize_wallet(row.owner_address or "") == owner
                and (row.action or "") == action
            ),
            None,
        )

        if matched is None:
            matched = RateLimitRow(
                id=str(uuid4()),
                owner_address=owner,
                action=action,
                window_start=now,
                count=0,
                updated_at=now_dt_str(),
            )
            rows.append(matched)

        if now - int(matched.window_start or now) >= 60:
            matched.window_start = now
            matched.count = 0

        if matched.count >= max_per_min:
            self._append_financial_audit(
                "FINANCE_RATE_LIMIT_HIT",
                owner,
                {
                    "businessType": "anomaly",
                    "action": action,
                    "limitPerMin": max_per_min,
                    "windowStart": int(matched.window_start or now),
                    "rateLimitBucket": str(int(matched.window_start or now) // 60),
                    "backend": "storage-fallback",
                },
            )
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "FINANCE_RATE_LIMIT_EXCEEDED",
                    "message": f"Finance write rate limit exceeded for action={action}.",
                },
            )

        matched.count = matched.count + 1
        matched.updated_at = now_dt_str()
        self.storage.get_data_manager().system.idempotency.write_rate_limit_rows(
            rows, now
        )

    async def _enforce_owner_write_rate_limit(
        self, owner_wallet: str, action: str
    ) -> None:
        owner, now, window_sec, max_per_min = self._rate_limit_context(owner_wallet)
        used_redis = await self._enforce_owner_write_rate_limit_redis(
            owner, action, now, window_sec, max_per_min
        )
        if not used_redis:
            self._enforce_owner_write_rate_limit_fallback(
                owner, action, now, max_per_min
            )
