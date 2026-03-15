from typing import Any, Dict, List, Optional
import asyncio
import time
from uuid import uuid4
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.redis_lock import RedisLockManager
from src.services.balance_mixins import BalanceAuditMixin, BalanceRedisGuardMixin
from src.services.repository_access import balance_repo, gateway_state_repo
from src.storage.base import BaseStorage


REFUND_MANUAL_REVIEW_THRESHOLD_USDC = 500.0
REFUND_AUTO_TYPE = "SYSTEM_FAILURE"
REFUND_MANUAL_TYPE = "MANUAL_APPEAL"
REFUND_ACTIVE_STATUSES = {"PENDING", "PENDING_MANUAL_REVIEW"}


class BuyerFinanceService(BalanceAuditMixin, BalanceRedisGuardMixin):
    """Buyer-side funding/refund domain service (deposit + refund)."""

    def __init__(
        self,
        storage: BaseStorage,
        mutation_lock: RedisLockManager,
        guard_delegate: Optional[BalanceRedisGuardMixin] = None,
    ):
        self.storage = storage
        self._mutation_lock = mutation_lock
        self._guard_delegate = guard_delegate

    async def _get_redis_client(self):
        if self._guard_delegate is not None:
            return await self._guard_delegate._get_redis_client()  # type: ignore[attr-defined]
        return await super()._get_redis_client()

    def _normalize_intents(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("intents"), list):
            return [item for item in raw["intents"] if isinstance(item, dict)]
        return []

    def _normalize_rows(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("rows"), list):
            return [item for item in raw["rows"] if isinstance(item, dict)]
        return []

    def _load_balance_ledger(self) -> Dict[str, Any]:
        ledger = balance_repo(self.storage).read_balance_ledger() or {}
        if not isinstance(ledger, dict):
            ledger = {}
        buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
        buyers_locked = ledger.get("buyersLocked") if isinstance(ledger.get("buyersLocked"), dict) else {}
        buyers_frozen = ledger.get("buyersFrozen") if isinstance(ledger.get("buyersFrozen"), dict) else {}
        sellers = ledger.get("sellers") if isinstance(ledger.get("sellers"), dict) else {}
        sellers_locked = ledger.get("sellersLocked") if isinstance(ledger.get("sellersLocked"), dict) else {}
        sellers_frozen = ledger.get("sellersFrozen") if isinstance(ledger.get("sellersFrozen"), dict) else {}
        platform = ledger.get("platform") if isinstance(ledger.get("platform"), dict) else {}
        platform.setdefault("feeAccrued", 0.0)
        ledger["buyers"] = buyers
        ledger["buyersLocked"] = buyers_locked
        ledger["buyersFrozen"] = buyers_frozen
        ledger["sellers"] = sellers
        ledger["sellersLocked"] = sellers_locked
        ledger["sellersFrozen"] = sellers_frozen
        ledger["platform"] = platform
        ledger.setdefault("updatedAt", int(time.time()))
        return ledger

    def _save_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        next_ledger = dict(ledger)
        next_ledger["updatedAt"] = int(time.time())
        balance_repo(self.storage).write_balance_ledger(next_ledger)

    def _load_deposit_intents(self) -> List[Dict[str, Any]]:
        rows = gateway_state_repo(self.storage).read_deposit_intents()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def _save_deposit_intents(self, rows: List[Dict[str, Any]]) -> None:
        gateway_state_repo(self.storage).write_deposit_intents(rows)

    def _load_refund_intents(self) -> List[Dict[str, Any]]:
        rows = gateway_state_repo(self.storage).read_refund_intents()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def _save_refund_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        gateway_state_repo(self.storage).write_refund_intents(rows, int(updated_at))

    def _load_usage_log_rows(self) -> List[Dict[str, Any]]:
        rows = gateway_state_repo(self.storage).read_usage_log_rows()
        return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []

    def _reserve_pending_deposit_amount(self, owner: str, amount_usdc: Decimal) -> None:
        ledger = self._load_balance_ledger()
        buyers = ledger.get("buyers", {})
        buyers_locked = ledger.get("buyersLocked", {})
        buyers.setdefault(owner, round(float(buyers.get(owner, 0.0)), 6))
        buyers_locked[owner] = round(float(buyers_locked.get(owner, 0.0)) + float(amount_usdc), 6)
        ledger["buyers"] = buyers
        ledger["buyersLocked"] = buyers_locked
        self._save_balance_ledger(ledger)

    def _confirm_pending_deposit_amount(self, owner: str, amount_usdc: Decimal) -> Dict[str, float]:
        ledger = self._load_balance_ledger()
        buyers = ledger.get("buyers", {})
        buyers_locked = ledger.get("buyersLocked", {})
        available_before = round(float(buyers.get(owner, 0.0)), 6)
        pending_before = round(float(buyers_locked.get(owner, 0.0)), 6)
        amount = round(float(amount_usdc), 6)
        if pending_before + 1e-9 < amount:
            raise RuntimeError("DEPOSIT_PENDING_BALANCE_INCONSISTENT")

        buyers[owner] = round(available_before + amount, 6)
        buyers_locked[owner] = round(max(0.0, pending_before - amount), 6)
        ledger["buyers"] = buyers
        ledger["buyersLocked"] = buyers_locked
        self._save_balance_ledger(ledger)
        return {
            "availableBefore": available_before,
            "availableAfter": round(float(buyers[owner]), 6),
            "pendingBefore": pending_before,
            "pendingAfter": round(float(buyers_locked[owner]), 6),
        }

    def _parse_refund_amount_usdc(self, payload: Dict[str, Any], available: float) -> float:
        raw = payload.get("amountUsdc")
        try:
            amount = round(float(raw), 6)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be a number."},
            )

        if amount < 10:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be >= 10 USDC."},
            )
        if amount > available:
            raise HTTPException(
                status_code=400,
                detail={"code": "INSUFFICIENT_BUYER_BALANCE", "message": "amountUsdc exceeds buyer available balance."},
            )
        return amount

    def _find_pending_refund(self, rows: List[Dict[str, Any]], owner_wallet: str) -> Optional[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("status") or "").upper() in REFUND_ACTIVE_STATUSES:
                return row
        return None

    def _find_refund_by_id(self, rows: List[Dict[str, Any]], owner_wallet: str, refund_id: str) -> Optional[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        target = str(refund_id or "").strip()
        if not target:
            return None
        for row in rows:
            if str(row.get("id") or "") != target:
                continue
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            return row
        return None

    def _build_pending_refund_response(self, row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "refundId": str(row.get("id") or ""),
            "signature": str(row.get("signature") or ""),
            "amountRefunded": round(float(row.get("amountUsdc") or 0.0), 6),
            "status": str(row.get("status") or "PENDING"),
            "gasPayer": "BUYER",
            "gasModel": "BUYER_PAYS_ONCHAIN",
            "riskLevel": str(row.get("riskLevel") or "green"),
            "riskReasonCode": str(row.get("riskReasonCode") or ""),
            "message": str(row.get("message") or ""),
        }

    def _parse_refund_origin(self, payload: Dict[str, Any]) -> Dict[str, str]:
        origin_request_id = str(payload.get("originRequestId") or "").strip()
        origin_tx_hash = str(payload.get("originTxHash") or "").strip().lower()
        if not origin_request_id and not origin_tx_hash:
            raise HTTPException(
                status_code=400,
                detail={"code": "REFUND_ORIGIN_REQUIRED", "message": "originRequestId or originTxHash is required."},
            )
        if origin_tx_hash:
            origin_tx_hash = self._normalize_tx_hash_or_raise(origin_tx_hash)
        return {
            "originRequestId": origin_request_id,
            "originTxHash": origin_tx_hash,
        }

    def _validate_refund_destination(self, owner: str, payload: Dict[str, Any]) -> None:
        destination = str(payload.get("destinationAddress") or "").strip().lower()
        if destination and normalize_wallet(destination) != owner:
            raise HTTPException(
                status_code=400,
                detail={"code": "REFUND_DESTINATION_NOT_ALLOWED", "message": "Refund destination must equal original payer address."},
            )

    def _resolve_refund_type(self, payload: Dict[str, Any]) -> str:
        refund_type = str(payload.get("refundType") or REFUND_AUTO_TYPE).strip().upper()
        if refund_type not in {REFUND_AUTO_TYPE, REFUND_MANUAL_TYPE}:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_REFUND_TYPE", "message": "refundType must be SYSTEM_FAILURE or MANUAL_APPEAL."},
            )
        return refund_type

    def _origin_matches(self, row: Dict[str, Any], origin: Dict[str, str]) -> bool:
        req_hit = bool(origin["originRequestId"]) and str(row.get("originRequestId") or "") == origin["originRequestId"]
        tx_hit = bool(origin["originTxHash"]) and str(row.get("originTxHash") or "").lower() == origin["originTxHash"]
        return req_hit or tx_hit

    def _row_numeric(self, row: Dict[str, Any], *keys: str) -> float:
        for key in keys:
            if key not in row:
                continue
            try:
                return round(float(row.get(key) or 0.0), 6)
            except Exception:
                continue
        return 0.0

    def _compute_refund_origin_limits(
        self,
        *,
        owner: str,
        origin: Dict[str, str],
        rows: List[Dict[str, Any]],
    ) -> Dict[str, float]:
        refundable_total = self._sum_refundable_usage_total(owner=owner, origin=origin)
        consumed = self._sum_consumed_refunds(owner=owner, origin=origin, rows=rows)
        return {
            "refundableTotal": refundable_total,
            "alreadyConsumed": consumed,
            "remaining": round(max(0.0, refundable_total - consumed), 6),
        }

    def _sum_refundable_usage_total(self, *, owner: str, origin: Dict[str, str]) -> float:
        usage_rows = self._load_usage_log_rows()
        refundable_total = 0.0
        for usage in usage_rows:
            if normalize_wallet(str(usage.get("buyer") or "")) != owner:
                continue
            status = str(usage.get("status") or "").strip().lower()
            if status not in {"succeeded", "success", "completed", "accepted"}:
                continue
            if not self._origin_matches(usage, origin):
                continue
            refundable_total = round(refundable_total + self._row_numeric(usage, "total_charge", "totalCharge"), 6)
        return refundable_total

    def _sum_consumed_refunds(self, *, owner: str, origin: Dict[str, str], rows: List[Dict[str, Any]]) -> float:
        consumed = 0.0
        for row in rows:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if not self._origin_matches(row, origin):
                continue
            if str(row.get("status") or "").upper() == "REJECTED":
                continue
            consumed = round(consumed + self._row_numeric(row, "amountUsdc", "amountRefunded"), 6)
        return consumed

    def _detect_abnormal_split_refund(
        self,
        *,
        owner: str,
        origin: Dict[str, str],
        rows: List[Dict[str, Any]],
        now: int,
    ) -> bool:
        cutoff = now - 24 * 3600
        count = 0
        for row in rows:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if not self._origin_matches(row, origin):
                continue
            if int(row.get("createdAt") or 0) < cutoff:
                continue
            if str(row.get("status") or "").upper() == "REJECTED":
                continue
            count += 1
        return count >= 2

    def _classify_refund_risk(self, *, amount_usdc: float, refund_type: str, abnormal_split: bool) -> Dict[str, str]:
        if abnormal_split:
            return {
                "status": "PENDING_MANUAL_REVIEW",
                "riskLevel": "red",
                "riskReasonCode": "ABNORMAL_SPLIT_REFUND_PATTERN",
                "message": "Refund submitted for manual risk review.",
            }
        if amount_usdc >= REFUND_MANUAL_REVIEW_THRESHOLD_USDC:
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
            "status": "PENDING",
            "riskLevel": "green",
            "riskReasonCode": "",
            "message": "",
        }

    def _normalize_tx_hash_or_raise(self, tx_hash: str) -> str:
        normalized = str(tx_hash or "").strip().lower()
        if not normalized.startswith("0x") or len(normalized) != 66:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_TX_HASH", "message": "txHash must be a 66-char 0x-prefixed hash."},
            )
        return normalized

    def _assert_no_refund_tx_replay(
        self,
        rows: List[Dict[str, Any]],
        owner_wallet: str,
        tx_hash: str,
        current_refund_id: str,
    ) -> None:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("id") or "") == current_refund_id:
                continue
            if str(row.get("txHash") or "").strip().lower() != tx_hash:
                continue
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_TX_REPLAY_DETECTED",
                    "message": "txHash is already bound to another refund intent.",
                },
            )

    def _assert_refund_completable(self, target: Dict[str, Any], tx_hash: str) -> Optional[Dict[str, Any]]:
        status = str(target.get("status") or "").upper()
        if status == "COMPLETED":
            existing_tx = str(target.get("txHash") or "")
            if existing_tx and existing_tx != tx_hash:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "REFUND_ALREADY_COMPLETED",
                        "message": "Refund already completed with a different txHash.",
                    },
                )
            return {
                "refundId": str(target.get("id") or ""),
                "status": "COMPLETED",
                "txHash": existing_tx,
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

    def _consume_locked_refund_amount(self, owner: str, amount_usdc: float) -> None:
        ledger = self._load_balance_ledger()
        buyers_locked = ledger.get("buyersLocked", {})
        locked = round(float(buyers_locked.get(owner, 0.0)), 6)
        if locked + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_LOCK_INCONSISTENT",
                    "message": "Locked buyer balance is insufficient for this refund intent.",
                },
            )
        buyers_locked[owner] = round(max(0.0, locked - amount_usdc), 6)
        ledger["buyersLocked"] = buyers_locked
        self._save_balance_ledger(ledger)

    def _reserve_buyer_refund_amount(self, owner: str, amount_usdc: float) -> None:
        ledger = self._load_balance_ledger()
        buyers = ledger.get("buyers", {})
        buyers_locked = ledger.get("buyersLocked", {})
        available_balance = round(float(buyers.get(owner, 0.0)), 6)
        if amount_usdc > available_balance:
            raise HTTPException(
                status_code=400,
                detail={"code": "INSUFFICIENT_BUYER_BALANCE", "message": "amountUsdc exceeds buyer available balance."},
            )
        buyers[owner] = round(float(buyers.get(owner, 0.0)) - amount_usdc, 6)
        buyers_locked[owner] = round(float(buyers_locked.get(owner, 0.0)) + amount_usdc, 6)
        ledger["buyers"] = buyers
        ledger["buyersLocked"] = buyers_locked
        self._save_balance_ledger(ledger)

    async def _finalize_refund_idempotency(
        self,
        *,
        owner: str,
        idempotency_key: str,
        request_hash: str,
        response: Dict[str, Any],
        redis_client: Optional[Any],
        idem_rows: List[Dict[str, Any]],
    ) -> None:
        if redis_client is None:
            self._record_idempotent_response(
                rows=idem_rows,
                scope="refund_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
            )
        await self._complete_idempotency_redis(
            scope="refund_intent",
            owner_wallet=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response=response,
        )

    async def _handle_pending_refund(
        self,
        *,
        pending: Dict[str, Any],
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_hash: str,
        redis_client: Optional[Any],
        idem_rows: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        pending_amount = round(float(pending.get("amountUsdc") or 0.0), 6)
        if pending_amount != amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "PENDING_REFUND_EXISTS",
                    "message": "A pending refund already exists. Complete it before creating a new one.",
                },
            )
        response = self._build_pending_refund_response(pending)
        await self._finalize_refund_idempotency(
            owner=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response=response,
            redis_client=redis_client,
            idem_rows=idem_rows,
        )
        return response

    def _parse_refund_create_context(self, payload: Dict[str, Any], owner: str, available_balance: float) -> Dict[str, Any]:
        amount_usdc = self._parse_refund_amount_usdc(payload, available_balance)
        reason = str(payload.get("reason") or "").strip()
        if len(reason) > 256:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_REASON", "message": "reason must be <= 256 chars."},
            )
        evidence_summary = str(payload.get("evidenceSummary") or "").strip()
        if len(evidence_summary) > 512:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_EVIDENCE_SUMMARY", "message": "evidenceSummary must be <= 512 chars."},
            )
        origin = self._parse_refund_origin(payload)
        self._validate_refund_destination(owner, payload)
        refund_type = self._resolve_refund_type(payload)
        destination_address = normalize_wallet(str(payload.get("destinationAddress") or owner))
        request_payload = {
            "ownerAddress": owner,
            "amountUsdc": round(amount_usdc, 6),
            "reason": reason,
            "originRequestId": origin["originRequestId"],
            "originTxHash": origin["originTxHash"],
            "refundType": refund_type,
            "destinationAddress": destination_address,
            "evidenceSummary": evidence_summary,
        }
        return {
            "amountUsdc": amount_usdc,
            "reason": reason,
            "evidenceSummary": evidence_summary,
            "origin": origin,
            "refundType": refund_type,
            "destinationAddress": destination_address,
            "requestHash": self._request_hash(request_payload),
        }

    def _validate_refund_origin_limit_or_raise(self, *, owner: str, origin: Dict[str, str], rows: List[Dict[str, Any]], amount_usdc: float) -> Dict[str, float]:
        limits = self._compute_refund_origin_limits(owner=owner, origin=origin, rows=rows)
        if limits["refundableTotal"] <= 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "REFUND_ORIGIN_NOT_FOUND",
                    "message": "No refundable completed charge found for provided origin reference.",
                },
            )
        if amount_usdc > limits["remaining"] + 1e-9:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "REFUND_EXCEEDS_ORIGIN_LIMIT",
                    "message": "Requested refund exceeds remaining refundable amount of the original charge.",
                },
            )
        return limits

    def _release_locked_refund_to_available(self, owner: str, amount_usdc: float) -> None:
        ledger = self._load_balance_ledger()
        buyers = ledger.get("buyers", {})
        buyers_locked = ledger.get("buyersLocked", {})
        locked = round(float(buyers_locked.get(owner, 0.0)), 6)
        if locked + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_LOCK_INCONSISTENT",
                    "message": "Locked buyer balance is insufficient for refund rejection release.",
                },
            )
        buyers_locked[owner] = round(max(0.0, locked - amount_usdc), 6)
        buyers[owner] = round(float(buyers.get(owner, 0.0)) + amount_usdc, 6)
        ledger["buyers"] = buyers
        ledger["buyersLocked"] = buyers_locked
        self._save_balance_ledger(ledger)

    def _parse_refund_review_context(self, request_meta: Optional[Dict[str, Any]]) -> Dict[str, str]:
        review_ctx = request_meta.get("review") if isinstance(request_meta, dict) and isinstance(request_meta.get("review"), dict) else {}
        reviewer_address = normalize_wallet(str(review_ctx.get("reviewerAddress") or "")) if review_ctx.get("reviewerAddress") else ""
        return {
            "decision": str(review_ctx.get("decision") or "APPROVE").strip().upper(),
            "reviewerAddress": reviewer_address,
            "reviewerNote": str(review_ctx.get("reviewerNote") or "").strip(),
        }

    def _reject_refund_manual_review(
        self,
        *,
        owner: str,
        rows: List[Dict[str, Any]],
        target: Dict[str, Any],
        amount_usdc: float,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        self._release_locked_refund_to_available(owner, amount_usdc)
        now = int(time.time())
        target["status"] = "REJECTED"
        target["reviewDecision"] = "REJECT"
        target["reviewerAddress"] = reviewer_address
        target["reviewerNote"] = reviewer_note
        target["reviewedAt"] = now
        target["updatedAt"] = now
        target["completeMeta"] = request_meta or {}
        self._save_refund_intents(rows, now)
        self._append_financial_audit(
            "REFUND_INTENT_REJECTED",
            owner,
            {
                "refundId": str(target.get("id") or ""),
                "amountUsdc": amount_usdc,
                "reviewerAddress": reviewer_address,
                "reviewerNote": reviewer_note,
                "requestMeta": request_meta or {},
            },
        )
        return {
            "refundId": str(target.get("id") or ""),
            "status": "REJECTED",
            "txHash": "",
        }

    def _handle_manual_review_before_completion(
        self,
        *,
        owner: str,
        rows: List[Dict[str, Any]],
        target: Dict[str, Any],
        amount_usdc: float,
        review_decision: str,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
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
        rows: List[Dict[str, Any]],
        target: Dict[str, Any],
        normalized_tx_hash: str,
        amount_usdc: float,
        status_before: str,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        now = int(time.time())
        target["status"] = "COMPLETED"
        target["txHash"] = normalized_tx_hash
        if status_before == "PENDING_MANUAL_REVIEW":
            target["reviewDecision"] = "APPROVE"
            target["reviewerAddress"] = reviewer_address
            target["reviewerNote"] = reviewer_note
            target["reviewedAt"] = now
        target["completedAt"] = now
        target["updatedAt"] = now
        target["completeMeta"] = request_meta or {}
        self._save_refund_intents(rows, now)

        self._append_financial_audit(
            "REFUND_INTENT_COMPLETED",
            owner,
            {
                "refundId": str(target.get("id") or ""),
                "txHash": normalized_tx_hash,
                "amountUsdc": amount_usdc,
                "reviewDecision": str(target.get("reviewDecision") or "APPROVE"),
                "reviewerAddress": str(target.get("reviewerAddress") or ""),
                "requestMeta": request_meta or {},
            },
        )
        return {
            "refundId": str(target.get("id") or ""),
            "status": "COMPLETED",
            "txHash": normalized_tx_hash,
        }

    async def _begin_deposit_idempotency(
        self,
        *,
        owner: str,
        idempotency_key: str,
        request_hash: str,
    ) -> tuple[Optional[Dict[str, Any]], Optional[Any], List[Dict[str, Any]]]:
        redis_client = await self._get_redis_client()
        redis_hit = await self._check_idempotency_redis(
            scope="deposit_intent",
            owner_wallet=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if redis_hit is not None:
            return redis_hit, redis_client, []

        started = await self._start_idempotency_redis(
            scope="deposit_intent",
            owner_wallet=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if not started:
            redis_retry = await self._check_idempotency_redis(
                scope="deposit_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if redis_retry is not None:
                return redis_retry, redis_client, []

        idem_rows: List[Dict[str, Any]] = []
        if redis_client is None:
            idem_rows = self._load_idempotency_rows()
            idem_hit = self._try_get_idempotent_response(
                rows=idem_rows,
                scope="deposit_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if idem_hit is not None:
                return idem_hit, redis_client, idem_rows

        return None, redis_client, idem_rows

    def _persist_deposit_intent(
        self,
        *,
        owner: str,
        tx_hash: str,
        amount_usdc: Decimal,
        idempotency_key: str,
        intent: Dict[str, Any],
        intents: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        now = int(time.time())
        next_intent = dict(intent)
        next_intent["ownerAddress"] = owner
        next_intent["buyerAddress"] = owner
        next_intent["txHash"] = tx_hash
        next_intent["amountUsdc"] = float(amount_usdc)
        next_intent["idempotencyKey"] = idempotency_key
        next_intent.setdefault("id", str(uuid4()))
        next_intent.setdefault("status", "PENDING_CONFIRMATION")
        next_intent.setdefault("createdAt", now)
        next_intent["updatedAt"] = now
        if hasattr(self.storage, "register_deposit_intent_atomic"):
            saved = getattr(self.storage, "register_deposit_intent_atomic")(
                owner_wallet=owner,
                tx_hash=tx_hash.lower(),
                request_id=idempotency_key,
                intent_row=next_intent,
            )
            if isinstance(saved, dict) and saved:
                return saved
        self._reserve_pending_deposit_amount(owner, amount_usdc)
        intents.append(next_intent)
        self._save_deposit_intents(intents)
        return next_intent

    def _audit_deposit_confirm(
        self,
        *,
        owner: str,
        deposit_intent_id: str,
        event_key: str,
        confirmations: int,
        request_meta: Optional[Dict[str, Any]],
        moved: Optional[Dict[str, float]] = None,
    ) -> None:
        details: Dict[str, Any] = {
            "depositIntentId": deposit_intent_id,
            "eventKey": event_key,
            "confirmations": int(confirmations),
            "requestMeta": request_meta or {},
        }
        if isinstance(moved, dict):
            details["availableAfter"] = moved.get("availableAfter")
            details["pendingAfter"] = moved.get("pendingAfter")
        self._append_financial_audit("DEPOSIT_INTENT_CONFIRMED", owner, details)

    def _confirm_deposit_intent_atomic_or_raise(
        self,
        *,
        owner: str,
        deposit_intent_id: str,
        event_key: str,
        confirmations: int,
    ) -> Dict[str, Any]:
        try:
            result = getattr(self.storage, "confirm_deposit_intent_atomic")(
                owner_wallet=owner,
                deposit_intent_id=deposit_intent_id,
                event_key=event_key,
                confirmations=int(confirmations),
            )
        except RuntimeError as exc:
            code = str(exc)
            if code == "DEPOSIT_INTENT_NOT_FOUND":
                raise HTTPException(
                    status_code=404,
                    detail={"code": "DEPOSIT_INTENT_NOT_FOUND", "message": "Deposit intent not found."},
                )
            if code == "DEPOSIT_STATUS_INVALID":
                raise HTTPException(
                    status_code=409,
                    detail={"code": "DEPOSIT_STATUS_INVALID", "message": "Deposit intent cannot be confirmed from current status."},
                )
            raise
        return result if isinstance(result, dict) else {}

    def _find_owner_deposit_intent(
        self,
        *,
        intents: List[Dict[str, Any]],
        owner: str,
        deposit_intent_id: str,
    ) -> Dict[str, Any]:
        for row in intents:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("id") or "") != str(deposit_intent_id or ""):
                continue
            return row
        raise HTTPException(
            status_code=404,
            detail={"code": "DEPOSIT_INTENT_NOT_FOUND", "message": "Deposit intent not found."},
        )

    def _assert_deposit_confirmable(self, status: str) -> None:
        if status in {"PENDING_CONFIRMATION", "PENDING", "CONFIRMED"}:
            return
        raise HTTPException(
            status_code=409,
            detail={"code": "DEPOSIT_STATUS_INVALID", "message": "Deposit intent cannot be confirmed from current status."},
        )

    async def confirm_deposit_intent(
        self,
        *,
        owner_wallet: str,
        deposit_intent_id: str,
        event_key: str,
        confirmations: int,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:deposit_confirm"):
            await self._enforce_owner_write_rate_limit(owner, "deposit_confirm")

            if hasattr(self.storage, "confirm_deposit_intent_atomic"):
                result = self._confirm_deposit_intent_atomic_or_raise(
                    owner=owner,
                    deposit_intent_id=deposit_intent_id,
                    event_key=event_key,
                    confirmations=confirmations,
                )
                self._audit_deposit_confirm(
                    owner=owner,
                    deposit_intent_id=deposit_intent_id,
                    event_key=event_key,
                    confirmations=confirmations,
                    request_meta=request_meta,
                )
                return result

            intents = self._load_deposit_intents()
            target = self._find_owner_deposit_intent(intents=intents, owner=owner, deposit_intent_id=deposit_intent_id)

            status = str(target.get("status") or "").upper()
            if status == "CONFIRMED":
                return target
            self._assert_deposit_confirmable(status)

            amount_usdc = Decimal(str(target.get("amountUsdc") or 0)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
            moved = self._confirm_pending_deposit_amount(owner, amount_usdc)
            now = int(time.time())
            target["status"] = "CONFIRMED"
            target["eventKey"] = str(event_key or "")
            target["confirmations"] = int(confirmations)
            target["creditedAmountUsdc"] = float(amount_usdc)
            target["confirmedAt"] = now
            target["updatedAt"] = now
            self._save_deposit_intents(intents)

            self._audit_deposit_confirm(
                owner=owner,
                deposit_intent_id=deposit_intent_id,
                event_key=event_key,
                confirmations=confirmations,
                request_meta=request_meta,
                moved=moved,
            )
            return target

    async def register_deposit_intent(
        self,
        intent: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:deposit_intent"):
            idempotency_key = self._validate_idempotency_key(idempotency_key)
            await self._enforce_owner_write_rate_limit(owner, "deposit_intent")

            tx_hash = str(intent.get("txHash") or "").strip()
            if not tx_hash.startswith("0x") or len(tx_hash) != 66:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_TX_HASH", "message": "txHash must be a 66-char 0x-prefixed hash."},
                )

            try:
                amount_usdc = Decimal(str(intent.get("amountUsdc") or "0")).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                )
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be a valid decimal number."},
                )
            if amount_usdc <= Decimal("0"):
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be greater than 0."},
                )

            intents = self._load_deposit_intents()
            request_payload = {
                "ownerAddress": owner,
                "txHash": tx_hash.lower(),
                "amountUsdc": float(amount_usdc),
            }
            request_hash = self._request_hash(request_payload)
            idem_hit, redis_client, idem_rows = await self._begin_deposit_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if idem_hit is not None:
                return idem_hit

            self._validate_unique_recent_deposit(intents, owner, tx_hash)

            next_intent = self._persist_deposit_intent(
                owner=owner,
                tx_hash=tx_hash,
                amount_usdc=amount_usdc,
                idempotency_key=idempotency_key,
                intent=intent,
                intents=intents,
            )

            response = dict(next_intent)
            if redis_client is None:
                self._record_idempotent_response(
                    rows=idem_rows,
                    scope="deposit_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    response=response,
                )
            await self._complete_idempotency_redis(
                scope="deposit_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
            )
            self._append_financial_audit(
                "DEPOSIT_INTENT_REGISTERED",
                owner,
                {
                    "depositIntentId": next_intent.get("id"),
                    "txHash": next_intent.get("txHash"),
                    "amountUsdc": next_intent.get("amountUsdc"),
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return next_intent

    async def list_deposit_intents(self, owner_wallet: str) -> list:
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        rows = self._load_deposit_intents()
        return [
            row
            for row in rows
            if normalize_wallet(str(row.get("ownerAddress") or row.get("buyerAddress") or "")) == normalized_owner
        ]

    async def process_refund_intent(
        self,
        payload: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:refund_intent"):
            idempotency_key = self._validate_idempotency_key(idempotency_key)
            await self._enforce_owner_write_rate_limit(owner, "refund_intent")

            ledger = self._load_balance_ledger()
            buyers = ledger.get("buyers", {})
            available_balance = round(float(buyers.get(owner, 0.0)), 6)
            context = self._parse_refund_create_context(payload, owner, available_balance)
            amount_usdc = float(context["amountUsdc"])
            reason = str(context["reason"])
            evidence_summary = str(context["evidenceSummary"])
            origin = context["origin"]
            refund_type = str(context["refundType"])
            destination_address = str(context["destinationAddress"])
            request_hash = str(context["requestHash"])
            redis_client = await self._get_redis_client()

            redis_hit = await self._check_idempotency_redis(
                scope="refund_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if redis_hit is not None:
                return redis_hit

            started = await self._start_idempotency_redis(
                scope="refund_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if not started:
                redis_retry = await self._check_idempotency_redis(
                    scope="refund_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                )
                if redis_retry is not None:
                    return redis_retry

            idem_rows: List[Dict[str, Any]] = []
            if redis_client is None:
                idem_rows = self._load_idempotency_rows()
                idem_hit = self._try_get_idempotent_response(
                    rows=idem_rows,
                    scope="refund_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                )
                if idem_hit is not None:
                    return idem_hit

            rows = self._load_refund_intents()
            limits = self._validate_refund_origin_limit_or_raise(
                owner=owner,
                origin=origin,
                rows=rows,
                amount_usdc=amount_usdc,
            )

            pending = self._find_pending_refund(rows, owner)
            if pending is not None:
                return await self._handle_pending_refund(
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
            abnormal_split = self._detect_abnormal_split_refund(owner=owner, origin=origin, rows=rows, now=now)
            risk = self._classify_refund_risk(
                amount_usdc=amount_usdc,
                refund_type=refund_type,
                abnormal_split=abnormal_split,
            )

            self._reserve_buyer_refund_amount(owner, amount_usdc)

            refund_row = {
                "id": refund_id,
                "ownerAddress": owner,
                "amountUsdc": round(amount_usdc, 6),
                "reason": reason,
                "status": risk["status"],
                "signature": signature,
                "gasPayer": "BUYER",
                "gasModel": "BUYER_PAYS_ONCHAIN",
                "originRequestId": origin["originRequestId"],
                "originTxHash": origin["originTxHash"],
                "refundType": refund_type,
                "destinationAddress": destination_address,
                "evidenceSummary": evidence_summary,
                "riskLevel": risk["riskLevel"],
                "riskReasonCode": risk["riskReasonCode"],
                "message": risk["message"],
                "idempotencyKey": idempotency_key,
                "createdAt": now,
                "updatedAt": now,
                "requestMeta": request_meta or {},
            }
            rows.append(refund_row)
            self._save_refund_intents(rows, now)

            response = {
                "refundId": refund_id,
                "signature": signature,
                "amountRefunded": round(amount_usdc, 6),
                "status": risk["status"],
                "gasPayer": "BUYER",
                "gasModel": "BUYER_PAYS_ONCHAIN",
                "riskLevel": risk["riskLevel"],
                "riskReasonCode": risk["riskReasonCode"],
                "message": risk["message"],
            }
            await self._finalize_refund_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
                redis_client=redis_client,
                idem_rows=idem_rows,
            )
            self._append_financial_audit(
                "REFUND_INTENT_CREATED",
                owner,
                {
                    "refundId": refund_id,
                    "amountUsdc": round(amount_usdc, 6),
                    "originRequestId": origin["originRequestId"],
                    "originTxHash": origin["originTxHash"],
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

    async def list_refunds(self, owner_wallet: str) -> List[Dict[str, Any]]:
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        rows = self._load_refund_intents()
        filtered = [
            row for row in rows if normalize_wallet(str(row.get("ownerAddress") or "")) == normalized_owner
        ]
        filtered.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
        return filtered

    async def complete_refund_intent(
        self,
        owner_wallet: str,
        refund_id: str,
        tx_hash: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:refund_complete"):
            await self._enforce_owner_write_rate_limit(owner, "refund_complete")
            rows = self._load_refund_intents()
            target = self._find_refund_by_id(rows, owner, refund_id)
            if target is None:
                raise HTTPException(
                    status_code=404,
                    detail={"code": "REFUND_NOT_FOUND", "message": "Refund intent not found."},
                )

            normalized_tx_hash = self._normalize_tx_hash_or_raise(tx_hash)
            if hasattr(self.storage, "complete_withdraw_tx_atomic"):
                bound = bool(
                    getattr(self.storage, "complete_withdraw_tx_atomic")(
                        owner_wallet=owner,
                        tx_hash=normalized_tx_hash,
                        kind="buyer_refund",
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
            self._assert_no_refund_tx_replay(rows, owner, normalized_tx_hash, str(target.get("id") or ""))
            completed = self._assert_refund_completable(target, normalized_tx_hash)
            if completed is not None:
                return completed

            status = str(target.get("status") or "").upper()
            review = self._parse_refund_review_context(request_meta)
            review_decision = review["decision"]
            reviewer_address = review["reviewerAddress"]
            reviewer_note = review["reviewerNote"]
            amount_usdc = round(float(target.get("amountUsdc") or 0.0), 6)

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

            self._consume_locked_refund_amount(owner, amount_usdc)
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
