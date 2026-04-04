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
from src.services.owner.finance_constants import REFUND_ACTIVE_STATUSES
from src.utils.datetime_utils import now_dt_str


class FinanceRefundExecMixin:
    """Refund execution: balance mutations, completion, and public refund methods."""

    def _release_locked_refund_to_available(
        self, owner: str, amount_usdc: float
    ) -> None:
        ledger = self._load_balance_ledger()  # type: ignore[attr-defined]
        consumer_wallet = ledger.ensure_consumer_wallet(owner)
        locked = round(float(consumer_wallet.pending_balance or 0.0), 6)
        if locked + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_LOCK_INCONSISTENT",
                    "message": "Locked owner balance is insufficient for refund rejection release.",
                },
            )
        consumer_wallet.pending_balance = round(max(0.0, locked - amount_usdc), 6)
        consumer_wallet.available_balance = round(
            float(consumer_wallet.available_balance or 0.0) + amount_usdc, 6
        )
        self._save_balance_ledger(ledger)  # type: ignore[attr-defined]

    def _parse_refund_review_context(
        self, request_meta: Optional[dict[str, Any]]
    ) -> RefundReviewContext:
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

    def _reject_refund_manual_review(
        self,
        *,
        owner: str,
        rows: List[RefundIntentRow],
        target: RefundIntentRow,
        amount_usdc: float,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        self._release_locked_refund_to_available(owner, amount_usdc)
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
                "amountUsdc": amount_usdc,
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
        amount_usdc: float,
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
        amount_usdc: float,
        status_before: str,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
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
                "amountUsdc": amount_usdc,
                "reviewDecision": str(target.review_decision or "APPROVE"),
                "reviewerAddress": str(target.reviewer_address or ""),
                "requestMeta": request_meta or {},
            },
        )
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
    ) -> dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:refund_intent"):  # type: ignore[attr-defined]
            idempotency_key = self._validate_idempotency_key(idempotency_key)  # type: ignore[attr-defined]
            await self._enforce_owner_write_rate_limit(owner, "refund_intent")  # type: ignore[attr-defined]

            ledger = self._load_balance_ledger()  # type: ignore[attr-defined]
            available_balance = ledger.consumer_available_balance(owner)
            context = self._parse_refund_create_context(  # type: ignore[attr-defined]
                payload, owner, available_balance
            )
            amount_usdc = context.amount_usdc
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
                amountUsdc=Decimal(str(round(amount_usdc, 6))),
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
                "amountRefunded": round(amount_usdc, 6),
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
                    "amountUsdc": round(amount_usdc, 6),
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

    async def list_refunds(self, owner_wallet: str) -> List[dict[str, Any]]:
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
    ) -> dict[str, Any]:
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
            if hasattr(self.storage, "complete_withdraw_tx_atomic"):  # type: ignore[attr-defined]
                bound = bool(
                    getattr(self.storage, "complete_withdraw_tx_atomic")(  # type: ignore[attr-defined]
                        CompleteWithdrawTxCommand(
                            owner_wallet=owner,
                            tx_hash=normalized_tx_hash,
                            kind="owner_refund",
                        )
                    )
                )
                if not bound:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "REFUND_TX_REPLAY_DETECTED",
                            "message": "txHash is already bound to another refund intent.",
                        },
                    )
            self._assert_no_refund_tx_replay(  # type: ignore[attr-defined]
                rows, owner, normalized_tx_hash, str(target.id or "")
            )
            completed = self._assert_refund_completable(target, normalized_tx_hash)  # type: ignore[attr-defined]
            if completed is not None:
                return completed

            status = str(target.status or "").upper()
            review = self._parse_refund_review_context(request_meta)
            review_decision = review.decision
            reviewer_address = review.reviewer_address
            reviewer_note = review.reviewer_note
            amount_usdc = round(float(target.amount_usdc or 0.0), 6)

            if status == "PENDING_MANUAL_REVIEW":
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

            self._consume_locked_refund_amount(owner, amount_usdc)  # type: ignore[attr-defined]
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
