"""Background task: auto-complete consumer withdrawals via on-chain events.

Now that consumer withdrawals use the same ``SynapseCore.withdraw()`` path as
provider withdrawals (user executes on-chain, not the platform), this task
serves as a **safety net**.  If the user's frontend crashes after the on-chain
tx succeeds but before calling ``/v1/refunds/{id}/complete``, the background
task will detect the ``WithdrawInfo`` event and auto-complete the record.

Flow per tick:
1. Collect REQUESTED consumer withdrawal rows.
2. For each, check on-chain ``userNonces[owner]``.  If the nonce has advanced
   past the nonce stored in the signed ticket, the user has already executed.
3. Scan recent ``WithdrawInfo(user, amount, fee)`` events to find the matching
   tx hash.
4. Mark the intent as **COMPLETED** with the on-chain tx hash.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Optional

from src.core.config import settings
from src.services.owner.finance_constants import (
    CONSUMER_WITHDRAW_FEE_USDC,
    CONSUMER_WITHDRAW_PROCESSOR_INTERVAL_SEC,
    CONSUMER_WITHDRAW_TYPE,
)
from src.storage.base import BaseStorage

logger = logging.getLogger(__name__)

USDC_DECIMALS = 18  # local hardhat MockUSDC uses 18 decimals

# Minimal ABIs — only what the event watcher needs.
_USER_NONCES_ABI = [
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "userNonces",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    }
]
_WITHDRAW_INFO_EVENT_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": False, "internalType": "uint256", "name": "amount", "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "fee", "type": "uint256"},
        ],
        "name": "WithdrawInfo",
        "type": "event",
    }
]

# Combined ABI for the contract instance
_CORE_ABI = _USER_NONCES_ABI + _WITHDRAW_INFO_EVENT_ABI


def _web3():
    from web3 import Web3  # type: ignore[import-not-found]
    return Web3


def _get_w3_and_core():
    """Return ``(w3, core_contract)`` or ``(None, None)``."""
    Web3 = _web3()
    rpc_url = str(settings.rpc_url or "http://127.0.0.1:8545")
    router_address = str(settings.router_address or "").strip()
    if not router_address or router_address == "0x" + "0" * 40:
        return None, None
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    if not w3.is_connected():
        return None, None
    core = w3.eth.contract(
        address=Web3.to_checksum_address(router_address),
        abi=_CORE_ABI,
    )
    return w3, core


# ---------------------------------------------------------------------------
# On-chain helpers
# ---------------------------------------------------------------------------

def _on_chain_nonce(w3, core, owner: str) -> Optional[int]:
    """Return the current ``userNonces[owner]`` or None on failure."""
    Web3 = _web3()
    try:
        return int(core.functions.userNonces(Web3.to_checksum_address(owner)).call())
    except Exception as exc:
        logger.warning("consumer_withdraw_processor: nonce query failed for %s: %s", owner, exc)
        return None


def _find_withdraw_tx(w3, core, owner: str, amount_wei: int, fee_wei: int, lookback: int = 200) -> Optional[str]:
    """Scan recent ``WithdrawInfo`` events for a matching (user, amount, fee) tuple."""
    Web3 = _web3()
    try:
        latest = w3.eth.block_number
        from_block = max(0, latest - lookback)
        user_checksum = Web3.to_checksum_address(owner)
        events = core.events.WithdrawInfo.get_logs(
            fromBlock=from_block,
            toBlock="latest",
            argument_filters={"user": user_checksum},
        )
        for evt in reversed(events):       # most recent first
            if int(evt.args.amount) == amount_wei and int(evt.args.fee) == fee_wei:
                return "0x" + evt.transactionHash.hex().removeprefix("0x")
    except Exception as exc:
        logger.warning("consumer_withdraw_processor: event scan failed for %s: %s", owner, exc)
    return None


# ---------------------------------------------------------------------------
# Single-intent processor
# ---------------------------------------------------------------------------

def _process_single_withdraw(storage: BaseStorage, row: Any) -> bool:
    """Check if the on-chain withdraw has been executed; if so, mark COMPLETED."""
    from src.core.common import normalize_wallet
    from src.utils.datetime_utils import now_dt_str

    owner = normalize_wallet(str(row.owner_address or ""))
    amount_usdc = round(float(row.amount_usdc or 0), 6)
    fee_usdc = round(CONSUMER_WITHDRAW_FEE_USDC, 6)
    net_usdc = round(amount_usdc - fee_usdc, 6)
    net_wei = int(round(net_usdc * (10 ** USDC_DECIMALS)))
    fee_wei = int(round(fee_usdc * (10 ** USDC_DECIMALS)))

    # Extract ticket nonce from the stored signature/request_meta if available
    ticket_nonce: Optional[int] = None
    meta = getattr(row, "request_meta", None) or {}
    if isinstance(meta, dict):
        ticket_nonce = meta.get("ticketNonce")

    w3, core = _get_w3_and_core()
    if w3 is None or core is None:
        return False

    # Strategy 1: nonce-based detection — if the user's on-chain nonce
    # advanced past the ticket nonce, the tx was executed.
    if ticket_nonce is not None:
        current_nonce = _on_chain_nonce(w3, core, owner)
        if current_nonce is None or current_nonce <= ticket_nonce:
            return False  # not executed yet

    # Strategy 2: event scan — find the matching WithdrawInfo event.
    tx_hash = _find_withdraw_tx(w3, core, owner, net_wei, fee_wei)
    if tx_hash is None:
        # Nonce advanced but no matching event found yet — might be a different
        # withdrawal or the event is further back than our lookback window.
        if ticket_nonce is not None:
            logger.info(
                "consumer_withdraw_processor: nonce advanced for %s but no matching event found",
                owner,
            )
        return False

    # Mark as COMPLETED
    try:
        dm = storage.get_data_manager()
        # Consume locked pending balance — use the atomic SQL path so
        # write_balance_ledger (which only writes available) cannot discard it.
        from src.utils.datetime_utils import now_dt_str
        try:
            dm.finance.balance.consume_consumer_pending_for_withdrawal(
                owner=owner,
                amount_usdc=amount_usdc,
                updated_at=now_dt_str(),
            )
        except RuntimeError:
            logger.warning(
                "consumer_withdraw_processor: pending balance consume failed for %s (amount=%.6f)",
                owner, amount_usdc,
            )

        # Update refund row status
        rows = dm.system.gateway_state.read_consumer_refund_rows()
        for r in rows:
            if str(r.id or "") == str(row.id or ""):
                now = int(time.time())
                r.status = "COMPLETED"
                r.tx_hash = tx_hash
                r.completed_at = now
                r.updated_at = now_dt_str()
                break
        dm.system.gateway_state.write_consumer_refund_rows(rows, int(time.time()))

        # Audit
        from src.domain.audit import AuditLogEntry
        from uuid import uuid4
        dm.audit.logs.append_audit_row(AuditLogEntry(
            id=str(uuid4()),
            timestamp=int(time.time()),
            action="CONSUMER_WITHDRAW_EVENT_COMPLETED",
            owner_address=owner,
            details={
                "withdrawId": str(row.id or ""),
                "amountUsdc": amount_usdc,
                "feeUsdc": fee_usdc,
                "netUsdc": net_usdc,
                "txHash": tx_hash,
                "source": "event_watcher",
            },
        ))
        logger.info(
            "consumer_withdraw_processor: COMPLETED id=%s owner=%s amount=%.6f tx=%s",
            row.id, owner, amount_usdc, tx_hash,
        )

        # Analytics: withdrawal_completed
        import asyncio
        from src.services.analytics.gateway_events import emit_withdrawal_completed
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(emit_withdrawal_completed(
                owner, amount_usdc=amount_usdc, tx_hash=tx_hash, role="consumer",
            ))
        except RuntimeError:
            pass

        return True
    except Exception as exc:
        logger.error(
            "consumer_withdraw_processor: failed to finalize row %s after finding tx %s: %s",
            row.id, tx_hash, exc,
        )
        return False


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------

def _collect_requested_consumer_withdrawals(storage: BaseStorage) -> list:
    """Return all RefundIntentRow with status=REQUESTED and type=CONSUMER_BALANCE_WITHDRAW."""
    try:
        dm = storage.get_data_manager()
        rows = dm.system.gateway_state.read_consumer_refund_rows()
        return [
            r for r in rows
            if str(r.refund_type or "") == CONSUMER_WITHDRAW_TYPE
            and str(r.status or "").upper() == "REQUESTED"
        ]
    except Exception as exc:
        logger.warning("consumer_withdraw_processor: failed to read rows: %s", exc)
        return []


async def run_consumer_withdraw_processor(
    stop_event: asyncio.Event, storage: BaseStorage
) -> None:
    interval = max(1.0, CONSUMER_WITHDRAW_PROCESSOR_INTERVAL_SEC)
    logger.info("Consumer withdrawal event-watcher started: interval=%ss", interval)

    while not stop_event.is_set():
        try:
            pending = await asyncio.to_thread(
                _collect_requested_consumer_withdrawals, storage
            )
            for row in pending:
                if stop_event.is_set():
                    break
                try:
                    await asyncio.to_thread(_process_single_withdraw, storage, row)
                except Exception as exc:
                    logger.warning(
                        "consumer_withdraw_processor: error processing %s: %s",
                        getattr(row, "id", "?"), exc,
                    )
        except Exception as exc:
            logger.warning("consumer_withdraw_processor: tick failed: %s", exc)

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass

    logger.info("Consumer withdrawal event-watcher stopped")
