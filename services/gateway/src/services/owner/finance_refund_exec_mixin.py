"""Refund execution mixin: balance mutations, completion, and public methods.

Contains all the write-path refund operations that mutate balance or storage,
plus the three public refund endpoints.
"""
from __future__ import annotations

import time
from decimal import Decimal
from typing import Any, List, Optional
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.domain.execution import CompleteWithdrawTxCommand
from src.domain.finance import RefundIntentRow, RefundReviewContext
from src.domain.operation_metadata import OperationContextMetadata
from src.services.owner.finance_constants import CONSUMER_WITHDRAW_TYPE, REFUND_ACTIVE_STATUSES
from src.services.owner.finance_fee_policy import accrue_consumer_withdraw_fee_after_fallback
from src.utils.datetime_utils import now_dt_str
from src.utils.money import money_str, parse_usdc

RefundResponse = dict[str, Any]
RefundListResponse = List[RefundResponse]


class FinanceRefundExecMixin:
    """Refund execution: balance mutations, completion, and public refund methods."""

    def _release_locked_refund_to_available(
        self, owner: str, amount_usdc: Decimal | str | int
    ) -> None:
        ledger = self._load_balance_ledger()  # type: ignore[attr-defined]
        consumer_wallet = ledger.ensure_consumer_wallet(owner)
        release_amount = parse_usdc(amount_usdc)
        locked = parse_usdc(consumer_wallet.pending_balance)
        if locked < release_amount:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_LOCK_INCONSISTENT",
                    "message": "Locked owner balance is insufficient for refund rejection release.",
                },
            )
        consumer_wallet.pending_balance = parse_usdc(max(Decimal("0"), locked - release_amount))
        consumer_wallet.available_balance = parse_usdc(
            parse_usdc(consumer_wallet.available_balance) + release_amount
        )
        self._save_balance_ledger(ledger)  # type: ignore[attr-defined]

    def _parse_refund_review_context(self, request_meta: Optional[dict[str, Any]]) -> RefundReviewContext:
        review_ctx = OperationContextMetadata.model_validate(request_meta or {}).review
        reviewer_address = (
            normalize_wallet(str(review_ctx.reviewer_address or ""))
            if review_ctx.reviewer_address
            else ""
        )
        return RefundReviewContext(
            decision=str(review_ctx.decision or "APPROVE").strip().upper(),
            reviewer_address=reviewer_address,
            reviewer_note=str(review_ctx.reviewer_note or "").strip(),
        )

    @staticmethod
    def _is_consumer_withdraw_row(target: RefundIntentRow) -> bool:
        return str(target.refund_type or "") == CONSUMER_WITHDRAW_TYPE

    @staticmethod
    def _fail_response(target: RefundIntentRow) -> dict[str, Any]:
        return {"refundId": str(target.id or ""), "status": str(target.status or ""), "txHash": str(target.tx_hash or "")}

    @staticmethod
    def _replace_refund_row(
        rows: List[RefundIntentRow],
        target: RefundIntentRow,
        updated: RefundIntentRow,
    ) -> None:
        for index, row in enumerate(rows):
            if row is target or str(row.id or "") == str(updated.id or ""):
                rows[index] = updated
                return

    @staticmethod
    def _raise_consumer_review_balance_conflict(exc: Exception) -> None:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "CONSUMER_WITHDRAW_REVIEW_BALANCE_INCONSISTENT",
                "message": (
                    "Consumer withdrawal review could not safely move frozen funds. "
                    "The review state was not changed."
                ),
            },
        ) from exc

    def _atomic_consumer_review_method(self, method_name: str):
        gateway_state = self.storage.get_data_manager().system.gateway_state
        method = getattr(gateway_state, method_name, None)
        return method if callable(method) else None

    def _complete_refund_tx_atomic_or_raise(
        self,
        *,
        owner: str,
        refund_id: str,
        normalized_tx_hash: str,
    ) -> bool:  # pragma: no cover: human-review-required E2E report
        if not hasattr(self.storage, "complete_withdraw_tx_atomic"):  # type: ignore[attr-defined]
            return False
        try:
            bound = bool(
                getattr(self.storage, "complete_withdraw_tx_atomic")(  # type: ignore[attr-defined]
                    CompleteWithdrawTxCommand(
                        owner_wallet=owner,
                        tx_hash=normalized_tx_hash,
                        kind="owner_refund",
                        withdrawal_id=refund_id,
                    )
                )
            )
        except RuntimeError as exc:
            if str(exc) != "WITHDRAWAL_PENDING_BALANCE_INCONSISTENT":
                raise
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_LOCK_INCONSISTENT",
                    "message": "Locked owner balance is insufficient for this refund completion.",
                },
            ) from exc
        if not bound:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_TX_REPLAY_DETECTED",
                    "message": "txHash is already bound to another refund intent.",
                },
            )
        return True

    def _review_consumer_withdrawal_reject(
        self,
        *,
        owner: str,
        rows: List[RefundIntentRow],
        target: RefundIntentRow,
        amount_usdc: Decimal,
        review: RefundReviewContext,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        now = int(time.time())
        updated = target.model_copy(deep=True)
        updated.reviewer_address = review.reviewer_address
        updated.reviewer_note = review.reviewer_note
        updated.reviewed_at = now
        updated.complete_meta = request_meta or {}
        updated.status = "REJECTED"
        updated.review_decision = "REJECT"
        updated.completed_at = now
        updated.updated_at = now_dt_str()
        updated.message = "Withdrawal rejected during manual security review."
        audit_detail = {
            "refundId": str(target.id or ""),
            "amountUsdc": money_str(amount_usdc),
            "reviewerAddress": review.reviewer_address,
            "reviewerNote": review.reviewer_note,
            "requestMeta": request_meta or {},
        }
        atomic_reject = self._atomic_consumer_review_method(
            "reject_consumer_withdrawal_review_atomic"
        )
        try:
            if atomic_reject is not None:
                atomic_reject(
                    owner=owner,
                    row=updated,
                    amount_usdc=amount_usdc,
                    detail=audit_detail,
                    updated_at=updated.updated_at,
                )
            else:
                self._release_consumer_frozen_to_available(owner, amount_usdc)  # type: ignore[attr-defined]
                self._replace_refund_row(rows, target, updated)
                self._save_refund_rows(rows, now)  # type: ignore[attr-defined]
                self._append_financial_audit(  # type: ignore[attr-defined]
                    "CONSUMER_WITHDRAW_REVIEW_REJECTED",
                    owner,
                    audit_detail,
                )
        except RuntimeError as exc:
            self._raise_consumer_review_balance_conflict(exc)
        self._replace_refund_row(rows, target, updated)
        return {
            "refundId": str(target.id or ""),
            "status": "REJECTED",
            "reviewDecision": "REJECT",
        }

    def _review_consumer_withdrawal_approve(
        self,
        *,
        owner: str,
        rows: List[RefundIntentRow],
        target: RefundIntentRow,
        amount_usdc: Decimal,
        review: RefundReviewContext,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        try:
            self._assert_withdraw_vault_liquidity(amount_usdc)  # type: ignore[attr-defined]  # reason: mixed in by BalanceWithdrawSigningMixin
        except RuntimeError as exc:
            self._raise_consumer_withdraw_runtime_error(str(exc))  # type: ignore[attr-defined]  # reason: mixed in by FinanceConsumerWithdrawMixin

        ticket = self._build_consumer_withdraw_ticket(  # type: ignore[attr-defined]
            owner=owner,
            gross_amount_usdc=amount_usdc,
            withdrawal_id=str(target.id or ""),
        )
        now = int(time.time())
        updated = target.model_copy(deep=True)
        updated.reviewer_address = review.reviewer_address
        updated.reviewer_note = review.reviewer_note
        updated.reviewed_at = now
        updated.complete_meta = request_meta or {}
        updated.status = "REQUESTED"
        updated.review_decision = "APPROVE"
        updated.updated_at = now_dt_str()
        updated.message = "Withdrawal approved. Signed ticket is ready for on-chain claim."
        updated.signature = ticket.signature
        updated.ticket = ticket
        updated.request_meta = {
            **(updated.request_meta.model_dump(by_alias=True, mode="json") if hasattr(updated.request_meta, "model_dump") else (updated.request_meta or {})),
            "ticketDeadline": ticket.deadline,
            "ticketId": ticket.ticket_id,
            "ticketHash": ticket.ticket_hash,
        }
        audit_detail = {
            "refundId": str(target.id or ""),
            "amountUsdc": money_str(amount_usdc),
            "reviewerAddress": review.reviewer_address,
            "reviewerNote": review.reviewer_note,
            "requestMeta": request_meta or {},
        }
        atomic_approve = self._atomic_consumer_review_method(
            "approve_consumer_withdrawal_review_atomic"
        )
        try:
            if atomic_approve is not None:
                atomic_approve(
                    owner=owner,
                    row=updated,
                    amount_usdc=amount_usdc,
                    detail=audit_detail,
                    updated_at=updated.updated_at,
                )
            else:
                self._move_consumer_frozen_to_pending(owner, amount_usdc)  # type: ignore[attr-defined]
                self._replace_refund_row(rows, target, updated)
                self._save_refund_rows(rows, now)  # type: ignore[attr-defined]
                self._append_financial_audit(  # type: ignore[attr-defined]
                    "CONSUMER_WITHDRAW_REVIEW_APPROVED",
                    owner,
                    audit_detail,
                )
        except RuntimeError as exc:
            self._raise_consumer_review_balance_conflict(exc)
        self._replace_refund_row(rows, target, updated)
        return {
            "refundId": str(target.id or ""),
            "status": "REQUESTED",
            "reviewDecision": "APPROVE",
            "ticket": ticket.model_dump(by_alias=True, mode="json", exclude_none=True),
        }

    def _reject_refund_manual_review(
        self,
        *,
        owner: str,
        rows: List[RefundIntentRow],
        target: RefundIntentRow,
        amount_usdc: Decimal | str | int,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        refund_amount = parse_usdc(amount_usdc)
        self._release_locked_refund_to_available(owner, refund_amount)
        now = int(time.time())
        target.status = "REJECTED"
        target.review_decision = "REJECT"
        target.reviewer_address = reviewer_address
        target.reviewer_note = reviewer_note
        target.reviewed_at = now
        target.updated_at = now
        target.complete_meta = request_meta or {}
        self._save_refund_rows(rows, now)  # type: ignore[attr-defined]
        self._append_financial_audit(  # type: ignore[attr-defined]
            "REFUND_INTENT_REJECTED",
            owner,
            {
                "refundId": str(target.id or ""),
                "amountUsdc": money_str(refund_amount),
                "reviewerAddress": reviewer_address,
                "reviewerNote": reviewer_note,
                "requestMeta": request_meta or {},
            },
        )
        return {
            "refundId": str(target.id or ""),
            "status": "REJECTED",
            "txHash": "",
        }

    def _handle_manual_review_before_completion(
        self,
        *,
        owner: str,
        rows: List[RefundIntentRow],
        target: RefundIntentRow,
        amount_usdc: Decimal | str | int,
        review_decision: str,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[dict[str, Any]],
    ) -> Optional[dict[str, Any]]:
        if review_decision not in {"APPROVE", "REJECT"}:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_REVIEW_DECISION",
                    "message": "review decision must be APPROVE or REJECT for manual review refunds.",
                },
            )
        if not reviewer_address:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "REFUND_REVIEW_APPROVER_REQUIRED",
                    "message": "Manual review refunds require reviewerAddress.",
                },
            )
        if review_decision == "REJECT":
            return self._reject_refund_manual_review(
                owner=owner,
                rows=rows,
                target=target,
                amount_usdc=amount_usdc,
                reviewer_address=reviewer_address,
                reviewer_note=reviewer_note,
                request_meta=request_meta,
            )
        return None

    def _finalize_refund_completion(
        self,
        *,
        owner: str,
        rows: List[RefundIntentRow],
        target: RefundIntentRow,
        normalized_tx_hash: str,
        amount_usdc: Decimal | str | int,
        status_before: str,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        refund_amount = parse_usdc(amount_usdc)
        now = int(time.time())
        target.status = "COMPLETED"
        target.tx_hash = normalized_tx_hash
        if status_before == "PENDING_MANUAL_REVIEW":
            target.review_decision = "APPROVE"
            target.reviewer_address = reviewer_address
            target.reviewer_note = reviewer_note
            target.reviewed_at = now
        target.completed_at = now
        target.updated_at = now
        target.complete_meta = request_meta or {}
        self._save_refund_rows(rows, now)  # type: ignore[attr-defined]
        self._append_financial_audit(  # type: ignore[attr-defined]
            "REFUND_INTENT_COMPLETED",
            owner,
            {
                "refundId": str(target.id or ""),
                "txHash": normalized_tx_hash,
                "amountUsdc": money_str(refund_amount),
                "reviewDecision": str(target.review_decision or "APPROVE"),
                "reviewerAddress": str(target.reviewer_address or ""),
                "requestMeta": request_meta or {},
            },
        )

        # Analytics: refund_completed (fire-and-forget via asyncio task)
        import asyncio
        from src.services.analytics.gateway_events import emit_refund_completed
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(emit_refund_completed(
                owner,
                amount_usdc=refund_amount,
                reason_code=str(target.reason or ""),
                tx_hash=normalized_tx_hash,
            ))
        except RuntimeError:
            pass

        return {
            "refundId": str(target.id or ""),
            "status": "COMPLETED",
            "txHash": normalized_tx_hash,
        }

    async def process_refund_intent(
        self,
        payload: dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> RefundResponse:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:refund_intent"):  # type: ignore[attr-defined]
            idempotency_key = self._validate_idempotency_key(idempotency_key)  # type: ignore[attr-defined]
            await self._enforce_owner_write_rate_limit(owner, "refund_intent")  # type: ignore[attr-defined]

            ledger = self._load_balance_ledger()  # type: ignore[attr-defined]
            available_balance = ledger.consumer_available_balance(owner)
            context = self._parse_refund_create_context(  # type: ignore[attr-defined]
                payload, owner, available_balance
            )
            amount_usdc = parse_usdc(context.amount_usdc)
            reason = context.reason
            evidence_summary = context.evidence_summary
            origin = context.origin
            refund_type = context.refund_type
            destination_address = context.destination_address
            request_hash = context.request_hash
            redis_client = await self._get_redis_client()  # type: ignore[attr-defined]

            redis_hit = await self._check_idempotency_redis(  # type: ignore[attr-defined]
                scope="refund_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if redis_hit is not None:
                return redis_hit

            started = await self._start_idempotency_redis(  # type: ignore[attr-defined]
                scope="refund_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if not started:
                redis_retry = await self._check_idempotency_redis(  # type: ignore[attr-defined]
                    scope="refund_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                )
                if redis_retry is not None:
                    return redis_retry

            idem_rows: List[dict[str, Any]] = []
            if redis_client is None:
                idem_rows = self._load_idempotency_rows()  # type: ignore[attr-defined]
                idem_hit = self._try_get_idempotent_response(  # type: ignore[attr-defined]
                    rows=idem_rows,
                    scope="refund_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                )
                if idem_hit is not None:
                    return idem_hit

            rows = self._load_refund_rows()  # type: ignore[attr-defined]
            limits = self._validate_refund_origin_limit_or_raise(  # type: ignore[attr-defined]
                owner=owner,
                origin=origin,
                rows=rows,
                amount_usdc=amount_usdc,
            )

            pending = self._find_pending_refund(rows, owner)  # type: ignore[attr-defined]
            if pending is not None:
                return await self._handle_pending_refund(  # type: ignore[attr-defined]
                    pending=pending,
                    owner=owner,
                    amount_usdc=amount_usdc,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    redis_client=redis_client,
                    idem_rows=idem_rows,
                )

            now = int(time.time())
            refund_id = str(uuid4())
            signature = f"mock-refund-signature-{refund_id[:12]}"
            abnormal_split = self._detect_abnormal_split_refund(  # type: ignore[attr-defined]
                owner=owner, origin=origin, rows=rows, now=now
            )
            risk = self._classify_refund_risk(  # type: ignore[attr-defined]
                amount_usdc=amount_usdc,
                refund_type=refund_type,
                abnormal_split=abnormal_split,
            )

            self._reserve_owner_refund_amount(owner, amount_usdc)  # type: ignore[attr-defined]

            refund_row = RefundIntentRow(
                id=refund_id,
                ownerAddress=owner,
                amountUsdc=amount_usdc,
                reason=reason,
                status=risk["status"],
                signature=signature,
                gasPayer="OWNER",
                gasModel="OWNER_PAYS_ONCHAIN",
                originRequestId=origin.request_id,
                originTxHash=origin.tx_hash,
                refundType=refund_type,
                destinationAddress=destination_address,
                evidenceSummary=evidence_summary,
                riskLevel=risk["riskLevel"],
                riskReasonCode=risk["riskReasonCode"],
                message=risk["message"],
                idempotencyKey=idempotency_key,
                createdAt=now_dt_str(),
                updatedAt=now_dt_str(),
                requestMeta=request_meta or {},
            )
            rows.append(refund_row)
            self._save_refund_rows(rows, now)  # type: ignore[attr-defined]

            response = {
                "refundId": refund_id,
                "signature": signature,
                "amountRefunded": money_str(amount_usdc),
                "status": risk["status"],
                "gasPayer": "OWNER",
                "gasModel": "OWNER_PAYS_ONCHAIN",
                "riskLevel": risk["riskLevel"],
                "riskReasonCode": risk["riskReasonCode"],
                "message": risk["message"],
            }
            await self._finalize_refund_idempotency(  # type: ignore[attr-defined]
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
                redis_client=redis_client,
                idem_rows=idem_rows,
            )
            self._append_financial_audit(  # type: ignore[attr-defined]
                "REFUND_INTENT_CREATED",
                owner,
                {
                    "refundId": refund_id,
                    "amountUsdc": money_str(amount_usdc),
                    "originRequestId": origin.request_id,
                    "originTxHash": origin.tx_hash,
                    "refundType": refund_type,
                    "refundableTotal": limits["refundableTotal"],
                    "refundableRemaining": limits["remaining"],
                    "riskLevel": risk["riskLevel"],
                    "riskReasonCode": risk["riskReasonCode"],
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return response

    async def list_refunds(self, owner_wallet: str) -> RefundListResponse:
        import asyncio
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        rows = self._load_refund_rows()  # type: ignore[attr-defined]
        filtered = [
            row
            for row in rows
            if self._refund_owner(row) == normalized_owner  # type: ignore[attr-defined]
        ]
        filtered.sort(key=self._row_updated_at, reverse=True)  # type: ignore[attr-defined]
        return [row.model_dump(by_alias=True, mode="json") for row in filtered]

    async def complete_refund_intent(
        self,
        owner_wallet: str,
        refund_id: str,
        tx_hash: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> RefundResponse:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:refund_complete"):  # type: ignore[attr-defined]
            await self._enforce_owner_write_rate_limit(owner, "refund_complete")  # type: ignore[attr-defined]
            rows = self._load_refund_rows()  # type: ignore[attr-defined]
            target = self._find_refund_by_id(rows, owner, refund_id)  # type: ignore[attr-defined]
            if target is None:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "code": "REFUND_NOT_FOUND",
                        "message": "Refund intent not found.",
                    },
                )

            normalized_tx_hash = self._normalize_tx_hash_or_raise(tx_hash)  # type: ignore[attr-defined]
            completed = self._assert_refund_completable(target, normalized_tx_hash)  # type: ignore[attr-defined]
            if completed is not None:
                return completed

            used_atomic_complete = self._complete_refund_tx_atomic_or_raise(
                owner=owner,
                refund_id=refund_id,
                normalized_tx_hash=normalized_tx_hash,
            )
            if not used_atomic_complete:
                self._assert_no_refund_tx_replay(  # type: ignore[attr-defined]
                    rows, owner, normalized_tx_hash, str(target.id or "")
                )

            status = str(target.status or "").upper()
            review = self._parse_refund_review_context(request_meta)
            review_decision = review.decision
            reviewer_address = review.reviewer_address
            reviewer_note = review.reviewer_note
            amount_usdc = parse_usdc(target.amount_usdc)

            if status == "PENDING_MANUAL_REVIEW":
                if self._is_consumer_withdraw_row(target):
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "CONSUMER_WITHDRAW_REVIEW_PENDING",
                            "message": "Manual-review consumer withdrawal must be approved or rejected before completion.",
                        },
                    )
                reject_response = self._handle_manual_review_before_completion(
                    owner=owner,
                    rows=rows,
                    target=target,
                    amount_usdc=amount_usdc,
                    review_decision=review_decision,
                    reviewer_address=reviewer_address,
                    reviewer_note=reviewer_note,
                    request_meta=request_meta,
                )
                if reject_response is not None:
                    return reject_response

            if not used_atomic_complete:
                self._consume_locked_refund_amount(  # type: ignore[attr-defined]
                    owner,
                    amount_usdc,
                )
                accrue_consumer_withdraw_fee_after_fallback(self.storage, target)  # type: ignore[attr-defined]  # mixin has service storage
            return self._finalize_refund_completion(
                owner=owner,
                rows=rows,
                target=target,
                normalized_tx_hash=normalized_tx_hash,
                amount_usdc=amount_usdc,
                status_before=status,
                reviewer_address=reviewer_address,
                reviewer_note=reviewer_note,
                request_meta=request_meta,
            )

    async def fail_refund_intent(
        self,
        owner_wallet: str,
        refund_id: str,
        *,
        reason_code: str,
        message: str = "",
        tx_hash: str | None = None,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> RefundResponse:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:refund_fail"):  # type: ignore[attr-defined]
            await self._enforce_owner_write_rate_limit(owner, "refund_fail")  # type: ignore[attr-defined]
            rows = self._load_refund_rows()  # type: ignore[attr-defined]
            target = self._find_refund_by_id(rows, owner, refund_id)  # type: ignore[attr-defined]
            if target is None:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "code": "REFUND_NOT_FOUND",
                        "message": "Refund intent not found.",
                    },
                )

            status = str(target.status or "").upper()
            normalized_tx_hash = (
                self._normalize_tx_hash_or_raise(tx_hash)  # type: ignore[attr-defined]
                if tx_hash
                else ""
            )
            if status == "COMPLETED":
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "REFUND_ALREADY_COMPLETED",
                        "message": "Completed refund intent cannot be failed.",
                    },
                )
            if status in {"FAILED", "FAILED_EXPIRED", "REJECTED", "CANCELLED"}:
                return self._fail_response(target)
            if status not in REFUND_ACTIVE_STATUSES:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "REFUND_NOT_PENDING",
                        "message": f"Refund status={status} cannot be failed.",
                    },
                )

            amount_usdc = parse_usdc(target.amount_usdc)
            if status == "REQUESTED":
                self._release_consumer_pending_to_available(owner, amount_usdc)  # type: ignore[attr-defined]
            elif status == "PENDING_MANUAL_REVIEW":
                self._release_consumer_frozen_to_available(owner, amount_usdc)  # type: ignore[attr-defined]

            now = int(time.time())
            target.status = "FAILED"
            target.tx_hash = normalized_tx_hash or None
            target.updated_at = now_dt_str()
            target.completed_at = now
            target.message = message or f"Withdrawal failed ({reason_code})."
            target.complete_meta = {
                **(request_meta or {}),
                "note": reason_code,
            }
            self._save_refund_rows(rows, now)  # type: ignore[attr-defined]
            self._append_financial_audit(  # type: ignore[attr-defined]
                "CONSUMER_WITHDRAW_FAILED",
                owner,
                {
                    "refundId": str(target.id or ""),
                    "reasonCode": reason_code,
                    "message": target.message,
                    "txHash": normalized_tx_hash,
                    "amountUsdc": money_str(amount_usdc),
                    "requestMeta": request_meta or {},
                },
            )
            return self._fail_response(target)

    async def review_consumer_withdrawal(
        self,
        owner_wallet: str,
        refund_id: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> RefundResponse:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:consumer_withdraw_review"):  # type: ignore[attr-defined]
            await self._enforce_owner_write_rate_limit(owner, "consumer_withdraw_review")  # type: ignore[attr-defined]
            rows = self._load_refund_rows()  # type: ignore[attr-defined]
            target = self._find_refund_by_id(rows, owner, refund_id)  # type: ignore[attr-defined]
            if target is None:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "code": "REFUND_NOT_FOUND",
                        "message": "Refund intent not found.",
                    },
                )
            if not self._is_consumer_withdraw_row(target):
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "REFUND_REVIEW_NOT_SUPPORTED",
                        "message": "Only consumer withdrawal intents support this review endpoint.",
                    },
                )
            status = str(target.status or "").upper()
            if status == "REQUESTED" and str(target.review_decision or "").upper() == "APPROVE":
                return {
                    "refundId": str(target.id or ""),
                    "status": "REQUESTED",
                    "ticket": target.ticket.model_dump(by_alias=True, mode="json", exclude_none=True),
                    "reviewDecision": "APPROVE",
                }
            if status == "REJECTED":
                return {
                    "refundId": str(target.id or ""),
                    "status": "REJECTED",
                    "reviewDecision": str(target.review_decision or "REJECT"),
                }
            if status != "PENDING_MANUAL_REVIEW":
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "REFUND_NOT_PENDING_REVIEW",
                        "message": f"Refund status={status} cannot be reviewed.",
                    },
                )

            review = self._parse_refund_review_context(request_meta)
            if review.decision not in {"APPROVE", "REJECT"}:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INVALID_REVIEW_DECISION",
                        "message": "review decision must be APPROVE or REJECT.",
                    },
                )
            if not review.reviewer_address:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "REFUND_REVIEW_APPROVER_REQUIRED",
                        "message": "Manual review refunds require reviewerAddress.",
                    },
                )

            amount_usdc = parse_usdc(target.amount_usdc)

            if review.decision == "REJECT":
                return self._review_consumer_withdrawal_reject(
                    owner=owner,
                    rows=rows,
                    target=target,
                    amount_usdc=amount_usdc,
                    review=review,
                    request_meta=request_meta,
                )

            return self._review_consumer_withdrawal_approve(
                owner=owner,
                rows=rows,
                target=target,
                amount_usdc=amount_usdc,
                review=review,
                request_meta=request_meta,
            )
