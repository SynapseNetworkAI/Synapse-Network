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

import logging
import time
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, List, Optional
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.services.owner.finance_constants import (
    CONSUMER_WITHDRAW_FEE_USDC,
    CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC,
    CONSUMER_WITHDRAW_MAX_DAILY_COUNT,
    CONSUMER_WITHDRAW_MIN_USDC,
    CONSUMER_WITHDRAW_TYPE,
    REFUND_ACTIVE_STATUSES,
    read_consumer_mature_withdrawable,
)
from src.domain.finance import RefundIntentRow
from src.utils.datetime_utils import now_dt_str
from src.utils.money import money_str


ConsumerWithdrawResponse = dict[str, Any]
ConsumerWithdrawListResponse = list[ConsumerWithdrawResponse]
CLAIMABLE_CONSUMER_WITHDRAW_STATUSES = frozenset(
    {
        "REQUESTED",
        "APPROVED_AUTO",
        "APPROVED_MANUAL",
        "SIGNED",
        "BROADCASTED",
        "TICKET_READY",
        "PROCESSING",
    }
)

logger = logging.getLogger(__name__)


class FinanceConsumerWithdrawMixin:
    """Consumer balance withdraw: reserve, create intent, and list."""

    @staticmethod
    def _raise_consumer_withdraw_runtime_error(code: str) -> None:
        if code == "INSUFFICIENT_VAULT_LIQUIDITY":
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "VAULT_LIQUIDITY_INSUFFICIENT",
                    "message": (
                        "Vault liquidity is insufficient for this withdrawal right now. "
                        "The platform treasury must refill on-chain USDC before you retry."
                    ),
                },
            )
        if code == "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE":
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE",
                    "message": (
                        "Unable to verify vault liquidity right now. Retry after the "
                        "gateway reconnects to chain RPC."
                    ),
                },
            )
        raise RuntimeError(code)

    @staticmethod
    def _q6d(value: Any) -> Decimal:
        return Decimal(str(value or "0")).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        )

    @classmethod
    def _money_float(cls, value: Any) -> float:
        return float(cls._q6d(value))

    @staticmethod
    def _is_consumer_withdraw_claimable(payload: dict[str, Any]) -> bool:
        status = str(payload.get("status") or "").strip().upper()
        if status not in CLAIMABLE_CONSUMER_WITHDRAW_STATUSES:
            return False
        if payload.get("txHash"):
            return False
        ticket = payload.get("ticket")
        if not isinstance(ticket, dict):
            return False
        signature = str(ticket.get("signature") or "").strip()
        contract_address = str(ticket.get("contractAddress") or "").strip()
        deadline = int(ticket.get("deadline") or payload.get("deadline") or 0)
        return bool(
            signature
            and contract_address
            and deadline > int(time.time())
        )

    def _build_consumer_withdraw_response(
        self,
        row: RefundIntentRow,
        *,
        existing_withdrawal: bool = False,
    ) -> dict[str, Any]:
        amount_usdc = self._q6d(row.amount_usdc)
        fee_usdc = self._q6d(CONSUMER_WITHDRAW_FEE_USDC)
        payload = {
            "withdrawId": str(row.id or ""),
            "amountUsdc": float(amount_usdc),
            "feeUsdc": float(fee_usdc),
            "netUsdc": float(max(Decimal("0"), amount_usdc - fee_usdc)),
            "status": str(row.status or "REQUESTED"),
            "riskLevel": str(row.risk_level or "green"),
            "riskReasonCode": str(row.risk_reason_code or ""),
            "message": str(row.message or ""),
            "destination": str(row.destination_address or row.owner_address or ""),
            "createdAt": str(row.created_at or ""),
        }
        if existing_withdrawal:
            payload["existingWithdrawal"] = True
        if row.ticket.signature:
            payload["ticket"] = row.ticket.model_dump(
                by_alias=True,
                mode="json",
                exclude_none=True,
            )
        payload["claimable"] = self._is_consumer_withdraw_claimable(payload)
        return payload

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

    def _balance_repository(self) -> Any:
        get_data_manager = getattr(self.storage, "get_data_manager", None)
        if not callable(get_data_manager):
            return None
        return getattr(get_data_manager().finance, "balance", None)

    def _read_consumer_mature_withdrawable(self, owner: str, fallback_available: Decimal) -> Decimal:
        return self._q6d(read_consumer_mature_withdrawable(self._balance_repository(), owner, fallback_available))

    def _consumer_withdrawal_window_stats(
        self,
        owner: str,
        rows: List[RefundIntentRow],
        now: int,
    ) -> tuple[int, Decimal]:
        balance_repo = self._balance_repository()
        reader = getattr(balance_repo, "read_consumer_withdrawal_window_stats", None)
        if callable(reader):
            count, amount = reader(owner, 24 * 3600)
            return int(count), self._q6d(amount)
        return self._count_consumer_withdrawals_last_24h(owner, rows, now), Decimal("0.000000")

    def _classify_consumer_withdraw_risk(
        self, amount_usdc: Decimal | str | int, daily_count: int
    ) -> dict[str, str]:
        amount = self._q6d(amount_usdc)
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
        if amount >= self._q6d(CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC):
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

    async def _finalize_consumer_withdraw_idempotency(
        self,
        *,
        owner: str,
        idempotency_key: str,
        request_hash: str,
        response: dict[str, Any],
        redis_client: Optional[Any],
        idem_rows: List[Any],
    ) -> None:
        if redis_client is None:
            self._record_idempotent_response(  # type: ignore[attr-defined]  # reason: mixed in by BalanceRedisGuardMixin
                rows=idem_rows,
                scope="consumer_withdraw_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
            )
        await self._complete_idempotency_redis(  # type: ignore[attr-defined]  # reason: mixed in by BalanceRedisGuardMixin
            scope="consumer_withdraw_intent",
            owner_wallet=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response=response,
        )

    async def create_consumer_withdraw_intent(
        self,
        payload: dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> ConsumerWithdrawResponse:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:consumer_withdraw_intent"):  # type: ignore[attr-defined]
            idempotency_key = self._validate_idempotency_key(idempotency_key)  # type: ignore[attr-defined]
            await self._enforce_owner_write_rate_limit(owner, "consumer_withdraw_intent")  # type: ignore[attr-defined]

            try:
                amount_usdc = self._q6d(payload.get("amountUsdc", 0))
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be a number."},
                )
            min_amount = self._q6d(CONSUMER_WITHDRAW_MIN_USDC)
            fee_usdc = self._q6d(CONSUMER_WITHDRAW_FEE_USDC)
            if amount_usdc < min_amount:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "MIN_WITHDRAWAL_AMOUNT_NOT_MET",
                        "message": f"Minimum consumer withdrawal amount is {CONSUMER_WITHDRAW_MIN_USDC:g} USDC.",
                    },
                )
            if amount_usdc <= fee_usdc:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "AMOUNT_TOO_LOW_FOR_FEE",
                        "message": (
                            f"Withdrawal amount must exceed the platform fee of "
                            f"${CONSUMER_WITHDRAW_FEE_USDC:.2f} USDC."
                        ),
                    },
                )

            reason = str(payload.get("reason") or "").strip()[:256]

            import hashlib, json
            request_hash = hashlib.sha256(
                json.dumps(
                    {
                        "owner": owner,
                        "amountUsdc": f"{amount_usdc:f}",
                        "reason": reason,
                    },
                    sort_keys=True,
                ).encode()
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
            idem_rows: List[Any] = []
            if redis_client is None:
                idem_rows = self._load_idempotency_rows()  # type: ignore[attr-defined]  # reason: mixed in by BalanceRedisGuardMixin
                idem_hit = self._try_get_idempotent_response(  # type: ignore[attr-defined]  # reason: mixed in by BalanceRedisGuardMixin
                    rows=idem_rows,
                    scope="consumer_withdraw_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                )
                if idem_hit is not None:
                    return idem_hit

            rows = self._load_refund_rows(owner_wallet=owner)  # type: ignore[attr-defined]
            now = int(time.time())
            for row in rows:
                if normalize_wallet(str(row.owner_address or "")) != owner:
                    continue
                if str(row.refund_type or "") != CONSUMER_WITHDRAW_TYPE:
                    continue
                row_status = str(row.status or "").upper()
                if row_status in REFUND_ACTIVE_STATUSES:
                    row_amount = self._q6d(row.amount_usdc)
                    if row_amount != amount_usdc:
                        raise HTTPException(409, {"code": "PENDING_WITHDRAWAL_EXISTS"})
                    ledger_check = self._load_balance_ledger()  # type: ignore[attr-defined]
                    avail_check = self._q6d(ledger_check.consumer_available_balance(owner))
                    pend_check = self._q6d(ledger_check.consumer_pending_balance(owner))
                    frozen_check = self._q6d(ledger_check.consumer_frozen_balance(owner))
                    changed = False
                    needs_pending_reserve = (
                        row_status == "REQUESTED"
                        and avail_check >= row_amount
                        and pend_check < row_amount
                    )
                    needs_manual_review_reserve = (
                        row_status == "PENDING_MANUAL_REVIEW"
                        and avail_check >= row_amount
                        and frozen_check < row_amount
                    )
                    needs_ticket = row_status == "REQUESTED" and not row.ticket.signature
                    if needs_pending_reserve or needs_manual_review_reserve or needs_ticket:
                        try:
                            self._assert_withdraw_vault_liquidity(row_amount)  # type: ignore[attr-defined]
                        except RuntimeError as exc:
                            self._raise_consumer_withdraw_runtime_error(str(exc))
                    if needs_pending_reserve:
                        try:
                            self._reserve_consumer_balance(owner, row_amount)  # type: ignore[attr-defined]
                            changed = True
                        except RuntimeError:
                            pass
                    if needs_manual_review_reserve:
                        try:
                            self._reserve_consumer_balance_for_manual_review(owner, row_amount)  # type: ignore[attr-defined]
                            changed = True
                        except RuntimeError:
                            pass
                    if needs_ticket:
                        row.ticket = self._build_consumer_withdraw_ticket(
                            owner=owner,
                            gross_amount_usdc=row_amount,
                            withdrawal_id=str(row.id or ""),
                        )  # type: ignore[attr-defined]
                        row.signature = row.ticket.signature
                        changed = True
                    if changed:
                        row.updated_at = now_dt_str()
                        self._save_refund_rows(rows, now)  # type: ignore[attr-defined]
                    response = self._build_consumer_withdraw_response(
                        row,
                        existing_withdrawal=True,
                    )
                    await self._finalize_consumer_withdraw_idempotency(
                        owner=owner,
                        idempotency_key=idempotency_key,
                        request_hash=request_hash,
                        response=response,
                        redis_client=redis_client,
                        idem_rows=idem_rows,
                    )
                    return response

            ledger = self._load_balance_ledger()  # type: ignore[attr-defined]
            available = self._q6d(ledger.consumer_available_balance(owner))
            if amount_usdc > available:
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

            mature_withdrawable = self._read_consumer_mature_withdrawable(owner, available)
            if amount_usdc > mature_withdrawable:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INSUFFICIENT_MATURE_CONSUMER_BALANCE",
                        "message": (
                            f"Requested {amount_usdc:.6f} USDC exceeds mature withdrawable balance "
                            f"of {mature_withdrawable:.6f} USDC. Recent deposits must mature for "
                            "7 days before withdrawal."
                        ),
                    },
                )

            try:
                self._assert_withdraw_vault_liquidity(amount_usdc)  # type: ignore[attr-defined]
            except RuntimeError as exc:
                self._raise_consumer_withdraw_runtime_error(str(exc))

            daily_count, rolling_amount = self._consumer_withdrawal_window_stats(
                owner,
                rows,
                now,
            )
            risk = self._classify_consumer_withdraw_risk(amount_usdc, daily_count)
            try:
                if risk["status"] == "PENDING_MANUAL_REVIEW":
                    self._reserve_consumer_balance_for_manual_review(
                        owner,
                        amount_usdc,
                    )  # type: ignore[attr-defined]
                else:
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

            withdraw_id = str(uuid4())
            ticket = None
            if risk["status"] == "REQUESTED":
                try:
                    ticket = self._build_consumer_withdraw_ticket(
                        owner=owner,
                        gross_amount_usdc=amount_usdc,
                        withdrawal_id=withdraw_id,
                    )  # type: ignore[attr-defined]
                except HTTPException:
                    self._release_consumer_pending_to_available(
                        owner,
                        amount_usdc,
                    )  # type: ignore[attr-defined]
                    raise
                except Exception as exc:
                    logger.exception(
                        "Consumer withdrawal ticket signing failed",
                        extra={
                            "owner": owner,
                            "withdrawal_id": withdraw_id,
                            "amount_usdc": amount_usdc,
                        },
                    )
                    self._release_consumer_pending_to_available(
                        owner,
                        amount_usdc,
                    )  # type: ignore[attr-defined]
                    raise HTTPException(
                        status_code=503,
                        detail={
                            "code": "WITHDRAW_TICKET_SIGNING_FAILED",
                            "message": (
                                "Unable to prepare a withdrawal ticket right now. "
                                "Please retry after the gateway reconnects."
                            ),
                        },
                    ) from exc

            row = RefundIntentRow(
                id=withdraw_id,
                ownerAddress=owner,
                amountUsdc=amount_usdc,
                reason=reason,
                status=risk["status"],
                signature=ticket.signature if ticket else None,
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
                requestMeta={
                    **(request_meta or {}),
                    **(
                        {
                            "ticketId": ticket.ticket_id,
                            "ticketHash": ticket.ticket_hash,
                            "ticketDeadline": ticket.deadline,
                        }
                        if ticket and ticket.ticket_hash
                        else {}
                    ),
                },
                ticket=ticket or {},
            )
            rows.append(row)
            self._save_refund_rows(rows, now)  # type: ignore[attr-defined]

            response = self._build_consumer_withdraw_response(row)
            await self._finalize_consumer_withdraw_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
                redis_client=redis_client,
                idem_rows=idem_rows,
            )

            self._append_financial_audit(  # type: ignore[attr-defined]
                "CONSUMER_WITHDRAW_INTENT_CREATED",
                owner,
                {
                    "withdrawId": withdraw_id,
                    "amountUsdc": money_str(amount_usdc),
                    "riskLevel": risk["riskLevel"],
                    "riskReasonCode": risk["riskReasonCode"],
                    "dailyCount": daily_count,
                    "rolling24hAmountUsdc": money_str(rolling_amount),
                    "matureWithdrawableUsdc": money_str(mature_withdrawable),
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return response

    async def list_consumer_withdrawals(
        self, owner_wallet: str
    ) -> ConsumerWithdrawListResponse:
        import asyncio
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        rows = self._load_refund_rows(owner_wallet=owner)  # type: ignore[attr-defined]
        result = []
        for row in rows:
            if normalize_wallet(str(row.owner_address or "")) != owner:
                continue
            if str(row.refund_type or "") != CONSUMER_WITHDRAW_TYPE:
                continue
            payload = row.model_dump(
                by_alias=True,
                mode="json",
                exclude_none=True,
            )
            payload["claimable"] = self._is_consumer_withdraw_claimable(payload)
            result.append(payload)
        result.sort(key=lambda r: str(r.get("updatedAt") or ""), reverse=True)
        return result
