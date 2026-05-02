from __future__ import annotations

from decimal import Decimal

from src.domain.ledger import WithdrawalIntentRow
from src.utils.money import money_str, quantize_usdc

EXPIRED_WITHDRAW_RELEASE_MESSAGE = "Withdrawal ticket expired. Locked receivable was released back to available balance."
EXPIRED_WITHDRAW_RECONCILED_MESSAGE = "Withdrawal ticket expired. Locked receivable had already been reconciled before cleanup."
EXPIRED_WITHDRAW_RPC_BEHIND_MESSAGE = "Withdrawal ticket is locally expired, but chain head has not crossed the finality margin yet."


class ProviderWithdrawSignedExpiryMixin:
    def _expire_signed_withdrawal_if_due(
        self,
        row: WithdrawalIntentRow,
        row_owner: str,
        now: int,
        now_text: str,
    ) -> tuple[bool, bool, bool]:
        if not self._is_expired_signed_withdrawal(row, now):
            return False, False, False
        deadline = int(row.deadline or 0)
        ticket_hash = str(row.ticket.ticket_hash or "")
        if not ticket_hash or not self._withdraw_rpc_head_past_deadline(deadline):
            row.message = EXPIRED_WITHDRAW_RPC_BEHIND_MESSAGE
            row.updated_at = now_text
            return True, True, False
        consumed = self._withdraw_ticket_consumed_or_unknown(ticket_hash)
        if consumed is None:
            return True, False, False
        if consumed:
            self._complete_consumed_expired_withdrawal(row, row_owner, ticket_hash, now, now_text)
            return True, True, False
        self._release_unconsumed_expired_withdrawal(row, row_owner, ticket_hash, now, now_text)
        return True, True, True

    def _complete_consumed_expired_withdrawal(
        self,
        row: WithdrawalIntentRow,
        row_owner: str,
        ticket_hash: str,
        now: int,
        now_text: str,
    ) -> None:
        amount_usdc = quantize_usdc(row.amount_usdc or Decimal("0"))
        if amount_usdc > Decimal("0"):
            self._consume_locked_withdraw_amount(row_owner, amount_usdc)
        row.status = "COMPLETED"
        row.updated_at = now_text
        row.completed_at = now
        row.message = "Withdrawal ticket was consumed on-chain before expiry cleanup."
        self._append_financial_audit(
            "PROVIDER_WITHDRAW_COMPLETED_BY_REAPER",
            row_owner,
            {
                "withdrawalId": str(row.id or ""),
                "ticketHash": ticket_hash,
                "amountUsdc": money_str(amount_usdc),
                "reason": "CHAIN_TICKET_CONSUMED",
            },
        )

    def _release_unconsumed_expired_withdrawal(
        self,
        row: WithdrawalIntentRow,
        row_owner: str,
        ticket_hash: str,
        now: int,
        now_text: str,
    ) -> None:
        amount_usdc = quantize_usdc(row.amount_usdc or Decimal("0"))
        released_amount_usdc = Decimal("0")
        if amount_usdc > Decimal("0"):
            released_amount_usdc = self._release_pending_withdraw_to_available(row_owner, amount_usdc)
        release_shortfall_usdc = quantize_usdc(max(Decimal("0"), amount_usdc - released_amount_usdc))
        row.status = "FAILED_EXPIRED"
        row.updated_at = now_text
        row.completed_at = now
        row.message = (
            EXPIRED_WITHDRAW_RELEASE_MESSAGE
            if release_shortfall_usdc <= Decimal("0")
            else EXPIRED_WITHDRAW_RECONCILED_MESSAGE
        )
        self._append_financial_audit(
            "PROVIDER_WITHDRAW_FAILED_EXPIRED",
            row_owner,
            {
                "withdrawalId": str(row.id or ""),
                "ticketHash": ticket_hash,
                "amountUsdc": money_str(amount_usdc),
                "releasedAmountUsdc": money_str(released_amount_usdc),
                "releaseShortfallUsdc": money_str(release_shortfall_usdc),
                "reason": "TICKET_EXPIRED",
                "deadline": int(row.deadline or 0),
            },
        )
