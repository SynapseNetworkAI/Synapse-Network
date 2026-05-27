from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from src.core.config import settings
from src.services.platform.tasks.deposit_indexer import (
    run_locked_bounded_pending_confirmation_sweep,
)
from src.storage import BaseStorage, get_storage

router = APIRouter()
logger = logging.getLogger(__name__)


def _alchemy_signature(body: bytes, signing_key: str) -> str:
    digest = hmac.new(
        signing_key.encode("utf-8"),
        msg=body,
        digestmod=hashlib.sha256,
    )
    return digest.hexdigest()


def _extract_tx_hashes(payload: dict[str, Any]) -> list[str]:
    event = payload.get("event")
    if not isinstance(event, dict):
        return []
    data = event.get("data")
    if not isinstance(data, dict):
        return []
    block = data.get("block")
    if not isinstance(block, dict):
        return []
    hashes: list[str] = []
    for log in block.get("logs") or []:
        if not isinstance(log, dict):
            continue
        transaction = log.get("transaction")
        if not isinstance(transaction, dict):
            continue
        tx_hash = str(transaction.get("hash") or "").strip().lower()
        if tx_hash:
            hashes.append(tx_hash)
    return hashes


@router.post("/internal/webhooks/alchemy/deposits")
async def receive_alchemy_deposit_webhook(
    request: Request,
    storage: Annotated[BaseStorage, Depends(get_storage)],
    x_alchemy_signature: Annotated[str | None, Header()] = None,
):
    if not settings.alchemy_deposit_webhook_enabled:
        raise HTTPException(status_code=404, detail="Not found")

    body = await request.body()
    expected = settings.alchemy_deposit_webhook_signing_key
    actual = x_alchemy_signature or ""
    if not expected or not hmac.compare_digest(
        actual,
        _alchemy_signature(body, expected),
    ):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = json.loads(body.decode("utf-8") or "{}")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload") from exc

    tx_hashes = _extract_tx_hashes(payload)
    result = await asyncio.to_thread(
        run_locked_bounded_pending_confirmation_sweep,
        storage,
    )
    logger.info(
        "ALCHEMY_DEPOSIT_WEBHOOK_RECEIVED tx_hashes=%s status=%s attempts=%s",
        len(tx_hashes),
        result.status,
        result.attempts,
    )
    return {
        "status": result.status,
        "source": "alchemy_custom_webhook",
        "attempts": result.attempts,
        "txHashes": tx_hashes,
        "result": {
            "credited": result.credited,
            "failed": result.failed,
            "pending": result.pending,
        },
        **({"reason": result.reason} if result.reason else {}),
    }
