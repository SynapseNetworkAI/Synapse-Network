"""Consumer balance withdrawal mixin.

Handles withdraw of UNUSED consumer balance (unspent deposits) back to the
owner's wallet. This is NOT a dispute refund — it is restricted to:
  - amount <= consumer_available_balance
  - amount >= CONSUMER_WITHDRAW_MIN_USDC
  - max CONSUMER_WITHDRAW_MAX_DAILY_COUNT withdrawals per 24 h
  - amounts >= CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC → PENDING_MANUAL_REVIEW

No originRequestId is required. The destination address is always the owner.
"""
from __future__ import annotations

import time
from decimal import Decimal
from typing import Any, List, Optional
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.services.owner.finance_constants import (
    CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC,
    CONSUMER_WITHDRAW_MAX_DAILY_COUNT,
    CONSUMER_WITHDRAW_MIN_USDC,
    CONSUMER_WITHDRAW_TYPE,
    REFUND_ACTIVE_STATUSES,
)
from src.domain.finance import RefundIntentRow
from src.utils.datetime_utils import now_dt_str


class FinanceConsumerWithdrawMixin:
    """Consumer balance withdraw: reserve, create intent, and list."""

    def _count_consumer_withdrawals_last_24h(
        self, owner: str, rows: List[RefundIntentRow], now: int
    ) -> int:
        cutoff = now - 24 * 3600
        count = 0
        for row in rows:
            if normalize_wallet(str(row.owner_address or "")) != owner:
                continue
            if str(row.refund_type or "") != CONSUMER_WITHDRAW_TYPE:
                continue
            if str(row.status or "").upper() == "REJECTED":
                continue
            updated = 0
            try:
                updated = int(row.updated_at or 0)
            except Exception:
                pass
            if not updated:
                try:
                    from datetime import datetime, timezone
                    updated = int(
                        datetime.fromisoformat(str(row.created_at or "").replace("Z", "+00:00"))
                        .astimezone(timezone.utc)
                        .timestamp()
                    )
                except Exception:
                    pass
            if updated >= cutoff:
                count += 1
        return count

    def _classify_consumer_withdraw_risk(
        self, amount_usdc: float, daily_count: int
    ) -> dict[str, str]:
        if daily_count >= CONSUMER_WITHDRAW_MAX_DAILY_COUNT:
            return {
                "status": "PENDING_MANUAL_REVIEW",
                "riskLevel": "red",
                "riskReasonCode": "DAILY_WITHDRAW_LIMIT_EXCEEDED",
                "message": (
                    f"You have already made {CONSUMER_WITHDRAW_MAX_DAILY_COUNT} withdrawals in the past 24 hours. "
                    "This request requires manual review."
                ),
            }
        if amount_usdc >= CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC:
            return {
                "status": "PENDING_MANUAL_REVIEW",
                "riskLevel": "yellow",
                "riskReasonCode": "LARGE_WITHDRAWAL_REQUIRES_MANUAL_REVIEW",
                "message": (
                    f"Withdrawals ≥ ${CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC:.0f} USDC "
                    "require manual review (ETA 12–24 h)."
                ),
            }
        return {
            "status": "REQUESTED",
            "riskLevel": "green",
            "riskReasonCode": "",
            "message": "",
        }

    async def create_consumer_withdraw_intent(
        self,
        payload: dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:consumer_withdraw_intent"):  # type: ignore[attr-defined]
            idempotency_key = self._validate_idempotency_key(idempotency_key)  # type: ignore[attr-defined]
            await self._enforce_owner_write_rate_limit(owner, "consumer_withdraw_intent")  # type: ignore[attr-defined]

            # ── Parse amount ──────────────────────────────────────────────────
            try:
                amount_usdc = round(float(payload.get("amountUsdc", 0)), 6)
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be a number."},
                )
            if amount_usdc < CONSUMER_WITHDRAW_MIN_USDC:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INVALID_AMOUNT",
                        "message": f"amountUsdc must be >= {CONSUMER_WITHDRAW_MIN_USDC} USDC.",
                    },
                )

            reason = str(payload.get("reason") or "").strip()[:256]

            # ── Idempotency check (before balance validation) ─────────────────
            import hashlib, json
            request_hash = hashlib.sha256(
                json.dumps({"owner": owner, "amountUsdc": amount_usdc, "reason": reason}, sort_keys=True).encode()
            ).hexdigest()

            redis_client = await self._get_redis_client()  # type: ignore[attr-defined]
            redis_hit = await self._check_idempotency_redis(  # type: ignore[attr-defined]
                scope="consumer_withdraw_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if redis_hit is not None:
                return redis_hit

            # ── Check available balance ───────────────────────────────────────
            ledger = self._load_balance_ledger()  # type: ignore[attr-defined]
            available = ledger.consumer_available_balance(owner)
            if amount_usdc > available + 1e-9:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INSUFFICIENT_CONSUMER_BALANCE",
                        "message": (
                            f"Requested {amount_usdc:.6f} USDC exceeds available balance "
                            f"of {available:.6f} USDC."
                        ),
                    },
                )

            # ── Frequency check (24 h daily cap) ─────────────────────────────
            rows = self._load_refund_rows()  # type: ignore[attr-defined]
            now = int(time.time())
            daily_count = self._count_consumer_withdrawals_last_24h(owner, rows, now)

            # ── Check if a pending withdrawal already exists ──────────────────
            for row in rows:
                if normalize_wallet(str(row.owner_address or "")) != owner:
                    continue
                if str(row.refund_type or "") != CONSUMER_WITHDRAW_TYPE:
                    continue
                if str(row.status or "").upper() in REFUND_ACTIVE_STATUSES:
                    return {
                        "withdrawId": str(row.id or ""),
                        "amountUsdc": float(row.amount_usdc or 0),
                        "status": str(row.status),
                        "riskLevel": str(row.risk_level or "green"),
                        "riskReasonCode": str(row.risk_reason_code or ""),
                        "message": str(row.message or ""),
                    }

            # ── Risk classification ───────────────────────────────────────────
            risk = self._classify_consumer_withdraw_risk(amount_usdc, daily_count)

            # ── Reserve balance (atomic SQL delta) ───────────────────────────
            try:
                self._reserve_consumer_balance(owner, amount_usdc)  # type: ignore[attr-defined]
            except RuntimeError:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INSUFFICIENT_CONSUMER_BALANCE",
                        "message": (
                            f"Requested {amount_usdc:.6f} USDC exceeds available balance."
                        ),
                    },
                )

            # ── Persist intent row (reuse RefundIntentRow storage) ───────────
            withdraw_id = str(uuid4())
            signature = f"mock-consumer-withdraw-{withdraw_id[:12]}"
            row = RefundIntentRow(
                id=withdraw_id,
                ownerAddress=owner,
                amountUsdc=Decimal(str(round(amount_usdc, 6))),
                reason=reason,
                status=risk["status"],
                signature=signature,
                gasPayer="OWNER",
                gasModel="OWNER_PAYS_ONCHAIN",
                refundType=CONSUMER_WITHDRAW_TYPE,
                destinationAddress=owner,
                riskLevel=risk["riskLevel"],
                riskReasonCode=risk["riskReasonCode"],
                message=risk["message"],
                idempotencyKey=idempotency_key,
                createdAt=now_dt_str(),
                updatedAt=now_dt_str(),
                requestMeta=request_meta or {},
            )
            rows.append(row)
            self._save_refund_rows(rows, now)  # type: ignore[attr-defined]

            response = {
                "withdrawId": withdraw_id,
                "amountUsdc": round(amount_usdc, 6),
                "status": risk["status"],
                "riskLevel": risk["riskLevel"],
                "riskReasonCode": risk["riskReasonCode"],
                "message": risk["message"],
                "destination": owner,
            }

            # ── Finalize idempotency ──────────────────────────────────────────
            await self._finalize_refund_idempotency(  # type: ignore[attr-defined]
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
                redis_client=redis_client,
                idem_rows=[],
            )

            # ── Audit log ─────────────────────────────────────────────────────
            self._append_financial_audit(  # type: ignore[attr-defined]
                "CONSUMER_WITHDRAW_INTENT_CREATED",
                owner,
                {
                    "withdrawId": withdraw_id,
                    "amountUsdc": round(amount_usdc, 6),
                    "riskLevel": risk["riskLevel"],
                    "riskReasonCode": risk["riskReasonCode"],
                    "dailyCount": daily_count,
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return response

    async def list_consumer_withdrawals(self, owner_wallet: str) -> list[dict[str, Any]]:
        import asyncio
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        rows = self._load_refund_rows()  # type: ignore[attr-defined]
        result = []
        for row in rows:
            if normalize_wallet(str(row.owner_address or "")) != owner:
                continue
            if str(row.refund_type or "") != CONSUMER_WITHDRAW_TYPE:
                continue
            result.append(row.model_dump(by_alias=True, mode="json"))
        result.sort(key=lambda r: str(r.get("updatedAt") or ""), reverse=True)
        return result
