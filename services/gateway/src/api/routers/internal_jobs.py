from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException

from src.core.config import settings
from src.services.notifications.outbox_worker import drain_notification_outbox_once
from src.services.platform.job_locks import postgres_advisory_job_lock
from src.storage import BaseStorage, get_storage

router = APIRouter()


@router.post("/internal/jobs/notification-outbox/trigger")
async def trigger_notification_outbox_drain(
    storage: Annotated[BaseStorage, Depends(get_storage)],
    x_synapse_internal_token: Annotated[str | None, Header()] = None,
):
    expected = settings.internal_trigger_secret
    if not settings.notification_outbox_trigger_enabled:
        raise HTTPException(status_code=404, detail="Not found")
    if not expected or not hmac.compare_digest(x_synapse_internal_token or "", expected):
        raise HTTPException(status_code=401, detail="Invalid internal trigger token")

    with postgres_advisory_job_lock(storage, "notification-outbox-drain") as acquired:
        if not acquired:
            return {
                "status": "skipped",
                "reason": "already_running",
                "jobName": "notification-outbox-drain",
            }
        result = await drain_notification_outbox_once(storage)
        return {
            "status": "ok",
            "jobName": "notification-outbox-drain",
            "result": result,
        }
