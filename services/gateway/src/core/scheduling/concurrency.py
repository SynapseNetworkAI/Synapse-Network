"""Concurrency helpers for bounded background work."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable
from typing import TypeVar

T = TypeVar("T")
R = TypeVar("R")


class BoundedTaskRunner:
    """Run awaitable work with a shared semaphore."""

    def __init__(
        self,
        max_concurrency: int,
        semaphore: asyncio.Semaphore | None = None,
    ) -> None:
        self.max_concurrency = max(1, int(max_concurrency or 1))
        self._semaphore = semaphore or asyncio.Semaphore(self.max_concurrency)

    async def run(
        self,
        items: Iterable[T],
        handler: Callable[[T], Awaitable[R]],
    ) -> list[R]:
        async def _run_one(item: T) -> R:
            async with self._semaphore:
                return await handler(item)

        tasks = [asyncio.create_task(_run_one(item)) for item in items]
        if not tasks:
            return []
        return list(await asyncio.gather(*tasks))
