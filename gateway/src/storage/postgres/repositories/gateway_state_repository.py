from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any, Callable, List

from src.domain.gateway import RouterConfigRow
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


class GatewayStateRepository:
    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6

    @staticmethod
    def _owner_id(wallet: str) -> str:
        return f"owner:{str(wallet or '').lower()}"

    @staticmethod
    def _deposit_state_key(deposit_id: str) -> str:
        return f"vault_deposit_meta::{deposit_id}"

    @staticmethod
    def _invocation_billing_state_key(invocation_id: str) -> str:
        return f"invocation_billing::{invocation_id}"

    @staticmethod
    def _vault_withdrawal_state_key(withdrawal_id: str) -> str:
        return f"vault_withdrawal_meta::{withdrawal_id}"

    @staticmethod
    def _provider_id(wallet: str) -> str:
        return f"provider:{str(wallet or '').lower()}"

    @staticmethod
    def _payload_dict(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    def _upsert_runtime_state(
        self, cur: Any, state_key: str, payload: dict[str, Any], updated_at: str
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
            VALUES (%s, %s::jsonb, %s)
            ON CONFLICT (state_key)
            DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
            """,
            (state_key, json.dumps(payload), updated_at),
        )

    def _read_runtime_state_payload(self, state_key: str) -> dict[str, Any]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT payload FROM synapse_runtime_state WHERE state_key = %s",
                (state_key,),
            )
            row = cur.fetchone()
        return self._payload_dict(row[0]) if row is not None else {}

    @staticmethod
    def _epoch_seconds(value: Any) -> int:
        normalized = to_dt_str(value, "") or ""
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
    def _normalized_total_charge(
        metadata: InvocationBillingState, charged_usdc: Any
    ) -> Any:
        if metadata.total_charge is not None:
            return metadata.total_charge
        return charged_usdc

    def _project_usage_log_row(
        self,
        invocation_id: Any,
        idempotency_key: Any,
        service_id: Any,
        status: Any,
        charged_usdc: Any,
        created_at: Any,
        payload: Any,
    ) -> UsageLogRow:
        metadata = InvocationBillingState.model_validate(self._payload_dict(payload))
        total_charge = self._normalized_total_charge(metadata, charged_usdc)
        return UsageLogRow(
            id=str(invocation_id),
            ts=self._epoch_seconds(created_at),
            requestId=str(metadata.request_id or idempotency_key or ""),
            serviceId=service_id,
            consumerAddress=metadata.owner_address,
            providerAddress=metadata.provider_address,
            status=str(status or "pending").lower(),
            unitPrice=self._q6(metadata.unit_price)
            if metadata.unit_price is not None
            else None,
            protocolFee=self._q6(metadata.protocol_fee)
            if metadata.protocol_fee is not None
            else None,
            routingTax=self._q6(metadata.routing_tax)
            if metadata.routing_tax is not None
            else None,
            totalCharge=self._q6(total_charge) if total_charge is not None else None,
            businessType=str(metadata.business_type or "charge"),
            riskLevel=str(metadata.risk_level or "green"),
            originRequestId=metadata.origin_request_id,
            originTxHash=metadata.origin_tx_hash,
        )

    @staticmethod
    def _billing_amount_or_zero(value: Any) -> Any:
        return value if value is not None else 0

    def _build_invocation_billing_state(
        self, row: UsageLogRow
    ) -> InvocationBillingState:
        return InvocationBillingState(
            requestId=row.request_id,
            ownerAddress=row.consumer_address.lower() if row.consumer_address else "",
            providerAddress=row.provider_address.lower() if row.provider_address else "",
            unitPrice=self._billing_amount_or_zero(row.unit_price),
            protocolFee=self._billing_amount_or_zero(row.protocol_fee),
            routingTax=self._billing_amount_or_zero(row.routing_tax),
            totalCharge=self._billing_amount_or_zero(row.total_charge),
            businessType=row.business_type,
            riskLevel=row.risk_level,
            originRequestId=row.origin_request_id,
            originTxHash=row.origin_tx_hash,
        )

    def _ensure_owner_account(self, cur: Any, wallet: str, updated_at: str) -> str:
        normalized_wallet = str(wallet or "").lower()
        owner_id = self._owner_id(normalized_wallet)
        cur.execute(
            """
            INSERT INTO synapse_owner_accounts (
                owner_id, owner_wallet, status, default_currency, created_at, updated_at
            ) VALUES (%s, %s, 'active', 'USDC', %s, %s)
            ON CONFLICT (owner_id)
            DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, updated_at = EXCLUDED.updated_at
            """,
            (owner_id, normalized_wallet, updated_at, updated_at),
        )
        return owner_id

    def _ensure_provider_profile(self, cur: Any, wallet: str, updated_at: str) -> str:
        normalized_wallet = str(wallet or "").lower()
        owner_id = self._ensure_owner_account(cur, normalized_wallet, updated_at)
        provider_id = self._provider_id(normalized_wallet)
        cur.execute(
            """
            INSERT INTO synapse_provider_profiles (
                provider_id, owner_id, display_name, status, created_at, updated_at
            ) VALUES (%s, %s, %s, 'active', %s, %s)
            ON CONFLICT (provider_id)
            DO UPDATE SET owner_id = EXCLUDED.owner_id, updated_at = EXCLUDED.updated_at
            """,
            (provider_id, owner_id, normalized_wallet, updated_at, updated_at),
        )
        return provider_id

    def _ensure_ledger_account(
        self, cur: Any, wallet: str, account_kind: str, updated_at: str
    ) -> str:
        normalized_wallet = str(wallet or "").lower()
        if account_kind == "consumer_wallet":
            owner_id = self._ensure_owner_account(cur, normalized_wallet, updated_at)
            account_id = f"consumer_wallet::{normalized_wallet}"
            cur.execute(
                """
                INSERT INTO synapse_ledger_accounts (
                    account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
                ) VALUES (%s, %s, %s, NULL, 'USDC', 'active', %s, %s)
                ON CONFLICT (account_id)
                DO UPDATE SET owner_id = EXCLUDED.owner_id, updated_at = EXCLUDED.updated_at
                """,
                (account_id, account_kind, owner_id, updated_at, updated_at),
            )
            return account_id
        if account_kind == "provider_wallet":
            owner_id = self._ensure_owner_account(cur, normalized_wallet, updated_at)
            provider_id = self._ensure_provider_profile(cur, normalized_wallet, updated_at)
            account_id = f"provider_wallet::{normalized_wallet}"
            cur.execute(
                """
                INSERT INTO synapse_ledger_accounts (
                    account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, 'USDC', 'active', %s, %s)
                ON CONFLICT (account_id)
                DO UPDATE SET owner_id = EXCLUDED.owner_id, provider_id = EXCLUDED.provider_id, updated_at = EXCLUDED.updated_at
                """,
                (account_id, account_kind, owner_id, provider_id, updated_at, updated_at),
            )
            return account_id
        account_id = "platform_revenue::main"
        cur.execute(
            """
            INSERT INTO synapse_ledger_accounts (
                account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
            ) VALUES (%s, %s, NULL, NULL, 'USDC', 'active', %s, %s)
            ON CONFLICT (account_id)
            DO UPDATE SET updated_at = EXCLUDED.updated_at
            """,
            (account_id, account_kind, updated_at, updated_at),
        )
        return account_id

    def read_deposit_intents(self) -> List[DepositIntentRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    vd.deposit_id,
                    oa.owner_wallet,
                    vd.tx_hash,
                    vd.request_id,
                    rs.payload,
                    vd.amount_usdc,
                    vd.status,
                    vd.created_at,
                    vd.updated_at
                FROM synapse_vault_deposits AS vd
                INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = vd.owner_id
                LEFT JOIN synapse_runtime_state AS rs
                    ON rs.state_key = CONCAT('vault_deposit_meta::', vd.deposit_id)
                ORDER BY created_at ASC
                """
            )
            rows = cur.fetchall()
        return [
            DepositIntentRow(
                id=str(row_id),
                ownerAddress=str(owner),
                txHash=str(tx_hash),
                requestId=request_id,
                consumerAddress=DepositMetadataState.model_validate(
                    self._payload_dict(meta_payload)
                ).consumer_address,
                amountUsdc=self._q6(amount_usdc),
                idempotencyKey=DepositMetadataState.model_validate(
                    self._payload_dict(meta_payload)
                ).idempotency_key,
                status=str(status),
                createdAt=to_dt_str(created_at, "") or "",
                updatedAt=to_dt_str(updated_at, "") or "",
            )
            for row_id, owner, tx_hash, request_id, meta_payload, amount_usdc, status, created_at, updated_at in rows
        ]

    def _normalize_deposit_intent_row(self, row: DepositIntentRow) -> DepositIntentRow | None:
        entity = row

        row_id = str(entity.id or "").strip()
        owner = str(entity.owner_address or "").strip().lower()
        tx_hash = str(entity.tx_hash or "").strip().lower()
        if not row_id or not owner:
            return None
        if not (tx_hash.startswith("0x") and len(tx_hash) == 66):
            return None
        return entity

    def write_deposit_intents(
        self, rows: List[DepositIntentRow]
    ) -> None:
        with self._db.tx_cursor() as cur:
            for row in rows:
                entity = self._normalize_deposit_intent_row(row)
                if entity is None:
                    continue
                updated_at = to_dt_str(entity.updated_at, now_dt_str())
                owner_id = self._ensure_owner_account(
                    cur,
                    entity.owner_address.lower(),
                    updated_at,
                )
                cur.execute(
                    """
                    INSERT INTO synapse_vault_deposits (
                        deposit_id, owner_id, tx_hash, amount_usdc, status,
                        block_number, request_id, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, NULL, %s, %s, %s)
                    ON CONFLICT (tx_hash)
                    DO UPDATE SET
                        owner_id = EXCLUDED.owner_id,
                        request_id = EXCLUDED.request_id,
                        amount_usdc = EXCLUDED.amount_usdc,
                        status = EXCLUDED.status,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        entity.id,
                        owner_id,
                        entity.tx_hash.lower(),
                        entity.request_id,
                        str(self._q6(entity.amount_usdc)),
                        entity.status,
                        to_dt_str(entity.created_at, now_dt_str()),
                        updated_at,
                    ),
                )
                self._upsert_runtime_state(
                    cur,
                    self._deposit_state_key(entity.id),
                    DepositMetadataState(
                        consumerAddress=entity.consumer_address.lower()
                        if entity.consumer_address
                        else None,
                        idempotencyKey=entity.idempotency_key,
                    ).model_dump(by_alias=True, mode="json"),
                    updated_at,
                )

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
                JOIN synapse_owners owner
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
                cur.execute(
                    """
                    INSERT INTO synapse_vault_withdrawals (
                        withdrawal_id, withdrawal_kind, source_account_id, request_id,
                        amount_usdc, status, tx_hash, signature, nonce, deadline,
                        created_at, updated_at
                    ) VALUES (%s, 'consumer_refund', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (withdrawal_id)
                    DO UPDATE SET
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
                JOIN synapse_owners owner
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
                cur.execute(
                    """
                    INSERT INTO synapse_vault_withdrawals (
                        withdrawal_id, withdrawal_kind, source_account_id, request_id,
                        amount_usdc, status, tx_hash, signature, nonce, deadline,
                        created_at, updated_at
                    ) VALUES (%s, 'provider_withdrawal', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (withdrawal_id)
                    DO UPDATE SET
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

    def read_router_config_rows(self) -> List[RouterConfigRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT owner_address, daily_limit_usdc, created_at, updated_at FROM synapse_router_config ORDER BY updated_at DESC"
            )
            rows = cur.fetchall()
        return [
            RouterConfigRow(
                ownerAddress=str(owner),
                dailyLimitUsdc=float(self._q6(limit)),
                createdAt=to_dt_str(created, "") or "",
                updatedAt=to_dt_str(updated, "") or "",
            )
            for owner, limit, created, updated in rows
        ]

    def write_router_config_rows(
        self, rows: List[RouterConfigRow], updated_at: str | int
    ) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_router_config")
            for row in rows:
                owner = row.owner_address.lower()
                if not owner:
                    continue
                cur.execute(
                    "INSERT INTO synapse_router_config (owner_address, daily_limit_usdc, created_at, updated_at) VALUES (%s, %s, %s, %s)",
                    (
                        owner,
                        str(self._q6(row.daily_limit_usdc)),
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
                    inv.idempotency_key,
                    inv.service_id,
                    inv.status,
                    inv.charged_usdc,
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
