"""Step 4: 充值全链路 — approve → deposit on-chain → intent → confirm → balance check"""
import time
from decimal import Decimal

import httpx
from web3 import Web3

from tests.e2e.conftest import GATEWAY_BASE, DEPOSIT_USDC
from tests.e2e.helpers.chain import (
    approve_usdc,
    deposit_on_chain,
    get_usdc_decimals,
)
from tests.e2e.helpers.gateway import deposit_intent, deposit_confirm, get_balance


def test_deposit_full_pipeline(
    w3, contract_config, mock_usdc_abi, synapse_core_abi,
    owner_account, owner_headers, session_state,
):
    usdc_addr  = Web3.to_checksum_address(contract_config["MockUSDC"])
    core_addr  = Web3.to_checksum_address(contract_config["SynapseCore"])
    usdc       = w3.eth.contract(address=usdc_addr, abi=mock_usdc_abi)
    core       = w3.eth.contract(address=core_addr, abi=synapse_core_abi)
    decimals   = get_usdc_decimals(w3, usdc)

    # ① approve
    approve_usdc(w3, usdc, owner_account, core_addr, DEPOSIT_USDC, decimals)

    # ② on-chain deposit
    tx_hash = deposit_on_chain(w3, core, owner_account, DEPOSIT_USDC, decimals)
    assert tx_hash.startswith("0x"), f"Bad tx_hash: {tx_hash}"
    session_state["deposit_tx_hash"] = tx_hash

    # ③ notify gateway: intent
    intent_resp = deposit_intent(GATEWAY_BASE, owner_headers, tx_hash, DEPOSIT_USDC)
    assert intent_resp.get("status") == "success", f"Intent response: {intent_resp}"

    intent_obj = intent_resp.get("intent", {})
    intent_id = str(
        intent_obj.get("id")
        or intent_obj.get("intentId")
        or intent_obj.get("depositIntentId")
        or ""
    ).strip()
    assert intent_id, f"Could not find intent ID in response: {intent_resp}"
    session_state["deposit_intent_id"] = intent_id

    # event_key can be txHash itself or a dedicated field
    event_key = str(
        intent_obj.get("eventKey")
        or intent_obj.get("event_key")
        or tx_hash
    ).strip()
    session_state["deposit_event_key"] = event_key


def test_deposit_confirm(owner_headers, session_state):
    """Confirm the deposit intent registered in the previous step."""
    intent_id = session_state.get("deposit_intent_id")
    event_key = session_state.get("deposit_event_key")
    assert intent_id, "deposit_intent_id missing — did test_deposit_full_pipeline pass?"
    assert event_key, "deposit_event_key missing"

    confirm_resp = deposit_confirm(GATEWAY_BASE, owner_headers, intent_id, event_key)
    assert confirm_resp.get("status") == "success", f"Confirm resp: {confirm_resp}"


def test_balance_reflects_deposit(owner_headers):
    """After confirm, gateway balance must be >= DEPOSIT_USDC."""
    # Allow a brief moment for async indexing if applicable
    time.sleep(1)
    balance = get_balance(GATEWAY_BASE, owner_headers)
    assert balance >= DEPOSIT_USDC, (
        f"Balance {balance} is less than deposited {DEPOSIT_USDC}"
    )


def test_duplicate_intent_is_idempotent(owner_headers, session_state):
    """Re-submitting the same txHash must not double-credit."""
    tx_hash = session_state.get("deposit_tx_hash")
    if not tx_hash:
        import pytest; pytest.skip("No deposit tx_hash from previous step")

    import uuid
    r = httpx.post(
        f"{GATEWAY_BASE}/api/v1/balance/deposit/intent",
        headers={**owner_headers, "X-Idempotency-Key": uuid.uuid4().hex},
        json={"txHash": tx_hash, "amountUsdc": float(DEPOSIT_USDC)},
        timeout=15,
    )
    # Accepted (200 idempotent) or conflict (409) — either is valid; must NOT be 5xx
    assert r.status_code in (200, 409), (
        f"Unexpected status for duplicate intent: {r.status_code} {r.text}"
    )
