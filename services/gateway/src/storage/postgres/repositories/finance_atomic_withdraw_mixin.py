"""Finance atomic repository — withdrawal domain helpers and public atomics.

Contains: vault withdrawal upsert, balance locking, risk metrics, audit,
process_withdrawal_request_atomic, reserve_provider_withdraw_atomic,
complete_withdraw_tx_atomic.
"""
from __future__ import annotations

import time
from decimal import Decimal
from typing import Any, Optional
from uuid import uuid4

from src.domain.audit import AuditLogRow
from src.domain.execution import (
    CompleteWithdrawTxCommand,
    PreparedWithdrawTicket,
    ReserveProviderWithdrawCommand,
    WithdrawalAtomicRequestCommand,
    WithdrawalDecision,
)
from src.domain.finance import BalanceMutationResult
from src.domain.runtime_state import VaultWithdrawalMetadataState
from src.utils.datetime_utils import now_dt_str, to_dt_str

from .finance_atomic_core_mixin import (
    VaultWithdrawalUpsertSpec,
    _INTEGRITY_ERRORS,
    _WITHDRAWAL_BLOCKED_MESSAGE,
)


class FinanceAtomicWithdrawMixin:
    """Withdrawal domain helpers and public atomic methods."""

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
        owner_id = self._ensure_owner_account(cur, spec.owner_wallet, spec.updated_at)  # type: ignore[attr-defined]
        provider_id = None
        source_account_id = self._ensure_ledger_account(  # type: ignore[attr-defined]
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
            provider_id = self._ensure_provider_profile(  # type: ignore[attr-defined]
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
                tx_hash, amount_usdc, status, request_id, ticket_id, ticket_hash, signature, nonce, deadline,
                created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s::synapse_withdrawal_kind, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (withdrawal_id)
            DO UPDATE SET
                owner_id = EXCLUDED.owner_id,
                provider_id = EXCLUDED.provider_id,
                source_account_id = EXCLUDED.source_account_id,
                tx_hash = EXCLUDED.tx_hash,
                amount_usdc = EXCLUDED.amount_usdc,
                status = EXCLUDED.status,
                request_id = EXCLUDED.request_id,
                ticket_id = COALESCE(synapse_vault_withdrawals.ticket_id, EXCLUDED.ticket_id),
                ticket_hash = COALESCE(synapse_vault_withdrawals.ticket_hash, EXCLUDED.ticket_hash),
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
                str(self._q6(spec.amount_usdc)),  # type: ignore[attr-defined]
                self._vault_status_from_flow_status(spec.flow_status, has_signature),  # type: ignore[attr-defined]
                spec.request_id,
                prepared_ticket.ticket_id if prepared_ticket else None,
                prepared_ticket.ticket_hash if prepared_ticket else None,
                prepared_ticket.signature if prepared_ticket else None,
                prepared_ticket.nonce if prepared_ticket else None,
                prepared_ticket.deadline if prepared_ticket else None,
                spec.updated_at,
                spec.updated_at,
            ),
        )
        self._upsert_runtime_state(  # type: ignore[attr-defined]
            cur,
            self._vault_withdrawal_state_key(spec.withdrawal_id),  # type: ignore[attr-defined]
            self._build_vault_withdrawal_metadata(
                spec, provider_address
            ).model_dump(by_alias=True, mode="json"),
            spec.updated_at,
        )

    def _load_locked_balance_triplet(
        self, cur: Any, owner: str, account_type: str, now: int
    ) -> tuple[Decimal, Decimal, Decimal]:
        now_text = to_dt_str(now, now_dt_str())
        account_id = self._ensure_ledger_account(cur, owner, account_type, now_text)  # type: ignore[attr-defined]
        cur.execute(self._balance_for_update_sql, (account_id,))  # type: ignore[attr-defined]
        hit = cur.fetchone()
        if hit is None:
            self._upsert_balance_triplet(  # type: ignore[attr-defined]
                cur, owner, account_type, Decimal("0"), Decimal("0"), Decimal("0"), now_text,
            )
            return Decimal("0"), Decimal("0"), Decimal("0")
        return self._q6(hit[0]), self._q6(hit[1]), self._q6(hit[2])  # type: ignore[attr-defined]

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
            (self._owner_id(owner), to_dt_str(window_start, now_dt_str())),  # type: ignore[attr-defined]
        )
        rolling_24h = self._q6((cur.fetchone() or [0])[0])  # type: ignore[attr-defined]

        cur.execute(
            """
            SELECT COALESCE(SUM(amount_usdc), 0)
            FROM synapse_ledger_entries
            WHERE credit_account_id = %s
              AND business_type = 'charge'
              AND status = 'posted'
            """,
            (self._account_identity(owner, "provider")[0],),  # type: ignore[attr-defined]
        )
        historical_net_income = self._q6((cur.fetchone() or [0])[0])  # type: ignore[attr-defined]

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
        evidence: Optional[dict[str, Any]] = None,
    ) -> None:
        evidence = evidence or {}
        self._append_finance_audit_row(  # type: ignore[attr-defined]
            cur,
            AuditLogRow(
                actionType=action,
                businessType=business_type,
                riskLevel=risk_level,
                ownerAddress=owner,
                requestId=request_id,
                amountDelta=amount,
                beforeBalance=evidence.get("beforeBalance"),
                afterBalance=evidence.get("afterBalance"),
                resultStatus=result_status,
                errorCode=risk_reason_code,
                message=message,
                txHash=evidence.get("txHash"),
                ledgerId=evidence.get("ledgerId"),
                traceId=evidence.get("traceId"),
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

    @staticmethod
    def _run_withdraw_pre_reserve_check(
        command: WithdrawalAtomicRequestCommand, amount: Decimal
    ) -> None:
        if command.pre_reserve_check is None:
            return
        command.pre_reserve_check(amount)

    def _is_wallet_restricted(self, cur: Any, wallet: str) -> bool:
        cur.execute(
            "SELECT payload->>'status' FROM synapse_runtime_state WHERE state_key = %s",
            (f"auth_session::{str(wallet or '').lower()}",),
        )
        row = cur.fetchone()
        if row is None:
            return False
        return str(row[0] or "").strip().lower() in self._restricted_session_statuses  # type: ignore[attr-defined]

    def _is_account_restricted_for_charge(
        self, cur: Any, wallet: str, account_type: str, now: int
    ) -> bool:
        _, _, frozen_balance = self._load_locked_balance_triplet(
            cur, wallet, account_type, now
        )
        if frozen_balance <= Decimal("0"):
            return False
        return self._is_wallet_restricted(cur, wallet)

    def process_withdrawal_request_atomic(
        self,
        command: WithdrawalAtomicRequestCommand,
    ) -> WithdrawalDecision:
        owner = str(command.provider_address or "").strip().lower()
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        amount = self._q6(command.amount_usdc)  # type: ignore[attr-defined]
        _ = command.request_meta
        if amount <= Decimal("0"):
            raise RuntimeError("INVALID_WITHDRAW_AMOUNT")

        with self._db.connect() as conn:  # type: ignore[attr-defined]
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
                    withdrawal_id = f"wd-{uuid4().hex}"

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

                    self._run_withdraw_pre_reserve_check(command, amount)

                    is_yellow = amount >= self._q6(command.single_limit_usdc) or (  # type: ignore[attr-defined]
                        rolling_24h + amount
                    ) >= self._q6(command.rolling_24h_limit_usdc)  # type: ignore[attr-defined]
                    next_available = self._q6(available_balance - amount)  # type: ignore[attr-defined]
                    prepared_ticket = None
                    if is_yellow:
                        status = "PENDING_MANUAL_REVIEW"
                        self._upsert_balance_triplet(  # type: ignore[attr-defined]
                            cur, owner, "provider", next_available, pending_balance,
                            self._q6(frozen_balance + amount), now_text,  # type: ignore[attr-defined]
                        )
                        ticket: dict[str, Any] = {}
                        message = (
                            f"Withdrawal requested. Amounts at or above ${command.single_limit_usdc:g} require manual security review (ETA: 12-24 hrs)."
                        )
                        risk_level = "yellow"
                    else:
                        status = "APPROVED_AUTO"
                        self._upsert_balance_triplet(  # type: ignore[attr-defined]
                            cur, owner, "provider", next_available,
                            self._q6(pending_balance + amount), frozen_balance, now_text,  # type: ignore[attr-defined]
                        )
                        prepared_ticket = (
                            command.sign_ticket_factory(amount, withdrawal_id)
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
                    amountUsdc=amount,
                    ticket=ticket,
                    message=message,
                )
            except Exception:
                conn.rollback()
                raise

    def reserve_provider_withdraw_atomic(
        self, command: ReserveProviderWithdrawCommand
    ) -> BalanceMutationResult:
        owner = str(command.owner_wallet or "").strip().lower()
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())

        with self._db.connect() as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                before_available, before_pending, before_frozen = (
                    self._load_locked_balance_triplet(cur, owner, "provider", now)
                )
                if before_available < self._q6(command.amount_usdc):  # type: ignore[attr-defined]
                    raise RuntimeError("INSUFFICIENT_PROVIDER_RECEIVABLE")
                after_available = self._q6(before_available - self._q6(command.amount_usdc))  # type: ignore[attr-defined]
                after_pending = self._q6(before_pending + self._q6(command.amount_usdc))  # type: ignore[attr-defined]

                self._upsert_balance_triplet(  # type: ignore[attr-defined]
                    cur, owner, "provider", after_available, after_pending, before_frozen, now_text,
                )

            conn.commit()
        return BalanceMutationResult(
            beforeBalance=float(before_available), afterBalance=float(after_available)
        )

    def complete_withdraw_tx_atomic(
        self, command: CompleteWithdrawTxCommand
    ) -> bool:
        withdrawal_id = str(command.withdrawal_id or "").strip()
        withdrawal_kind = (
            "provider_withdrawal"
            if str(command.kind or "").strip() == "provider_withdraw"
            else "consumer_refund"
        )
        with self._db.connect() as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_withdraw_tx_dedup (owner_address, tx_hash, kind) VALUES (%s, %s, %s)",
                        (command.owner_wallet, command.tx_hash, command.kind),
                    )
                except _INTEGRITY_ERRORS:
                    conn.rollback()
                    return False
                if withdrawal_id:
                    cur.execute(
                        """
                        UPDATE synapse_vault_withdrawals
                        SET status = 'COMPLETED',
                            tx_hash = %s,
                            updated_at = %s
                        WHERE withdrawal_id = %s
                          AND owner_id = %s
                          AND withdrawal_kind = %s
                        """,
                        (
                            command.tx_hash,
                            now_dt_str(),
                            withdrawal_id,
                            self._owner_id(command.owner_wallet),  # type: ignore[attr-defined]
                            withdrawal_kind,
                        ),
                    )
            conn.commit()
        return True
