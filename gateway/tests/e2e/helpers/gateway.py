"""Gateway API helpers: deposit intent/confirm, balance query."""
from __future__ import annotations

import uuid
from decimal import Decimal

import httpx

TIMEOUT = 30


def get_balance(gateway_base: str, headers: dict) -> Decimal:
    r = httpx.get(f"{gateway_base}/api/v1/balance", headers=headers, timeout=TIMEOUT)
    r.raise_for_status()
    data = r.json()
    # Real response shape:
    # {"status": "success", "balance": {"ownerBalance": x, "consumerAvailableBalance": x, ...}}
    balance_field = data.get("balance", {})
    if isinstance(balance_field, dict):
        # prefer consumerAvailableBalance (spendable), fallback to ownerBalance
        value = (
            balance_field.get("consumerAvailableBalance")
            or balance_field.get("ownerBalance")
            or 0
        )
    else:
        value = balance_field or 0
    return Decimal(str(value))


def deposit_intent(
    gateway_base: str,
    headers: dict,
    tx_hash: str,
    amount_usdc: Decimal,
) -> dict:
    """Register deposit intent. Returns the intent dict from gateway."""
    idem_key = uuid.uuid4().hex
    r = httpx.post(
        f"{gateway_base}/api/v1/balance/deposit/intent",
        headers={**headers, "X-Idempotency-Key": idem_key},
        json={"txHash": tx_hash, "amountUsdc": float(amount_usdc)},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"deposit intent failed ({r.status_code}): {r.text}"
    return r.json()


def deposit_confirm(
    gateway_base: str,
    headers: dict,
    intent_id: str,
    event_key: str,
) -> dict:
    """Confirm a registered deposit intent."""
    r = httpx.post(
        f"{gateway_base}/api/v1/balance/deposit/intents/{intent_id}/confirm",
        headers=headers,
        json={"eventKey": event_key, "confirmations": 1},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"deposit confirm failed ({r.status_code}): {r.text}"
    return r.json()
