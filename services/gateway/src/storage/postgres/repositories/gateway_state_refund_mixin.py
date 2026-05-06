"""Gateway state repository — refund row mixin."""
from __future__ import annotations

import json
from typing import List
from uuid import uuid4

from src.domain.finance import (
    RefundIntentRow,
)
from src.domain.runtime_state import (
    VaultWithdrawalMetadataState,
)
from src.utils.datetime_utils import now_dt_str, to_dt_str




class GatewayStateRefundMixin:
    """Consumer refund row read/write operations."""

    def _upsert_consumer_refund_metadata(
        self,
        cur,
        row: RefundIntentRow,
        *,
        consumer_wallet: str,
        updated_at: str,
    ) -> None:
        self._upsert_runtime_state(
            cur,
            self._vault_withdrawal_state_key(row.id),
            VaultWithdrawalMetadataState(
                consumerAddress=consumer_wallet,
                requestId=row.request_id,
                idempotencyKey=row.idempotency_key,
                flowStatus=row.status,
                reason=row.reason,
                gasPayer=row.gas_payer,
                gasModel=row.gas_model,
                originRequestId=row.origin_request_id,
                originTxHash=row.origin_tx_hash,
                refundType=row.refund_type,
                destinationAddress=row.destination_address,
                evidenceSummary=row.evidence_summary,
                riskLevel=row.risk_level,
                riskReasonCode=row.risk_reason_code,
                message=row.message,
                requestMeta=row.request_meta,
                reviewDecision=row.review_decision,
                reviewerAddress=row.reviewer_address,
                reviewerNote=row.reviewer_note,
                reviewedAt=row.reviewed_at,
                completedAt=row.completed_at,
                completeMeta=row.complete_meta,
                ticket=row.ticket,
            ).model_dump(by_alias=True, mode="json"),
            updated_at,
        )

    def _append_consumer_review_audit(
        self,
        cur,
        *,
        action: str,
        owner: str,
        amount_usdc,
        detail: dict,
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_audit_events (
                event_id, event_type, business_type, owner_id,
                amount_delta, result_status, detail_json
            ) VALUES (%s, %s, 'refund', %s, %s, 'SUCCESS', %s::jsonb)
            """,
            (
                str(uuid4()),
                action,
                self._owner_id(owner),
                str(self._q6(amount_usdc)),
                json.dumps(detail, default=str),
            ),
        )

    def reject_consumer_withdrawal_review_atomic(
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
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET frozen_balance = frozen_balance - %s,
                    available_balance = available_balance + %s,
                    updated_at = %s
                WHERE account_id = %s
                  AND frozen_balance >= %s
                """,
                (str(amount), str(amount), updated_at, source_account_id, str(amount)),
            )
            if cur.rowcount != 1:
                raise RuntimeError("RELEASE_FROZEN_TO_AVAILABLE_INCONSISTENT")

            cur.execute(
                """
                UPDATE synapse_vault_withdrawals
                SET status = 'REJECTED',
                    signature = NULL,
                    updated_at = %s
                WHERE withdrawal_id = %s
                  AND withdrawal_kind = 'consumer_refund'
                  AND source_account_id = %s
                  AND status = 'PENDING_MANUAL_REVIEW'
                """,
                (updated_at, row.id, source_account_id),
            )
            if cur.rowcount != 1:
                raise RuntimeError("CONSUMER_WITHDRAW_REVIEW_STATE_INCONSISTENT")

            self._upsert_consumer_refund_metadata(
                cur,
                row,
                consumer_wallet=consumer_wallet,
                updated_at=updated_at,
            )
            self._append_consumer_review_audit(
                cur,
                action="CONSUMER_WITHDRAW_REVIEW_REJECTED",
                owner=consumer_wallet,
                amount_usdc=amount,
                detail=detail,
            )

    def approve_consumer_withdrawal_review_atomic(
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
            cur.execute(
                """
                UPDATE synapse_account_balances
                SET frozen_balance = frozen_balance - %s,
                    pending_balance = pending_balance + %s,
                    updated_at = %s
                WHERE account_id = %s
                  AND frozen_balance >= %s
                """,
                (str(amount), str(amount), updated_at, source_account_id, str(amount)),
            )
            if cur.rowcount != 1:
                raise RuntimeError("MOVE_FROZEN_TO_PENDING_INCONSISTENT")

            cur.execute(
                """
                UPDATE synapse_vault_withdrawals
                SET status = 'REQUESTED',
                    ticket_id = COALESCE(ticket_id, %s),
                    ticket_hash = COALESCE(ticket_hash, %s),
                    signature = %s,
                    nonce = %s,
                    deadline = %s,
                    updated_at = %s
                WHERE withdrawal_id = %s
                  AND withdrawal_kind = 'consumer_refund'
                  AND source_account_id = %s
                  AND status = 'PENDING_MANUAL_REVIEW'
                """,
                (
                    row.ticket.ticket_id,
                    row.ticket.ticket_hash,
                    row.signature or row.ticket.signature or None,
                    row.ticket.nonce,
                    row.ticket.deadline,
                    updated_at,
                    row.id,
                    source_account_id,
                ),
            )
            if cur.rowcount != 1:
                raise RuntimeError("CONSUMER_WITHDRAW_REVIEW_STATE_INCONSISTENT")

            self._upsert_consumer_refund_metadata(
                cur,
                row,
                consumer_wallet=consumer_wallet,
                updated_at=updated_at,
            )
            self._append_consumer_review_audit(
                cur,
                action="CONSUMER_WITHDRAW_REVIEW_APPROVED",
                owner=consumer_wallet,
                amount_usdc=amount,
                detail=detail,
            )

    def read_consumer_refund_rows(self, *, owner_wallet: str | None = None) -> List[RefundIntentRow]:
        with self._db.readonly_cursor() as cur:
            base_sql = """
                SELECT
                    vw.withdrawal_id,
                    owner.owner_wallet,
                    vw.tx_hash,
                    vw.status,
                    vw.request_id,
                    vw.amount_usdc,
                    vw.ticket_id,
                    vw.ticket_hash,
                    vw.signature,
                    vw.nonce,
                    vw.deadline,
                    vw.created_at,
                    vw.updated_at,
                    rs.payload
                FROM synapse_vault_withdrawals vw
                JOIN synapse_ledger_accounts account
                  ON account.account_id = vw.source_account_id
                JOIN synapse_owner_accounts owner
                  ON owner.owner_id = account.owner_id
                LEFT JOIN synapse_runtime_state rs
                  ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
                WHERE vw.withdrawal_kind = 'consumer_refund'
            """
            params: tuple = ()
            if owner_wallet:
                base_sql += " AND LOWER(owner.owner_wallet) = %s"
                params = (owner_wallet.lower(),)
            base_sql += " ORDER BY created_at ASC"
            cur.execute(base_sql, params)
            rows = cur.fetchall()
        projected: List[RefundIntentRow] = []
        for (
            row_id,
            owner,
            tx_hash,
            status,
            request_id,
            amount_usdc,
            ticket_id,
            ticket_hash,
            signature,
            nonce,
            deadline,
            created_at,
            updated_at,
            payload,
        ) in rows:
            metadata = VaultWithdrawalMetadataState.model_validate(
                self._payload_dict(payload)
            )
            ticket = metadata.ticket
            if ticket.ticket_id is None and ticket_id is not None:
                ticket.ticket_id = str(ticket_id)
            if ticket.ticket_hash is None and ticket_hash is not None:
                ticket.ticket_hash = str(ticket_hash)
            if ticket.signature is None and signature is not None:
                ticket.signature = str(signature)
            if ticket.nonce is None and nonce is not None:
                ticket.nonce = int(nonce)
            if ticket.deadline is None and deadline is not None:
                ticket.deadline = int(deadline)
            projected.append(
                RefundIntentRow(
                    id=str(row_id),
                    ownerAddress=str(owner),
                    txHash=tx_hash,
                    status=str(status or metadata.flow_status or "pending"),
                    requestId=str(request_id or metadata.request_id or ""),
                    consumerAddress=str(metadata.consumer_address or owner or ""),
                    amountUsdc=self._q6(amount_usdc),
                    idempotencyKey=metadata.idempotency_key,
                    reason=metadata.reason,
                    signature=signature,
                    gasPayer=metadata.gas_payer,
                    gasModel=metadata.gas_model,
                    originRequestId=metadata.origin_request_id,
                    originTxHash=metadata.origin_tx_hash,
                    refundType=metadata.refund_type,
                    destinationAddress=metadata.destination_address,
                    evidenceSummary=metadata.evidence_summary,
                    riskLevel=metadata.risk_level,
                    riskReasonCode=metadata.risk_reason_code,
                    message=metadata.message,
                    requestMeta=metadata.request_meta,
                    reviewDecision=metadata.review_decision,
                    reviewerAddress=metadata.reviewer_address,
                    reviewerNote=metadata.reviewer_note,
                    reviewedAt=metadata.reviewed_at,
                    completedAt=metadata.completed_at,
                    completeMeta=metadata.complete_meta,
                    ticket=ticket,
                    createdAt=to_dt_str(created_at, "") or "",
                    updatedAt=to_dt_str(updated_at, "") or "",
                )
            )
        return projected

    def write_consumer_refund_rows(
        self, rows: List[RefundIntentRow], updated_at: str | int
    ) -> None:
        with self._db.tx_cursor() as cur:
            for row in rows:
                row_updated_at = to_dt_str(row.updated_at or updated_at, now_dt_str())
                consumer_wallet = str(
                    row.consumer_address or row.owner_address or ""
                ).lower()
                source_account_id = self._ensure_ledger_account(
                    cur,
                    consumer_wallet,
                    "consumer_wallet",
                    row_updated_at,
                )
                owner_id = self._owner_id(consumer_wallet)
                cur.execute(
                    """
                    INSERT INTO synapse_vault_withdrawals (
                        withdrawal_id, owner_id, provider_id, withdrawal_kind,
                        source_account_id, request_id, amount_usdc, status, tx_hash,
                        ticket_id, ticket_hash, signature, nonce, deadline, created_at, updated_at
                    ) VALUES (%s, %s, NULL, 'consumer_refund', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (withdrawal_id)
                    DO UPDATE SET
                        owner_id = EXCLUDED.owner_id,
                        source_account_id = EXCLUDED.source_account_id,
                        request_id = EXCLUDED.request_id,
                        amount_usdc = EXCLUDED.amount_usdc,
                        status = EXCLUDED.status,
                        tx_hash = EXCLUDED.tx_hash,
                        ticket_id = COALESCE(synapse_vault_withdrawals.ticket_id, EXCLUDED.ticket_id),
                        ticket_hash = COALESCE(synapse_vault_withdrawals.ticket_hash, EXCLUDED.ticket_hash),
                        signature = EXCLUDED.signature,
                        nonce = EXCLUDED.nonce,
                        deadline = EXCLUDED.deadline,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        row.id,
                        owner_id,
                        source_account_id,
                        row.request_id,
                        str(self._q6(row.amount_usdc)),
                        row.status,
                        row.tx_hash.lower() if row.tx_hash else None,
                        row.ticket.ticket_id,
                        row.ticket.ticket_hash,
                        row.signature or row.ticket.signature or None,
                        row.ticket.nonce,
                        row.ticket.deadline,
                        to_dt_str(row.created_at or updated_at, now_dt_str()),
                        row_updated_at,
                    ),
                )
                self._upsert_consumer_refund_metadata(
                    cur,
                    row,
                    consumer_wallet=consumer_wallet,
                    updated_at=row_updated_at,
                )
