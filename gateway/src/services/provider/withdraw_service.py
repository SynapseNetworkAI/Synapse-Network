from typing import Any, Dict, List, Optional
import asyncio
import time
from uuid import uuid4
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.core.redis_lock import RedisLockManager
from src.domain.execution import (
    CompleteWithdrawTxCommand,
    PreparedWithdrawTicket,
    ReserveProviderWithdrawCommand,
    WithdrawalAtomicRequestCommand,
    WithdrawalDecision,
)
from src.domain.finance import BalanceLedger
from src.domain.finance import (
    WithdrawCreateContext,
)
from src.domain.ledger import WithdrawalIntentRow
from src.services.balance_mixins import (
    BalanceAuditMixin,
    BalanceRedisGuardMixin,
    BalanceWithdrawSigningMixin,
    USDC_DECIMALS,
)
from src.storage.base import BaseStorage


WITHDRAW_AUTO_APPROVAL_LIMIT_USDC = 100.0
ACTIVE_WITHDRAWAL_STATUSES = {
    "REQUESTED",
    "APPROVED_AUTO",
    "PENDING_MANUAL_REVIEW",
    "PENDING",
}
INSUFFICIENT_RECEIVABLE_MESSAGE = "amountUsdc exceeds provider receivable."


class ProviderWithdrawService(
    BalanceAuditMixin, BalanceRedisGuardMixin, BalanceWithdrawSigningMixin
):
    """Provider-side withdrawal domain service."""

    def __init__(
        self,
        storage: BaseStorage,
        mutation_lock: RedisLockManager,
        signing_delegate: Optional[BalanceWithdrawSigningMixin] = None,
        guard_delegate: Optional[BalanceRedisGuardMixin] = None,
    ):
        self.storage = storage
        self._mutation_lock = mutation_lock
        self._signing_delegate = signing_delegate
        self._guard_delegate = guard_delegate

    async def _get_redis_client(self):
        if self._guard_delegate is not None:
            return await self._guard_delegate._get_redis_client()  # type: ignore[attr-defined]
        return await super()._get_redis_client()

    def _withdraw_contract(self):
        if self._signing_delegate is not None:
            return self._signing_delegate._withdraw_contract()  # type: ignore[attr-defined]
        return super()._withdraw_contract()

    def _require_withdraw_signer(self) -> str:
        if self._signing_delegate is not None:
            return self._signing_delegate._require_withdraw_signer()  # type: ignore[attr-defined]
        return super()._require_withdraw_signer()

    def _sign_withdraw_ticket(
        self, typed_data: Dict[str, Any], private_key: str
    ) -> str:
        if self._signing_delegate is not None:
            return self._signing_delegate._sign_withdraw_ticket(typed_data, private_key)  # type: ignore[attr-defined]
        return super()._sign_withdraw_ticket(typed_data, private_key)

    @staticmethod
    def _withdraw_owner(row: WithdrawalIntentRow) -> str:
        return normalize_wallet(str(row.owner_address or ""))

    @staticmethod
    def _withdraw_created_at(row: WithdrawalIntentRow) -> int:
        try:
            return int(row.created_at or 0)
        except Exception:
            return 0

    def _normalize_withdrawal_rows(self) -> List[WithdrawalIntentRow]:
        raw_rows = self.storage.get_data_manager().system.gateway_state.read_provider_withdrawal_rows()
        rows: List[WithdrawalIntentRow] = []
        if isinstance(raw_rows, list):
            for row in raw_rows:
                if isinstance(row, WithdrawalIntentRow):
                    rows.append(row)
        for row in rows:
            status = str(row.status or "").upper()
            if not status or status == "PENDING":
                row.status = "REQUESTED"
            else:
                row.status = status
        return rows

    def _save_withdrawal_rows(self, rows: List[WithdrawalIntentRow]) -> None:
        self.storage.get_data_manager().system.gateway_state.write_provider_withdrawal_rows(
            rows, int(time.time())
        )

    def _load_balance_ledger(self) -> BalanceLedger:
        return self.storage.get_data_manager().finance.balance.read_balance_ledger()

    def _save_balance_ledger(self, ledger: BalanceLedger) -> None:
        ledger.updated_at = int(time.time())
        self.storage.get_data_manager().finance.balance.write_balance_ledger(ledger)

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

    def _parse_withdraw_amount_usdc(
        self, payload: Dict[str, Any], available: float
    ) -> float:
        raw = payload.get("amountUsdc")
        if raw is None:
            if available <= 0:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INSUFFICIENT_PROVIDER_RECEIVABLE",
                        "message": "No provider receivable available for withdrawal.",
                    },
                )
            return round(available, 6)
        try:
            amount = float(raw)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be a number.",
                },
            )
        amount = round(amount, 6)
        if amount <= 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be greater than 0.",
                },
            )
        if amount > available:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INSUFFICIENT_PROVIDER_RECEIVABLE",
                    "message": INSUFFICIENT_RECEIVABLE_MESSAGE,
                },
            )
        return amount

    def _requested_withdraw_amount_for_hash(self, payload: Dict[str, Any]) -> Any:
        raw = payload.get("amountUsdc")
        if raw is None:
            return None
        try:
            return round(float(raw), 6)
        except Exception:
            return raw

    def _build_withdraw_create_context(
        self,
        *,
        owner: str,
        payload: Dict[str, Any],
        available_receivable: float,
    ) -> WithdrawCreateContext:
        amount_usdc = self._parse_withdraw_amount_usdc(payload, available_receivable)
        request_hash = self._request_hash(
            {
                "ownerAddress": owner,
                "amountUsdc": self._requested_withdraw_amount_for_hash(payload),
            }
        )
        return WithdrawCreateContext(
            amount_usdc=amount_usdc,
            request_hash=request_hash,
        )

    def _build_pending_withdraw_response(self, row: WithdrawalIntentRow) -> Dict[str, Any]:
        return {
            "withdrawalId": str(row.id or ""),
            "status": str(row.status or "REQUESTED"),
            "amountUsdc": round(float(row.amount_usdc or 0.0), 6),
            "ticket": row.ticket.model_dump(by_alias=True, mode="json", exclude_none=True),
            "message": str(row.message or ""),
        }

    def _normalize_tx_hash_or_raise(self, tx_hash: str) -> str:
        normalized = str(tx_hash or "").strip().lower()
        if not normalized.startswith("0x") or len(normalized) != 66:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_TX_HASH",
                    "message": "txHash must be a 66-char 0x-prefixed hash.",
                },
            )
        return normalized

    def _assert_withdrawal_completable(
        self, target: WithdrawalIntentRow, tx_hash: str
    ) -> Optional[Dict[str, Any]]:
        status = str(target.status or "").upper()
        if status == "COMPLETED":
            existing_tx = str(target.tx_hash or "")
            if existing_tx and existing_tx != tx_hash:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "WITHDRAWAL_ALREADY_COMPLETED",
                        "message": "Withdrawal already completed with a different txHash.",
                    },
                )
            return {
                "withdrawalId": str(target.id or ""),
                "status": "COMPLETED",
                "txHash": existing_tx,
            }
        if status not in {"APPROVED_AUTO", "REQUESTED", "PENDING"}:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "WITHDRAWAL_NOT_PENDING",
                    "message": f"Withdrawal status={status} cannot be completed.",
                },
            )
        return None

    def _assert_no_withdraw_tx_replay(
        self,
        rows: List[WithdrawalIntentRow],
        owner_wallet: str,
        tx_hash: str,
        current_withdrawal_id: str,
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
                detail={
                    "code": "WITHDRAWAL_TX_REPLAY_DETECTED",
                    "message": "txHash is already bound to another withdrawal.",
                },
            )

    def _consume_locked_withdraw_amount(self, owner: str, amount_usdc: float) -> None:
        ledger = self._load_balance_ledger()
        provider_wallet = ledger.ensure_provider_wallet(owner)
        locked = round(float(provider_wallet.pending_balance or 0.0), 6)
        if locked + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "WITHDRAWAL_LOCK_INCONSISTENT",
                    "message": "Locked provider receivable is insufficient for this withdrawal intent.",
                },
            )
        provider_wallet.pending_balance = round(max(0.0, locked - amount_usdc), 6)
        self._save_balance_ledger(ledger)

    def _reserve_withdraw_amount(
        self, owner: str, amount_usdc: float, ledger: BalanceLedger
    ) -> None:
        provider_wallet = ledger.ensure_provider_wallet(owner)
        provider_wallet.available_balance = round(
            float(provider_wallet.available_balance or 0.0) - amount_usdc, 6
        )
        provider_wallet.pending_balance = round(
            float(provider_wallet.pending_balance or 0.0) + amount_usdc, 6
        )
        if hasattr(self.storage, "reserve_provider_withdraw_atomic") or hasattr(
            self.storage, "reserve_seller_withdraw_atomic"
        ):
            try:
                reserve_atomic = getattr(
                    self.storage,
                    "reserve_provider_withdraw_atomic",
                    getattr(self.storage, "reserve_seller_withdraw_atomic"),
                )
                reserve_atomic(
                    ReserveProviderWithdrawCommand(
                        owner_wallet=owner,
                        amount_usdc=Decimal(str(amount_usdc)).quantize(
                            Decimal("0.000001"), rounding=ROUND_HALF_UP
                        ),
                    )
                )
            except RuntimeError as exc:
                if str(exc) == "INSUFFICIENT_PROVIDER_RECEIVABLE":
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "INSUFFICIENT_PROVIDER_RECEIVABLE",
                            "message": INSUFFICIENT_RECEIVABLE_MESSAGE,
                        },
                    )
                raise
            return
        self._save_balance_ledger(ledger)

    def _prepare_withdraw_ticket(
        self,
        *,
        owner: str,
        amount_usdc: float,
    ) -> PreparedWithdrawTicket:
        requires_manual_review = amount_usdc >= WITHDRAW_AUTO_APPROVAL_LIMIT_USDC
        amount_wei = int(round(amount_usdc * float(10**USDC_DECIMALS)))

        if requires_manual_review:
            return PreparedWithdrawTicket(
                requires_manual_review=True,
                amount_wei=amount_wei,
                fee_wei=0,
                nonce=0,
                chain_id=0,
                deadline=0,
                signature="",
                signer_address="",
                ticket={},
            )

        private_key = self._require_withdraw_signer()
        nonce, chain_id = self._resolve_withdraw_nonce_and_chain(owner)
        deadline = int(time.time()) + self._resolve_withdraw_deadline_sec()
        fee_wei = 0
        typed_data = self._build_withdraw_typed_data(
            owner_wallet=owner,
            amount_wei=amount_wei,
            fee_wei=fee_wei,
            nonce=nonce,
            deadline=deadline,
            chain_id=chain_id,
            verifying_contract=normalize_wallet(settings.router_address),
        )
        signature = self._sign_withdraw_ticket(typed_data, private_key)

        try:
            from eth_account import Account  # type: ignore[import-not-found]

            signer_address = normalize_wallet(Account.from_key(private_key).address)
        except Exception:
            signer_address = ""

        return PreparedWithdrawTicket(
            requires_manual_review=False,
            amount_wei=amount_wei,
            fee_wei=fee_wei,
            nonce=nonce,
            chain_id=chain_id,
            deadline=deadline,
            signature=signature,
            signer_address=signer_address,
            ticket={
                "amount": str(amount_wei),
                "fee": str(fee_wei),
                "nonce": nonce,
                "deadline": deadline,
                "signature": signature,
                "chainId": chain_id,
                "contractAddress": normalize_wallet(settings.router_address),
            },
        )

    def _build_atomic_signing_ticket(
        self, owner: str, amount_usdc: Decimal
    ) -> PreparedWithdrawTicket:
        return self._prepare_withdraw_ticket(
            owner=owner, amount_usdc=float(amount_usdc)
        )

    def process_withdrawal_request(
        self, command: WithdrawalAtomicRequestCommand
    ) -> WithdrawalDecision:
        if not hasattr(self.storage, "process_withdrawal_request_atomic"):
            raise RuntimeError("WITHDRAWAL_ATOMIC_NOT_SUPPORTED")

        owner = normalize_wallet(command.provider_address)
        high_risk_override = owner in settings.withdrawal_high_risk_seller_addresses
        window_seconds = command.window_seconds

        try:
            return getattr(self.storage, "process_withdrawal_request_atomic")(
                WithdrawalAtomicRequestCommand(
                    provider_address=owner,
                    amount_usdc=command.amount_usdc,
                    request_id=command.request_id,
                    idempotency_key=command.idempotency_key,
                    request_meta=command.request_meta,
                    single_limit_usdc=command.single_limit_usdc,
                    rolling_24h_limit_usdc=command.rolling_24h_limit_usdc,
                    window_seconds=window_seconds,
                    high_risk_override=bool(high_risk_override or command.high_risk_override),
                    sign_ticket_factory=lambda value: self._build_atomic_signing_ticket(
                        owner, value
                    ),
                )
            )
        except RuntimeError as exc:
            code = str(exc)
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
                    detail={
                        "code": "INVALID_AMOUNT",
                        "message": "amountUsdc must be greater than 0.",
                    },
                )
            raise

    async def _create_provider_withdraw_intent_atomic(
        self,
        *,
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_hash: str,
        request_meta: Optional[Dict[str, Any]],
        redis_client: Optional[Any],
        idem_rows: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        request_id = str((request_meta or {}).get("requestId") or str(uuid4()))
        atomic_result = self.process_withdrawal_request(
            WithdrawalAtomicRequestCommand(
                provider_address=owner,
                amount_usdc=Decimal(str(amount_usdc)).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                request_id=request_id,
                idempotency_key=idempotency_key,
                request_meta=request_meta,
                single_limit_usdc=Decimal(
                    str(settings.withdrawal_auto_single_limit_usdc)
                ),
                rolling_24h_limit_usdc=Decimal(
                    str(settings.withdrawal_auto_24h_limit_usdc)
                ),
                window_seconds=max(1, int(settings.withdrawal_window_hours)) * 3600,
                high_risk_override=False,
            )
        )
        response = {
            "withdrawalId": atomic_result.withdrawal_id,
            "status": atomic_result.status,
            "amountUsdc": atomic_result.amount_usdc,
            "ticket": dict(atomic_result.ticket),
            "message": atomic_result.message,
        }
        await self._finish_provider_withdraw_idempotency(
            owner=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response=response,
            redis_client=redis_client,
            idem_rows=idem_rows,
        )
        if atomic_result.decision.lower() == "red":
            raise HTTPException(
                status_code=403,
                detail={
                    "code": atomic_result.risk_reason_code
                    or "WITHDRAWAL_BLOCKED_BY_RISK_POLICY",
                    "message": atomic_result.message
                    or "Withdrawal blocked by risk policy.",
                },
            )

        self._append_financial_audit(
            "PROVIDER_WITHDRAW_INTENT_CREATED",
            owner,
            {
                "withdrawalId": response["withdrawalId"],
                "amountUsdc": response["amountUsdc"],
                "status": response["status"],
                "idempotencyKey": idempotency_key,
                "requestId": atomic_result.request_id,
                "requestMeta": request_meta or {},
            },
        )
        return response

    async def _resolve_pending_withdrawal_response(
        self,
        *,
        rows: List[WithdrawalIntentRow],
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_hash: str,
        redis_client: Optional[Any],
        idem_rows: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        pending = self._get_pending_withdrawal(rows, owner)
        if pending is None:
            return None

        if (
            self._withdraw_owner(pending) == owner
            and round(float(pending.amount_usdc or 0.0), 6) == amount_usdc
        ):
            response = self._build_pending_withdraw_response(pending)
            await self._finish_provider_withdraw_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
                redis_client=redis_client,
                idem_rows=idem_rows,
            )
            return response

        raise HTTPException(
            status_code=409,
            detail={
                "code": "PENDING_WITHDRAWAL_EXISTS",
                "message": "A pending provider withdrawal already exists. Complete or cancel it before creating a new one.",
            },
        )

    def _build_withdraw_row_and_response(
        self,
        *,
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]],
        ticket_payload: PreparedWithdrawTicket,
    ) -> tuple[WithdrawalIntentRow, Dict[str, Any]]:
        now = int(time.time())
        withdrawal_id = str(uuid4())
        status = (
            "PENDING_MANUAL_REVIEW"
            if ticket_payload.requires_manual_review
            else "APPROVED_AUTO"
        )
        message = (
            "Withdrawal requested. Amounts over $100 require manual security review (ETA: 12-24 hrs)."
            if ticket_payload.requires_manual_review
            else ""
        )
        row = WithdrawalIntentRow(
            id=withdrawal_id,
            ownerAddress=owner,
            amountUsdc=Decimal(str(amount_usdc)),
            amountWei=str(ticket_payload.amount_wei),
            feeWei=str(ticket_payload.fee_wei),
            nonce=ticket_payload.nonce,
            deadline=ticket_payload.deadline,
            signature=ticket_payload.signature,
            chainId=ticket_payload.chain_id,
            contractAddress=normalize_wallet(settings.router_address),
            signerAddress=ticket_payload.signer_address,
            status=status,
            businessType="withdraw",
            riskLevel="yellow" if ticket_payload.requires_manual_review else "green",
            idempotencyKey=idempotency_key,
            createdAt=str(now),
            updatedAt=str(now),
            requestMeta=request_meta or {},
            message=message,
            ticket=dict(ticket_payload.ticket),
        )
        response = {
            "withdrawalId": withdrawal_id,
            "status": status,
            "amountUsdc": amount_usdc,
            "ticket": dict(ticket_payload.ticket),
            "message": message,
        }
        return row, response

    async def create_provider_withdraw_intent(
        self,
        payload: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:provider_withdraw_intent"):
            idempotency_key = self._validate_idempotency_key(idempotency_key)
            await self._enforce_owner_write_rate_limit(
                owner, "provider_withdraw_intent"
            )

            ledger = self._load_balance_ledger()
            available_receivable = ledger.provider_receivable_balance(owner)
            context = self._build_withdraw_create_context(
                owner=owner,
                payload=payload,
                available_receivable=available_receivable,
            )

            (
                existing_response,
                redis_client,
                idem_rows,
            ) = await self._begin_provider_withdraw_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=context.request_hash,
            )
            if existing_response is not None:
                return existing_response

            rows = self._normalize_withdrawal_rows()
            pending_response = await self._resolve_pending_withdrawal_response(
                rows=rows,
                owner=owner,
                amount_usdc=context.amount_usdc,
                idempotency_key=idempotency_key,
                request_hash=context.request_hash,
                redis_client=redis_client,
                idem_rows=idem_rows,
            )
            if pending_response is not None:
                return pending_response

            if hasattr(self.storage, "process_withdrawal_request_atomic"):
                return await self._create_provider_withdraw_intent_atomic(
                    owner=owner,
                    amount_usdc=context.amount_usdc,
                    idempotency_key=idempotency_key,
                    request_hash=context.request_hash,
                    request_meta=request_meta,
                    redis_client=redis_client,
                    idem_rows=idem_rows,
                )

            ticket_payload = self._prepare_withdraw_ticket(
                owner=owner, amount_usdc=context.amount_usdc
            )
            self._reserve_withdraw_amount(owner, context.amount_usdc, ledger)
            row, response = self._build_withdraw_row_and_response(
                owner=owner,
                amount_usdc=context.amount_usdc,
                idempotency_key=idempotency_key,
                request_meta=request_meta,
                ticket_payload=ticket_payload,
            )
            rows.append(row)
            self._save_withdrawal_rows(rows)
            await self._finish_provider_withdraw_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=context.request_hash,
                response=response,
                redis_client=redis_client,
                idem_rows=idem_rows,
            )

            self._append_financial_audit(
                "PROVIDER_WITHDRAW_INTENT_CREATED",
                owner,
                {
                    "withdrawalId": response["withdrawalId"],
                    "amountUsdc": context.amount_usdc,
                    "status": response["status"],
                    "nonce": row.nonce,
                    "deadline": row.deadline,
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return response

    async def list_provider_withdrawals(
        self, owner_wallet: str
    ) -> List[Dict[str, Any]]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        rows = self._normalize_withdrawal_rows()
        filtered = [
            row
            for row in rows
            if self._withdraw_owner(row) == owner
        ]
        filtered.sort(key=self._withdraw_created_at, reverse=True)
        return [row.model_dump(by_alias=True, mode="json") for row in filtered]

    async def complete_provider_withdrawal(
        self,
        owner_wallet: str,
        withdrawal_id: str,
        tx_hash: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:provider_withdraw_complete"):
            await self._enforce_owner_write_rate_limit(
                owner, "provider_withdraw_complete"
            )
            rows = self._normalize_withdrawal_rows()
            target = self._find_withdrawal_by_id(rows, owner, withdrawal_id)
            if target is None:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "code": "WITHDRAWAL_NOT_FOUND",
                        "message": "Provider withdrawal intent not found.",
                    },
                )

            normalized_tx_hash = self._normalize_tx_hash_or_raise(tx_hash)
            if hasattr(self.storage, "complete_withdraw_tx_atomic"):
                bound = bool(
                    getattr(self.storage, "complete_withdraw_tx_atomic")(
                        CompleteWithdrawTxCommand(
                            owner_wallet=owner,
                            tx_hash=normalized_tx_hash,
                            kind="provider_withdraw",
                        )
                    )
                )
                if not bound:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "WITHDRAWAL_TX_REPLAY_DETECTED",
                            "message": "txHash is already bound to another withdrawal.",
                        },
                    )
            self._assert_no_withdraw_tx_replay(
                rows, owner, normalized_tx_hash, str(target.id or "")
            )
            completed = self._assert_withdrawal_completable(target, normalized_tx_hash)
            if completed is not None:
                return completed

            amount_usdc = round(float(target.amount_usdc or 0.0), 6)
            self._consume_locked_withdraw_amount(owner, amount_usdc)

            now = int(time.time())
            target.status = "COMPLETED"
            target.tx_hash = normalized_tx_hash
            target.completed_at = now
            target.updated_at = str(now)
            target.complete_meta = request_meta or {}
            self._save_withdrawal_rows(rows)

            self._append_financial_audit(
                "PROVIDER_WITHDRAW_COMPLETED",
                owner,
                {
                    "withdrawalId": str(target.id or ""),
                    "txHash": normalized_tx_hash,
                    "amountUsdc": amount_usdc,
                    "requestMeta": request_meta or {},
                },
            )
            return {
                "withdrawalId": str(target.id or ""),
                "status": "COMPLETED",
                "txHash": normalized_tx_hash,
            }


SellerWithdrawService = ProviderWithdrawService
