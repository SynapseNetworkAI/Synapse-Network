"""Gateway state repository — withdrawal, billing, and runtime state mixin."""
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



class GatewayStateWithdrawalMixin:
    """Withdrawal rows, spend limits, billing, events, and runtime state."""

    def read_provider_withdrawal_rows(self) -> List[WithdrawalIntentRow]:
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
                WHERE vw.withdrawal_kind = 'provider_withdrawal'
                ORDER BY created_at ASC
                """
            )
            rows = cur.fetchall()
        projected: List[WithdrawalIntentRow] = []
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
                WithdrawalIntentRow(
                    id=str(row_id),
                    ownerAddress=str(owner),
                    txHash=tx_hash,
                    status=str(metadata.flow_status or status or "pending"),
                    requestId=str(request_id or metadata.request_id or ""),
                    idempotencyKey=metadata.idempotency_key,
                    amountUsdc=self._q6(amount_usdc),
                    amountWei=metadata.amount_wei,
                    feeWei=metadata.fee_wei,
                    nonce=nonce,
                    deadline=deadline,
                    signature=signature,
                    chainId=metadata.chain_id,
                    contractAddress=metadata.contract_address,
                    signerAddress=metadata.signer_address,
                    businessType=metadata.business_type,
                    evidenceSummary=metadata.evidence_summary,
                    riskLevel=metadata.risk_level,
                    riskReasonCode=metadata.risk_reason_code,
                    message=metadata.message,
                    requestMeta=metadata.request_meta,
                    reviewDecision=metadata.review_decision,
                    reviewerAddress=metadata.reviewer_address,
                    reviewerNote=metadata.reviewer_note,
                    reviewedAt=metadata.reviewed_at,
                    ticket=metadata.ticket,
                    completedAt=metadata.completed_at,
                    completeMeta=metadata.complete_meta,
                    createdAt=to_dt_str(created_at, "") or "",
                    updatedAt=to_dt_str(updated_at, "") or "",
                )
            )
        return projected

    def write_provider_withdrawal_rows(
        self, rows: List[WithdrawalIntentRow], updated_at: str | int
    ) -> None:
        with self._db.tx_cursor() as cur:
            for row in rows:
                row_updated_at = to_dt_str(row.updated_at or updated_at, now_dt_str())
                owner_wallet = str(row.owner_address or "").lower()
                source_account_id = self._ensure_ledger_account(
                    cur,
                    owner_wallet,
                    "provider_wallet",
                    row_updated_at,
                )
                owner_id = self._owner_id(owner_wallet)
                provider_id = self._provider_id(owner_wallet)
                cur.execute(
                    """
                    INSERT INTO synapse_vault_withdrawals (
                        withdrawal_id, owner_id, provider_id, withdrawal_kind,
                        source_account_id, request_id, amount_usdc, status, tx_hash,
                        signature, nonce, deadline, created_at, updated_at
                    ) VALUES (%s, %s, %s, 'provider_withdrawal', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (withdrawal_id)
                    DO UPDATE SET
                        owner_id = EXCLUDED.owner_id,
                        provider_id = EXCLUDED.provider_id,
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
                        provider_id,
                        source_account_id,
                        row.request_id,
                        str(self._q6(row.amount_usdc)),
                        row.status,
                        row.tx_hash.lower() if row.tx_hash else None,
                        row.signature,
                        row.nonce,
                        row.deadline,
                        to_dt_str(row.created_at or updated_at, now_dt_str()),
                        row_updated_at,
                    ),
                )
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
                    row_updated_at,
                )

    def read_owner_spend_limit_rows(self) -> List[OwnerSpendLimitRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT owner_address, spending_limit_usdc, cycle_interval, created_at, updated_at
                FROM synapse_owner_spend_limits
                ORDER BY updated_at DESC
                """
            )
            rows = cur.fetchall()
        return [
            OwnerSpendLimitRow(
                ownerAddress=str(owner),
                spendingLimitUsdc=self._q6(limit) if limit is not None else None,
                cycleInterval=str(cycle_interval or "monthly"),
                createdAt=to_dt_str(created, "") or "",
                updatedAt=to_dt_str(updated, "") or "",
            )
            for owner, limit, cycle_interval, created, updated in rows
        ]

    def write_owner_spend_limit_rows(
        self, rows: List[OwnerSpendLimitRow], updated_at: str | int
    ) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_owner_spend_limits")
            for row in rows:
                owner = row.owner_address.lower()
                if not owner:
                    continue
                spending_limit = (
                    str(self._q6(row.spending_limit_usdc))
                    if row.spending_limit_usdc is not None
                    else None
                )
                cur.execute(
                    """
                    INSERT INTO synapse_owner_spend_limits (
                        owner_address, spending_limit_usdc, cycle_interval, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        owner,
                        spending_limit,
                        str(row.cycle_interval or "monthly"),
                        to_dt_str(row.created_at or updated_at, now_dt_str()),
                        to_dt_str(row.updated_at or updated_at, now_dt_str()),
                    ),
                )

    def read_invocation_billing_rows(self) -> List[UsageLogRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    inv.invocation_id,
                    inv.agent_id,
                    inv.idempotency_key,
                    inv.service_id,
                    inv.status,
                    inv.charged_usdc,
                    inv.started_at,
                    inv.finished_at,
                    inv.created_at,
                    rs.payload
                FROM synapse_invocations inv
                LEFT JOIN synapse_runtime_state rs
                  ON rs.state_key = CONCAT('invocation_billing::', inv.invocation_id)
                WHERE inv.charged_usdc IS NOT NULL
                   OR rs.state_key IS NOT NULL
                ORDER BY inv.created_at DESC
                """
            )
            rows = cur.fetchall()
        return [self._project_usage_log_row(*row) for row in rows]

    def write_invocation_billing_rows(self, rows: List[UsageLogRow]) -> None:
        with self._db.tx_cursor() as cur:
            for row in rows:
                invocation_id = str(row.id or "").strip()
                if not invocation_id:
                    continue
                self._upsert_runtime_state(
                    cur,
                    self._invocation_billing_state_key(invocation_id),
                    self._build_invocation_billing_state(row).model_dump(
                        by_alias=True, mode="json"
                    ),
                    now_dt_str(),
                )

    def read_processed_deposit_event_keys(self) -> List[str]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT dedup_key FROM synapse_processed_deposit_events ORDER BY updated_at DESC"
            )
            rows = cur.fetchall()
        return [str(row[0]) for row in rows if row and row[0] is not None]

    def write_processed_deposit_event_keys(
        self, keys: List[str], updated_at: str | int
    ) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_processed_deposit_events")
            for key in keys:
                dedup_key = str(key or "").strip()
                if not dedup_key:
                    continue
                entity = ProcessedDepositEventRow(
                    dedupKey=dedup_key,
                    updatedAt=to_dt_str(updated_at, now_dt_str()) or now_dt_str(),
                )
                cur.execute(
                    "INSERT INTO synapse_processed_deposit_events (dedup_key, updated_at) VALUES (%s, %s)",
                    (entity.dedup_key, entity.updated_at),
                )

    def read_runtime_state(self, state_key: str) -> dict[str, Any]:
        entity = self.read_runtime_state_row(state_key)
        return entity.payload if entity is not None else {}

    def read_runtime_state_row(self, state_key: str) -> RuntimeStateRow | None:
        key = str(state_key or "").strip()
        if not key:
            return None
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT state_key, payload, updated_at FROM synapse_runtime_state WHERE state_key = %s",
                (key,),
            )
            row = cur.fetchone()
        if not row:
            return None
        payload = row[1]
        return RuntimeStateRow(
            stateKey=str(row[0] or key),
            payload=dict(payload) if isinstance(payload, dict) else {},
            updatedAt=to_dt_str(row[2], "") or "",
        )

    def write_runtime_state(self, state_key: str, payload: dict[str, Any]) -> None:
        entity = RuntimeStateRow(
            stateKey=str(state_key or "").strip(),
            payload=dict(payload or {}),
            updatedAt=now_dt_str(),
        )
        self.write_runtime_state_row(entity)

    def write_runtime_state_row(self, row: RuntimeStateRow) -> None:
        if not row.state_key:
            return
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (state_key)
                DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                """,
                (row.state_key, json.dumps(row.payload, ensure_ascii=False)),
            )
