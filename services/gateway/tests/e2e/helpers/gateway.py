"""Gateway API helpers: balance, provider secret, deposit and service registry."""
from __future__ import annotations

import uuid
from decimal import Decimal

import httpx

TIMEOUT = 30


def get_balance_full(gateway_base: str, headers: dict) -> dict:
    """Return the raw balance dict from gateway for multi-field assertions."""
    r = httpx.get(f"{gateway_base}/api/v1/balance", headers=headers, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json().get("balance", {})


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


def issue_provider_secret(
    gateway_base: str,
    headers: dict,
    *,
    name: str,
    rpm: int = 120,
    credit_limit: float = 10.0,
) -> dict:
    r = httpx.post(
        f"{gateway_base}/api/v1/secrets/provider/issue",
        headers=headers,
        json={
            "name": name,
            "rpm": rpm,
            "creditLimit": credit_limit,
            "resetInterval": "monthly",
        },
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, (
        f"issue provider secret failed ({r.status_code}): {r.text}"
    )
    return r.json()


def list_provider_secrets(gateway_base: str, headers: dict) -> list[dict]:
    r = httpx.get(
        f"{gateway_base}/api/v1/secrets/provider/list",
        headers=headers,
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, (
        f"list provider secrets failed ({r.status_code}): {r.text}"
    )
    payload = r.json()
    return payload.get("secrets", [])


def register_service(gateway_base: str, headers: dict, payload: dict) -> dict:
    r = httpx.post(
        f"{gateway_base}/api/v1/services",
        headers=headers,
        json=payload,
        timeout=TIMEOUT,
    )
    assert r.status_code in (200, 201), (
        f"service registration failed ({r.status_code}): {r.text}"
    )
    return r.json()


def list_services(gateway_base: str, headers: dict) -> list[dict]:
    r = httpx.get(
        f"{gateway_base}/api/v1/services",
        headers=headers,
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"list services failed ({r.status_code}): {r.text}"
    payload = r.json()
    return payload.get("services") or payload.get("items") or []
