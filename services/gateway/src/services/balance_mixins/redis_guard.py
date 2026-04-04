"""Composite Redis guard mixin for balance services.

Idempotency logic lives in ``redis_guard_idempotency``.
Rate-limit logic lives in ``redis_guard_rate_limit``.
This module only assembles the two sub-mixins so callers import a single name.
"""
from src.services.balance_mixins.redis_guard_idempotency import BalanceRedisIdempotencyMixin
from src.services.balance_mixins.redis_guard_rate_limit import BalanceRedisRateLimitMixin


class BalanceRedisGuardMixin(BalanceRedisIdempotencyMixin, BalanceRedisRateLimitMixin):
    """Composite mixin: idempotency + rate-limit Redis guards."""
