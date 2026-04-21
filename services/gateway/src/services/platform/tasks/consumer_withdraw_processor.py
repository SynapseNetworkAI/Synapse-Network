"""Background task: auto-complete consumer withdrawals via on-chain events.

Now that consumer withdrawals use the same ``SynapseCore.withdraw()`` path as
provider withdrawals (user executes on-chain, not the platform), this task
serves as a **safety net**.  If the user's frontend crashes after the on-chain
tx succeeds but before calling ``/v1/refunds/{id}/complete``, the background
task will detect the ``WithdrawInfo`` event and auto-complete the record.

Flow per tick:
1. Collect REQUESTED consumer withdrawal rows.
2. Scan recent ``WithdrawInfo(user, ticketHash, amount, fee)`` events.
3. Mark matching rows as **COMPLETED** with the on-chain tx hash.
4. Only after local expiry buffer and RPC block-time finality margin pass, query
   ``isTicketConsumed(ticketHash)`` before releasing funds as **FAILED_EXPIRED**.
"""
from __future__ import annotations

import asyncio
import logging
import time
from decimal import Decimal
from typing import Any, Optional

from src.core.config import settings
from src.services.owner.finance_constants import (
    CONSUMER_WITHDRAW_FEE_USDC,
    CONSUMER_WITHDRAW_PROCESSOR_INTERVAL_SEC,
    CONSUMER_WITHDRAW_TYPE,
)
from src.storage.base import BaseStorage
from src.utils.money import parse_usdc

logger = logging.getLogger(__name__)

# Minimal ABIs — only what the event watcher needs.
_TICKET_STATE_ABI = [
    {
        "inputs": [{"internalType": "bytes32", "name": "ticketHash", "type": "bytes32"}],
        "name": "isTicketConsumed",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    }
]
_WITHDRAW_INFO_EVENT_ABI = [
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": True, "internalType": "bytes32", "name": "ticketHash", "type": "bytes32"},
            {"indexed": False, "internalType": "uint256", "name": "amount", "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "fee", "type": "uint256"},
        ],
        "name": "WithdrawInfo",
        "type": "event",
    }
]

# Combined ABI for the contract instance
_CORE_ABI = _TICKET_STATE_ABI + _WITHDRAW_INFO_EVENT_ABI


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
    w3 = Web3(
        Web3.HTTPProvider(
            rpc_url,
            request_kwargs={"timeout": settings.rpc_request_timeout_sec},
        )
    )
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

def _find_withdraw_tx(w3, core, owner: str, ticket_hash: str, lookback: int = 200) -> Optional[str]:
    """Scan recent ``WithdrawInfo`` events for the exact ticket hash."""
    Web3 = _web3()
    try:
        latest = w3.eth.block_number
        from_block = max(0, latest - lookback)
        user_checksum = Web3.to_checksum_address(owner)
        events = core.events.WithdrawInfo.get_logs(
            from_block=from_block,
            to_block="latest",
            argument_filters={"user": user_checksum, "ticketHash": ticket_hash},
        )
        for evt in reversed(events):       # most recent first
            return "0x" + evt.transactionHash.hex().removeprefix("0x")
    except Exception as exc:
        logger.warning(
            "consumer_withdraw_processor: event scan failed: %s",
            exc.__class__.__name__,
        )
    return None


def _is_ticket_consumed(core, ticket_hash: str) -> Optional[bool]:
    try:
        return bool(core.functions.isTicketConsumed(ticket_hash).call())
    except Exception as exc:
        logger.warning(
            "consumer_withdraw_processor: chain state query failed: %s",
            exc.__class__.__name__,
        )
        return None


def _rpc_block_timestamp(w3) -> Optional[int]:
    try:
        return int(w3.eth.get_block("latest")["timestamp"])
    except Exception as exc:
        logger.warning("consumer_withdraw_processor: latest block timestamp query failed: %s", exc)
        return None


def _row_request_meta_dict(row: Any) -> dict[str, Any]:
    meta = getattr(row, "request_meta", None)
    if isinstance(meta, dict):
        return meta
    if hasattr(meta, "model_dump"):
        try:
            return meta.model_dump(by_alias=True, mode="json")
        except Exception:
            return {}
    return {}


def _ticket_deadline(row: Any) -> int:
    ticket = getattr(row, "ticket", None)
    if getattr(ticket, "deadline", None):
        return int(ticket.deadline or 0)
    return int(_row_request_meta_dict(row).get("ticketDeadline") or 0)


def _ticket_hash(row: Any) -> str:
    ticket = getattr(row, "ticket", None)
    if getattr(ticket, "ticket_hash", None):
        return str(ticket.ticket_hash or "")
    return str(_row_request_meta_dict(row).get("ticketHash") or "")


# ---------------------------------------------------------------------------
# Single-intent processor
# ---------------------------------------------------------------------------

def _process_single_withdraw(storage: BaseStorage, row: Any) -> bool:
    """Check if the on-chain withdraw has been executed; if so, mark COMPLETED."""
    from src.core.common import normalize_wallet
    from src.utils.datetime_utils import now_dt_str

    owner = normalize_wallet(str(row.owner_address or ""))
    w3, core = _get_w3_and_core()
    if w3 is None or core is None:
        return False
    amount_usdc = parse_usdc(row.amount_usdc)
    fee_usdc = parse_usdc(Decimal(str(CONSUMER_WITHDRAW_FEE_USDC)))
    net_usdc = parse_usdc(amount_usdc - fee_usdc)
    ticket_hash = _ticket_hash(row)
    if not ticket_hash:
        logger.warning("consumer_withdraw_processor: row %s has no claim credential digest", row.id)
        return False

    tx_hash = _find_withdraw_tx(w3, core, owner, ticket_hash)
    if tx_hash is not None:
        if str(getattr(row, "status", "") or "").upper() == "FAILED_EXPIRED":
            logger.critical(
                "P0_RECONCILIATION_ANOMALY: expired consumer withdrawal later emitted chain event id=%s",
                row.id,
            )
            return False
        return _complete_consumer_withdraw(storage, row, owner, amount_usdc, fee_usdc, net_usdc, tx_hash)
    if str(getattr(row, "status", "") or "").upper() == "FAILED_EXPIRED":
        return False

    ticket_deadline = _ticket_deadline(row)
    expiry_buffer = max(0, int(getattr(settings, "withdraw_ticket_expiry_buffer_sec", 900) or 900))
    finality_margin = max(0, int(getattr(settings, "withdraw_rpc_finality_margin_sec", 300) or 300))
    if ticket_deadline > 0 and int(time.time()) > ticket_deadline + expiry_buffer:
        block_timestamp = _rpc_block_timestamp(w3)
        if block_timestamp is None or block_timestamp <= ticket_deadline + finality_margin:
            logger.info(
                "consumer_withdraw_processor: RPC_BEHIND_WITHDRAW_DEADLINE id=%s",
                row.id,
            )
            return False
        consumed = _is_ticket_consumed(core, ticket_hash)
        if consumed is None:
            return False
        if consumed:
            return _complete_consumer_withdraw(
                storage, row, owner, amount_usdc, fee_usdc, net_usdc, ""
            )
        try:
            dm = storage.get_data_manager()
            dm.finance.balance.release_consumer_pending_to_available(
                owner=owner,
                amount_usdc=amount_usdc,
                updated_at=now_dt_str(),
            )
        except RuntimeError:
            logger.warning(
                "consumer_withdraw_processor: pending release failed for expired row id=%s",
                row.id,
            )
        rows = dm.system.gateway_state.read_consumer_refund_rows()
        for r in rows:
            if str(r.id or "") != str(row.id or ""):
                continue
            now = int(time.time())
            r.status = "FAILED_EXPIRED"
            r.completed_at = now
            r.updated_at = now_dt_str()
            r.message = "Withdrawal ticket expired before on-chain execution. Funds were released back to available balance."
            break
        dm.system.gateway_state.write_consumer_refund_rows(rows, int(time.time()))
        logger.info(
            "consumer_withdraw_processor: FAILED_EXPIRED id=%s reason=credential_expired",
            row.id,
        )
        return True

    return False


def _complete_consumer_withdraw(
    storage: BaseStorage,
    row: Any,
    owner: str,
    amount_usdc: Decimal,
    fee_usdc: Decimal,
    net_usdc: Decimal,
    tx_hash: str,
) -> bool:
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
                "consumer_withdraw_processor: pending consume failed for row id=%s",
                row.id,
            )

        # Update refund row status
        rows = dm.system.gateway_state.read_consumer_refund_rows()
        for r in rows:
            if str(r.id or "") == str(row.id or ""):
                now = int(time.time())
                r.status = "COMPLETED"
                if tx_hash:
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
            "consumer_withdraw_processor: COMPLETED id=%s source=event_watcher",
            row.id,
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
            "consumer_withdraw_processor: failed to finalize row %s after chain event: %s",
            row.id, exc.__class__.__name__,
        )
        return False


# ---------------------------------------------------------------------------
# Background loop
# ---------------------------------------------------------------------------

def _collect_requested_consumer_withdrawals(storage: BaseStorage) -> list:
    """Return active or anomaly-check consumer withdrawal rows."""
    try:
        dm = storage.get_data_manager()
        rows = dm.system.gateway_state.read_consumer_refund_rows()
        return [
            r for r in rows
            if str(r.refund_type or "") == CONSUMER_WITHDRAW_TYPE
            and str(r.status or "").upper() in {"REQUESTED", "FAILED_EXPIRED"}
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
