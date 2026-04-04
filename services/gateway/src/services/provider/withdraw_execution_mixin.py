"""Provider withdrawal execution mixin.

Contains reserve/ticket/review/atomic-path execution methods.
Composed into ProviderWithdrawService via MRO.
"""
from __future__ import annotations

import time
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, List, Optional
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.execution import (
    PreparedWithdrawTicket,
    ReserveProviderWithdrawCommand,
    WithdrawalAtomicRequestCommand,
    WithdrawalDecision,
)
from src.domain.finance import BalanceLedger
from src.domain.idempotency import IdempotencyRow
from src.domain.ledger import WithdrawalIntentRow
from src.domain.operation_metadata import OperationContextMetadata, WithdrawalTicketMetadata
from src.services.balance_mixins import USDC_DECIMALS
from src.services.provider.withdraw_helpers_mixin import (
    INSUFFICIENT_RECEIVABLE_MESSAGE,
    MANUAL_REVIEW_REJECT_MESSAGE,
    MANUAL_REVIEW_APPROVED_MESSAGE,
)
from src.utils.datetime_utils import now_dt_str


class ProviderWithdrawExecutionMixin:
    """Execution-phase withdrawal methods: reserve, ticket preparation, review, atomic path."""

    def _reserve_withdraw_amount(
        self,
        owner: str,
        amount_usdc: float,
        ledger: BalanceLedger,
        *,
        lock_to_frozen: bool = False,
    ) -> None:
        provider_wallet = ledger.ensure_provider_wallet(owner)
        provider_wallet.available_balance = round(
            float(provider_wallet.available_balance or 0.0) - amount_usdc, 6
        )
        if lock_to_frozen:
            provider_wallet.frozen_balance = round(
                float(provider_wallet.frozen_balance or 0.0) + amount_usdc, 6
            )
        else:
            provider_wallet.pending_balance = round(
                float(provider_wallet.pending_balance or 0.0) + amount_usdc, 6
            )
        reserve_provider_withdraw_atomic = getattr(
            self.storage, "reserve_provider_withdraw_atomic", None  # type: ignore[attr-defined]
        )
        if callable(reserve_provider_withdraw_atomic):
            try:
                reserve_provider_withdraw_atomic(
                    ReserveProviderWithdrawCommand(
                        owner_wallet=owner,
                        amount_usdc=Decimal(str(amount_usdc)).quantize(
                            Decimal("0.000001"), rounding=ROUND_HALF_UP
                        ),
                    )
                )
            except RuntimeError as exc:
                if str(exc) == "INSUFFICIENT_PROVIDER_RECEIVABLE":
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "INSUFFICIENT_PROVIDER_RECEIVABLE",
                            "message": INSUFFICIENT_RECEIVABLE_MESSAGE,
                        },
                    )
                raise
            return
        self._save_balance_ledger(ledger)  # type: ignore[attr-defined]

    def _prepare_withdraw_ticket(
        self,
        *,
        owner: str,
        amount_usdc: float,
        force_sign: bool = False,
    ) -> PreparedWithdrawTicket:
        requires_manual_review = (
            amount_usdc >= settings.withdrawal_auto_single_limit_usdc
        ) and not force_sign
        amount_wei = int(round(amount_usdc * float(10**USDC_DECIMALS)))

        if requires_manual_review:
            return PreparedWithdrawTicket(
                requires_manual_review=True,
                amount_wei=amount_wei,
                fee_wei=0,
                nonce=0,
                chain_id=0,
                deadline=0,
                signature="",
                signer_address="",
                ticket={},
            )

        private_key = self._require_withdraw_signer()  # type: ignore[attr-defined]
        nonce, chain_id = self._resolve_withdraw_nonce_and_chain(owner)  # type: ignore[attr-defined]
        deadline = int(time.time()) + self._resolve_withdraw_deadline_sec()  # type: ignore[attr-defined]
        fee_wei = 0
        typed_data = self._build_withdraw_typed_data(  # type: ignore[attr-defined]
            owner_wallet=owner,
            amount_wei=amount_wei,
            fee_wei=fee_wei,
            nonce=nonce,
            deadline=deadline,
            chain_id=chain_id,
            verifying_contract=normalize_wallet(settings.router_address),
        )
        signature = self._sign_withdraw_ticket(typed_data, private_key)  # type: ignore[attr-defined]

        try:
            from eth_account import Account  # type: ignore[import-not-found]

            signer_address = normalize_wallet(Account.from_key(private_key).address)
        except Exception:
            signer_address = ""

        return PreparedWithdrawTicket(
            requires_manual_review=False,
            amount_wei=amount_wei,
            fee_wei=fee_wei,
            nonce=nonce,
            chain_id=chain_id,
            deadline=deadline,
            signature=signature,
            signer_address=signer_address,
            ticket={
                "amount": str(amount_wei),
                "fee": str(fee_wei),
                "nonce": nonce,
                "deadline": deadline,
                "signature": signature,
                "chainId": chain_id,
                "contractAddress": normalize_wallet(settings.router_address),
            },
        )

    def _parse_withdraw_review_context(
        self, request_meta: Optional[dict[str, Any]]
    ) -> tuple[str, str, str]:
        review_ctx = OperationContextMetadata.model_validate(request_meta or {}).review
        reviewer_address = (
            normalize_wallet(str(review_ctx.reviewer_address or ""))
            if review_ctx.reviewer_address
            else ""
        )
        return (
            str(review_ctx.decision or "").strip().upper(),
            reviewer_address,
            str(review_ctx.reviewer_note or "").strip(),
        )

    def _reject_manual_review_withdrawal(
        self,
        *,
        owner: str,
        rows: List[WithdrawalIntentRow],
        target: WithdrawalIntentRow,
        amount_usdc: float,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        self._release_frozen_withdraw_to_available(owner, amount_usdc)  # type: ignore[attr-defined]
        now = int(time.time())
        now_text = now_dt_str()
        target.status = "REJECTED"
        target.review_decision = "REJECT"
        target.reviewer_address = reviewer_address
        target.reviewer_note = reviewer_note
        target.reviewed_at = now
        target.updated_at = now_text
        target.message = MANUAL_REVIEW_REJECT_MESSAGE
        self._save_withdrawal_rows(rows)  # type: ignore[attr-defined]
        self._append_financial_audit(  # type: ignore[attr-defined]
            "PROVIDER_WITHDRAW_REVIEW_REJECTED",
            owner,
            {
                "withdrawalId": str(target.id or ""),
                "amountUsdc": amount_usdc,
                "reviewerAddress": reviewer_address,
                "reviewerNote": reviewer_note,
                "requestMeta": request_meta or {},
            },
        )
        return {
            "withdrawalId": str(target.id or ""),
            "status": "REJECTED",
            "amountUsdc": amount_usdc,
            "ticket": {},
            "message": MANUAL_REVIEW_REJECT_MESSAGE,
        }

    def _approve_manual_review_withdrawal(
        self,
        *,
        owner: str,
        rows: List[WithdrawalIntentRow],
        target: WithdrawalIntentRow,
        amount_usdc: float,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        self._assert_withdraw_vault_liquidity(Decimal(str(amount_usdc)))  # type: ignore[attr-defined]
        ticket_payload = self._prepare_withdraw_ticket(
            owner=owner,
            amount_usdc=amount_usdc,
            force_sign=True,
        )
        self._move_frozen_withdraw_to_pending(owner, amount_usdc)  # type: ignore[attr-defined]

        now = int(time.time())
        now_text = now_dt_str()
        target.status = "APPROVED_AUTO"
        target.review_decision = "APPROVE"
        target.reviewer_address = reviewer_address
        target.reviewer_note = reviewer_note
        target.reviewed_at = now
        target.updated_at = now_text
        target.amount_wei = str(ticket_payload.amount_wei)
        target.fee_wei = str(ticket_payload.fee_wei)
        target.nonce = ticket_payload.nonce
        target.deadline = ticket_payload.deadline
        target.signature = ticket_payload.signature
        target.chain_id = ticket_payload.chain_id
        target.contract_address = normalize_wallet(settings.router_address)
        target.signer_address = ticket_payload.signer_address
        target.ticket = WithdrawalTicketMetadata.model_validate(ticket_payload.ticket)
        target.message = MANUAL_REVIEW_APPROVED_MESSAGE
        self._save_withdrawal_rows(rows)  # type: ignore[attr-defined]

        response = {
            "withdrawalId": str(target.id or ""),
            "status": "APPROVED_AUTO",
            "amountUsdc": amount_usdc,
            "ticket": dict(ticket_payload.ticket),
            "message": MANUAL_REVIEW_APPROVED_MESSAGE,
        }
        self._append_financial_audit(  # type: ignore[attr-defined]
            "PROVIDER_WITHDRAW_REVIEW_APPROVED",
            owner,
            {
                "withdrawalId": response["withdrawalId"],
                "amountUsdc": amount_usdc,
                "reviewerAddress": reviewer_address,
                "reviewerNote": reviewer_note,
                "requestMeta": request_meta or {},
            },
        )
        return response

    def _build_atomic_signing_ticket(
        self, owner: str, amount_usdc: Decimal
    ) -> PreparedWithdrawTicket:
        return self._prepare_withdraw_ticket(
            owner=owner, amount_usdc=float(amount_usdc)
        )

    def process_withdrawal_request(
        self, command: WithdrawalAtomicRequestCommand
    ) -> WithdrawalDecision:
        if not hasattr(self.storage, "process_withdrawal_request_atomic"):  # type: ignore[attr-defined]
            raise RuntimeError("WITHDRAWAL_ATOMIC_NOT_SUPPORTED")

        owner = normalize_wallet(command.provider_address)
        high_risk_override = owner in settings.withdrawal_high_risk_provider_addresses
        window_seconds = command.window_seconds

        try:
            return getattr(self.storage, "process_withdrawal_request_atomic")(  # type: ignore[attr-defined]
                WithdrawalAtomicRequestCommand(
                    provider_address=owner,
                    amount_usdc=command.amount_usdc,
                    request_id=command.request_id,
                    idempotency_key=command.idempotency_key,
                    request_meta=command.request_meta,
                    single_limit_usdc=command.single_limit_usdc,
                    rolling_24h_limit_usdc=command.rolling_24h_limit_usdc,
                    window_seconds=window_seconds,
                    high_risk_override=bool(high_risk_override or command.high_risk_override),
                    pre_reserve_check=self._assert_withdraw_vault_liquidity,  # type: ignore[attr-defined]
                    sign_ticket_factory=lambda value: self._build_atomic_signing_ticket(
                        owner, value
                    ),
                )
            )
        except RuntimeError as exc:
            self._raise_withdraw_runtime_error(str(exc))  # type: ignore[attr-defined]
            raise

    async def _create_provider_withdraw_intent_atomic(
        self,
        *,
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_hash: str,
        request_meta: Optional[dict[str, Any]],
        redis_client: Optional[Any],
        idem_rows: List[IdempotencyRow],
    ) -> dict[str, Any]:
        request_id = str((request_meta or {}).get("requestId") or str(uuid4()))
        atomic_result = self.process_withdrawal_request(
            WithdrawalAtomicRequestCommand(
                provider_address=owner,
                amount_usdc=Decimal(str(amount_usdc)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                request_id=request_id,
                idempotency_key=idempotency_key,
                request_meta=request_meta,
                single_limit_usdc=Decimal(
                    str(settings.withdrawal_auto_single_limit_usdc)
                ),
                rolling_24h_limit_usdc=Decimal(
                    str(settings.withdrawal_auto_24h_limit_usdc)
                ),
                window_seconds=max(1, int(settings.withdrawal_window_hours)) * 3600,
                high_risk_override=False,
            )
        )
        response = {
            "withdrawalId": atomic_result.withdrawal_id,
            "status": atomic_result.status,
            "amountUsdc": atomic_result.amount_usdc,
            "ticket": dict(atomic_result.ticket),
            "message": atomic_result.message,
        }
        await self._finish_provider_withdraw_idempotency(  # type: ignore[attr-defined]
            owner=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response=response,
            redis_client=redis_client,
            idem_rows=idem_rows,
        )
        if atomic_result.decision.lower() == "red":
            raise HTTPException(
                status_code=403,
                detail={
                    "code": atomic_result.risk_reason_code
                    or "WITHDRAWAL_BLOCKED_BY_RISK_POLICY",
                    "message": atomic_result.message
                    or "Withdrawal blocked by risk policy.",
                },
            )

        self._append_financial_audit(  # type: ignore[attr-defined]
            "PROVIDER_WITHDRAW_INTENT_CREATED",
            owner,
            {
                "withdrawalId": response["withdrawalId"],
                "amountUsdc": response["amountUsdc"],
                "status": response["status"],
                "idempotencyKey": idempotency_key,
                "requestId": request_id,
                "requestMeta": request_meta or {},
            },
        )
        return response

    async def _resolve_pending_withdrawal_response(
        self,
        *,
        rows: List[WithdrawalIntentRow],
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_hash: str,
        redis_client: Optional[Any],
        idem_rows: List[IdempotencyRow],
    ) -> Optional[dict[str, Any]]:
        pending = self._get_pending_withdrawal(rows, owner)  # type: ignore[attr-defined]
        if pending is None:
            return None

        if (
            self._withdraw_owner(pending) == owner  # type: ignore[attr-defined]
            and round(float(pending.amount_usdc or 0.0), 6) == amount_usdc
        ):
            response = self._build_pending_withdraw_response(pending)  # type: ignore[attr-defined]
            await self._finish_provider_withdraw_idempotency(  # type: ignore[attr-defined]
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
                redis_client=redis_client,
                idem_rows=idem_rows,
            )
            return response

        raise HTTPException(
            status_code=409,
            detail={
                "code": "PENDING_WITHDRAWAL_EXISTS",
                "message": "A pending provider withdrawal already exists. Complete or cancel it before creating a new one.",
            },
        )

    def _build_withdraw_row_and_response(
        self,
        *,
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_meta: Optional[dict[str, Any]],
        ticket_payload: PreparedWithdrawTicket,
    ) -> tuple[WithdrawalIntentRow, dict[str, Any]]:
        now_text = now_dt_str()
        withdrawal_id = str(uuid4())
        status = (
            "PENDING_MANUAL_REVIEW"
            if ticket_payload.requires_manual_review
            else "APPROVED_AUTO"
        )
        manual_review_limit = settings.withdrawal_auto_single_limit_usdc
        message = (
            f"Withdrawal requested. Amounts at or above ${manual_review_limit:g} require manual security review (ETA: 12-24 hrs)."
            if ticket_payload.requires_manual_review
            else ""
        )
        row = WithdrawalIntentRow(
            id=withdrawal_id,
            ownerAddress=owner,
            amountUsdc=Decimal(str(amount_usdc)),
            amountWei=str(ticket_payload.amount_wei),
            feeWei=str(ticket_payload.fee_wei),
            nonce=ticket_payload.nonce,
            deadline=ticket_payload.deadline,
            signature=ticket_payload.signature,
            chainId=ticket_payload.chain_id,
            contractAddress=normalize_wallet(settings.router_address),
            signerAddress=ticket_payload.signer_address,
            status=status,
            businessType="withdraw",
            riskLevel="yellow" if ticket_payload.requires_manual_review else "green",
            idempotencyKey=idempotency_key,
            createdAt=now_text,
            updatedAt=now_text,
            requestMeta=self._operation_context_metadata(request_meta),  # type: ignore[attr-defined]
            message=message,
            ticket=self._withdrawal_ticket_metadata(ticket_payload.ticket),  # type: ignore[attr-defined]
        )
        response = {
            "withdrawalId": withdrawal_id,
            "status": status,
            "amountUsdc": amount_usdc,
            "ticket": dict(ticket_payload.ticket),
            "message": message,
        }
        return row, response
