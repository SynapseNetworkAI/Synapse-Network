from __future__ import annotations

import json
from uuid import uuid4

from src.domain.finance import RefundIntentRow
from src.domain.ledger import WithdrawalIntentRow
from src.domain.runtime_state import VaultWithdrawalMetadataState


class GatewayStateManualReviewExpiryMixin:
    def expire_consumer_withdrawal_manual_review_atomic(
        self,
        *,
        owner: str,
        row: RefundIntentRow,
        amount_usdc,
        detail: dict,
        updated_at: str,
    ) -> None:
        consumer_wallet = str(owner or "").lower()
        amount = self._q6(amount_usdc)
        with self._db.tx_cursor() as cur:
            source_account_id = self._ensure_ledger_account(
                cur,
                consumer_wallet,
                "consumer_wallet",
                updated_at,
            )
            self._release_account_frozen_to_available(cur, source_account_id, amount, updated_at)
            self._expire_consumer_withdrawal_row(cur, row.id, source_account_id, updated_at)
            self._upsert_consumer_refund_metadata(
                cur,
                row,
                consumer_wallet=consumer_wallet,
                updated_at=updated_at,
            )
            self._append_consumer_review_audit(
                cur,
                action="CONSUMER_WITHDRAW_MANUAL_REVIEW_EXPIRED",
                owner=consumer_wallet,
                amount_usdc=amount,
                detail=detail,
            )

    def expire_provider_withdrawal_manual_review_atomic(
        self,
        *,
        owner: str,
        row: WithdrawalIntentRow,
        amount_usdc,
        detail: dict,
        updated_at: str,
    ) -> None:
        owner_wallet = str(owner or "").lower()
        amount = self._q6(amount_usdc)
        with self._db.tx_cursor() as cur:
            source_account_id = self._ensure_ledger_account(
                cur,
                owner_wallet,
                "provider_wallet",
                updated_at,
            )
            self._release_account_frozen_to_available(cur, source_account_id, amount, updated_at)
            self._expire_provider_withdrawal_row(cur, row.id, source_account_id, updated_at)
            self._upsert_provider_withdrawal_metadata(cur, row, updated_at)
            self._append_provider_withdrawal_expiry_audit(
                cur,
                owner=owner_wallet,
                amount_usdc=amount,
                detail=detail,
            )

    @staticmethod
    def _release_account_frozen_to_available(cur, account_id: str, amount, updated_at: str) -> None:
        cur.execute(
            """
            UPDATE synapse_account_balances
            SET frozen_balance = frozen_balance - %s,
                available_balance = available_balance + %s,
                updated_at = %s
            WHERE account_id = %s
              AND frozen_balance >= %s
            """,
            (str(amount), str(amount), updated_at, account_id, str(amount)),
        )
        if cur.rowcount != 1:
            raise RuntimeError("RELEASE_FROZEN_TO_AVAILABLE_INCONSISTENT")

    @staticmethod
    def _expire_consumer_withdrawal_row(cur, row_id: str, source_account_id: str, updated_at: str) -> None:
        cur.execute(
            """
            UPDATE synapse_vault_withdrawals
            SET status = 'FAILED_EXPIRED',
                signature = NULL,
                updated_at = %s
            WHERE withdrawal_id = %s
              AND withdrawal_kind = 'consumer_refund'
              AND source_account_id = %s
              AND status = 'PENDING_MANUAL_REVIEW'
            """,
            (updated_at, row_id, source_account_id),
        )
        if cur.rowcount != 1:
            raise RuntimeError("CONSUMER_WITHDRAW_REVIEW_STATE_INCONSISTENT")

    @staticmethod
    def _expire_provider_withdrawal_row(cur, row_id: str, source_account_id: str, updated_at: str) -> None:
        cur.execute(
            """
            UPDATE synapse_vault_withdrawals
            SET status = 'FAILED_EXPIRED',
                signature = NULL,
                updated_at = %s
            WHERE withdrawal_id = %s
              AND withdrawal_kind = 'provider_withdrawal'
              AND source_account_id = %s
              AND status = 'PENDING_MANUAL_REVIEW'
            """,
            (updated_at, row_id, source_account_id),
        )
        if cur.rowcount != 1:
            raise RuntimeError("PROVIDER_WITHDRAW_REVIEW_STATE_INCONSISTENT")

    def _upsert_provider_withdrawal_metadata(
        self,
        cur,
        row: WithdrawalIntentRow,
        updated_at: str,
    ) -> None:
        self._upsert_runtime_state(
            cur,
            self._vault_withdrawal_state_key(row.id),
            VaultWithdrawalMetadataState(
                idempotencyKey=row.idempotency_key,
                amountWei=row.amount_wei,
                feeWei=row.fee_wei,
                chainId=row.chain_id,
                contractAddress=row.contract_address,
                signerAddress=row.signer_address,
                businessType=row.business_type or "withdraw",
                evidenceSummary=row.evidence_summary,
                flowStatus=row.status,
                requestId=row.request_id,
                riskLevel=row.risk_level,
                riskReasonCode=row.risk_reason_code,
                message=row.message,
                requestMeta=row.request_meta,
                reviewDecision=row.review_decision,
                reviewerAddress=row.reviewer_address,
                reviewerNote=row.reviewer_note,
                reviewedAt=row.reviewed_at,
                ticket=row.ticket,
                completedAt=row.completed_at,
                completeMeta=row.complete_meta,
            ).model_dump(by_alias=True, mode="json"),
            updated_at,
        )

    def _append_provider_withdrawal_expiry_audit(
        self,
        cur,
        *,
        owner: str,
        amount_usdc,
        detail: dict,
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_audit_events (
                event_id, event_type, business_type, owner_id,
                amount_delta, result_status, detail_json
            ) VALUES (%s, 'PROVIDER_WITHDRAW_MANUAL_REVIEW_EXPIRED', 'withdraw', %s, %s, 'SUCCESS', %s::jsonb)
            """,
            (
                str(uuid4()),
                self._owner_id(owner),
                str(self._q6(amount_usdc)),
                json.dumps(detail, default=str),
            ),
        )
