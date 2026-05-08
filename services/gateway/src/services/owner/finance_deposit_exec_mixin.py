"""Deposit execution mixin: idempotency, intent persistence, and public methods."""
from __future__ import annotations

import asyncio
import time
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, List, Optional
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.domain.execution import DepositIntentConfirmCommand, DepositIntentRegisterCommand
from src.domain.finance import DepositBalanceMove, DepositIntentDraft
from src.domain.ledger import DepositIntentRow
from src.services.analytics import gateway_events
from src.services.owner.finance_constants import CONSUMER_DEPOSIT_MIN_USDC
from src.utils.datetime_utils import now_dt_str

DepositIntentResponse = dict[str, Any]
DepositSyncStatusResponse = dict[str, Any]


class FinanceDepositExecMixin:
    """Deposit execution: idempotency gate, intent storage, and public deposit endpoints."""

    async def _begin_deposit_idempotency(
        self,
        *,
        owner: str,
        idempotency_key: str,
        request_hash: str,
    ) -> tuple[Optional[dict[str, Any]], Optional[Any], List[dict[str, Any]]]:
        redis_client = await self._get_redis_client()  # type: ignore[attr-defined]
        redis_hit = await self._check_idempotency_redis(  # type: ignore[attr-defined]
            scope="deposit_intent",
            owner_wallet=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if redis_hit is not None:
            return redis_hit, redis_client, []

        started = await self._start_idempotency_redis(  # type: ignore[attr-defined]
            scope="deposit_intent",
            owner_wallet=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if not started:
            redis_retry = await self._check_idempotency_redis(  # type: ignore[attr-defined]
                scope="deposit_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if redis_retry is not None:
                return redis_retry, redis_client, []

        idem_rows: List[dict[str, Any]] = []
        if redis_client is None:
            idem_rows = self._load_idempotency_rows()  # type: ignore[attr-defined]
            idem_hit = self._try_get_idempotent_response(  # type: ignore[attr-defined]
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
        if hasattr(self.storage, "register_deposit_intent_atomic"):  # type: ignore[attr-defined]
            saved = self.storage.register_deposit_intent_atomic(  # type: ignore[attr-defined]  # quality-budget-disable-reason: Postgres storage exposes atomic deposit persistence.
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
        self._reserve_pending_deposit_amount(owner, draft.amount_usdc)  # type: ignore[attr-defined]
        intents.append(next_intent)
        self._save_deposit_intents(intents)  # type: ignore[attr-defined]
        return next_intent

    def _audit_deposit_confirm(
        self,
        *,
        owner: str,
        deposit_intent_id: str,
        event_key: str,
        confirmations: int,
        request_meta: Optional[dict[str, Any]],
        confirmed_row: Optional[DepositIntentRow] = None,
        moved: Optional[DepositBalanceMove] = None,
    ) -> None:
        details: dict[str, Any] = {
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
        self._append_financial_audit("DEPOSIT_INTENT_CONFIRMED", owner, details)  # type: ignore[attr-defined]

    async def _emit_deposit_completed_for_confirmed_intent(
        self,
        *,
        owner: str,
        confirmed_row: DepositIntentRow,
    ) -> None:
        await gateway_events.emit_deposit_completed(
            owner,
            amount_usdc=Decimal(str(confirmed_row.amount_usdc or "0")),
            tx_hash=str(confirmed_row.tx_hash or ""),
        )

    def _confirm_deposit_intent_atomic_or_raise(
        self,
        *,
        owner: str,
        deposit_intent_id: str,
        event_key: str,
        confirmations: int,
    ) -> DepositIntentRow:
        try:
            result = self.storage.confirm_deposit_intent_atomic(  # type: ignore[attr-defined]  # quality-budget-disable-reason: Postgres storage exposes atomic deposit confirmation.
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
                ) from exc
            if code == "DEPOSIT_STATUS_INVALID":
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "DEPOSIT_STATUS_INVALID",
                        "message": "Deposit intent cannot be confirmed from current status.",
                    },
                ) from exc
            raise
        if isinstance(result, DepositIntentRow):
            return result
        raise RuntimeError("DEPOSIT_CONFIRM_RESULT_INVALID")

    def _parse_deposit_intent_draft(
        self,
        *,
        intent: dict[str, Any],
        owner: str,
    ) -> DepositIntentDraft:
        tx_hash = self._normalize_tx_hash_or_raise(str(intent.get("txHash") or ""))  # type: ignore[attr-defined]

        try:
            amount_usdc = Decimal(str(intent.get("amountUsdc") or "0")).quantize(
                Decimal("0.000001"), rounding=ROUND_HALF_UP
            )
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be a valid decimal number.",
                },
            ) from exc
        if amount_usdc <= Decimal("0"):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be greater than 0.",
                },
            )
        min_deposit = Decimal(str(CONSUMER_DEPOSIT_MIN_USDC)).quantize(
            Decimal("0.000001"), rounding=ROUND_HALF_UP
        )
        if amount_usdc < min_deposit:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "MIN_DEPOSIT_AMOUNT_NOT_MET",
                    "message": f"Minimum deposit amount is {min_deposit} USDC.",
                },
            )

        request_hash = self._request_hash(  # type: ignore[attr-defined]
            {
                "ownerAddress": owner,
                "txHash": tx_hash,
                "amountUsdc": str(amount_usdc),
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
            if self._deposit_owner(row) != owner:  # type: ignore[attr-defined]
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
        request_meta: Optional[dict[str, Any]] = None,
    ) -> DepositIntentResponse:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:deposit_confirm"):  # type: ignore[attr-defined]
            await self._enforce_owner_write_rate_limit(owner, "deposit_confirm")  # type: ignore[attr-defined]

            if hasattr(self.storage, "confirm_deposit_intent_atomic"):  # type: ignore[attr-defined]
                result = self._confirm_deposit_intent_atomic_or_raise(
                    owner=owner,
                    deposit_intent_id=deposit_intent_id,
                    event_key=event_key,
                    confirmations=confirmations,
                )
                newly_confirmed = result.event_key is not None and str(
                    result.event_key
                ) == str(event_key or "")
                if newly_confirmed:
                    self._audit_deposit_confirm(
                        owner=owner,
                        deposit_intent_id=deposit_intent_id,
                        event_key=event_key,
                        confirmations=confirmations,
                        request_meta=request_meta,
                        confirmed_row=result,
                    )
                    await self._emit_deposit_completed_for_confirmed_intent(
                        owner=owner,
                        confirmed_row=result,
                    )
                return result.model_dump(by_alias=True, mode="json")

            intents = self._load_deposit_intents()  # type: ignore[attr-defined]
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
            moved = self._confirm_pending_deposit_amount(owner, amount_usdc)  # type: ignore[attr-defined]
            now = int(time.time())
            target.status = "CONFIRMED"
            target.event_key = str(event_key or "")
            target.confirmations = int(confirmations)
            target.credited_amount_usdc = amount_usdc
            target.confirmed_at = now
            target.updated_at = now_dt_str()
            self._save_deposit_intents(intents)  # type: ignore[attr-defined]

            self._audit_deposit_confirm(
                owner=owner,
                deposit_intent_id=deposit_intent_id,
                event_key=event_key,
                confirmations=confirmations,
                request_meta=request_meta,
                confirmed_row=target,
                moved=moved,
            )
            await self._emit_deposit_completed_for_confirmed_intent(
                owner=owner,
                confirmed_row=target,
            )
            return target.model_dump(by_alias=True, mode="json")

    async def register_deposit_intent(
        self,
        intent: dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> DepositIntentResponse:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:deposit_intent"):  # type: ignore[attr-defined]
            idempotency_key = self._validate_idempotency_key(idempotency_key)  # type: ignore[attr-defined]
            await self._enforce_owner_write_rate_limit(owner, "deposit_intent")  # type: ignore[attr-defined]

            draft = self._parse_deposit_intent_draft(intent=intent, owner=owner)

            intents = self._load_deposit_intents()  # type: ignore[attr-defined]
            idem_hit, redis_client, idem_rows = await self._begin_deposit_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=draft.request_hash,
            )
            if idem_hit is not None:
                return idem_hit

            replay_hit = self._validate_unique_recent_deposit(intents, owner, draft.tx_hash)  # type: ignore[attr-defined]
            if replay_hit is not None:
                if redis_client is None:
                    self._record_idempotent_response(  # type: ignore[attr-defined]
                        rows=idem_rows,
                        scope="deposit_intent",
                        owner_wallet=owner,
                        idempotency_key=idempotency_key,
                        request_hash=draft.request_hash,
                        response=replay_hit,
                    )
                await self._complete_idempotency_redis(  # type: ignore[attr-defined]
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
                self._record_idempotent_response(  # type: ignore[attr-defined]
                    rows=idem_rows,
                    scope="deposit_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=draft.request_hash,
                    response=response,
                )
            await self._complete_idempotency_redis(  # type: ignore[attr-defined]
                scope="deposit_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=draft.request_hash,
                response=response,
            )
            self._append_financial_audit(  # type: ignore[attr-defined]
                "DEPOSIT_INTENT_REGISTERED",
                owner,
                {
                    "businessType": "deposit",
                    "depositIntentId": next_intent.id,
                    "txHash": next_intent.tx_hash,
                    "amountUsdc": str(next_intent.amount_usdc),
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return response

    async def list_deposit_intents(self, owner_wallet: str) -> list:
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        rows = self._load_deposit_intents()  # type: ignore[attr-defined]
        return [
            row.model_dump(by_alias=True, mode="json")
            for row in rows
            if self._deposit_owner(row) == normalized_owner  # type: ignore[attr-defined]
        ]

    async def get_deposit_sync_status(
        self, owner_wallet: str, tx_hash: str
    ) -> DepositSyncStatusResponse:
        await asyncio.sleep(0)
        rows = self._load_deposit_intents()  # type: ignore[attr-defined]
        target = self._find_deposit_intent_by_tx_hash(rows, owner_wallet, tx_hash)  # type: ignore[attr-defined]
        return self._deposit_sync_status_from_row(tx_hash, target)  # type: ignore[attr-defined]
