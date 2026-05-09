from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CompleteWithdrawTxContext:
    owner: str
    tx_hash: str
    command_kind: str
    withdrawal_id: str
    withdrawal_kind: str
    active_statuses: tuple[str, ...]
    now_text: str
