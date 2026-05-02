from __future__ import annotations

import time
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from src.core.config import settings
from src.domain.ledger import WithdrawalIntentRow
from src.services.notifications.in_app import build_provider_withdrawal_failed_expired_intent
from src.services.notifications.transactional import enqueue_transaction_email
from src.utils.datetime_utils import to_dt_str
from src.utils.money import money_str, quantize_usdc

MANUAL_REVIEW_EXPIRED_PROVIDER_MESSAGE = (
    "Provider withdrawal timed out during manual review. Frozen earnings were "
    "safely returned to your withdrawable balance. Please create a new "
    "provider withdrawal if needed."
)
logger = logging.getLogger(__name__)


class ProviderWithdrawManualReviewExpiryMixin:
    @staticmethod
    def _withdraw_created_at(row: WithdrawalIntentRow) -> int:
        normalized = to_dt_str(row.created_at, "") or ""
        if not normalized:
            return 0
        try:
            return int(
                datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
                .replace(tzinfo=timezone.utc)
                .timestamp()
            )
        except Exception:
            return 0

    @staticmethod
    def _is_expired_manual_review_withdrawal(
        row: WithdrawalIntentRow, now: Optional[int] = None
    ) -> bool:
        if str(row.status or "").upper() != "PENDING_MANUAL_REVIEW":
            return False
        created_at = ProviderWithdrawManualReviewExpiryMixin._withdraw_created_at(row)
        if created_at <= 0:
            return False
        expiry_sec = int(getattr(settings, "withdrawal_manual_review_expiry_sec", 86400) or 86400)
        expiry_min = int(getattr(settings, "withdrawal_manual_review_expiry_min_sec", 60) or 60)
        return int(now or time.time()) - created_at >= max(expiry_min, expiry_sec)

    def _expire_manual_review_withdrawal_if_due(
        self,
        row: WithdrawalIntentRow,
        row_owner: str,
        now: int,
        now_text: str,
    ) -> tuple[bool, bool]:
        if not self._is_expired_manual_review_withdrawal(row, now):
            return False, False
        amount_usdc = quantize_usdc(row.amount_usdc or Decimal("0"))
        audit_detail = {
            "withdrawalId": str(row.id or ""),
            "amountUsdc": money_str(amount_usdc),
            "releasedAmountUsdc": money_str(amount_usdc),
            "reason": "MANUAL_REVIEW_EXPIRED",
            "expirySeconds": int(
                getattr(settings, "withdrawal_manual_review_expiry_sec", 86400) or 86400
            ),
        }
        updated = self._manual_review_expired_row(row, now, now_text)
        expire_atomic = getattr(
            self.storage.get_data_manager().system.gateway_state,
            "expire_provider_withdrawal_manual_review_atomic",
            None,
        )
        try:
            if callable(expire_atomic):
                expire_atomic(
                    owner=row_owner,
                    row=updated,
                    amount_usdc=amount_usdc,
                    detail=audit_detail,
                    updated_at=now_text,
                )
            else:
                self._expire_manual_review_withdrawal_in_memory(
                    row_owner,
                    amount_usdc,
                    audit_detail,
                    updated,
                    row,
                )
        except RuntimeError:
            return True, False
        row.status = updated.status
        row.updated_at = updated.updated_at
        row.completed_at = updated.completed_at
        row.message = updated.message
        self._emit_provider_manual_review_expiry_notifications(row_owner, row, amount_usdc)
        return True, True

    @staticmethod
    def _manual_review_expired_row(
        row: WithdrawalIntentRow,
        now: int,
        now_text: str,
    ) -> WithdrawalIntentRow:
        updated = row.model_copy(deep=True)
        updated.status = "FAILED_EXPIRED"
        updated.updated_at = now_text
        updated.completed_at = now
        updated.message = MANUAL_REVIEW_EXPIRED_PROVIDER_MESSAGE
        return updated

    def _expire_manual_review_withdrawal_in_memory(
        self,
        row_owner: str,
        amount_usdc: Decimal,
        audit_detail: dict,
        updated: WithdrawalIntentRow,
        row: WithdrawalIntentRow,
    ) -> None:
        self._release_frozen_withdraw_to_available(row_owner, amount_usdc)
        row.status = updated.status
        row.updated_at = updated.updated_at
        row.completed_at = updated.completed_at
        row.message = updated.message
        self._append_financial_audit(
            "PROVIDER_WITHDRAW_MANUAL_REVIEW_EXPIRED",
            row_owner,
            audit_detail,
        )

    def _emit_provider_manual_review_expiry_notifications(
        self,
        owner: str,
        row: WithdrawalIntentRow,
        amount_usdc: Decimal,
    ) -> None:
        payload = {
            "withdrawalId": str(row.id or ""),
            "amount": money_str(amount_usdc),
            "status": "FAILED_EXPIRED",
            "message": MANUAL_REVIEW_EXPIRED_PROVIDER_MESSAGE,
            "ownerAddress": owner,
        }
        try:
            self.storage.enqueue_in_app_notification(
                build_provider_withdrawal_failed_expired_intent(owner, payload)
            )
        except Exception as exc:
            logger.warning("provider_withdraw_reaper: in-app expiry notification failed: %s", exc)
        enqueue_transaction_email(
            self.storage,
            owner_wallet=owner,
            template_key="provider_withdrawal_failed_expired",
            event_type="provider_withdrawal.failed_expired",
            payload=payload,
        )
