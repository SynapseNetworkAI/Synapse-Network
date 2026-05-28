from __future__ import annotations

import logging
from decimal import Decimal

from src.utils.money import money_str

logger = logging.getLogger(__name__)


def log_consumer_withdraw_completed(
    *,
    withdrawal_id: str,
    owner: str,
    amount_usdc: Decimal,
    fee_usdc: Decimal,
    net_usdc: Decimal,
    tx_hash: str,
    completion_source: str,
) -> None:
    logger.info(
        "event=CONSUMER_WITHDRAW_COMPLETED withdrawal_id=%s owner_address=%s tx_hash=%s amount_usdc=%s fee_usdc=%s net_usdc=%s completion_source=%s",
        withdrawal_id,
        owner,
        tx_hash,
        money_str(amount_usdc),
        money_str(fee_usdc),
        money_str(net_usdc),
        completion_source,
    )
