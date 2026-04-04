from typing import Any, List, Literal, Optional, cast
import asyncio
from datetime import datetime, timezone
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
from src.domain.idempotency import IdempotencyRow
from src.domain.ledger import WithdrawalIntentRow
from src.domain.operation_metadata import OperationContextMetadata, WithdrawalTicketMetadata
from src.services.balance_mixins import (
    BalanceAuditMixin,
    BalanceRedisGuardMixin,
    BalanceWithdrawSigningMixin,
    USDC_DECIMALS,
)
from src.storage.base import BaseStorage
from src.utils.datetime_utils import now_dt_str, to_dt_str


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
    "REQUESTED",
    "APPROVED_AUTO",
    "PENDING_MANUAL_REVIEW",
    "REJECTED",
    "COMPLETED",
    "CANCELLED",
]
WITHDRAW_ROW_STATUSES: set[WithdrawalRowStatus] = {
    "REQUESTED",
    "APPROVED_AUTO",
    "PENDING_MANUAL_REVIEW",
    "REJECTED",
    "COMPLETED",
    "CANCELLED",
}


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
        self, typed_data: dict[str, Any], private_key: str
    ) -> str:
        if self._signing_delegate is not None:
            return self._signing_delegate._sign_withdraw_ticket(typed_data, private_key)  # type: ignore[attr-defined]
        return super()._sign_withdraw_ticket(typed_data, private_key)

    def _read_vault_liquidity_amount_wei(self) -> int:
        token_address = normalize_wallet(settings.usdc_token_address)
        router_address = normalize_wallet(settings.router_address)
        if not token_address or not router_address:
            raise RuntimeError("WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE")

        try:
            _provider, contract = self._withdraw_contract()
            web3 = getattr(contract, "w3", None)
            if web3 is None:
                raise RuntimeError("WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE")
            token_contract = web3.eth.contract(
                address=web3.to_checksum_address(token_address),
                abi=[
                    {
                        "constant": True,
                        "inputs": [{"name": "account", "type": "address"}],
                        "name": "balanceOf",
                        "outputs": [{"name": "", "type": "uint256"}],
                        "stateMutability": "view",
                        "type": "function",
                    }
                ],
            )
            return int(
                token_contract.functions.balanceOf(
                    web3.to_checksum_address(router_address)
                ).call()
            )
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError("WITHDRAW_VAULT_LIQUIDITY_CHECK_UNAVAILABLE") from exc

    def _assert_withdraw_vault_liquidity(self, amount_usdc: Decimal) -> None:
        amount_wei = int(round(float(amount_usdc) * float(10**USDC_DECIMALS)))
        vault_balance_wei = self._read_vault_liquidity_amount_wei()
        if vault_balance_wei < amount_wei:
            raise RuntimeError("INSUFFICIENT_VAULT_LIQUIDITY")

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
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be greater than 0.",
                },
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
            elif status in WITHDRAW_ROW_STATUSES:
                row.status = cast(WithdrawalRowStatus, status)
        return rows

    def _save_withdrawal_rows(self, rows: List[WithdrawalIntentRow]) -> None:
        self.storage.get_data_manager().system.gateway_state.write_provider_withdrawal_rows(
            rows, int(time.time())
        )

    def _load_balance_ledger(self) -> BalanceLedger:
        return self.storage.get_data_manager().finance.balance.read_balance_ledger()

    def _save_balance_ledger(self, ledger: BalanceLedger) -> None:
        ledger.updated_at = now_dt_str()
        self.storage.get_data_manager().finance.balance.write_balance_ledger(ledger)

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
        current_time = int(now or time.time())
        return deadline < current_time

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

            amount_usdc = round(float(row.amount_usdc or 0.0), 6)
            released_amount_usdc = 0.0
            if amount_usdc > 0:
                released_amount_usdc = self._release_pending_withdraw_to_available(
                    row_owner, amount_usdc
                )
            release_shortfall_usdc = round(
                max(0.0, amount_usdc - released_amount_usdc), 6
            )

            row.status = "CANCELLED"
            row.updated_at = now_text
            row.completed_at = now
            row.message = (
                EXPIRED_WITHDRAW_RELEASE_MESSAGE
                if release_shortfall_usdc <= 1e-9
                else EXPIRED_WITHDRAW_RECONCILED_MESSAGE
            )
            changed = True

            self._append_financial_audit(
                "PROVIDER_WITHDRAW_CANCELLED",
                row_owner,
                {
                    "withdrawalId": str(row.id or ""),
                    "amountUsdc": amount_usdc,
                    "releasedAmountUsdc": released_amount_usdc,
                    "releaseShortfallUsdc": release_shortfall_usdc,
                    "reason": "TICKET_EXPIRED",
                    "deadline": int(row.deadline or 0),
                },
            )

        if changed:
            self._save_withdrawal_rows(rows)

        return rows

    async def expire_stale_provider_withdrawals(self) -> int:
        await asyncio.sleep(0)
        async with self._mutation_lock.lock("provider_withdraw_expiry_reaper"):
            rows = self._normalize_withdrawal_rows()
            before_cancelled = sum(
                1 for row in rows if str(row.status or "").upper() == "CANCELLED"
            )
            rows = self._expire_stale_withdrawals(rows)
            after_cancelled = sum(
                1 for row in rows if str(row.status or "").upper() == "CANCELLED"
            )
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

    def _parse_withdraw_amount_usdc(
        self, payload: dict[str, Any], available: float
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
            amount = Decimal(str(raw))
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be a number.",
                },
            )
        if amount != amount.quantize(WITHDRAW_AMOUNT_PRECISION):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc supports up to 2 decimal places.",
                },
            )
        if amount <= 0:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_AMOUNT",
                    "message": "amountUsdc must be greater than 0.",
                },
            )
        if amount > Decimal(str(available)):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INSUFFICIENT_PROVIDER_RECEIVABLE",
                    "message": INSUFFICIENT_RECEIVABLE_MESSAGE,
                },
            )
        return float(amount)

    def _requested_withdraw_amount_for_hash(self, payload: dict[str, Any]) -> Any:
        raw = payload.get("amountUsdc")
        if raw is None:
            return None
        try:
            amount = Decimal(str(raw))
            if amount != amount.quantize(WITHDRAW_AMOUNT_PRECISION):
                return raw
            return float(amount)
        except Exception:
            return raw

    def _build_withdraw_create_context(
        self,
        *,
        owner: str,
        payload: dict[str, Any],
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

    def _build_pending_withdraw_response(self, row: WithdrawalIntentRow) -> dict[str, Any]:
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
    ) -> Optional[dict[str, Any]]:
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

    def _release_pending_withdraw_to_available(self, owner: str, amount_usdc: float) -> float:
        ledger = self._load_balance_ledger()
        provider_wallet = ledger.ensure_provider_wallet(owner)
        locked = round(float(provider_wallet.pending_balance or 0.0), 6)
        releasable_amount = round(min(max(0.0, amount_usdc), locked), 6)
        if releasable_amount <= 0:
            return 0.0
        provider_wallet.pending_balance = round(
            max(0.0, locked - releasable_amount), 6
        )
        provider_wallet.available_balance = round(
            float(provider_wallet.available_balance or 0.0) + releasable_amount, 6
        )
        self._save_balance_ledger(ledger)
        return releasable_amount

    def _release_frozen_withdraw_to_available(
        self, owner: str, amount_usdc: float
    ) -> None:
        ledger = self._load_balance_ledger()
        provider_wallet = ledger.ensure_provider_wallet(owner)
        frozen = round(float(provider_wallet.frozen_balance or 0.0), 6)
        if frozen + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "WITHDRAWAL_FROZEN_INCONSISTENT",
                    "message": "Frozen provider receivable is insufficient for this manual review action.",
                },
            )
        provider_wallet.frozen_balance = round(max(0.0, frozen - amount_usdc), 6)
        provider_wallet.available_balance = round(
            float(provider_wallet.available_balance or 0.0) + amount_usdc, 6
        )
        self._save_balance_ledger(ledger)

    def _move_frozen_withdraw_to_pending(self, owner: str, amount_usdc: float) -> None:
        ledger = self._load_balance_ledger()
        provider_wallet = ledger.ensure_provider_wallet(owner)
        frozen = round(float(provider_wallet.frozen_balance or 0.0), 6)
        if frozen + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "WITHDRAWAL_FROZEN_INCONSISTENT",
                    "message": "Frozen provider receivable is insufficient for this manual review action.",
                },
            )
        provider_wallet.frozen_balance = round(max(0.0, frozen - amount_usdc), 6)
        provider_wallet.pending_balance = round(
            float(provider_wallet.pending_balance or 0.0) + amount_usdc, 6
        )
        self._save_balance_ledger(ledger)

    def _reserve_withdraw_amount(
        self,
        owner: str,
        amount_usdc: float,
        ledger: BalanceLedger,
        *,
        lock_to_frozen: bool = False,
    ) -> None:
        provider_wallet = ledger.ensure_provider_wallet(owner)
        provider_wallet.available_balance = round(
            float(provider_wallet.available_balance or 0.0) - amount_usdc, 6
        )
        if lock_to_frozen:
            provider_wallet.frozen_balance = round(
                float(provider_wallet.frozen_balance or 0.0) + amount_usdc, 6
            )
        else:
            provider_wallet.pending_balance = round(
                float(provider_wallet.pending_balance or 0.0) + amount_usdc, 6
            )
        reserve_provider_withdraw_atomic = getattr(
            self.storage, "reserve_provider_withdraw_atomic", None
        )
        if callable(reserve_provider_withdraw_atomic):
            try:
                reserve_provider_withdraw_atomic(
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
        force_sign: bool = False,
    ) -> PreparedWithdrawTicket:
        requires_manual_review = (
            amount_usdc >= settings.withdrawal_auto_single_limit_usdc
        ) and not force_sign
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

    def _parse_withdraw_review_context(
        self, request_meta: Optional[dict[str, Any]]
    ) -> tuple[str, str, str]:
        review_ctx = OperationContextMetadata.model_validate(request_meta or {}).review
        reviewer_address = (
            normalize_wallet(str(review_ctx.reviewer_address or ""))
            if review_ctx.reviewer_address
            else ""
        )
        return (
            str(review_ctx.decision or "").strip().upper(),
            reviewer_address,
            str(review_ctx.reviewer_note or "").strip(),
        )

    def _reject_manual_review_withdrawal(
        self,
        *,
        owner: str,
        rows: List[WithdrawalIntentRow],
        target: WithdrawalIntentRow,
        amount_usdc: float,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        self._release_frozen_withdraw_to_available(owner, amount_usdc)
        now = int(time.time())
        now_text = now_dt_str()
        target.status = "REJECTED"
        target.review_decision = "REJECT"
        target.reviewer_address = reviewer_address
        target.reviewer_note = reviewer_note
        target.reviewed_at = now
        target.updated_at = now_text
        target.message = MANUAL_REVIEW_REJECT_MESSAGE
        self._save_withdrawal_rows(rows)
        self._append_financial_audit(
            "PROVIDER_WITHDRAW_REVIEW_REJECTED",
            owner,
            {
                "withdrawalId": str(target.id or ""),
                "amountUsdc": amount_usdc,
                "reviewerAddress": reviewer_address,
                "reviewerNote": reviewer_note,
                "requestMeta": request_meta or {},
            },
        )
        return {
            "withdrawalId": str(target.id or ""),
            "status": "REJECTED",
            "amountUsdc": amount_usdc,
            "ticket": {},
            "message": MANUAL_REVIEW_REJECT_MESSAGE,
        }

    def _approve_manual_review_withdrawal(
        self,
        *,
        owner: str,
        rows: List[WithdrawalIntentRow],
        target: WithdrawalIntentRow,
        amount_usdc: float,
        reviewer_address: str,
        reviewer_note: str,
        request_meta: Optional[dict[str, Any]],
    ) -> dict[str, Any]:
        self._assert_withdraw_vault_liquidity(Decimal(str(amount_usdc)))
        ticket_payload = self._prepare_withdraw_ticket(
            owner=owner,
            amount_usdc=amount_usdc,
            force_sign=True,
        )
        self._move_frozen_withdraw_to_pending(owner, amount_usdc)

        now = int(time.time())
        now_text = now_dt_str()
        target.status = "APPROVED_AUTO"
        target.review_decision = "APPROVE"
        target.reviewer_address = reviewer_address
        target.reviewer_note = reviewer_note
        target.reviewed_at = now
        target.updated_at = now_text
        target.amount_wei = str(ticket_payload.amount_wei)
        target.fee_wei = str(ticket_payload.fee_wei)
        target.nonce = ticket_payload.nonce
        target.deadline = ticket_payload.deadline
        target.signature = ticket_payload.signature
        target.chain_id = ticket_payload.chain_id
        target.contract_address = normalize_wallet(settings.router_address)
        target.signer_address = ticket_payload.signer_address
        target.ticket = WithdrawalTicketMetadata.model_validate(ticket_payload.ticket)
        target.message = MANUAL_REVIEW_APPROVED_MESSAGE
        self._save_withdrawal_rows(rows)

        response = {
            "withdrawalId": str(target.id or ""),
            "status": "APPROVED_AUTO",
            "amountUsdc": amount_usdc,
            "ticket": dict(ticket_payload.ticket),
            "message": MANUAL_REVIEW_APPROVED_MESSAGE,
        }
        self._append_financial_audit(
            "PROVIDER_WITHDRAW_REVIEW_APPROVED",
            owner,
            {
                "withdrawalId": response["withdrawalId"],
                "amountUsdc": amount_usdc,
                "reviewerAddress": reviewer_address,
                "reviewerNote": reviewer_note,
                "requestMeta": request_meta or {},
            },
        )
        return response

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
        high_risk_override = owner in settings.withdrawal_high_risk_provider_addresses
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
                    pre_reserve_check=self._assert_withdraw_vault_liquidity,
                    sign_ticket_factory=lambda value: self._build_atomic_signing_ticket(
                        owner, value
                    ),
                )
            )
        except RuntimeError as exc:
            self._raise_withdraw_runtime_error(str(exc))
            raise

    async def _create_provider_withdraw_intent_atomic(
        self,
        *,
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_hash: str,
        request_meta: Optional[dict[str, Any]],
        redis_client: Optional[Any],
        idem_rows: List[IdempotencyRow],
    ) -> dict[str, Any]:
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
                "requestId": request_id,
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
        idem_rows: List[IdempotencyRow],
    ) -> Optional[dict[str, Any]]:
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
        request_meta: Optional[dict[str, Any]],
        ticket_payload: PreparedWithdrawTicket,
    ) -> tuple[WithdrawalIntentRow, dict[str, Any]]:
        now_text = now_dt_str()
        withdrawal_id = str(uuid4())
        status = (
            "PENDING_MANUAL_REVIEW"
            if ticket_payload.requires_manual_review
            else "APPROVED_AUTO"
        )
        manual_review_limit = settings.withdrawal_auto_single_limit_usdc
        message = (
            f"Withdrawal requested. Amounts at or above ${manual_review_limit:g} require manual security review (ETA: 12-24 hrs)."
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
            createdAt=now_text,
            updatedAt=now_text,
            requestMeta=self._operation_context_metadata(request_meta),
            message=message,
            ticket=self._withdrawal_ticket_metadata(ticket_payload.ticket),
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
        payload: dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:provider_withdraw_intent"):
            idempotency_key = self._validate_idempotency_key(idempotency_key)
            await self._enforce_owner_write_rate_limit(
                owner, "provider_withdraw_intent"
            )

            rows = self._expire_stale_withdrawals(
                self._normalize_withdrawal_rows(), owner
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

            try:
                self._assert_withdraw_vault_liquidity(Decimal(str(context.amount_usdc)))
            except RuntimeError as exc:
                self._raise_withdraw_runtime_error(str(exc))
                raise

            ticket_payload = self._prepare_withdraw_ticket(
                owner=owner, amount_usdc=context.amount_usdc
            )
            self._reserve_withdraw_amount(
                owner,
                context.amount_usdc,
                ledger,
                lock_to_frozen=ticket_payload.requires_manual_review,
            )
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
    ) -> List[dict[str, Any]]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        rows = self._expire_stale_withdrawals(
            self._normalize_withdrawal_rows(), owner
        )
        filtered = [
            row
            for row in rows
            if self._withdraw_owner(row) == owner
        ]
        filtered.sort(key=self._withdraw_created_at, reverse=True)
        return [row.model_dump(by_alias=True, mode="json") for row in filtered]

    async def review_provider_withdrawal(
        self,
        owner_wallet: str,
        withdrawal_id: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:provider_withdraw_review"):
            await self._enforce_owner_write_rate_limit(
                owner, "provider_withdraw_review"
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

            status = str(target.status or "").upper()
            if status != "PENDING_MANUAL_REVIEW":
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "WITHDRAWAL_REVIEW_NOT_PENDING",
                        "message": f"Withdrawal status={status} is not awaiting manual review.",
                    },
                )

            review_decision, reviewer_address, reviewer_note = (
                self._parse_withdraw_review_context(request_meta)
            )
            if review_decision not in {"APPROVE", "REJECT"}:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INVALID_REVIEW_DECISION",
                        "message": "review decision must be APPROVE or REJECT for manual review withdrawals.",
                    },
                )
            if not reviewer_address:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "WITHDRAW_REVIEW_APPROVER_REQUIRED",
                        "message": "Manual review withdrawals require reviewerAddress.",
                    },
                )

            amount_usdc = round(float(target.amount_usdc or 0.0), 6)
            if review_decision == "REJECT":
                return self._reject_manual_review_withdrawal(
                    owner=owner,
                    rows=rows,
                    target=target,
                    amount_usdc=amount_usdc,
                    reviewer_address=reviewer_address,
                    reviewer_note=reviewer_note,
                    request_meta=request_meta,
                )

            return self._approve_manual_review_withdrawal(
                owner=owner,
                rows=rows,
                target=target,
                amount_usdc=amount_usdc,
                reviewer_address=reviewer_address,
                reviewer_note=reviewer_note,
                request_meta=request_meta,
            )

    async def complete_provider_withdrawal(
        self,
        owner_wallet: str,
        withdrawal_id: str,
        tx_hash: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:provider_withdraw_complete"):
            await self._enforce_owner_write_rate_limit(
                owner, "provider_withdraw_complete"
            )
            rows = self._expire_stale_withdrawals(
                self._normalize_withdrawal_rows(), owner
            )
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
            now_text = now_dt_str()
            target.status = "COMPLETED"
            target.tx_hash = normalized_tx_hash
            target.completed_at = now
            target.updated_at = now_text
            target.complete_meta = self._operation_context_metadata(request_meta)
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
