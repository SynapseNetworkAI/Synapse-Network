import asyncio
from typing import Any, Optional

from src.core.config import settings

_redis_client: Optional[Any] = None
_redis_init_lock = asyncio.Lock()


async def get_redis_client() -> Optional[Any]:
    """Return a shared async Redis client if REDIS_URL is configured and reachable."""
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    if not settings.redis_url:
        return None

    async with _redis_init_lock:
        if _redis_client is not None:
            return _redis_client
        try:
            import redis.asyncio as redis_async  # type: ignore[import-not-found]

            client = redis_async.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
            await client.ping()
            _redis_client = client
        except Exception:
            _redis_client = None
        return _redis_client
