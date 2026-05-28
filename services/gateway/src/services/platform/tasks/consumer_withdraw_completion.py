from __future__ import annotations

import asyncio
import time
from decimal import Decimal
from typing import Any
from uuid import uuid4

from src.domain.audit import AuditLogEntry
from src.services.analytics.gateway_events import emit_withdrawal_completed
from src.services.owner.consumer_withdraw_logging import (
    log_consumer_withdraw_completed,
)
from src.utils.datetime_utils import now_dt_str
from src.utils.money import parse_usdc


def settle_completed_consumer_withdraw_balance(
    dm: Any,
    owner: str,
    amount_usdc: Decimal,
    fee_usdc: Decimal,
) -> None:
    balance_repo = dm.finance.balance
    settle_with_fee = getattr(
        balance_repo,
        "consume_consumer_pending_for_withdrawal_and_accrue_platform_fee",
        None,
    )
    if callable(settle_with_fee):
        settle_with_fee(
            owner=owner,
            amount_usdc=amount_usdc,
            fee_usdc=fee_usdc,
            updated_at=now_dt_str(),
        )
        return

    balance_repo.consume_consumer_pending_for_withdrawal(
        owner=owner,
        amount_usdc=amount_usdc,
        updated_at=now_dt_str(),
    )
    ledger = balance_repo.read_balance_ledger()
    ledger.platform.fee_accrued = parse_usdc(
        Decimal(str(ledger.platform.fee_accrued or "0")) + fee_usdc
    )
    balance_repo.write_balance_ledger(ledger)


def append_consumer_withdraw_completed_audit(
    dm: Any,
    row: Any,
    owner: str,
    amount_usdc: Decimal,
    fee_usdc: Decimal,
    net_usdc: Decimal,
    tx_hash: str,
) -> None:
    dm.audit.logs.append_audit_row(
        AuditLogEntry(
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
        )
    )
def emit_consumer_withdraw_completed_metric(
    owner: str,
    amount_usdc: Decimal,
    tx_hash: str,
) -> None:
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(
            emit_withdrawal_completed(
                owner,
                amount_usdc=amount_usdc,
                tx_hash=tx_hash,
                role="consumer",
            )
        )
    except RuntimeError:
        pass
