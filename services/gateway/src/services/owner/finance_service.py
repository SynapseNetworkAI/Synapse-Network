from __future__ import annotations

from typing import Any, Dict, List, Optional
import asyncio
import time
from uuid import uuid4
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.redis_lock import RedisLockManager
from src.domain.execution import (
    CompleteWithdrawTxCommand,
    DepositIntentConfirmCommand,
    DepositIntentRegisterCommand,
)
from src.domain.finance import BalanceLedger
from src.domain.finance import (
    DepositAttemptRow,
    DepositBalanceMove,
    DepositIntentDraft,
    RefundCreateContext,
    RefundIntentRow,
    RefundOriginRef,
    RefundReviewContext,
    UsageLogRow,
)
from src.domain.ledger import DepositIntentRow
from src.domain.operation_metadata import OperationContextMetadata
from src.services.balance_mixins import BalanceAuditMixin, BalanceRedisGuardMixin
from src.storage.base import BaseStorage
from src.utils.datetime_utils import now_dt_str


REFUND_MANUAL_REVIEW_THRESHOLD_USDC = 500.0
REFUND_AUTO_TYPE = "SYSTEM_FAILURE"
REFUND_MANUAL_TYPE = "MANUAL_APPEAL"
REFUND_ACTIVE_STATUSES = {"PENDING", "PENDING_MANUAL_REVIEW"}
DEPOSIT_ATTEMPT_STAGES = {
    "SIGN_REQUESTED",
    "TX_BROADCASTED",
    "RECEIPT_FAILED",
    "RECEIPT_CONFIRMED",
    "INTENT_REGISTERED",
}
INVALID_TX_HASH_MESSAGE = "txHash must be a 66-char 0x-prefixed hash."


class OwnerFinanceService(BalanceAuditMixin, BalanceRedisGuardMixin):
    """Owner-side funding/refund domain service (deposit + refund)."""

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

    @staticmethod
    def _row_updated_at(row: Any) -> int:
        try:
            return int(row.updated_at or 0)
        except Exception:
            return 0

    @staticmethod
    def _deposit_owner(row: DepositIntentRow) -> str:
        return normalize_wallet(str(row.owner_address or ""))

    @staticmethod
    def _refund_owner(row: RefundIntentRow) -> str:
        return normalize_wallet(str(row.owner_address or ""))

    def _load_balance_ledger(self) -> BalanceLedger:
        return self.storage.get_data_manager().finance.balance.read_balance_ledger()

    def _save_balance_ledger(self, ledger: BalanceLedger) -> None:
        ledger.updated_at = now_dt_str()
        self.storage.get_data_manager().finance.balance.write_balance_ledger(ledger)

    def _load_deposit_intents(self) -> List[DepositIntentRow]:
        rows = self.storage.get_data_manager().system.gateway_state.read_deposit_intents()
        return rows if isinstance(rows, list) else []

    def _save_deposit_intents(self, rows: List[DepositIntentRow]) -> None:
        self.storage.get_data_manager().system.gateway_state.write_deposit_intents(rows)

    def _find_deposit_intent_by_tx_hash(
        self, rows: List[DepositIntentRow], owner_wallet: str, tx_hash: str
    ) -> Optional[DepositIntentRow]:
        owner = normalize_wallet(owner_wallet)
        normalized_tx_hash = self._normalize_tx_hash_or_raise(tx_hash)
        target: Optional[DepositIntentRow] = None
        for row in rows:
            if self._deposit_owner(row) != owner:
                continue
            if str(row.tx_hash or "").strip().lower() != normalized_tx_hash:
                continue
            if target is None or self._row_updated_at(row) >= self._row_updated_at(target):
                target = row
        return target

    @staticmethod
    def _deposit_sync_status_from_row(
        tx_hash: str, row: Optional[DepositIntentRow]
    ) -> Dict[str, Any]:
        normalized_tx_hash = str(tx_hash or "").strip().lower()
        if row is None:
            return {
                "txHash": normalized_tx_hash,
                "found": False,
                "synced": False,
                "status": "NOT_REGISTERED",
                "confirmed": False,
                "canRefreshBalance": False,
            }

        status = str(row.status or "PENDING_CONFIRMATION").strip().upper()
        confirmed = status == "CONFIRMED"
        return {
            "txHash": normalized_tx_hash,
            "found": True,
            "synced": True,
            "status": status,
            "confirmed": confirmed,
            "canRefreshBalance": confirmed,
            "depositIntentId": str(row.id or ""),
            "ownerAddress": normalize_wallet(str(row.owner_address or "")),
            "amountUsdc": round(float(row.amount_usdc or 0), 6),
            "creditedAmountUsdc": round(float(row.credited_amount_usdc or 0), 6),
            "confirmations": int(row.confirmations or 0),
            "eventKey": str(row.event_key or "") or None,
            "confirmedAt": row.confirmed_at,
            "updatedAt": str(row.updated_at or "") or None,
            "source": "deposit_intent",
        }

    def _load_refund_rows(self) -> List[RefundIntentRow]:
        rows = self.storage.get_data_manager().system.gateway_state.read_consumer_refund_rows()
        if not isinstance(rows, list):
            return []
        result: List[RefundIntentRow] = []
        for row in rows:
            if isinstance(row, RefundIntentRow):
                result.append(row)
            elif isinstance(row, dict):
                result.append(RefundIntentRow.model_validate(row))
        return result

    def _save_refund_rows(self, rows: List[RefundIntentRow], updated_at: int) -> None:
        self.storage.get_data_manager().system.gateway_state.write_consumer_refund_rows(
            rows, int(updated_at)
        )

    def _parse_deposit_attempt_amount(self, raw_amount: Any) -> Decimal:
        try:
            amount_usdc = Decimal(str(raw_amount or "0")).quantize(
                Decimal("0.000001"), rounding=ROUND_HALF_UP
            )
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be a valid decimal number.",
                },
            )
        if amount_usdc <= Decimal("0"):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be greater than 0.",
                },
            )
        return amount_usdc

    def _parse_deposit_attempt_stage(self, raw_stage: Any) -> str:
        stage = str(raw_stage or "").strip().upper()
        if stage not in DEPOSIT_ATTEMPT_STAGES:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_ATTEMPT_STAGE",
                    "message": "Unsupported deposit attempt stage.",
                },
            )
        return stage

    def _parse_deposit_attempt_tx_hash(self, raw_tx_hash: Any) -> Optional[str]:
        tx_hash = str(raw_tx_hash or "").strip().lower()
        if not tx_hash:
            return None
        return self._normalize_tx_hash_or_raise(tx_hash)

    def _require_deposit_attempt_id(self, payload: Dict[str, Any]) -> str:
        attempt_id = str(payload.get("attemptId") or "").strip()
        if not attempt_id:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_ATTEMPT_ID",
                    "message": "attemptId is required.",
                },
            )
        return attempt_id

    def _request_meta_value(
        self, request_meta: Optional[Dict[str, Any]], key: str
    ) -> Optional[str]:
        value = str((request_meta or {}).get(key) or "").strip()
        return value or None

    def _build_deposit_attempt_row(
        self,
        *,
        payload: Dict[str, Any],
        owner: str,
        attempt_id: str,
        amount_usdc: Decimal,
        stage: str,
        tx_hash: Optional[str],
        request_meta: Optional[Dict[str, Any]],
    ) -> DepositAttemptRow:
        now_text = now_dt_str()
        return DepositAttemptRow(
            attemptId=attempt_id,
            ownerAddress=owner,
            clientRequestId=str(payload.get("clientRequestId") or "").strip() or None,
            txHash=tx_hash,
            amountUsdc=amount_usdc,
            stage=stage,
            failureReason=str(payload.get("failureReason") or "").strip() or None,
            requestId=self._request_meta_value(request_meta, "requestId"),
            clientIp=self._request_meta_value(request_meta, "clientIp"),
            userAgent=self._request_meta_value(request_meta, "userAgent"),
            createdAt=now_text,
            updatedAt=now_text,
        )

    def _serialize_deposit_attempt_row(self, saved: Any) -> Dict[str, Any]:
        if isinstance(saved, DepositAttemptRow):
            return saved.model_dump(by_alias=True, mode="json")
        if isinstance(saved, dict):
            return saved
        return {}

    def _require_deposit_attempt_storage(self) -> Any:
        storage_hook = getattr(self.storage, "record_deposit_attempt", None)
        if storage_hook is None:
            raise RuntimeError("DEPOSIT_ATTEMPTS_REQUIRE_POSTGRES_STORAGE")
        return storage_hook

    async def record_deposit_attempt(
        self,
        *,
        payload: Dict[str, Any],
        owner_wallet: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        attempt_id = self._require_deposit_attempt_id(payload)
        amount_usdc = self._parse_deposit_attempt_amount(payload.get("amountUsdc"))
        stage = self._parse_deposit_attempt_stage(payload.get("stage"))
        tx_hash = self._parse_deposit_attempt_tx_hash(payload.get("txHash"))

        saved = self._require_deposit_attempt_storage()(
            self._build_deposit_attempt_row(
                payload=payload,
                owner=owner,
                attempt_id=attempt_id,
                amount_usdc=amount_usdc,
                stage=stage,
                tx_hash=tx_hash,
                request_meta=request_meta,
            )
        )
        return self._serialize_deposit_attempt_row(saved)

    def _load_invocation_billing_rows(self) -> List[UsageLogRow]:
        rows = (
            self.storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
        )
        if not isinstance(rows, list):
            return []
        result: List[UsageLogRow] = []
        for row in rows:
            if isinstance(row, UsageLogRow):
                result.append(row)
            elif isinstance(row, dict):
                result.append(UsageLogRow.model_validate(row))
        return result

    def _reserve_pending_deposit_amount(self, owner: str, amount_usdc: Decimal) -> None:
        ledger = self._load_balance_ledger()
        consumer_wallet = ledger.ensure_consumer_wallet(owner)
        consumer_wallet.pending_balance = round(
            float(consumer_wallet.pending_balance or 0.0) + float(amount_usdc), 6
        )
        self._save_balance_ledger(ledger)

    def _confirm_pending_deposit_amount(
        self, owner: str, amount_usdc: Decimal
    ) -> DepositBalanceMove:
        ledger = self._load_balance_ledger()
        consumer_wallet = ledger.ensure_consumer_wallet(owner)
        available_before = round(float(consumer_wallet.available_balance or 0.0), 6)
        pending_before = round(float(consumer_wallet.pending_balance or 0.0), 6)
        amount = round(float(amount_usdc), 6)
        if pending_before + 1e-9 < amount:
            raise RuntimeError("DEPOSIT_PENDING_BALANCE_INCONSISTENT")

        consumer_wallet.available_balance = round(available_before + amount, 6)
        consumer_wallet.pending_balance = round(max(0.0, pending_before - amount), 6)
        self._save_balance_ledger(ledger)
        return DepositBalanceMove(
            available_before=available_before,
            available_after=round(float(consumer_wallet.available_balance or 0.0), 6),
            pending_before=pending_before,
            pending_after=round(float(consumer_wallet.pending_balance or 0.0), 6),
        )

    def _parse_refund_amount_usdc(
        self, payload: Dict[str, Any], available: float
    ) -> float:
        raw = payload.get("amountUsdc")
        try:
            amount = round(float(raw), 6)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be a number.",
                },
            )

        if amount < 10:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be >= 10 USDC.",
                },
            )
        if amount > available:
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
            if self._refund_owner(row) != owner:
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
            if self._refund_owner(row) != owner:
                continue
            return row
        return None

    def _build_pending_refund_response(self, row: RefundIntentRow) -> Dict[str, Any]:
        return {
            "refundId": str(row.id or ""),
            "signature": str(row.signature or ""),
            "amountRefunded": round(float(row.amount_usdc or 0.0), 6),
            "status": str(row.status or "PENDING"),
            "gasPayer": str(row.gas_payer or "OWNER"),
            "gasModel": str(row.gas_model or "OWNER_PAYS_ONCHAIN"),
            "riskLevel": str(row.risk_level or "green"),
            "riskReasonCode": str(row.risk_reason_code or ""),
            "message": str(row.message or ""),
        }

    def _parse_refund_origin(self, payload: Dict[str, Any]) -> RefundOriginRef:
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
            origin_tx_hash = self._normalize_tx_hash_or_raise(origin_tx_hash)
        return RefundOriginRef(
            request_id=origin_request_id,
            tx_hash=origin_tx_hash,
        )

    def _validate_refund_destination(self, owner: str, payload: Dict[str, Any]) -> None:
        destination = str(payload.get("destinationAddress") or "").strip().lower()
        if destination and normalize_wallet(destination) != owner:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "REFUND_DESTINATION_NOT_ALLOWED",
                    "message": "Refund destination must equal original payer address.",
                },
            )

    def _resolve_refund_type(self, payload: Dict[str, Any]) -> str:
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
    ) -> Dict[str, float]:
        refundable_total = self._sum_refundable_usage_total(owner=owner, origin=origin)
        consumed = self._sum_consumed_refunds(owner=owner, origin=origin, rows=rows)
        return {
            "refundableTotal": refundable_total,
            "alreadyConsumed": consumed,
            "remaining": round(max(0.0, refundable_total - consumed), 6),
        }

    def _sum_refundable_usage_total(
        self, *, owner: str, origin: RefundOriginRef
    ) -> float:
        usage_rows = self._load_invocation_billing_rows()
        refundable_total = 0.0
        for usage in usage_rows:
            if normalize_wallet(str(usage.consumer_address or "")) != owner:
                continue
            status = str(usage.status or "").strip().lower()
            if status not in {"succeeded", "success", "completed", "accepted"}:
                continue
            if not self._origin_matches(usage, origin):
                continue
            refundable_total = round(
                refundable_total + round(float(usage.total_charge or 0.0), 6),
                6,
            )
        return refundable_total

    def _sum_consumed_refunds(
        self, *, owner: str, origin: RefundOriginRef, rows: List[RefundIntentRow]
    ) -> float:
        consumed = 0.0
        for row in rows:
            if self._refund_owner(row) != owner:
                continue
            if not self._origin_matches(row, origin):
                continue
            if str(row.status or "").upper() == "REJECTED":
                continue
            consumed = round(consumed + round(float(row.amount_usdc or 0.0), 6), 6)
        return consumed

    def _detect_abnormal_split_refund(
        self,
        *,
        owner: str,
        origin: Dict[str, str],
        rows: List[RefundIntentRow],
        now: int,
    ) -> bool:
        cutoff = now - 24 * 3600
        count = 0
        for row in rows:
            if self._refund_owner(row) != owner:
                continue
            if not self._origin_matches(row, origin):
                continue
            if self._row_updated_at(row) < cutoff:
                continue
            if str(row.status or "").upper() == "REJECTED":
                continue
            count += 1
        return count >= 2

    def _classify_refund_risk(
        self, *, amount_usdc: float, refund_type: str, abnormal_split: bool
    ) -> Dict[str, str]:
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
                detail={
                    "code": "INVALID_TX_HASH",
                    "message": INVALID_TX_HASH_MESSAGE,
                },
            )
        return normalized

    def _assert_no_refund_tx_replay(
        self,
        rows: List[RefundIntentRow],
        owner_wallet: str,
        tx_hash: str,
        current_refund_id: str,
    ) -> None:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if self._refund_owner(row) != owner:
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
    ) -> Optional[Dict[str, Any]]:
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
        consumer_wallet = ledger.ensure_consumer_wallet(owner)
        locked = round(float(consumer_wallet.pending_balance or 0.0), 6)
        if locked + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_LOCK_INCONSISTENT",
                    "message": "Locked owner balance is insufficient for this refund intent.",
                },
            )
        consumer_wallet.pending_balance = round(max(0.0, locked - amount_usdc), 6)
        self._save_balance_ledger(ledger)

    def _reserve_owner_refund_amount(self, owner: str, amount_usdc: float) -> None:
        ledger = self._load_balance_ledger()
        consumer_wallet = ledger.ensure_consumer_wallet(owner)
        available_balance = round(float(consumer_wallet.available_balance or 0.0), 6)
        if amount_usdc > available_balance:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INSUFFICIENT_OWNER_BALANCE",
                    "message": "amountUsdc exceeds owner available balance.",
                },
            )
        consumer_wallet.available_balance = round(
            float(consumer_wallet.available_balance or 0.0) - amount_usdc, 6
        )
        consumer_wallet.pending_balance = round(
            float(consumer_wallet.pending_balance or 0.0) + amount_usdc, 6
        )
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
        pending: RefundIntentRow,
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_hash: str,
        redis_client: Optional[Any],
        idem_rows: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        pending_amount = round(float(pending.amount_usdc or 0.0), 6)
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

    def _parse_refund_create_context(
        self, payload: Dict[str, Any], owner: str, available_balance: float
    ) -> RefundCreateContext:
        amount_usdc = self._parse_refund_amount_usdc(payload, available_balance)
        reason = str(payload.get("reason") or "").strip()
        if len(reason) > 256:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_REASON",
                    "message": "reason must be <= 256 chars.",
                },
            )
        evidence_summary = str(payload.get("evidenceSummary") or "").strip()
        if len(evidence_summary) > 512:
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
            "amountUsdc": round(amount_usdc, 6),
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
            request_hash=self._request_hash(request_payload),
        )

    def _validate_refund_origin_limit_or_raise(
        self,
        *,
        owner: str,
        origin: RefundOriginRef,
        rows: List[RefundIntentRow],
        amount_usdc: float,
    ) -> Dict[str, float]:
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
        if amount_usdc > limits["remaining"] + 1e-9:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "REFUND_EXCEEDS_ORIGIN_LIMIT",
                    "message": "Requested refund exceeds remaining refundable amount of the original charge.",
                },
            )
        return limits

    def _release_locked_refund_to_available(
        self, owner: str, amount_usdc: float
    ) -> None:
        ledger = self._load_balance_ledger()
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
        self._save_balance_ledger(ledger)

    def _parse_refund_review_context(
        self, request_meta: Optional[Dict[str, Any]]
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
        request_meta: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        self._release_locked_refund_to_available(owner, amount_usdc)
        now = int(time.time())
        target.status = "REJECTED"
        target.review_decision = "REJECT"
        target.reviewer_address = reviewer_address
        target.reviewer_note = reviewer_note
        target.reviewed_at = now
        target.updated_at = now
        target.complete_meta = request_meta or {}
        self._save_refund_rows(rows, now)
        self._append_financial_audit(
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
        rows: List[RefundIntentRow],
        target: RefundIntentRow,
        normalized_tx_hash: str,
        amount_usdc: float,
        status_before: str,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
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
        self._save_refund_rows(rows, now)

        self._append_financial_audit(
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
        owner: str,
        idempotency_key: str,
        draft: DepositIntentDraft,
        intents: List[DepositIntentRow],
        client_request_id: Optional[str] = None,
        client_ip: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> DepositIntentRow:
        next_intent = DepositIntentRow(
            id=draft.intent_id,
            ownerAddress=owner,
            txHash=draft.tx_hash,
            amountUsdc=draft.amount_usdc,
            idempotencyKey=idempotency_key,
            clientRequestId=client_request_id,
            clientIp=client_ip,
            userAgent=user_agent,
            status=draft.status,
            createdAt=draft.created_at,
            updatedAt=now_dt_str(),
        )
        if hasattr(self.storage, "register_deposit_intent_atomic"):
            register_atomic = getattr(self.storage, "register_deposit_intent_atomic")
            saved = register_atomic(
                DepositIntentRegisterCommand(
                    owner_wallet=owner,
                    tx_hash=draft.tx_hash.lower(),
                    request_id=idempotency_key,
                    intent_row=next_intent,
                )
            )
            if isinstance(saved, DepositIntentRow):
                return saved
            raise RuntimeError("DEPOSIT_REGISTER_RESULT_INVALID")
        self._reserve_pending_deposit_amount(owner, draft.amount_usdc)
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
        confirmed_row: Optional[DepositIntentRow] = None,
        moved: Optional[DepositBalanceMove] = None,
    ) -> None:
        details: Dict[str, Any] = {
            "businessType": "deposit",
            "depositIntentId": deposit_intent_id,
            "eventKey": event_key,
            "confirmations": int(confirmations),
            "status": "CONFIRMED",
            "resultStatus": "CONFIRMED",
            "requestMeta": request_meta or {},
        }
        if confirmed_row is not None:
            details["requestId"] = confirmed_row.request_id
            details["txHash"] = confirmed_row.tx_hash
            details["deltaAmount"] = str(confirmed_row.amount_usdc)
            details["amountUsdc"] = str(confirmed_row.amount_usdc)
        if moved is not None:
            details["availableAfter"] = moved.available_after
            details["pendingAfter"] = moved.pending_after
        self._append_financial_audit("DEPOSIT_INTENT_CONFIRMED", owner, details)

    def _confirm_deposit_intent_atomic_or_raise(
        self,
        *,
        owner: str,
        deposit_intent_id: str,
        event_key: str,
        confirmations: int,
    ) -> DepositIntentRow:
        try:
            result = getattr(self.storage, "confirm_deposit_intent_atomic")(
                DepositIntentConfirmCommand(
                    owner_wallet=owner,
                    deposit_intent_id=deposit_intent_id,
                    event_key=event_key,
                    confirmations=int(confirmations),
                )
            )
        except RuntimeError as exc:
            code = str(exc)
            if code == "DEPOSIT_INTENT_NOT_FOUND":
                raise HTTPException(
                    status_code=404,
                    detail={
                        "code": "DEPOSIT_INTENT_NOT_FOUND",
                        "message": "Deposit intent not found.",
                    },
                )
            if code == "DEPOSIT_STATUS_INVALID":
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "DEPOSIT_STATUS_INVALID",
                        "message": "Deposit intent cannot be confirmed from current status.",
                    },
                )
            raise
        if isinstance(result, DepositIntentRow):
            return result
        raise RuntimeError("DEPOSIT_CONFIRM_RESULT_INVALID")

    def _parse_deposit_intent_draft(
        self,
        *,
        intent: Dict[str, Any],
        owner: str,
    ) -> DepositIntentDraft:
        tx_hash = self._normalize_tx_hash_or_raise(str(intent.get("txHash") or ""))

        try:
            amount_usdc = Decimal(str(intent.get("amountUsdc") or "0")).quantize(
                Decimal("0.000001"), rounding=ROUND_HALF_UP
            )
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be a valid decimal number.",
                },
            )
        if amount_usdc <= Decimal("0"):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be greater than 0.",
                },
            )

        request_hash = self._request_hash(
            {
                "ownerAddress": owner,
                "txHash": tx_hash,
                "amountUsdc": float(amount_usdc),
            }
        )
        return DepositIntentDraft(
            tx_hash=tx_hash,
            amount_usdc=amount_usdc,
            intent_id=str(intent.get("id") or uuid4()),
            status=str(intent.get("status") or "PENDING_CONFIRMATION"),
            created_at=str(intent.get("createdAt") or now_dt_str()),
            request_hash=request_hash,
        )

    def _find_owner_deposit_intent(
        self,
        *,
        intents: List[DepositIntentRow],
        owner: str,
        deposit_intent_id: str,
    ) -> DepositIntentRow:
        for row in intents:
            if self._deposit_owner(row) != owner:
                continue
            if str(row.id or "") != str(deposit_intent_id or ""):
                continue
            return row
        raise HTTPException(
            status_code=404,
            detail={
                "code": "DEPOSIT_INTENT_NOT_FOUND",
                "message": "Deposit intent not found.",
            },
        )

    def _assert_deposit_confirmable(self, status: str) -> None:
        if status in {"PENDING_CONFIRMATION", "PENDING", "CONFIRMED"}:
            return
        raise HTTPException(
            status_code=409,
            detail={
                "code": "DEPOSIT_STATUS_INVALID",
                "message": "Deposit intent cannot be confirmed from current status.",
            },
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
                    confirmed_row=result,
                )
                return result.model_dump(by_alias=True, mode="json")

            intents = self._load_deposit_intents()
            target = self._find_owner_deposit_intent(
                intents=intents, owner=owner, deposit_intent_id=deposit_intent_id
            )

            status = str(target.status or "").upper()
            if status == "CONFIRMED":
                return target.model_dump(by_alias=True, mode="json")
            self._assert_deposit_confirmable(status)

            amount_usdc = Decimal(str(target.amount_usdc or 0)).quantize(
                Decimal("0.000001"), rounding=ROUND_HALF_UP
            )
            moved = self._confirm_pending_deposit_amount(owner, amount_usdc)
            now = int(time.time())
            target.status = "CONFIRMED"
            target.event_key = str(event_key or "")
            target.confirmations = int(confirmations)
            target.credited_amount_usdc = amount_usdc
            target.confirmed_at = now
            target.updated_at = now_dt_str()
            self._save_deposit_intents(intents)

            self._audit_deposit_confirm(
                owner=owner,
                deposit_intent_id=deposit_intent_id,
                event_key=event_key,
                confirmations=confirmations,
                request_meta=request_meta,
                confirmed_row=target,
                moved=moved,
            )
            return target.model_dump(by_alias=True, mode="json")

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

            draft = self._parse_deposit_intent_draft(intent=intent, owner=owner)

            intents = self._load_deposit_intents()
            idem_hit, redis_client, idem_rows = await self._begin_deposit_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=draft.request_hash,
            )
            if idem_hit is not None:
                return idem_hit

            replay_hit = self._validate_unique_recent_deposit(intents, owner, draft.tx_hash)
            if replay_hit is not None:
                if redis_client is None:
                    self._record_idempotent_response(
                        rows=idem_rows,
                        scope="deposit_intent",
                        owner_wallet=owner,
                        idempotency_key=idempotency_key,
                        request_hash=draft.request_hash,
                        response=replay_hit,
                    )
                await self._complete_idempotency_redis(
                    scope="deposit_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=draft.request_hash,
                    response=replay_hit,
                )
                return replay_hit

            next_intent = self._persist_deposit_intent(
                owner=owner,
                idempotency_key=idempotency_key,
                draft=draft,
                intents=intents,
                client_request_id=intent.get("clientRequestId"),
                client_ip=request_meta.get("clientIp") if request_meta else None,
                user_agent=request_meta.get("userAgent") if request_meta else None,
            )

            response = next_intent.model_dump(by_alias=True, mode="json")
            if redis_client is None:
                self._record_idempotent_response(
                    rows=idem_rows,
                    scope="deposit_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=draft.request_hash,
                    response=response,
                )
            await self._complete_idempotency_redis(
                scope="deposit_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=draft.request_hash,
                response=response,
            )
            self._append_financial_audit(
                "DEPOSIT_INTENT_REGISTERED",
                owner,
                {
                    "businessType": "deposit",
                    "depositIntentId": next_intent.id,
                    "txHash": next_intent.tx_hash,
                    "amountUsdc": float(next_intent.amount_usdc),
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return response

    async def list_deposit_intents(self, owner_wallet: str) -> list:
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        rows = self._load_deposit_intents()
        return [
            row.model_dump(by_alias=True, mode="json")
            for row in rows
            if self._deposit_owner(row) == normalized_owner
        ]

    async def get_deposit_sync_status(
        self, owner_wallet: str, tx_hash: str
    ) -> Dict[str, Any]:
        await asyncio.sleep(0)
        rows = self._load_deposit_intents()
        target = self._find_deposit_intent_by_tx_hash(rows, owner_wallet, tx_hash)
        return self._deposit_sync_status_from_row(tx_hash, target)

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
            available_balance = ledger.consumer_available_balance(owner)
            context = self._parse_refund_create_context(
                payload, owner, available_balance
            )
            amount_usdc = context.amount_usdc
            reason = context.reason
            evidence_summary = context.evidence_summary
            origin = context.origin
            refund_type = context.refund_type
            destination_address = context.destination_address
            request_hash = context.request_hash
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

            rows = self._load_refund_rows()
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
            abnormal_split = self._detect_abnormal_split_refund(
                owner=owner, origin=origin, rows=rows, now=now
            )
            risk = self._classify_refund_risk(
                amount_usdc=amount_usdc,
                refund_type=refund_type,
                abnormal_split=abnormal_split,
            )

            self._reserve_owner_refund_amount(owner, amount_usdc)

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
            self._save_refund_rows(rows, now)

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

    async def list_refunds(self, owner_wallet: str) -> List[Dict[str, Any]]:
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        rows = self._load_refund_rows()
        filtered = [
            row
            for row in rows
            if self._refund_owner(row) == normalized_owner
        ]
        filtered.sort(key=self._row_updated_at, reverse=True)
        return [row.model_dump(by_alias=True, mode="json") for row in filtered]

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
            rows = self._load_refund_rows()
            target = self._find_refund_by_id(rows, owner, refund_id)
            if target is None:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "code": "REFUND_NOT_FOUND",
                        "message": "Refund intent not found.",
                    },
                )

            normalized_tx_hash = self._normalize_tx_hash_or_raise(tx_hash)
            if hasattr(self.storage, "complete_withdraw_tx_atomic"):
                bound = bool(
                    getattr(self.storage, "complete_withdraw_tx_atomic")(
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
            self._assert_no_refund_tx_replay(
                rows, owner, normalized_tx_hash, str(target.id or "")
            )
            completed = self._assert_refund_completable(target, normalized_tx_hash)
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
