from __future__ import annotations

import asyncio
import logging

import httpx

from src.core.config import settings

logger = logging.getLogger("synapse.deposit_indexer.trigger")

_HTTP_OK_MIN = 200
_HTTP_REDIRECT_MIN = 300


async def post_deposit_indexer_trigger(
    *,
    source: str,
    triggered_by: str,
    tx_hash: str | None = None,
) -> bool:
    if (
        not settings.deposit_indexer_trigger_enabled
        or not settings.internal_trigger_secret
        or not settings.deposit_indexer_trigger_url
    ):
        return False

    delay_sec = max(0.0, float(settings.deposit_indexer_trigger_delay_sec))
    if delay_sec > 0:
        await asyncio.sleep(delay_sec)

    payload = {
        "source": source,
        "triggeredBy": triggered_by,
    }
    normalized_tx_hash = str(tx_hash or "").strip().lower()
    if normalized_tx_hash:
        payload["txHash"] = normalized_tx_hash

    try:
        async with httpx.AsyncClient(
            timeout=settings.deposit_indexer_trigger_timeout_sec,
            trust_env=False,
        ) as client:
            response = await client.post(
                settings.deposit_indexer_trigger_url,
                headers={
                    "X-Synapse-Internal-Token": settings.internal_trigger_secret,
                },
                json=payload,
            )
    except Exception:
        logger.exception(
            "DEPOSIT_INDEXER_TRIGGER_FAILED source=%s triggered_by=%s tx_hash=%s",
            source,
            triggered_by,
            normalized_tx_hash or "",
        )
        return False

    if response.status_code < _HTTP_OK_MIN or response.status_code >= _HTTP_REDIRECT_MIN:
        logger.warning(
            "DEPOSIT_INDEXER_TRIGGER_FAILED status=%s source=%s triggered_by=%s tx_hash=%s",
            response.status_code,
            source,
            triggered_by,
            normalized_tx_hash or "",
        )
        return False
    return True
