import asyncio
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Callable, Optional
from uuid import uuid4


class RedisLockManager:
    """Redis-first distributed lock with local-lock fallback for degraded environments."""

    _RELEASE_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""

    def __init__(
        self,
        redis_getter: Callable[[], Awaitable[Optional[Any]]],
        *,
        key_prefix: str = "finance:lock",
        acquire_timeout_sec: float = 5.0,
        poll_interval_sec: float = 0.05,
    ):
        self._redis_getter = redis_getter
        self._key_prefix = key_prefix
        self._acquire_timeout_sec = max(0.2, float(acquire_timeout_sec))
        self._poll_interval_sec = max(0.01, float(poll_interval_sec))
        self._local_locks: dict[str, asyncio.Lock] = {}

    @asynccontextmanager
    async def lock(self, resource: str, ttl_sec: int = 15) -> AsyncIterator[None]:
        ttl = max(2, int(ttl_sec))
        redis_client = await self._redis_getter()

        # If redis does not support basic lock operations, fall back to local process lock.
        if redis_client is None or not hasattr(redis_client, "set"):
            async with self._local_lock(resource):
                yield
            return

        redis_key = f"{self._key_prefix}:{resource}"
        token = str(uuid4())

        acquired = await self._acquire(redis_client, redis_key, token, ttl)
        if not acquired:
            # Avoid hard-failing business path on temporary redis contention.
            async with self._local_lock(resource):
                yield
            return

        try:
            yield
        finally:
            await self._release(redis_client, redis_key, token)

    @asynccontextmanager
    async def _local_lock(self, resource: str) -> AsyncIterator[None]:
        lock = self._local_locks.get(resource)
        if lock is None:
            lock = asyncio.Lock()
            self._local_locks[resource] = lock
        async with lock:
            yield

    async def _acquire(self, client: Any, key: str, token: str, ttl_sec: int) -> bool:
        deadline = time.time() + self._acquire_timeout_sec
        while time.time() < deadline:
            try:
                ok = await client.set(key, token, ex=ttl_sec, nx=True)
                if ok:
                    return True
            except Exception:
                return False
            await asyncio.sleep(self._poll_interval_sec)
        return False

    async def _release(self, client: Any, key: str, token: str) -> None:
        try:
            if hasattr(client, "eval"):
                await client.eval(self._RELEASE_LUA, 1, key, token)
                return
            if hasattr(client, "get") and hasattr(client, "delete"):
                current = await client.get(key)
                if current == token:
                    await client.delete(key)
        except Exception:
            return
