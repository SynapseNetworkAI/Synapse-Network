"""Gateway state repository — core helpers and deposit row mixin."""
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



class GatewayStateCoreMixin:
    """Static helpers, ensure-owner, deposit read/write operations."""

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

    @staticmethod
    def _latency_ms(started_at: Any, finished_at: Any, fallback: Any) -> int | None:
        if fallback is not None:
            try:
                return int(fallback)
            except Exception:
                pass
        started = GatewayStateCoreMixin._epoch_seconds(started_at)
        finished = GatewayStateCoreMixin._epoch_seconds(finished_at)
        if started <= 0 or finished <= 0 or finished < started:
            return None
        return int((finished - started) * 1000)

    def _project_usage_log_row(
        self,
        invocation_id: Any,
        agent_id: Any,
        idempotency_key: Any,
        service_id: Any,
        status: Any,
        charged_usdc: Any,
        started_at: Any,
        finished_at: Any,
        created_at: Any,
        payload: Any,
    ) -> UsageLogRow:
        metadata = InvocationBillingState.model_validate(self._payload_dict(payload))
        total_charge = self._normalized_total_charge(metadata, charged_usdc)
        latency_ms = self._latency_ms(started_at, finished_at, metadata.latency_ms)
        return UsageLogRow(
            id=str(invocation_id),
            ts=self._epoch_seconds(created_at),
            agentId=str(metadata.agent_id or agent_id or "") or None,
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
            latencyMs=latency_ms,
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
            agentId=row.agent_id,
            requestId=row.request_id,
            ownerAddress=row.consumer_address.lower() if row.consumer_address else "",
            providerAddress=row.provider_address.lower() if row.provider_address else "",
            unitPrice=self._billing_amount_or_zero(row.unit_price),
            protocolFee=self._billing_amount_or_zero(row.protocol_fee),
            routingTax=self._billing_amount_or_zero(row.routing_tax),
            totalCharge=self._billing_amount_or_zero(row.total_charge),
            latencyMs=row.latency_ms,
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

    def _normalize_deposit_intent_row(self, row: Any) -> DepositIntentRow | None:
        if isinstance(row, DepositIntentRow):
            entity = row
        elif isinstance(row, dict):
            try:
                entity = DepositIntentRow.model_validate(row)
            except Exception:
                return None
        else:
            return None

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
                        deposit_id, owner_id, owner_address, target_account_id, tx_hash,
                        amount_usdc, status, block_number, request_id, client_request_id,
                        client_ip, user_agent, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (tx_hash)
                    DO UPDATE SET
                        owner_id = EXCLUDED.owner_id,
                        owner_address = EXCLUDED.owner_address,
                        target_account_id = EXCLUDED.target_account_id,
                        request_id = EXCLUDED.request_id,
                        amount_usdc = EXCLUDED.amount_usdc,
                        status = EXCLUDED.status,
                        client_request_id = EXCLUDED.client_request_id,
                        client_ip = EXCLUDED.client_ip,
                        user_agent = EXCLUDED.user_agent,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        entity.id,
                        owner_id,
                        entity.owner_address.lower(),
                        self._ensure_ledger_account(
                            cur,
                            entity.owner_address.lower(),
                            "consumer_wallet",
                            updated_at,
                        ),
                        entity.tx_hash.lower(),
                        str(self._q6(entity.amount_usdc)),
                        entity.status,
                        entity.request_id,
                        entity.client_request_id,
                        entity.client_ip,
                        entity.user_agent,
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

