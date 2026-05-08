"""Refund analysis and parsing helpers mixin.

Contains all the parsing, validation, risk classification, and read-query
methods for the refund workflow. Does not mutate the balance ledger or write
to storage — those operations live in FinanceRefundExecMixin.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any, List, Optional

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.domain.finance import (
    RefundCreateContext,
    RefundIntentRow,
    RefundOriginRef,
)
from src.services.owner.finance_constants import (
    REFUND_ACTIVE_STATUSES,
    REFUND_AUTO_TYPE,
    REFUND_MANUAL_REVIEW_THRESHOLD_USDC,
    REFUND_MANUAL_TYPE,
)
from src.utils.money import money_str, parse_usdc

REFUND_MIN_USDC = Decimal("10")
REFUND_ABNORMAL_SPLIT_MIN_COUNT = 2
REFUND_REASON_MAX_CHARS = 256
REFUND_EVIDENCE_SUMMARY_MAX_CHARS = 512


class FinanceRefundAnalysisMixin:
    """Refund analysis helpers — no balance mutations here."""

    def _parse_refund_amount_usdc(
        self, payload: dict[str, Any], available: Decimal | str | int
    ) -> Decimal:
        raw = payload.get("amountUsdc")
        try:
            amount = parse_usdc(raw)
        except Exception as exc:  # pragma: no cover: human-review-required E2E report
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be a number.",
                },
            ) from exc
        if amount < REFUND_MIN_USDC:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be >= 10 USDC.",
                },
            )
        if amount > parse_usdc(available):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INSUFFICIENT_OWNER_BALANCE",
                    "message": "amountUsdc exceeds owner available balance.",
                },
            )
        return amount

    def _find_pending_refund(
        self, rows: List[RefundIntentRow], owner_wallet: str
    ) -> Optional[RefundIntentRow]:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if self._refund_owner(row) != owner:  # type: ignore[attr-defined]
                continue
            if str(row.status or "").upper() in REFUND_ACTIVE_STATUSES:
                return row
        return None

    def _find_refund_by_id(
        self, rows: List[RefundIntentRow], owner_wallet: str, refund_id: str
    ) -> Optional[RefundIntentRow]:
        owner = normalize_wallet(owner_wallet)
        target = str(refund_id or "").strip()
        if not target:
            return None
        for row in rows:
            if str(row.id or "") != target:
                continue
            if self._refund_owner(row) != owner:  # type: ignore[attr-defined]
                continue
            return row
        return None

    def _build_pending_refund_response(self, row: RefundIntentRow) -> dict[str, Any]:
        return {
            "refundId": str(row.id or ""),
            "signature": str(row.signature or ""),
            "amountRefunded": money_str(row.amount_usdc),
            "status": str(row.status or "REQUESTED"),
            "gasPayer": str(row.gas_payer or "OWNER"),
            "gasModel": str(row.gas_model or "OWNER_PAYS_ONCHAIN"),
            "riskLevel": str(row.risk_level or "green"),
            "riskReasonCode": str(row.risk_reason_code or ""),
            "message": str(row.message or ""),
        }

    def _parse_refund_origin(self, payload: dict[str, Any]) -> RefundOriginRef:
        origin_request_id = str(payload.get("originRequestId") or "").strip()
        origin_tx_hash = str(payload.get("originTxHash") or "").strip().lower()
        if not origin_request_id and not origin_tx_hash:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "REFUND_ORIGIN_REQUIRED",
                    "message": "originRequestId or originTxHash is required.",
                },
            )
        if origin_tx_hash:
            origin_tx_hash = self._normalize_tx_hash_or_raise(origin_tx_hash)  # type: ignore[attr-defined]
        return RefundOriginRef(
            request_id=origin_request_id,
            tx_hash=origin_tx_hash,
        )

    def _validate_refund_destination(self, owner: str, payload: dict[str, Any]) -> None:
        destination = str(payload.get("destinationAddress") or "").strip().lower()
        if destination and normalize_wallet(destination) != owner:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "REFUND_DESTINATION_NOT_ALLOWED",
                    "message": "Refund destination must equal original payer address.",
                },
            )

    def _resolve_refund_type(self, payload: dict[str, Any]) -> str:
        refund_type = str(payload.get("refundType") or REFUND_AUTO_TYPE).strip().upper()
        if refund_type not in {REFUND_AUTO_TYPE, REFUND_MANUAL_TYPE}:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_REFUND_TYPE",
                    "message": "refundType must be SYSTEM_FAILURE or MANUAL_APPEAL.",
                },
            )
        return refund_type

    def _origin_matches(self, row: Any, origin: RefundOriginRef) -> bool:
        origin_request_id = getattr(row, "origin_request_id", None)
        origin_tx_hash = getattr(row, "origin_tx_hash", None)
        req_hit = (
            bool(origin.request_id)
            and str(origin_request_id or "") == origin.request_id
        )
        tx_hit = (
            bool(origin.tx_hash)
            and str(origin_tx_hash or "").lower() == origin.tx_hash
        )
        return req_hit or tx_hit

    def _compute_refund_origin_limits(
        self,
        *,
        owner: str,
        origin: RefundOriginRef,
        rows: List[RefundIntentRow],
    ) -> dict[str, Decimal]:
        refundable_total = self._sum_refundable_usage_total(owner=owner, origin=origin)
        consumed = self._sum_consumed_refunds(owner=owner, origin=origin, rows=rows)
        return {
            "refundableTotal": refundable_total,
            "alreadyConsumed": consumed,
            "remaining": parse_usdc(max(Decimal("0"), refundable_total - consumed)),
        }

    def _sum_refundable_usage_total(
        self, *, owner: str, origin: RefundOriginRef
    ) -> Decimal:
        usage_rows = self._load_invocation_billing_rows()  # type: ignore[attr-defined]
        refundable_total = Decimal("0")
        for usage in usage_rows:
            if normalize_wallet(str(usage.consumer_address or "")) != owner:
                continue
            status = str(usage.status or "").strip().lower()
            if status not in {"succeeded", "success", "completed", "accepted"}:
                continue
            if not self._origin_matches(usage, origin):
                continue
            refundable_total = parse_usdc(refundable_total + parse_usdc(usage.total_charge))
        return refundable_total

    def _sum_consumed_refunds(
        self, *, owner: str, origin: RefundOriginRef, rows: List[RefundIntentRow]
    ) -> Decimal:
        consumed = Decimal("0")
        for row in rows:
            if self._refund_owner(row) != owner:  # type: ignore[attr-defined]
                continue
            if not self._origin_matches(row, origin):
                continue
            if str(row.status or "").upper() == "REJECTED":
                continue
            consumed = parse_usdc(consumed + parse_usdc(row.amount_usdc))
        return consumed

    def _detect_abnormal_split_refund(
        self,
        *,
        owner: str,
        origin: Any,
        rows: List[RefundIntentRow],
        now: int,
    ) -> bool:
        cutoff = now - 24 * 3600
        count = 0
        for row in rows:
            if self._refund_owner(row) != owner:  # type: ignore[attr-defined]
                continue
            if not self._origin_matches(row, origin):
                continue
            if self._row_updated_at(row) < cutoff:  # type: ignore[attr-defined]
                continue
            if str(row.status or "").upper() == "REJECTED":
                continue
            count += 1
        return count >= REFUND_ABNORMAL_SPLIT_MIN_COUNT

    def _classify_refund_risk(
        self, *, amount_usdc: Decimal | str | int, refund_type: str, abnormal_split: bool
    ) -> dict[str, str]:
        amount = parse_usdc(amount_usdc)
        if abnormal_split:
            return {
                "status": "PENDING_MANUAL_REVIEW",
                "riskLevel": "red",
                "riskReasonCode": "ABNORMAL_SPLIT_REFUND_PATTERN",
                "message": "Refund submitted for manual risk review.",
            }
        if amount >= Decimal(str(REFUND_MANUAL_REVIEW_THRESHOLD_USDC)).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        ):
            return {
                "status": "PENDING_MANUAL_REVIEW",
                "riskLevel": "yellow",
                "riskReasonCode": "LARGE_REFUND_REQUIRES_MANUAL_REVIEW",
                "message": "Large refund requires manual review (ETA: 12-24 hrs).",
            }
        if refund_type == REFUND_MANUAL_TYPE:
            return {
                "status": "PENDING_MANUAL_REVIEW",
                "riskLevel": "yellow",
                "riskReasonCode": "MANUAL_APPEAL_REQUIRES_REVIEW",
                "message": "Manual appeal refund requires reviewer approval.",
            }
        return {
            "status": "REQUESTED",
            "riskLevel": "green",
            "riskReasonCode": "",
            "message": "",
        }

    def _assert_no_refund_tx_replay(
        self,
        rows: List[RefundIntentRow],
        owner_wallet: str,
        tx_hash: str,
        current_refund_id: str,
    ) -> None:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if self._refund_owner(row) != owner:  # type: ignore[attr-defined]
                continue
            if str(row.id or "") == current_refund_id:
                continue
            if str(row.tx_hash or "").strip().lower() != tx_hash:
                continue
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_TX_REPLAY_DETECTED",
                    "message": "txHash is already bound to another refund intent.",
                },
            )

    def _assert_refund_completable(
        self, target: RefundIntentRow, tx_hash: str
    ) -> Optional[dict[str, Any]]:
        status = str(target.status or "").upper()
        if status == "COMPLETED":
            existing_tx = str(target.tx_hash or "")
            if existing_tx and existing_tx != tx_hash:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "REFUND_ALREADY_COMPLETED",
                        "message": "Refund already completed with a different txHash.",
                    },
                )
            return {
                "refundId": str(target.id or ""),
                "status": "COMPLETED",
                "txHash": existing_tx,
                "idempotentReplay": True,
            }
        if status not in REFUND_ACTIVE_STATUSES:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_NOT_PENDING",
                    "message": f"Refund status={status} cannot be completed.",
                },
            )
        return None

    def _validate_refund_origin_limit_or_raise(
        self,
        *,
        owner: str,
        origin: RefundOriginRef,
        rows: List[RefundIntentRow],
        amount_usdc: Decimal | str | int,
    ) -> dict[str, Decimal]:
        amount = parse_usdc(amount_usdc)
        limits = self._compute_refund_origin_limits(
            owner=owner, origin=origin, rows=rows
        )
        if limits["refundableTotal"] <= 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "REFUND_ORIGIN_NOT_FOUND",
                    "message": "No refundable completed charge found for provided origin reference.",
                },
            )
        if amount > limits["remaining"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "REFUND_EXCEEDS_ORIGIN_LIMIT",
                    "message": "Requested refund exceeds remaining refundable amount of the original charge.",
                },
            )
        return limits

    def _parse_refund_create_context(
        self, payload: dict[str, Any], owner: str, available_balance: Decimal | str | int
    ) -> RefundCreateContext:
        amount_usdc = self._parse_refund_amount_usdc(payload, available_balance)
        reason = str(payload.get("reason") or "").strip()
        if len(reason) > REFUND_REASON_MAX_CHARS:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_REASON",
                    "message": "reason must be <= 256 chars.",
                },
            )
        evidence_summary = str(payload.get("evidenceSummary") or "").strip()
        if len(evidence_summary) > REFUND_EVIDENCE_SUMMARY_MAX_CHARS:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_EVIDENCE_SUMMARY",
                    "message": "evidenceSummary must be <= 512 chars.",
                },
            )
        origin = self._parse_refund_origin(payload)
        self._validate_refund_destination(owner, payload)
        refund_type = self._resolve_refund_type(payload)
        destination_address = normalize_wallet(
            str(payload.get("destinationAddress") or owner)
        )
        request_payload = {
            "ownerAddress": owner,
            "amountUsdc": money_str(amount_usdc),
            "reason": reason,
            "originRequestId": origin.request_id,
            "originTxHash": origin.tx_hash,
            "refundType": refund_type,
            "destinationAddress": destination_address,
            "evidenceSummary": evidence_summary,
        }
        return RefundCreateContext(
            amount_usdc=amount_usdc,
            reason=reason,
            evidence_summary=evidence_summary,
            origin=origin,
            refund_type=refund_type,
            destination_address=destination_address,
            request_hash=self._request_hash(request_payload),  # type: ignore[attr-defined]
        )
