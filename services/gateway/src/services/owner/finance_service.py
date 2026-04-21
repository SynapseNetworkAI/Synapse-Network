from __future__ import annotations

from typing import Any, List, Optional
import time
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.redis_lock import RedisLockManager
from src.domain.finance import BalanceLedger
from src.domain.finance import (
    DepositAttemptRow,
    DepositBalanceMove,
    RefundIntentRow,
    UsageLogRow,
)
from src.domain.ledger import DepositIntentRow
from src.domain.operation_metadata import WithdrawalTicketMetadata
from src.services.balance_mixins import BalanceAuditMixin, BalanceRedisGuardMixin, BalanceWithdrawSigningMixin
from src.services.owner.finance_constants import (
    CONSUMER_WITHDRAW_FEE_USDC,
    DEPOSIT_ATTEMPT_STAGES,
    INVALID_TX_HASH_MESSAGE,
)
from src.services.owner.finance_consumer_withdraw_mixin import FinanceConsumerWithdrawMixin
from src.services.owner.finance_deposit_exec_mixin import FinanceDepositExecMixin
from src.services.owner.finance_refund_analysis_mixin import FinanceRefundAnalysisMixin
from src.services.owner.finance_refund_exec_mixin import FinanceRefundExecMixin
from src.storage.base import BaseStorage
from src.utils.datetime_utils import now_dt_str
from src.utils.money import money_str, parse_usdc, quantize_usdc, usdc_decimal_to_atomic


class OwnerFinanceService(
    FinanceConsumerWithdrawMixin,
    FinanceDepositExecMixin,
    FinanceRefundAnalysisMixin,
    FinanceRefundExecMixin,
    BalanceWithdrawSigningMixin,
    BalanceAuditMixin,
    BalanceRedisGuardMixin,
):
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

    def _reserve_consumer_balance(self, owner: str, amount_usdc: Decimal | str | int) -> None:
        """Atomically move *amount_usdc* from consumer available → pending."""
        self.storage.get_data_manager().finance.balance.reserve_consumer_balance_for_withdrawal(
            owner=owner,
            amount_usdc=parse_usdc(amount_usdc),
            updated_at=now_dt_str(),
        )

    def _reserve_consumer_balance_for_manual_review(
        self, owner: str, amount_usdc: Decimal | str | int
    ) -> None:
        self.storage.get_data_manager().finance.balance.reserve_consumer_balance_for_manual_review(
            owner=owner,
            amount_usdc=parse_usdc(amount_usdc),
            updated_at=now_dt_str(),
        )

    def _move_consumer_frozen_to_pending(self, owner: str, amount_usdc: Decimal | str | int) -> None:
        self.storage.get_data_manager().finance.balance.move_consumer_frozen_to_pending(
            owner=owner,
            amount_usdc=parse_usdc(amount_usdc),
            updated_at=now_dt_str(),
        )

    def _release_consumer_pending_to_available(
        self, owner: str, amount_usdc: Decimal | str | int
    ) -> None:
        self.storage.get_data_manager().finance.balance.release_consumer_pending_to_available(
            owner=owner,
            amount_usdc=parse_usdc(amount_usdc),
            updated_at=now_dt_str(),
        )

    def _release_consumer_frozen_to_available(
        self, owner: str, amount_usdc: Decimal | str | int
    ) -> None:
        self.storage.get_data_manager().finance.balance.release_consumer_frozen_to_available(
            owner=owner,
            amount_usdc=parse_usdc(amount_usdc),
            updated_at=now_dt_str(),
        )

    def _build_consumer_withdraw_ticket(
        self, *, owner: str, gross_amount_usdc: Decimal, withdrawal_id: str
    ) -> WithdrawalTicketMetadata:
        from src.core.config import settings
        from src.services.balance_mixins.withdraw_signing import USDC_DECIMALS

        fee_usdc = Decimal(str(CONSUMER_WITHDRAW_FEE_USDC))
        net_usdc = quantize_usdc(gross_amount_usdc - fee_usdc)
        private_key = self._require_withdraw_signer()
        chain_id = self._resolve_withdraw_chain()
        deadline = int(time.time()) + self._resolve_withdraw_deadline_sec()
        net_wei = usdc_decimal_to_atomic(net_usdc, decimals=USDC_DECIMALS)
        fee_wei = usdc_decimal_to_atomic(fee_usdc, decimals=USDC_DECIMALS)
        ticket_id = self._derive_withdraw_ticket_id(withdrawal_id=withdrawal_id)
        typed_data = self._build_withdraw_typed_data(
            owner_wallet=owner,
            amount_wei=net_wei,
            fee_wei=fee_wei,
            ticket_id=ticket_id,
            deadline=deadline,
            chain_id=chain_id,
            verifying_contract=normalize_wallet(settings.router_address),
        )
        signature, ticket_hash = self._sign_withdraw_ticket(typed_data, private_key)
        return WithdrawalTicketMetadata.model_validate(
            {
                "ticketId": ticket_id,
                "ticketHash": ticket_hash,
                "amount": str(net_wei),
                "fee": str(fee_wei),
                "deadline": deadline,
                "signature": signature,
                "chainId": chain_id,
                "contractAddress": normalize_wallet(settings.router_address),
            }
        )

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
    ) -> dict[str, Any]:
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
            "amountUsdc": money_str(row.amount_usdc),
            "creditedAmountUsdc": money_str(row.credited_amount_usdc),
            "confirmations": int(row.confirmations or 0),
            "eventKey": str(row.event_key or "") or None,
            "confirmedAt": row.confirmed_at,
            "updatedAt": str(row.updated_at or "") or None,
            "source": "deposit_intent",
        }

    def _load_refund_rows(self, *, owner_wallet: str | None = None) -> List[RefundIntentRow]:
        rows = self.storage.get_data_manager().system.gateway_state.read_consumer_refund_rows(
            owner_wallet=owner_wallet
        )
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

    def _require_deposit_attempt_id(self, payload: dict[str, Any]) -> str:
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
        self, request_meta: Optional[dict[str, Any]], key: str
    ) -> Optional[str]:
        value = str((request_meta or {}).get(key) or "").strip()
        return value or None

    def _build_deposit_attempt_row(
        self,
        *,
        payload: dict[str, Any],
        owner: str,
        attempt_id: str,
        amount_usdc: Decimal,
        stage: str,
        tx_hash: Optional[str],
        request_meta: Optional[dict[str, Any]],
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

    def _serialize_deposit_attempt_row(self, saved: Any) -> dict[str, Any]:
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
        payload: dict[str, Any],
        owner_wallet: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
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
        consumer_wallet.pending_balance = parse_usdc(
            Decimal(str(consumer_wallet.pending_balance or "0")) + parse_usdc(amount_usdc)
        )
        self._save_balance_ledger(ledger)

    def _confirm_pending_deposit_amount(
        self, owner: str, amount_usdc: Decimal
    ) -> DepositBalanceMove:
        ledger = self._load_balance_ledger()
        consumer_wallet = ledger.ensure_consumer_wallet(owner)
        available_before = parse_usdc(consumer_wallet.available_balance)
        pending_before = parse_usdc(consumer_wallet.pending_balance)
        amount = parse_usdc(amount_usdc)
        if pending_before < amount:
            raise RuntimeError("DEPOSIT_PENDING_BALANCE_INCONSISTENT")

        consumer_wallet.available_balance = parse_usdc(available_before + amount)
        consumer_wallet.pending_balance = parse_usdc(max(Decimal("0"), pending_before - amount))
        self._save_balance_ledger(ledger)
        return DepositBalanceMove(
            available_before=available_before,
            available_after=parse_usdc(consumer_wallet.available_balance),
            pending_before=pending_before,
            pending_after=parse_usdc(consumer_wallet.pending_balance),
        )

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

    def _consume_locked_refund_amount(self, owner: str, amount_usdc: Decimal | str | int) -> None:
        """Atomically reduce pending_balance after withdrawal/refund completion.

        Uses the atomic SQL path so the change is not discarded by
        ``write_balance_ledger`` (which intentionally only writes available).
        """
        from src.utils.datetime_utils import now_dt_str as _now
        try:
            self.storage.get_data_manager().finance.balance.consume_consumer_pending_for_withdrawal(
                owner=owner,
                amount_usdc=parse_usdc(amount_usdc),
                updated_at=_now(),
            )
        except RuntimeError:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_LOCK_INCONSISTENT",
                    "message": "Locked owner balance is insufficient for this refund intent.",
                },
            )

    def _reserve_owner_refund_amount(self, owner: str, amount_usdc: Decimal | str | int) -> None:
        ledger = self._load_balance_ledger()
        consumer_wallet = ledger.ensure_consumer_wallet(owner)
        available_balance = parse_usdc(consumer_wallet.available_balance)
        amount = parse_usdc(amount_usdc)
        if amount > available_balance:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INSUFFICIENT_OWNER_BALANCE",
                    "message": "amountUsdc exceeds owner available balance.",
                },
            )
        consumer_wallet.available_balance = parse_usdc(available_balance - amount)
        consumer_wallet.pending_balance = parse_usdc(
            Decimal(str(consumer_wallet.pending_balance or "0")) + amount
        )
        self._save_balance_ledger(ledger)

    async def _finalize_refund_idempotency(
        self,
        *,
        owner: str,
        idempotency_key: str,
        request_hash: str,
        response: dict[str, Any],
        redis_client: Optional[Any],
        idem_rows: List[dict[str, Any]],
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
        amount_usdc: Decimal | str | int,
        idempotency_key: str,
        request_hash: str,
        redis_client: Optional[Any],
        idem_rows: List[dict[str, Any]],
    ) -> dict[str, Any]:
        pending_amount = parse_usdc(pending.amount_usdc)
        requested_amount = parse_usdc(amount_usdc)
        if pending_amount != requested_amount:
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
