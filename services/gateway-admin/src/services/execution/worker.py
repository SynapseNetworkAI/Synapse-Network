import asyncio
import logging

from src.services.execution.service import ExecutionService

logger = logging.getLogger(__name__)


class ExecutionWorker:
    def __init__(self, service: ExecutionService, *, poll_interval_sec: float, batch_size: int) -> None:
        self._service = service
        self._poll_interval_sec = max(0.05, float(poll_interval_sec))
        self._batch_size = max(1, int(batch_size))

    async def run(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            try:
                await asyncio.to_thread(self._service.execute_pending_jobs_once, self._batch_size)
            except Exception:
                logger.exception("execution worker cycle failed")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=self._poll_interval_sec)
            except asyncio.TimeoutError:
                continue