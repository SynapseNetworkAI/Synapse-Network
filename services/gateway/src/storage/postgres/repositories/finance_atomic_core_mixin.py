"""Finance atomic repository — shared core helpers and charge helpers.

Contains: account management, balance helpers, ledger entry, audit row,
runtime state, charge usage helpers, and module-level shared constants/types.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional
from uuid import uuid4

from src.domain.audit import AuditLogRow
from src.domain.execution import PreparedWithdrawTicket
from src.domain.finance import ChargeConsumerUsageCommand, UsageLogRow
from src.domain.runtime_state import InvocationBillingState

from .invocation_billing_sql import upsert_invocation_billing

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover
    psycopg = None

_INTEGRITY_ERRORS = (psycopg.IntegrityError,) if psycopg is not None else (Exception,)
_WITHDRAWAL_BLOCKED_MESSAGE = "Withdrawal blocked by risk policy."


@dataclass(frozen=True)
class VaultWithdrawalUpsertSpec:
    withdrawal_id: str
    owner_wallet: str
    amount_usdc: Decimal
    flow_status: str
    request_id: Optional[str]
    updated_at: str
    idempotency_key: Optional[str]
    provider_wallet: Optional[str] = None
    tx_hash: Optional[str] = None
    prepared_ticket: Optional[PreparedWithdrawTicket] = None
    risk_level: Optional[str] = None
    risk_reason_code: Optional[str] = None
    message: Optional[str] = None
    request_meta: Optional[dict[str, Any]] = None


@dataclass(frozen=True)
class LedgerEntrySpec:
    entry_id: str
    reference_type: str
    reference_id: str
    business_type: str
    debit_account_id: str
    credit_account_id: str
    amount_usdc: Decimal
    request_id: Optional[str]
    trace_id: Optional[str] = None
    status: str = "posted"


class FinanceAtomicCoreMixin:
    """Shared DB helpers: account setup, balance ops, ledger, audit, runtime state, charge."""

    @staticmethod
    def _owner_id(wallet: str) -> str:
        return f"owner:{str(wallet or '').lower()}"

    @staticmethod
    def _provider_id(wallet: str) -> str:
        return f"provider:{str(wallet or '').lower()}"

    @staticmethod
    def _account_identity(wallet: str, account_type: str) -> tuple[str, str]:
        normalized_wallet = str(wallet or "").lower()
        normalized_type = str(account_type or "").lower()
        if normalized_type == "consumer":
            return f"consumer_wallet::{normalized_wallet}", "consumer_wallet"
        if normalized_type == "provider":
            return f"provider_wallet::{normalized_wallet}", "provider_wallet"
        if normalized_type == "platform_promo":
            return f"platform_promo::{normalized_wallet}", "platform_promo"
        return "platform_revenue::main", "platform_revenue"

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
        self, cur: Any, wallet: str, account_type: str, updated_at: str
    ) -> str:
        account_id, account_kind = self._account_identity(wallet, account_type)
        if account_kind == "consumer_wallet":
            owner_id = self._ensure_owner_account(cur, wallet, updated_at)
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
            owner_id = self._ensure_owner_account(cur, wallet, updated_at)
            provider_id = self._ensure_provider_profile(cur, wallet, updated_at)
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

    def _upsert_balance_triplet(
        self,
        cur: Any,
        wallet: str,
        account_type: str,
        available_balance: Decimal,
        pending_balance: Decimal,
        frozen_balance: Decimal,
        updated_at: str,
    ) -> None:
        account_id = self._ensure_ledger_account(cur, wallet, account_type, updated_at)
        cur.execute(
            self._balance_upsert_sql,  # type: ignore[attr-defined]
            (
                account_id,
                str(self._q6(available_balance)),  # type: ignore[attr-defined]
                str(self._q6(pending_balance)),  # type: ignore[attr-defined]
                str(self._q6(frozen_balance)),  # type: ignore[attr-defined]
                updated_at,
            ),
        )

    @staticmethod
    def _event_id(prefix: str) -> str:
        return f"{prefix}-{uuid4().hex}"

    @staticmethod
    def _audit_detail_json(row: AuditLogRow) -> dict[str, Any]:
        payload = {
            "domain": "finance",
            "riskLevel": row.risk_level,
            "actor": row.actor,
            "requestId": row.request_id,
            "traceId": row.trace_id,
            "txHash": row.tx_hash,
            "counterpartyAddress": row.counterparty_address,
            "direction": row.direction,
            "status": row.status,
            "riskReasonCode": row.risk_reason_code,
            "ledgerId": row.ledger_id,
            "clientIp": row.client_ip,
            "userAgent": row.user_agent,
            "beforeBalance": str(row.before_balance) if row.before_balance is not None else None,
            "afterBalance": str(row.after_balance) if row.after_balance is not None else None,
            "message": row.message,
            "ownerAddress": row.owner_address,
        }
        extra = row.detail_json if isinstance(row.detail_json, dict) else {}
        payload.update(extra)
        return payload

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
    def _vault_status_from_flow_status(flow_status: str, has_signature: bool = False) -> str:
        normalized = str(flow_status or "").strip().upper()
        if normalized in {"REJECTED", "FAILED"}:
            return "FAILED"
        if has_signature or normalized in {"SIGNED", "APPROVED_AUTO", "BROADCASTED", "CONFIRMED"}:
            return "SIGNED"
        return "REQUESTED"

    def _append_ledger_entry(
        self,
        cur: Any,
        spec: LedgerEntrySpec | None = None,
        **legacy_fields: Any,
    ) -> None:
        if spec is None:
            spec = LedgerEntrySpec(**legacy_fields)
        if self._q6(spec.amount_usdc) <= Decimal("0"):  # type: ignore[attr-defined]  # reason: composed repository injects quantizer
            return
        cur.execute(
            """
            INSERT INTO synapse_ledger_entries (
                entry_id, reference_type, reference_id, business_type,
                debit_account_id, credit_account_id, amount_usdc,
                status, request_id, trace_id
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (entry_id)
            DO UPDATE SET
                amount_usdc = EXCLUDED.amount_usdc,
                status = EXCLUDED.status,
                request_id = EXCLUDED.request_id,
                trace_id = EXCLUDED.trace_id
            """,
            (
                spec.entry_id,
                spec.reference_type,
                spec.reference_id,
                spec.business_type,
                spec.debit_account_id,
                spec.credit_account_id,
                str(self._q6(spec.amount_usdc)),  # type: ignore[attr-defined]  # reason: composed repository injects quantizer
                spec.status,
                spec.request_id,
                spec.trace_id,
            ),
        )

    def _load_available_balance(
        self, cur: Any, wallet: str, account_type: str, now: int
    ) -> Decimal:
        hit = self._load_locked_balance_triplet(cur, wallet, account_type, now)  # type: ignore[attr-defined]
        return self._q6(hit[0])  # type: ignore[attr-defined]

    def _set_available_balance(
        self,
        cur: Any,
        wallet: str,
        account_type: str,
        available_value: Decimal,
        now: int,
        now_text: str,
    ) -> None:
        _, current_pending, current_frozen = self._load_locked_balance_triplet(  # type: ignore[attr-defined]
            cur, wallet, account_type, now
        )
        self._upsert_balance_triplet(
            cur,
            wallet,
            account_type,
            self._q6(available_value),  # type: ignore[attr-defined]
            self._q6(current_pending),  # type: ignore[attr-defined]
            self._q6(current_frozen),  # type: ignore[attr-defined]
            now_text,
        )

    def _ensure_platform_promo_account(
        self, cur: Any, campaign_id: str, updated_at: str
    ) -> str:
        normalized_campaign = str(campaign_id or "").strip().lower()
        account_id = f"platform_promo::{normalized_campaign}"
        cur.execute(
            """
            INSERT INTO synapse_ledger_accounts (
                account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
            ) VALUES (%s, 'platform_promo', NULL, NULL, 'USDC', 'active', %s, %s)
            ON CONFLICT (account_id)
            DO UPDATE SET updated_at = EXCLUDED.updated_at
            """,
            (account_id, updated_at, updated_at),
        )
        return account_id

    def _append_finance_audit_row(self, cur: Any, row: AuditLogRow) -> None:
        cur.execute(
            """
            INSERT INTO synapse_audit_events (
                event_id, event_type, business_type, owner_id,
                amount_delta, result_status, error_code, detail_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                self._event_id("audit"),
                row.action_type,
                row.business_type,
                self._owner_id(row.owner_address),
                str(row.amount_delta) if row.amount_delta is not None else None,
                row.result_status,
                row.error_code,
                json.dumps(self._audit_detail_json(row)),
            ),
        )

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

    def _assert_charge_not_restricted(
        self, cur: Any, owner: str, provider: str, now: int
    ) -> None:
        if self._is_account_restricted_for_charge(cur, owner, "consumer", now):  # type: ignore[attr-defined]
            raise RuntimeError("CONSUMER_RESTRICTED_RISK_BLOCK")
        if self._is_account_restricted_for_charge(cur, provider, "provider", now):  # type: ignore[attr-defined]
            raise RuntimeError("PROVIDER_RESTRICTED_RISK_BLOCK")

    def _build_charge_usage_row(
        self,
        command: ChargeConsumerUsageCommand,
        invocation_id: str,
        owner: str,
        provider: str,
        now: int,
    ) -> UsageLogRow:
        return UsageLogRow(
            id=invocation_id,
            ts=int(command.usage_row.ts or now),
            requestId=command.request_id or command.usage_row.request_id,
            serviceId=(
                command.invocation.service_id
                if command.invocation is not None
                else command.usage_row.service_id
            ),
            consumerAddress=(command.usage_row.consumer_address or owner),
            providerAddress=(command.usage_row.provider_address or provider),
            status=command.usage_row.status or "accepted",
            unitPrice=self._q6(command.unit_price or command.usage_row.unit_price or 0),  # type: ignore[attr-defined]
            protocolFee=self._q6(command.protocol_fee or command.usage_row.protocol_fee or 0),  # type: ignore[attr-defined]
            routingTax=self._q6(command.routing_tax or command.usage_row.routing_tax or 0),  # type: ignore[attr-defined]
            totalCharge=self._q6(command.total_charge),  # type: ignore[attr-defined]
            businessType=command.usage_row.business_type,
            riskLevel=command.usage_row.risk_level,
            originRequestId=command.usage_row.origin_request_id,
            originTxHash=command.usage_row.origin_tx_hash,
        )

    def _record_charge_facts(
        self,
        cur: Any,
        command: ChargeConsumerUsageCommand,
        row: UsageLogRow,
        owner: str,
        provider: str,
        now_text: str,
    ) -> None:
        consumer_account_id = self._account_identity(owner, "consumer")[0]
        provider_account_id = self._account_identity(provider, "provider")[0]
        platform_account_id = self._account_identity("__platform__", "platform_fee")[0]
        if command.invocation is not None:
            cur.execute(
                """
                UPDATE synapse_invocations
                SET charged_usdc = %s, updated_at = %s
                WHERE invocation_id = %s
                """,
                (
                    str(self._q6(command.total_charge)),  # type: ignore[attr-defined]
                    now_text,
                    command.invocation.invocation_id,
                ),
            )
        billing_state = InvocationBillingState(
            ownerAddress=row.consumer_address or owner,
            providerAddress=row.provider_address or provider,
            agentId=(command.invocation.agent_id if command.invocation is not None else row.agent_id),
            requestId=row.request_id,
            originRequestId=row.origin_request_id,
            originTxHash=row.origin_tx_hash,
            unitPrice=row.unit_price or Decimal("0"),
            protocolFee=row.protocol_fee or Decimal("0"),
            routingTax=row.routing_tax or Decimal("0"),
            totalCharge=row.total_charge or Decimal("0"),
            latencyMs=row.latency_ms,
            businessType=row.business_type,
            riskLevel=row.risk_level,
        )
        upsert_invocation_billing(
            cur,
            self._q6,
            row.id,
            billing_state,
            now_text,
        )
        self._upsert_runtime_state(
            cur,
            self._invocation_billing_state_key(row.id),
            billing_state.model_dump(by_alias=True, mode="json"),
            now_text,
        )
        self._append_ledger_entry(
            cur,
            LedgerEntrySpec(
                entry_id=f"ledger-charge-provider::{row.id}",
                reference_type="invocation",
                reference_id=row.id,
                business_type="charge",
                debit_account_id=consumer_account_id,
                credit_account_id=provider_account_id,
                amount_usdc=self._q6(command.provider_net),  # type: ignore[attr-defined]  # reason: composed repository injects quantizer
                request_id=row.request_id,
            ),
        )
        self._append_ledger_entry(
            cur,
            LedgerEntrySpec(
                entry_id=f"ledger-charge-platform::{row.id}",
                reference_type="invocation",
                reference_id=row.id,
                business_type="charge",
                debit_account_id=consumer_account_id,
                credit_account_id=platform_account_id,
                amount_usdc=self._q6(command.platform_fee_total),  # type: ignore[attr-defined]  # reason: composed repository injects quantizer
                request_id=row.request_id,
            ),
        )
