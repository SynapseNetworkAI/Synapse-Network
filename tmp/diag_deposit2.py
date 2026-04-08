#!/usr/bin/env python3
"""Simulate the deposit indexer processing for the stuck intent."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "gateway"))

from src.core.config import settings
from src.core.common import normalize_wallet
from src.services.platform.tasks.deposit_indexer.chain import (
    _get_confirmed_receipt_or_none,
    _resolve_matched_event,
    _normalize_tx_hash,
    _amount_usdc_from_raw,
    _resolve_token_decimals,
)

tx_hash = "0x08a51f97b499ec7da9b6e25bf898424ea4c16dbc12e601ad00661022993d49f1"
owner = "0xd856907d7e35a8f9bd225859a59e58577147a092"
min_amount = 20.0

print("=== Step 1: _get_confirmed_receipt_or_none ===")
result = _get_confirmed_receipt_or_none(tx_hash)
if result is None:
    print("  RESULT: None (not confirmed yet or not found)")
elif result.get("failed"):
    print("  RESULT: FAILED tx")
else:
    print(f"  RESULT: ok, confirmations={result.get('confirmations')}")
    receipt = result["receipt"]

    print("\n=== Step 2: _resolve_matched_event ===")
    matched = _resolve_matched_event(receipt, owner, min_amount)
    if matched:
        print(f"  MATCHED: eventKey={matched.get('eventKey')}, owner={matched.get('ownerAddress')}, amountRaw={matched.get('amountRaw')}, token={matched.get('token')}")
        decimals = _resolve_token_decimals(str(matched.get("token") or ""))
        amount_usdc = _amount_usdc_from_raw(int(matched.get("amountRaw", 0)), decimals=decimals)
        print(f"  decimals={decimals}, amount_usdc={amount_usdc}")
    else:
        print("  NO MATCH - this is the bug!")

        # Try manual fallback
        print("\n=== Step 2b: Manual debugging ===")
        from src.services.platform.tasks.deposit_indexer.chain import (
            _decode_router_deposit_events,
            _decode_erc20_transfer_to_router,
            _pick_matching_event,
        )
        router_events = _decode_router_deposit_events(receipt)
        print(f"  Router ABI events: {len(router_events)}")
        for e in router_events:
            print(f"    {e}")

        erc20_events = _decode_erc20_transfer_to_router(receipt)
        print(f"  ERC20 Transfer fallback events: {len(erc20_events)}")
        for e in erc20_events:
            print(f"    {e}")

        if erc20_events:
            match2 = _pick_matching_event(erc20_events, owner, min_amount)
            print(f"  Pick matching: {match2}")
