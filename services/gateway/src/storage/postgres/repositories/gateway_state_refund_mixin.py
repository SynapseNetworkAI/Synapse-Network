"""Gateway state repository — refund row mixin."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any, Callable, List

from src.domain.gateway import OwnerSpendLimitRow
from src.domain.ledger import DepositIntentRow, WithdrawalIntentRow
from src.domain.finance import (
    RefundIntentRow,
    UsageLogRow,
)
from src.domain.runtime_state import (
    DepositMetadataState,
    InvocationBillingState,
    VaultWithdrawalMetadataState,
)
from src.domain.system import ProcessedDepositEventRow, RuntimeStateRow
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager



class GatewayStateRefundMixin:
    """Consumer refund row read/write operations."""

    def read_consumer_refund_rows(self) -> List[RefundIntentRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    vw.withdrawal_id,
                    owner.owner_wallet,
                    vw.tx_hash,
                    vw.status,
                    vw.request_id,
                    vw.amount_usdc,
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
                ORDER BY created_at ASC
                """
            )
            rows = cur.fetchall()
        projected: List[RefundIntentRow] = []
        for (
            row_id,
            owner,
            tx_hash,
            status,
            request_id,
            amount_usdc,
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
            projected.append(
                RefundIntentRow(
                    id=str(row_id),
                    ownerAddress=str(owner),
                    txHash=tx_hash,
                    status=str(metadata.flow_status or status or "pending"),
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
                        signature, nonce, deadline, created_at, updated_at
                    ) VALUES (%s, %s, NULL, 'consumer_refund', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (withdrawal_id)
                    DO UPDATE SET
                        owner_id = EXCLUDED.owner_id,
                        source_account_id = EXCLUDED.source_account_id,
                        request_id = EXCLUDED.request_id,
                        amount_usdc = EXCLUDED.amount_usdc,
                        status = EXCLUDED.status,
                        tx_hash = EXCLUDED.tx_hash,
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
                        None,
                        None,
                        None,
                        to_dt_str(row.created_at or updated_at, now_dt_str()),
                        row_updated_at,
                    ),
                )
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
                    ).model_dump(by_alias=True, mode="json"),
                    row_updated_at,
                )

