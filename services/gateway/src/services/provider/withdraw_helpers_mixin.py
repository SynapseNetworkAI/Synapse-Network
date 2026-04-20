"""Provider withdrawal helper methods mixin.

Contains all I/O helpers, validators, assertion methods, and the
expire_stale_provider_withdrawals public endpoint.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, List, Literal, Optional, cast

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.domain.finance import BalanceLedger, WithdrawCreateContext
from src.domain.ledger import WithdrawalIntentRow
from src.domain.operation_metadata import OperationContextMetadata, WithdrawalTicketMetadata
from src.utils.datetime_utils import now_dt_str, to_dt_str
from src.utils.money import money_str, quantize_usdc

ACTIVE_WITHDRAWAL_STATUSES = {
    "REQUESTED",
    "APPROVED_AUTO",
    "PENDING_MANUAL_REVIEW",
    "PENDING",
}
INSUFFICIENT_RECEIVABLE_MESSAGE = "amountUsdc exceeds provider receivable."
MANUAL_REVIEW_REJECT_MESSAGE = "Withdrawal rejected during manual security review."
MANUAL_REVIEW_APPROVED_MESSAGE = "Withdrawal approved. Signed ticket is ready for on-chain claim."
EXPIRED_WITHDRAW_RELEASE_MESSAGE = "Withdrawal ticket expired. Locked receivable was released back to available balance."
EXPIRED_WITHDRAW_RECONCILED_MESSAGE = "Withdrawal ticket expired. Locked receivable had already been reconciled before cleanup."
WITHDRAW_AMOUNT_PRECISION = Decimal("0.01")
INSUFFICIENT_VAULT_LIQUIDITY_MESSAGE = "Vault liquidity is insufficient for this withdrawal right now. The platform treasury must refill on-chain USDC before you retry."
WITHDRAW_VAULT_CHECK_UNAVAILABLE_MESSAGE = "Unable to verify vault liquidity right now. Retry after the gateway reconnects to chain RPC."
WithdrawalRowStatus = Literal[
    "REQUESTED", "APPROVED_AUTO", "PENDING_MANUAL_REVIEW",
    "REJECTED", "COMPLETED", "CANCELLED",
]
WITHDRAW_ROW_STATUSES: set[WithdrawalRowStatus] = {
    "REQUESTED", "APPROVED_AUTO", "PENDING_MANUAL_REVIEW",
    "REJECTED", "COMPLETED", "CANCELLED",
}


class ProviderWithdrawHelpersMixin:
    """Withdrawal I/O helpers, validators, and assertion methods."""

    def _provider_balance_repository(self) -> Any:
        get_data_manager = getattr(self.storage, "get_data_manager", None)
        if not callable(get_data_manager):
            return None
        return getattr(get_data_manager().finance, "balance", None)

    @staticmethod
    def _raise_withdraw_runtime_error(code: str) -> None:
        if code == "INSUFFICIENT_PROVIDER_RECEIVABLE":
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INSUFFICIENT_PROVIDER_RECEIVABLE",
                    "message": INSUFFICIENT_RECEIVABLE_MESSAGE,
                },
            )
        if code == "INVALID_WITHDRAW_AMOUNT":
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be greater than 0."},
            )
        if code == "INSUFFICIENT_VAULT_LIQUIDITY":
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INSUFFICIENT_VAULT_LIQUIDITY",
                    "message": INSUFFICIENT_VAULT_LIQUIDITY_MESSAGE,
                },
            )
        if code == "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE":
            raise HTTPException(
                status_code=503,
                detail={
                    "code": "WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE",
                    "message": WITHDRAW_VAULT_CHECK_UNAVAILABLE_MESSAGE,
                },
            )

    @staticmethod
    def _withdraw_owner(row: WithdrawalIntentRow) -> str:
        return normalize_wallet(str(row.owner_address or ""))

    @staticmethod
    def _withdraw_created_at(row: WithdrawalIntentRow) -> int:
        normalized = to_dt_str(row.created_at, "") or ""
        if not normalized:
            return 0
        try:
            return int(
                datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
                .replace(tzinfo=timezone.utc)
                .timestamp()
            )
        except Exception:
            return 0

    def _normalize_withdrawal_rows(self) -> List[WithdrawalIntentRow]:
        raw_rows = self.storage.get_data_manager().system.gateway_state.read_provider_withdrawal_rows()  # type: ignore[attr-defined]
        rows: List[WithdrawalIntentRow] = []
        if isinstance(raw_rows, list):
            for row in raw_rows:
                if isinstance(row, WithdrawalIntentRow):
                    rows.append(row)
        for row in rows:
            status = str(row.status or "").upper()
            if not status or status == "PENDING":
                row.status = "REQUESTED"
            elif status in WITHDRAW_ROW_STATUSES:
                row.status = cast(WithdrawalRowStatus, status)
        return rows

    def _save_withdrawal_rows(self, rows: List[WithdrawalIntentRow]) -> None:
        self.storage.get_data_manager().system.gateway_state.write_provider_withdrawal_rows(  # type: ignore[attr-defined]
            rows, int(time.time())
        )

    def _load_balance_ledger(self) -> BalanceLedger:
        return self.storage.get_data_manager().finance.balance.read_balance_ledger()  # type: ignore[attr-defined]

    def _save_balance_ledger(self, ledger: BalanceLedger) -> None:
        ledger.updated_at = now_dt_str()
        self.storage.get_data_manager().finance.balance.write_balance_ledger(ledger)  # type: ignore[attr-defined]

    @staticmethod
    def _operation_context_metadata(
        request_meta: Optional[dict[str, Any]] = None,
    ) -> OperationContextMetadata:
        return OperationContextMetadata.model_validate(request_meta or {})

    @staticmethod
    def _withdrawal_ticket_metadata(
        ticket_payload: dict[str, Any],
    ) -> WithdrawalTicketMetadata:
        return WithdrawalTicketMetadata.model_validate(ticket_payload)

    def _get_pending_withdrawal(
        self, rows: List[WithdrawalIntentRow], owner_wallet: str
    ) -> Optional[WithdrawalIntentRow]:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if self._withdraw_owner(row) != owner:
                continue
            if str(row.status or "").upper() in ACTIVE_WITHDRAWAL_STATUSES:
                return row
        return None

    @staticmethod
    def _is_expired_signed_withdrawal(
        row: WithdrawalIntentRow, now: Optional[int] = None
    ) -> bool:
        status = str(row.status or "").upper()
        if status not in {"APPROVED_AUTO", "REQUESTED", "PENDING"}:
            return False
        deadline = int(row.deadline or 0)
        if deadline <= 0:
            return False
        return deadline < int(now or time.time())

    def _expire_stale_withdrawals(
        self, rows: List[WithdrawalIntentRow], owner_wallet: Optional[str] = None
    ) -> List[WithdrawalIntentRow]:
        owner = normalize_wallet(owner_wallet) if owner_wallet is not None else None
        now = int(time.time())
        now_text = now_dt_str()
        changed = False
        for row in rows:
            row_owner = self._withdraw_owner(row)
            if owner is not None and row_owner != owner:
                continue
            if not self._is_expired_signed_withdrawal(row, now):
                continue
            amount_usdc = quantize_usdc(row.amount_usdc or Decimal("0"))
            released_amount_usdc = Decimal("0")
            if amount_usdc > Decimal("0"):
                released_amount_usdc = self._release_pending_withdraw_to_available(row_owner, amount_usdc)
            release_shortfall_usdc = quantize_usdc(max(Decimal("0"), amount_usdc - released_amount_usdc))
            row.status = "CANCELLED"
            row.updated_at = now_text
            row.completed_at = now
            row.message = (
                EXPIRED_WITHDRAW_RELEASE_MESSAGE
                if release_shortfall_usdc <= Decimal("0")
                else EXPIRED_WITHDRAW_RECONCILED_MESSAGE
            )
            changed = True
            self._append_financial_audit(  # type: ignore[attr-defined]
                "PROVIDER_WITHDRAW_CANCELLED",
                row_owner,
                {
                    "withdrawalId": str(row.id or ""),
                    "amountUsdc": money_str(amount_usdc),
                    "releasedAmountUsdc": money_str(released_amount_usdc),
                    "releaseShortfallUsdc": money_str(release_shortfall_usdc),
                    "reason": "TICKET_EXPIRED",
                    "deadline": int(row.deadline or 0),
                },
            )
        if changed:
            self._save_withdrawal_rows(rows)
        return rows

    async def expire_stale_provider_withdrawals(self) -> int:
        await asyncio.sleep(0)
        async with self._mutation_lock.lock("provider_withdraw_expiry_reaper"):  # type: ignore[attr-defined]
            rows = self._normalize_withdrawal_rows()
            before_cancelled = sum(1 for row in rows if str(row.status or "").upper() == "CANCELLED")
            rows = self._expire_stale_withdrawals(rows)
            after_cancelled = sum(1 for row in rows if str(row.status or "").upper() == "CANCELLED")
            return max(0, after_cancelled - before_cancelled)

    def _find_withdrawal_by_id(
        self, rows: List[WithdrawalIntentRow], owner_wallet: str, withdrawal_id: str
    ) -> Optional[WithdrawalIntentRow]:
        owner = normalize_wallet(owner_wallet)
        target = str(withdrawal_id or "").strip()
        if not target:
            return None
        for row in rows:
            if str(row.id or "") != target:
                continue
            if self._withdraw_owner(row) != owner:
                continue
            return row
        return None

    def _parse_withdraw_amount_usdc(self, payload: dict[str, Any], available: Decimal) -> Decimal:
        raw = payload.get("amountUsdc")
        if raw is None:
            if available <= Decimal("0"):
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INSUFFICIENT_PROVIDER_RECEIVABLE",
                        "message": "No provider receivable available for withdrawal.",
                    },
                )
            return quantize_usdc(available)
        try:
            if isinstance(raw, float):
                raise TypeError("float is forbidden for amountUsdc")
            amount = Decimal(str(raw))
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be a decimal string or integer value."},
            )
        if amount != amount.quantize(WITHDRAW_AMOUNT_PRECISION):
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc supports up to 2 decimal places."},
            )
        if amount <= 0:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be greater than 0."},
            )
        available_amount = quantize_usdc(available)
        if amount > available_amount:
            raise HTTPException(
                status_code=400,
                detail={"code": "INSUFFICIENT_PROVIDER_RECEIVABLE", "message": INSUFFICIENT_RECEIVABLE_MESSAGE},
            )
        return quantize_usdc(amount)

    def _requested_withdraw_amount_for_hash(self, payload: dict[str, Any]) -> Any:
        raw = payload.get("amountUsdc")
        if raw is None:
            return None
        try:
            if isinstance(raw, float):
                raise TypeError("float is forbidden for amountUsdc")
            amount = Decimal(str(raw))
            if amount != amount.quantize(WITHDRAW_AMOUNT_PRECISION):
                return raw
            return money_str(amount)
        except Exception:
            return raw

    def _parse_requested_withdraw_amount_usdc(self, payload: dict[str, Any]) -> Decimal:
        return self._parse_withdraw_amount_usdc(payload, Decimal("999999999999999999"))

    def _build_withdraw_create_context(
        self, *, owner: str, payload: dict[str, Any], available_receivable: Decimal,
    ) -> WithdrawCreateContext:
        amount_usdc = self._parse_withdraw_amount_usdc(payload, available_receivable)
        request_hash = self._request_hash(  # type: ignore[attr-defined]
            {"ownerAddress": owner, "amountUsdc": self._requested_withdraw_amount_for_hash(payload)}
        )
        return WithdrawCreateContext(amount_usdc=quantize_usdc(amount_usdc), request_hash=request_hash)

    def _build_pending_withdraw_response(self, row: WithdrawalIntentRow) -> dict[str, Any]:
        return {
            "withdrawalId": str(row.id or ""),
            "status": str(row.status or "REQUESTED"),
            "amountUsdc": money_str(row.amount_usdc or Decimal("0")),
            "ticket": row.ticket.model_dump(by_alias=True, mode="json", exclude_none=True),
            "message": str(row.message or ""),
        }

    def _normalize_tx_hash_or_raise(self, tx_hash: str) -> str:
        normalized = str(tx_hash or "").strip().lower()
        if not normalized.startswith("0x") or len(normalized) != 66:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_TX_HASH", "message": "txHash must be a 66-char 0x-prefixed hash."},
            )
        return normalized

    def _assert_withdrawal_completable(
        self, target: WithdrawalIntentRow, tx_hash: str
    ) -> Optional[dict[str, Any]]:
        status = str(target.status or "").upper()
        if status == "COMPLETED":
            existing_tx = str(target.tx_hash or "")
            if existing_tx and existing_tx != tx_hash:
                raise HTTPException(
                    status_code=409,
                    detail={"code": "WITHDRAWAL_ALREADY_COMPLETED", "message": "Withdrawal already completed with a different txHash."},
                )
            return {"withdrawalId": str(target.id or ""), "status": "COMPLETED", "txHash": existing_tx}
        if status not in {"APPROVED_AUTO", "REQUESTED", "PENDING"}:
            raise HTTPException(
                status_code=409,
                detail={"code": "WITHDRAWAL_NOT_PENDING", "message": f"Withdrawal status={status} cannot be completed."},
            )
        return None

    def _assert_no_withdraw_tx_replay(
        self, rows: List[WithdrawalIntentRow], owner_wallet: str, tx_hash: str, current_withdrawal_id: str,
    ) -> None:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if self._withdraw_owner(row) != owner:
                continue
            if str(row.id or "") == current_withdrawal_id:
                continue
            if str(row.tx_hash or "").strip().lower() != tx_hash:
                continue
            raise HTTPException(
                status_code=409,
                detail={"code": "WITHDRAWAL_TX_REPLAY_DETECTED", "message": "txHash is already bound to another withdrawal."},
            )

    def _consume_locked_withdraw_amount(self, owner: str, amount_usdc: Decimal) -> None:
        balance_repo = self._provider_balance_repository()
        consume_pending = getattr(balance_repo, "consume_provider_pending_for_withdrawal", None)
        if callable(consume_pending):
            try:
                consume_pending(owner, amount_usdc, now_dt_str())
                return
            except RuntimeError as exc:
                if str(exc) != "CONSUME_PROVIDER_PENDING_INCONSISTENT":
                    raise
                raise HTTPException(
                    status_code=409,
                    detail={"code": "WITHDRAWAL_LOCK_INCONSISTENT", "message": "Locked provider receivable is insufficient for this withdrawal intent."},
                ) from exc
        ledger = self._load_balance_ledger()
        provider_wallet = ledger.ensure_provider_wallet(owner)
        locked = quantize_usdc(provider_wallet.pending_balance or Decimal("0"))
        amount = quantize_usdc(amount_usdc)
        if locked < amount:
            raise HTTPException(
                status_code=409,
                detail={"code": "WITHDRAWAL_LOCK_INCONSISTENT", "message": "Locked provider receivable is insufficient for this withdrawal intent."},
            )
        provider_wallet.pending_balance = quantize_usdc(max(Decimal("0"), locked - amount))
        self._save_balance_ledger(ledger)

    def _release_pending_withdraw_to_available(self, owner: str, amount_usdc: Decimal) -> Decimal:
        balance_repo = self._provider_balance_repository()
        release_pending = getattr(balance_repo, "release_provider_pending_to_available", None)
        if callable(release_pending):
            amount = quantize_usdc(amount_usdc)
            try:
                release_pending(owner, amount, now_dt_str())
                return amount
            except RuntimeError as exc:
                if str(exc) != "RELEASE_PROVIDER_PENDING_TO_AVAILABLE_INCONSISTENT":
                    raise
                return Decimal("0")
        ledger = self._load_balance_ledger()
        provider_wallet = ledger.ensure_provider_wallet(owner)
        locked = quantize_usdc(provider_wallet.pending_balance or Decimal("0"))
        requested_amount = quantize_usdc(amount_usdc)
        releasable_amount = quantize_usdc(min(max(Decimal("0"), requested_amount), locked))
        if releasable_amount <= Decimal("0"):
            return Decimal("0")
        provider_wallet.pending_balance = quantize_usdc(max(Decimal("0"), locked - releasable_amount))
        provider_wallet.available_balance = quantize_usdc(
            quantize_usdc(provider_wallet.available_balance or Decimal("0")) + releasable_amount
        )
        self._save_balance_ledger(ledger)
        return releasable_amount

    def _release_frozen_withdraw_to_available(self, owner: str, amount_usdc: Decimal) -> None:
        balance_repo = self._provider_balance_repository()
        release_frozen = getattr(balance_repo, "release_provider_frozen_to_available", None)
        if callable(release_frozen):
            try:
                release_frozen(owner, amount_usdc, now_dt_str())
                return
            except RuntimeError as exc:
                if str(exc) != "RELEASE_PROVIDER_FROZEN_TO_AVAILABLE_INCONSISTENT":
                    raise
                raise HTTPException(
                    status_code=409,
                    detail={"code": "WITHDRAWAL_FROZEN_INCONSISTENT", "message": "Frozen provider receivable is insufficient for this manual review action."},
                ) from exc
        ledger = self._load_balance_ledger()
        provider_wallet = ledger.ensure_provider_wallet(owner)
        frozen = quantize_usdc(provider_wallet.frozen_balance or Decimal("0"))
        amount = quantize_usdc(amount_usdc)
        if frozen < amount:
            raise HTTPException(
                status_code=409,
                detail={"code": "WITHDRAWAL_FROZEN_INCONSISTENT", "message": "Frozen provider receivable is insufficient for this manual review action."},
            )
        provider_wallet.frozen_balance = quantize_usdc(max(Decimal("0"), frozen - amount))
        provider_wallet.available_balance = quantize_usdc(
            quantize_usdc(provider_wallet.available_balance or Decimal("0")) + amount
        )
        self._save_balance_ledger(ledger)

    def _move_frozen_withdraw_to_pending(self, owner: str, amount_usdc: Decimal) -> None:
        balance_repo = self._provider_balance_repository()
        move_frozen = getattr(balance_repo, "move_provider_frozen_to_pending", None)
        if callable(move_frozen):
            try:
                move_frozen(owner, amount_usdc, now_dt_str())
                return
            except RuntimeError as exc:
                if str(exc) != "MOVE_PROVIDER_FROZEN_TO_PENDING_INCONSISTENT":
                    raise
                raise HTTPException(
                    status_code=409,
                    detail={"code": "WITHDRAWAL_FROZEN_INCONSISTENT", "message": "Frozen provider receivable is insufficient for this manual review action."},
                ) from exc
        ledger = self._load_balance_ledger()
        provider_wallet = ledger.ensure_provider_wallet(owner)
        frozen = quantize_usdc(provider_wallet.frozen_balance or Decimal("0"))
        amount = quantize_usdc(amount_usdc)
        if frozen < amount:
            raise HTTPException(
                status_code=409,
                detail={"code": "WITHDRAWAL_FROZEN_INCONSISTENT", "message": "Frozen provider receivable is insufficient for this manual review action."},
            )
        provider_wallet.frozen_balance = quantize_usdc(max(Decimal("0"), frozen - amount))
        provider_wallet.pending_balance = quantize_usdc(
            quantize_usdc(provider_wallet.pending_balance or Decimal("0")) + amount
        )
        self._save_balance_ledger(ledger)
