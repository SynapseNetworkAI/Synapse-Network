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
    hashes: list[str] = []
    seen: set[str] = set()

    def _push(raw_value: Any) -> None:
        tx_hash = str(raw_value or "").strip().lower()
        if not tx_hash or tx_hash in seen:
            return
        seen.add(tx_hash)
        hashes.append(tx_hash)

    event = payload.get("event")
    if not isinstance(event, dict):
        return []
    activity = event.get("activity")
    if isinstance(activity, list):
        for item in activity:
            if not isinstance(item, dict):
                continue
            _push(item.get("hash"))
            _push(item.get("transactionHash"))
    data = event.get("data")
    if not isinstance(data, dict):
        return hashes
    block = data.get("block")
    if not isinstance(block, dict):
        return hashes
    for log in block.get("logs") or []:
        if not isinstance(log, dict):
            continue
        transaction = log.get("transaction")
        if not isinstance(transaction, dict):
            continue
        _push(transaction.get("hash"))
    return hashes


def _alchemy_webhook_source(payload: dict[str, Any]) -> str:
    event = payload.get("event")
    if isinstance(event, dict) and isinstance(event.get("activity"), list):
        return "alchemy_address_activity"
    return "alchemy_custom_webhook"


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
    webhook_source = _alchemy_webhook_source(payload)
    result = await asyncio.to_thread(
        run_locked_bounded_pending_confirmation_sweep,
        storage,
    )
    tx_hash_preview = tx_hashes[:3]
    logger.info(
        "event=ALCHEMY_DEPOSIT_WEBHOOK_RECEIVED webhook_source=%s tx_hashes_count=%s tx_hashes_preview=%s status=%s attempts=%s credited=%s failed=%s pending=%s reason=%s",
        webhook_source,
        len(tx_hashes),
        tx_hash_preview,
        result.status,
        result.attempts,
        result.credited,
        result.failed,
        result.pending,
        result.reason or "",
    )
    return {
        "status": result.status,
        "source": webhook_source,
        "attempts": result.attempts,
        "txHashes": tx_hashes,
        "result": {
            "credited": result.credited,
            "failed": result.failed,
            "pending": result.pending,
        },
        **({"reason": result.reason} if result.reason else {}),
    }
