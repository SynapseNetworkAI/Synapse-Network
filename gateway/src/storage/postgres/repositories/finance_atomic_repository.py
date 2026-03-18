from __future__ import annotations

from dataclasses import dataclass
import json
import time
from decimal import Decimal
from typing import Any, Callable, Optional
from uuid import uuid4

from src.domain.audit import AuditLogRow
from src.domain.execution import (
    CompleteWithdrawTxCommand,
    DepositIntentConfirmCommand,
    DepositIntentRegisterCommand,
    PreparedWithdrawTicket,
    ReserveProviderWithdrawCommand,
    WithdrawalAtomicRequestCommand,
    WithdrawalDecision,
)
from src.domain.finance import (
    BalanceMutationResult,
    ChargeConsumerUsageCommand,
    ConsumerChargeResult,
    UsageLogRow,
)
from src.domain.ledger import DepositIntentRow
from src.domain.runtime_state import (
    DepositMetadataState,
    InvocationBillingState,
    VaultWithdrawalMetadataState,
)
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager

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


class FinanceAtomicRepository:
    def __init__(
        self,
        db: DatabaseManager,
        quantize6: Callable[[Any], Decimal],
        balance_upsert_sql: str,
        balance_for_update_sql: str,
        audit_insert_sql: str,
        restricted_session_statuses: tuple[str, ...],
    ):
        self._db = db
        self._q6 = quantize6
        self._balance_upsert_sql = balance_upsert_sql
        self._balance_for_update_sql = balance_for_update_sql
        _ = audit_insert_sql
        self._restricted_session_statuses = restricted_session_statuses

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
            self._balance_upsert_sql,
            (
                account_id,
                str(self._q6(available_balance)),
                str(self._q6(pending_balance)),
                str(self._q6(frozen_balance)),
                updated_at,
            ),
        )

    @staticmethod
    def _event_id(prefix: str) -> str:
        return f"{prefix}-{uuid4().hex}"

    @staticmethod
    def _audit_detail_json(row: AuditLogRow) -> dict[str, Any]:
        return {
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
        *,
        entry_id: str,
        reference_type: str,
        reference_id: str,
        business_type: str,
        debit_account_id: str,
        credit_account_id: str,
        amount_usdc: Decimal,
        request_id: Optional[str],
        trace_id: Optional[str] = None,
        status: str = "posted",
    ) -> None:
        if self._q6(amount_usdc) <= Decimal("0"):
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
                entry_id,
                reference_type,
                reference_id,
                business_type,
                debit_account_id,
                credit_account_id,
                str(self._q6(amount_usdc)),
                status,
                request_id,
                trace_id,
            ),
        )

    def _build_vault_withdrawal_metadata(
        self, spec: VaultWithdrawalUpsertSpec, provider_address: Optional[str]
    ) -> VaultWithdrawalMetadataState:
        prepared_ticket = spec.prepared_ticket
        return VaultWithdrawalMetadataState(
            flowStatus=spec.flow_status,
            businessType="withdraw" if spec.provider_wallet else "refund",
            requestId=spec.request_id,
            idempotencyKey=spec.idempotency_key,
            consumerAddress=None if spec.provider_wallet else spec.owner_wallet,
            providerAddress=provider_address,
            amountWei=str(prepared_ticket.amount_wei) if prepared_ticket else None,
            feeWei=str(prepared_ticket.fee_wei) if prepared_ticket else None,
            chainId=prepared_ticket.chain_id if prepared_ticket else None,
            contractAddress=(prepared_ticket.ticket or {}).get("contractAddress")
            if prepared_ticket
            else None,
            signerAddress=prepared_ticket.signer_address if prepared_ticket else None,
            riskLevel=spec.risk_level,
            riskReasonCode=spec.risk_reason_code,
            message=spec.message,
            requestMeta=spec.request_meta or {},
            ticket=(prepared_ticket.ticket if prepared_ticket else {}),
        )

    def _upsert_vault_withdrawal(self, cur: Any, spec: VaultWithdrawalUpsertSpec) -> None:
        owner_id = self._ensure_owner_account(cur, spec.owner_wallet, spec.updated_at)
        provider_id = None
        source_account_id = self._ensure_ledger_account(
            cur,
            spec.owner_wallet,
            "provider" if spec.provider_wallet else "consumer",
            spec.updated_at,
        )
        withdrawal_kind = (
            "provider_withdrawal" if spec.provider_wallet else "consumer_refund"
        )
        provider_address = (
            str(spec.provider_wallet or "").lower() if spec.provider_wallet else None
        )
        if provider_address:
            provider_id = self._ensure_provider_profile(
                cur, provider_address, spec.updated_at
            )
        prepared_ticket = spec.prepared_ticket
        has_signature = isinstance(prepared_ticket, PreparedWithdrawTicket) and bool(
            prepared_ticket.signature
        )
        cur.execute(
            """
            INSERT INTO synapse_vault_withdrawals (
                withdrawal_id, owner_id, provider_id, source_account_id, withdrawal_kind,
                tx_hash, amount_usdc, status, request_id, signature, nonce, deadline,
                created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s::synapse_withdrawal_kind, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (withdrawal_id)
            DO UPDATE SET
                owner_id = EXCLUDED.owner_id,
                provider_id = EXCLUDED.provider_id,
                source_account_id = EXCLUDED.source_account_id,
                tx_hash = EXCLUDED.tx_hash,
                amount_usdc = EXCLUDED.amount_usdc,
                status = EXCLUDED.status,
                request_id = EXCLUDED.request_id,
                signature = EXCLUDED.signature,
                nonce = EXCLUDED.nonce,
                deadline = EXCLUDED.deadline,
                updated_at = EXCLUDED.updated_at
            """,
            (
                spec.withdrawal_id,
                owner_id,
                provider_id,
                source_account_id,
                withdrawal_kind,
                spec.tx_hash,
                str(self._q6(spec.amount_usdc)),
                self._vault_status_from_flow_status(spec.flow_status, has_signature),
                spec.request_id,
                prepared_ticket.signature if prepared_ticket else None,
                prepared_ticket.nonce if prepared_ticket else None,
                prepared_ticket.deadline if prepared_ticket else None,
                spec.updated_at,
                spec.updated_at,
            ),
        )
        self._upsert_runtime_state(
            cur,
            self._vault_withdrawal_state_key(spec.withdrawal_id),
            self._build_vault_withdrawal_metadata(
                spec, provider_address
            ).model_dump(by_alias=True, mode="json"),
            spec.updated_at,
        )

    def _load_available_balance(
        self, cur: Any, wallet: str, account_type: str, now: int
    ) -> Decimal:
        hit = self._load_locked_balance_triplet(cur, wallet, account_type, now)
        return self._q6(hit[0])

    def _set_available_balance(
        self,
        cur: Any,
        wallet: str,
        account_type: str,
        available_value: Decimal,
        now: int,
        now_text: str,
    ) -> None:
        _, current_pending, current_frozen = self._load_locked_balance_triplet(
            cur, wallet, account_type, now
        )
        self._upsert_balance_triplet(
            cur,
            wallet,
            account_type,
            self._q6(available_value),
            self._q6(current_pending),
            self._q6(current_frozen),
            now_text,
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
                    str(self._q6(command.total_charge)),
                    now_text,
                    command.invocation.invocation_id,
                ),
            )
        self._upsert_runtime_state(
            cur,
            self._invocation_billing_state_key(row.id),
            InvocationBillingState(
                ownerAddress=row.consumer_address or owner,
                providerAddress=row.provider_address or provider,
                requestId=row.request_id,
                originRequestId=row.origin_request_id,
                originTxHash=row.origin_tx_hash,
                unitPrice=row.unit_price or Decimal("0"),
                protocolFee=row.protocol_fee or Decimal("0"),
                routingTax=row.routing_tax or Decimal("0"),
                totalCharge=row.total_charge or Decimal("0"),
                businessType=row.business_type,
                riskLevel=row.risk_level,
            ).model_dump(by_alias=True, mode="json"),
            now_text,
        )
        self._append_ledger_entry(
            cur,
            entry_id=f"ledger-charge-provider::{row.id}",
            reference_type="invocation",
            reference_id=row.id,
            business_type="charge",
            debit_account_id=consumer_account_id,
            credit_account_id=provider_account_id,
            amount_usdc=self._q6(command.provider_net),
            request_id=row.request_id,
        )
        self._append_ledger_entry(
            cur,
            entry_id=f"ledger-charge-platform::{row.id}",
            reference_type="invocation",
            reference_id=row.id,
            business_type="charge",
            debit_account_id=consumer_account_id,
            credit_account_id=platform_account_id,
            amount_usdc=self._q6(command.platform_fee_total),
            request_id=row.request_id,
        )

    def _assert_charge_not_restricted(
        self, cur: Any, owner: str, provider: str, now: int
    ) -> None:
        if self._is_account_restricted_for_charge(cur, owner, "consumer", now):
            raise RuntimeError("CONSUMER_RESTRICTED_RISK_BLOCK")
        if self._is_account_restricted_for_charge(cur, provider, "provider", now):
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
            unitPrice=self._q6(command.unit_price or command.usage_row.unit_price or 0),
            protocolFee=self._q6(command.protocol_fee or command.usage_row.protocol_fee or 0),
            routingTax=self._q6(command.routing_tax or command.usage_row.routing_tax or 0),
            totalCharge=self._q6(command.total_charge),
            businessType=command.usage_row.business_type,
            riskLevel=command.usage_row.risk_level,
            originRequestId=command.usage_row.origin_request_id,
            originTxHash=command.usage_row.origin_tx_hash,
        )

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

    def _load_deposit_runtime_meta(
        self, cur: Any, deposit_id: str
    ) -> DepositMetadataState:
        cur.execute(
            "SELECT payload FROM synapse_runtime_state WHERE state_key = %s",
            (self._deposit_state_key(deposit_id),),
        )
        row = cur.fetchone()
        payload = self._payload_dict(row[0]) if row is not None else {}
        return DepositMetadataState.model_validate(payload)

    def _build_deposit_intent_row(
        self,
        owner: str,
        tx: str,
        request_id: str,
        intent_row: DepositIntentRow,
        amount_usdc: Decimal,
        now: int,
        now_text: str,
    ) -> DepositIntentRow:
        row_id = str(intent_row.id or "").strip() or f"dep-{now}-{tx[-8:]}"
        return DepositIntentRow(
            id=row_id,
            ownerAddress=owner,
            txHash=tx,
            requestId=request_id or intent_row.request_id,
            consumerAddress=intent_row.consumer_address,
            amountUsdc=amount_usdc,
            idempotencyKey=intent_row.idempotency_key,
            status=intent_row.status or "PENDING_CONFIRMATION",
            createdAt=to_dt_str(intent_row.created_at or now_text, now_text)
            or now_text,
            updatedAt=now_text,
        )

    def _read_existing_deposit_intent_by_tx(
        self, tx: str, owner: str, now_text: str
    ) -> DepositIntentRow | None:
        with self._db.readonly_cursor() as lookup_cur:
            lookup_cur.execute(
                """
                SELECT vd.deposit_id, oa.owner_wallet, vd.tx_hash, vd.request_id,
                       vd.amount_usdc, vd.status, vd.created_at, vd.updated_at
                FROM synapse_vault_deposits AS vd
                INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = vd.owner_id
                WHERE vd.tx_hash = %s AND oa.owner_wallet = %s
                """,
                (tx, owner),
            )
            hit = lookup_cur.fetchone()
            if hit is None:
                return None
            lookup_cur.execute(
                "SELECT payload FROM synapse_runtime_state WHERE state_key = %s",
                (self._deposit_state_key(str(hit[0])),),
            )
            meta_hit = lookup_cur.fetchone()
        meta = DepositMetadataState.model_validate(
            self._payload_dict(meta_hit[0]) if meta_hit is not None else {}
        )
        return DepositIntentRow(
            id=str(hit[0]),
            ownerAddress=str(hit[1]),
            txHash=str(hit[2]),
            requestId=hit[3],
            consumerAddress=meta.consumer_address,
            amountUsdc=self._q6(hit[4]),
            idempotencyKey=meta.idempotency_key,
            status=str(hit[5]),
            createdAt=to_dt_str(hit[6], now_text) or now_text,
            updatedAt=to_dt_str(hit[7], now_text) or now_text,
        )

    def _persist_deposit_intent(
        self, cur: Any, owner: str, row: DepositIntentRow, now_text: str
    ) -> None:
        owner_id = self._ensure_owner_account(cur, owner, now_text)
        cur.execute(
            """
            INSERT INTO synapse_vault_deposits (
                deposit_id, owner_id, tx_hash, amount_usdc, status,
                block_number, request_id, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, NULL, %s, %s, %s)
            ON CONFLICT (deposit_id)
            DO UPDATE SET
                owner_id = EXCLUDED.owner_id,
                tx_hash = EXCLUDED.tx_hash,
                amount_usdc = EXCLUDED.amount_usdc,
                status = EXCLUDED.status,
                request_id = EXCLUDED.request_id,
                updated_at = EXCLUDED.updated_at
            """,
            (
                row.id,
                owner_id,
                row.tx_hash,
                str(row.amount_usdc),
                row.status,
                row.request_id,
                row.created_at,
                row.updated_at,
            ),
        )
        self._upsert_runtime_state(
            cur,
            self._deposit_state_key(row.id),
                DepositMetadataState(
                    consumerAddress=row.consumer_address,
                    idempotencyKey=row.idempotency_key,
                ).model_dump(by_alias=True, mode="json"),
            row.updated_at,
        )

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
                row.owner_address,
                str(row.amount_delta) if row.amount_delta is not None else None,
                row.result_status,
                row.error_code,
                json.dumps(self._audit_detail_json(row)),
            ),
        )

    def _load_locked_balance_triplet(
        self, cur: Any, owner: str, account_type: str, now: int
    ) -> tuple[Decimal, Decimal, Decimal]:
        now_text = to_dt_str(now, now_dt_str())
        account_id = self._ensure_ledger_account(cur, owner, account_type, now_text)
        cur.execute(self._balance_for_update_sql, (account_id,))
        hit = cur.fetchone()
        if hit is None:
            self._upsert_balance_triplet(
                cur,
                owner,
                account_type,
                Decimal("0"),
                Decimal("0"),
                Decimal("0"),
                now_text,
            )
            return Decimal("0"), Decimal("0"), Decimal("0")
        return self._q6(hit[0]), self._q6(hit[1]), self._q6(hit[2])

    def _compute_withdrawal_risk_metrics(
        self, cur: Any, owner: str, now: int, window_seconds: int
    ) -> tuple[Decimal, Decimal, bool]:
        window_start = now - max(1, int(window_seconds))
        cur.execute(
            """
            SELECT COALESCE(SUM(amount_usdc), 0)
                        FROM synapse_vault_withdrawals
                        WHERE owner_id = %s
                            AND withdrawal_kind = 'provider_withdrawal'
              AND created_at >= %s
                            AND status <> 'FAILED'
            """,
                        (self._owner_id(owner), to_dt_str(window_start, now_dt_str())),
        )
        rolling_24h = self._q6((cur.fetchone() or [0])[0])

        cur.execute(
            """
                        SELECT COALESCE(SUM(amount_usdc), 0)
                        FROM synapse_ledger_entries
                        WHERE credit_account_id = %s
                            AND business_type = 'charge'
                            AND status = 'posted'
            """,
                        (self._account_identity(owner, "provider")[0],),
        )
        historical_net_income = self._q6((cur.fetchone() or [0])[0])

        cur.execute(
            "SELECT 1 FROM synapse_provider_risk_flags WHERE owner_address = %s AND is_high_risk = TRUE LIMIT 1",
            (owner,),
        )
        high_risk_from_db = cur.fetchone() is not None
        return rolling_24h, historical_net_income, high_risk_from_db

    def _append_withdrawal_audit(
        self,
        cur: Any,
        *,
        action: str,
        business_type: str,
        owner: str,
        request_id: str,
        amount: Decimal,
        risk_level: str,
        risk_reason_code: Optional[str],
        result_status: str,
        message: str,
    ) -> None:
        self._append_finance_audit_row(
            cur,
            AuditLogRow(
                actionType=action,
                businessType=business_type,
                riskLevel=risk_level,
                ownerAddress=owner,
                requestId=request_id,
                amountDelta=amount,
                resultStatus=result_status,
                errorCode=risk_reason_code,
                message=message,
                status=result_status,
            ),
        )

    def _resolve_red_reason(
        self, amount: Decimal, historical_net_income: Decimal, is_high_risk: bool
    ) -> Optional[str]:
        if amount > historical_net_income:
            return "WITHDRAW_EXCEEDS_HISTORICAL_NET_INCOME"
        if is_high_risk:
            return "HIGH_RISK_PROVIDER_TAGGED"
        return None

    def process_withdrawal_request_atomic(
        self,
        command: WithdrawalAtomicRequestCommand,
    ) -> WithdrawalDecision:
        owner = str(command.provider_address or "").strip().lower()
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        amount = self._q6(command.amount_usdc)
        _ = command.request_meta
        if amount <= Decimal("0"):
            raise RuntimeError("INVALID_WITHDRAW_AMOUNT")

        with self._db.connect() as conn:
            try:
                with conn.cursor() as cur:
                    available_balance, pending_balance, frozen_balance = (
                        self._load_locked_balance_triplet(cur, owner, "provider", now)
                    )
                    if available_balance < amount:
                        raise RuntimeError("INSUFFICIENT_PROVIDER_RECEIVABLE")

                    rolling_24h, historical_net_income, high_risk_from_db = (
                        self._compute_withdrawal_risk_metrics(
                            cur, owner, now, command.window_seconds
                        )
                    )
                    is_high_risk = bool(command.high_risk_override or high_risk_from_db)
                    red_reason = self._resolve_red_reason(
                        amount, historical_net_income, is_high_risk
                    )
                    withdrawal_id = f"wd-{now}-{owner[-8:]}"

                    if red_reason:
                        self._upsert_vault_withdrawal(
                            cur,
                            VaultWithdrawalUpsertSpec(
                                withdrawal_id=withdrawal_id,
                                owner_wallet=owner,
                                provider_wallet=owner,
                                amount_usdc=amount,
                                flow_status="REJECTED",
                                request_id=command.request_id,
                                updated_at=now_text,
                                idempotency_key=command.idempotency_key,
                                risk_level="red",
                                risk_reason_code=red_reason,
                                message=_WITHDRAWAL_BLOCKED_MESSAGE,
                                request_meta=command.request_meta,
                            ),
                        )
                        self._append_withdrawal_audit(
                            cur,
                            action="PROVIDER_WITHDRAW_REJECTED",
                            business_type="withdraw",
                            owner=owner,
                            request_id=command.request_id,
                            amount=amount,
                            risk_level="red",
                            risk_reason_code=red_reason,
                            result_status="REJECTED",
                            message=_WITHDRAWAL_BLOCKED_MESSAGE,
                        )
                        conn.commit()
                        return WithdrawalDecision(
                            decision="red",
                            withdrawalId=withdrawal_id,
                            status="REJECTED",
                            riskReasonCode=red_reason,
                            message=_WITHDRAWAL_BLOCKED_MESSAGE,
                        )

                    is_yellow = amount >= self._q6(command.single_limit_usdc) or (
                        rolling_24h + amount
                    ) >= self._q6(command.rolling_24h_limit_usdc)
                    next_available = self._q6(available_balance - amount)
                    if is_yellow:
                        status = "PENDING_MANUAL_REVIEW"
                        self._upsert_balance_triplet(
                            cur,
                            owner,
                            "provider",
                            next_available,
                            pending_balance,
                            self._q6(frozen_balance + amount),
                            now_text,
                        )
                        ticket = {}
                        message = "Withdrawal requested. Amounts over $100 require manual security review (ETA: 12-24 hrs)."
                        risk_level = "yellow"
                    else:
                        status = "APPROVED_AUTO"
                        self._upsert_balance_triplet(
                            cur,
                            owner,
                            "provider",
                            next_available,
                            self._q6(pending_balance + amount),
                            frozen_balance,
                            now_text,
                        )
                        prepared_ticket = (
                            command.sign_ticket_factory(amount)
                            if command.sign_ticket_factory is not None
                            else None
                        )
                        ticket = (
                            dict(prepared_ticket.ticket)
                            if isinstance(prepared_ticket, PreparedWithdrawTicket)
                            else {}
                        )
                        message = ""
                        risk_level = "green"

                    self._upsert_vault_withdrawal(
                        cur,
                        VaultWithdrawalUpsertSpec(
                            withdrawal_id=withdrawal_id,
                            owner_wallet=owner,
                            provider_wallet=owner,
                            amount_usdc=amount,
                            flow_status=status,
                            request_id=command.request_id,
                            updated_at=now_text,
                            idempotency_key=command.idempotency_key,
                            prepared_ticket=prepared_ticket if not is_yellow else None,
                            risk_level=risk_level,
                            message=message,
                            request_meta=command.request_meta,
                        ),
                    )

                    self._append_withdrawal_audit(
                        cur,
                        action="PROVIDER_WITHDRAW_INTENT_CREATED",
                        business_type="withdraw",
                        owner=owner,
                        request_id=command.request_id,
                        amount=amount,
                        risk_level=risk_level,
                        risk_reason_code=None,
                        result_status=status,
                        message=message,
                    )
                conn.commit()
                return WithdrawalDecision(
                    decision="yellow" if is_yellow else "green",
                    withdrawalId=withdrawal_id,
                    status=status,
                    amountUsdc=float(amount),
                    ticket=ticket,
                    message=message,
                )
            except Exception:
                conn.rollback()
                raise

    def _is_wallet_restricted(self, cur: Any, wallet: str) -> bool:
        cur.execute(
            "SELECT payload->>'status' FROM synapse_runtime_state WHERE state_key = %s",
            (f"auth_session::{str(wallet or '').lower()}",),
        )
        row = cur.fetchone()
        if row is None:
            return False
        return str(row[0] or "").strip().lower() in self._restricted_session_statuses

    def _is_account_restricted_for_charge(
        self, cur: Any, wallet: str, account_type: str, now: int
    ) -> bool:
        _, _, frozen_balance = self._load_locked_balance_triplet(
            cur, wallet, account_type, now
        )
        if frozen_balance <= Decimal("0"):
            return False
        return self._is_wallet_restricted(cur, wallet)

    def register_deposit_intent_atomic(
        self,
        command: DepositIntentRegisterCommand,
    ) -> DepositIntentRow:
        owner = str(command.owner_wallet or "").strip().lower()
        tx = str(command.tx_hash or "").strip().lower()
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        amount_usdc = self._q6(command.intent_row.amount_usdc)
        if amount_usdc <= Decimal("0"):
            raise RuntimeError("INVALID_DEPOSIT_AMOUNT")

        row = self._build_deposit_intent_row(
            owner,
            tx,
            command.request_id,
            command.intent_row,
            amount_usdc,
            now,
            now_text,
        )

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_deposit_dedup (tx_hash, owner_address, request_id) VALUES (%s, %s, %s)",
                        (tx, owner, command.request_id or None),
                    )
                except _INTEGRITY_ERRORS:
                    conn.rollback()
                    existing = self._read_existing_deposit_intent_by_tx(
                        tx, owner, now_text
                    )
                    if existing is not None:
                        return existing
                    raise RuntimeError("DEPOSIT_ALREADY_PROCESSED")

                available_balance, pending_balance, frozen_balance = (
                    self._load_locked_balance_triplet(cur, owner, "consumer", now)
                )
                self._upsert_balance_triplet(
                    cur,
                    owner,
                    "consumer",
                    available_balance,
                    self._q6(pending_balance + amount_usdc),
                    frozen_balance,
                    now_text,
                )

                self._persist_deposit_intent(cur, owner, row, now_text)
            conn.commit()
        return row

    def confirm_deposit_intent_atomic(
        self,
        command: DepositIntentConfirmCommand,
    ) -> DepositIntentRow:
        owner = str(command.owner_wallet or "").strip().lower()
        intent_id = str(command.deposit_intent_id or "").strip()
        if not intent_id:
            raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT vd.deposit_id, oa.owner_wallet, vd.tx_hash, vd.request_id,
                           vd.amount_usdc, vd.status, vd.created_at, vd.updated_at
                    FROM synapse_vault_deposits AS vd
                    INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = vd.owner_id
                    WHERE vd.deposit_id = %s AND oa.owner_wallet = %s
                    FOR UPDATE
                    """,
                    (intent_id, owner),
                )
                hit = cur.fetchone()
                if hit is None:
                    raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")

                meta = self._load_deposit_runtime_meta(cur, str(hit[0]))

                row = DepositIntentRow(
                    id=str(hit[0]),
                    ownerAddress=str(hit[1]),
                    txHash=str(hit[2]),
                    requestId=hit[3],
                    consumerAddress=meta.consumer_address,
                    amountUsdc=self._q6(hit[4]),
                    idempotencyKey=meta.idempotency_key,
                    status=str(hit[5]),
                    createdAt=to_dt_str(hit[6], now_text) or now_text,
                    updatedAt=to_dt_str(hit[7], now_text) or now_text,
                )

                available_balance, pending_balance, frozen_balance = (
                    self._load_locked_balance_triplet(cur, owner, "consumer", now)
                )

                if row.status.upper() == "CONFIRMED":
                    if pending_balance >= row.amount_usdc:
                        next_available = self._q6(available_balance + row.amount_usdc)
                        next_pending = self._q6(pending_balance - row.amount_usdc)
                        self._upsert_balance_triplet(
                            cur,
                            owner,
                            "consumer",
                            next_available,
                            next_pending,
                            frozen_balance,
                            now_text,
                        )
                        cur.execute(
                            "UPDATE synapse_vault_deposits SET updated_at = %s WHERE deposit_id = %s AND owner_id = %s",
                            (now_text, row.id, self._owner_id(owner)),
                        )
                        self._append_withdrawal_audit(
                            cur,
                            action="CONSUMER_DEPOSIT_CONFIRMED_REPAIRED",
                            business_type="deposit",
                            owner=owner,
                            request_id=row.request_id or command.event_key,
                            amount=row.amount_usdc,
                            risk_level="yellow",
                            risk_reason_code="DEPOSIT_CONFIRM_REPAIR",
                            result_status="CONFIRMED",
                            message="repair_pending_to_available",
                        )
                        conn.commit()
                        return DepositIntentRow(
                            id=row.id,
                            ownerAddress=row.owner_address,
                            txHash=row.tx_hash,
                            requestId=row.request_id,
                            consumerAddress=row.consumer_address,
                            amountUsdc=row.amount_usdc,
                            idempotencyKey=row.idempotency_key,
                            status="CONFIRMED",
                            createdAt=row.created_at,
                            updatedAt=now_text,
                        )
                    return row
                if row.status.upper() not in {"PENDING_CONFIRMATION", "PENDING"}:
                    raise RuntimeError("DEPOSIT_STATUS_INVALID")
                if pending_balance < row.amount_usdc:
                    raise RuntimeError("DEPOSIT_PENDING_BALANCE_INCONSISTENT")

                next_available = self._q6(available_balance + row.amount_usdc)
                next_pending = self._q6(pending_balance - row.amount_usdc)
                self._upsert_balance_triplet(
                    cur,
                    owner,
                    "consumer",
                    next_available,
                    next_pending,
                    frozen_balance,
                    now_text,
                )

                cur.execute(
                    "UPDATE synapse_vault_deposits SET status = %s, updated_at = %s WHERE deposit_id = %s AND owner_id = %s",
                    ("CONFIRMED", now_text, row.id, self._owner_id(owner)),
                )

                self._append_withdrawal_audit(
                    cur,
                    action="CONSUMER_DEPOSIT_CONFIRMED",
                    business_type="deposit",
                    owner=owner,
                    request_id=row.request_id or command.event_key,
                    amount=row.amount_usdc,
                    risk_level="green",
                    risk_reason_code=None,
                    result_status="CONFIRMED",
                            message=f"confirmations={int(command.confirmations)}",
                )
            conn.commit()
        return DepositIntentRow(
            id=row.id,
            ownerAddress=row.owner_address,
            txHash=row.tx_hash,
            requestId=row.request_id,
            consumerAddress=row.consumer_address,
            amountUsdc=row.amount_usdc,
            idempotencyKey=row.idempotency_key,
            status="CONFIRMED",
            createdAt=row.created_at,
            updatedAt=now_text,
        )

    def charge_consumer_and_record_usage_atomic(
        self,
        command: ChargeConsumerUsageCommand,
    ) -> ConsumerChargeResult:
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        owner = str(command.owner_wallet or "").strip().lower()
        provider = str(command.provider_wallet or "").strip().lower()

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                self._assert_charge_not_restricted(cur, owner, provider, now)

                before_consumer = self._load_available_balance(
                    cur, owner, "consumer", now
                )
                if before_consumer < self._q6(command.total_charge):
                    raise RuntimeError("INSUFFICIENT_BALANCE")

                provider_before = self._load_available_balance(
                    cur, provider, "provider", now
                )
                platform_before = self._load_available_balance(
                    cur, "__platform__", "platform_fee", now
                )
                consumer_after = self._q6(before_consumer - self._q6(command.total_charge))
                provider_after = self._q6(provider_before + self._q6(command.provider_net))
                platform_after = self._q6(
                    platform_before + self._q6(command.platform_fee_total)
                )
                invocation_id = (
                    str(command.invocation.invocation_id or "").strip()
                    if command.invocation is not None
                    else str(command.usage_row.id or "").strip()
                )
                self._set_available_balance(
                    cur, owner, "consumer", consumer_after, now, now_text
                )
                self._set_available_balance(
                    cur, provider, "provider", provider_after, now, now_text
                )
                self._set_available_balance(
                    cur,
                    "__platform__",
                    "platform_fee",
                    platform_after,
                    now,
                    now_text,
                )

                row = self._build_charge_usage_row(
                    command, invocation_id, owner, provider, now
                )
                self._record_charge_facts(
                    cur, command, row, owner, provider, now_text
                )

                self._append_finance_audit_row(
                    cur,
                    AuditLogRow(
                        actionType="CONSUMER_CHARGE_ATOMIC",
                        businessType="charge",
                        riskLevel="green",
                        ownerAddress=owner,
                        amountDelta=-self._q6(command.total_charge),
                        beforeBalance=before_consumer,
                        afterBalance=consumer_after,
                        resultStatus="SUCCEEDED",
                        status="SUCCEEDED",
                        requestId=row.request_id,
                        message=f"provider={provider}; invocation={row.id}",
                    ),
                )

            conn.commit()
        return ConsumerChargeResult(
            consumerAvailableBalanceAfter=float(consumer_after)
        )

    def reserve_provider_withdraw_atomic(
        self, command: ReserveProviderWithdrawCommand
    ) -> BalanceMutationResult:
        owner = str(command.owner_wallet or "").strip().lower()
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                before_available, before_pending, before_frozen = (
                    self._load_locked_balance_triplet(cur, owner, "provider", now)
                )
                if before_available < self._q6(command.amount_usdc):
                    raise RuntimeError("INSUFFICIENT_PROVIDER_RECEIVABLE")
                after_available = self._q6(before_available - self._q6(command.amount_usdc))
                after_pending = self._q6(before_pending + self._q6(command.amount_usdc))

                self._upsert_balance_triplet(
                    cur,
                    owner,
                    "provider",
                    after_available,
                    after_pending,
                    before_frozen,
                    now_text,
                )

            conn.commit()
        return BalanceMutationResult(
            beforeBalance=float(before_available), afterBalance=float(after_available)
        )


    def complete_withdraw_tx_atomic(
        self, command: CompleteWithdrawTxCommand
    ) -> bool:
        with self._db.connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_withdraw_tx_dedup (owner_address, tx_hash, kind) VALUES (%s, %s, %s)",
                        (command.owner_wallet, command.tx_hash, command.kind),
                    )
                except _INTEGRITY_ERRORS:
                    conn.rollback()
                    return False
            conn.commit()
        return True
