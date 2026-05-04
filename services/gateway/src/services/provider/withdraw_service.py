import asyncio
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.core.redis_lock import RedisLockManager
from src.domain.execution import CompleteWithdrawTxCommand
from src.services.balance_mixins import (
    BalanceAuditMixin,
    BalanceRedisGuardMixin,
    BalanceWithdrawSigningMixin,
    USDC_DECIMALS,
)
from src.services.provider.withdraw_helpers_mixin import (
    ProviderWithdrawHelpersMixin,
)
from src.services.provider.withdraw_policy_mixin import ProviderWithdrawPolicyMixin
from src.services.provider.withdraw_execution_mixin import ProviderWithdrawExecutionMixin
from src.storage.base import BaseStorage
from src.utils.datetime_utils import now_dt_str
from src.utils.money import money_str, parse_usdc, usdc_decimal_to_atomic


@dataclass
class ProviderWithdrawLegacyContext:
    owner: str
    amount_usdc: Decimal
    idempotency_key: str
    request_hash: str
    request_meta: Optional[dict[str, Any]]
    redis_client: Any
    idem_rows: Any
    rows: list[Any]
    ledger: Any


ProviderWithdrawResponse = dict[str, Any]
ProviderWithdrawListResponse = list[ProviderWithdrawResponse]


class ProviderWithdrawService(
    ProviderWithdrawPolicyMixin,
    ProviderWithdrawHelpersMixin,
    ProviderWithdrawExecutionMixin,
    BalanceAuditMixin,
    BalanceRedisGuardMixin,
    BalanceWithdrawSigningMixin,
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

    def _require_withdraw_signer(self) -> Any:
        if self._signing_delegate is not None:
            return self._signing_delegate._require_withdraw_signer()  # type: ignore[attr-defined]  # because delegate protocol is runtime-composed
        return super()._require_withdraw_signer()

    def _sign_withdraw_ticket(
        self, typed_data: dict[str, Any], signer_config: Any
    ) -> tuple[str, str]:
        if self._signing_delegate is not None:
            return self._signing_delegate._sign_withdraw_ticket(typed_data, signer_config)  # type: ignore[attr-defined]
        return super()._sign_withdraw_ticket(typed_data, signer_config)

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
        amount_wei = usdc_decimal_to_atomic(amount_usdc, decimals=USDC_DECIMALS)
        vault_balance_wei = self._read_vault_liquidity_amount_wei()
        if vault_balance_wei < amount_wei:
            raise RuntimeError("INSUFFICIENT_VAULT_LIQUIDITY")

    def _resolve_provider_withdraw_amount_payload(
        self,
        *,
        payload: dict[str, Any],
        available_receivable: Decimal,
        mature_receivable: Decimal,
    ) -> tuple[Decimal, dict[str, Any]]:
        min_amount = self._provider_withdraw_min_amount()
        if payload.get("amountUsdc") is None:
            if available_receivable <= Decimal("0"):
                self._raise_withdraw_runtime_error("INSUFFICIENT_PROVIDER_RECEIVABLE")
            if mature_receivable <= Decimal("0"):
                self._raise_provider_receivable_not_matured(
                    min_amount, mature_receivable
                )
            if mature_receivable < min_amount:
                self._raise_min_provider_withdraw(min_amount)
            return mature_receivable, {
                **payload,
                "amountUsdc": money_str(mature_receivable),
            }

        amount_usdc = parse_usdc(self._parse_requested_withdraw_amount_usdc(payload))
        if amount_usdc < min_amount:
            self._raise_min_provider_withdraw(min_amount)
        if amount_usdc > mature_receivable:
            self._raise_provider_receivable_not_matured(amount_usdc, mature_receivable)
        return amount_usdc, payload

    def _reserve_provider_withdraw_and_prepare_ticket(
        self,
        *,
        owner: str,
        withdrawal_id: str,
        amount_usdc: Decimal,
        ledger: Any,
        requires_manual_review: bool,
    ) -> Any:
        if requires_manual_review:
            ticket_payload = self._prepare_withdraw_ticket(
                owner=owner,
                withdrawal_id=withdrawal_id,
                amount_usdc=amount_usdc,
            )
            self._reserve_withdraw_amount(
                owner, amount_usdc, ledger, lock_to_frozen=True
            )
            return ticket_payload

        self._reserve_withdraw_amount(owner, amount_usdc, ledger, lock_to_frozen=False)
        try:
            return self._prepare_withdraw_ticket(
                owner=owner,
                withdrawal_id=withdrawal_id,
                amount_usdc=amount_usdc,
            )
        except Exception:
            self._release_pending_withdraw_to_available(owner, amount_usdc)
            raise

    async def _persist_provider_withdraw_intent_legacy(
        self,
        *,
        context: ProviderWithdrawLegacyContext,
        ticket_payload: Any,
        withdrawal_id: str,
    ) -> dict[str, Any]:
        row, response = self._build_withdraw_row_and_response(
            owner=context.owner,
            amount_usdc=context.amount_usdc,
            idempotency_key=context.idempotency_key,
            request_meta=context.request_meta,
            ticket_payload=ticket_payload,
            withdrawal_id=withdrawal_id,
        )
        context.rows.append(row)
        self._save_withdrawal_rows(context.rows)
        await self._finish_provider_withdraw_idempotency(
            owner=context.owner,
            idempotency_key=context.idempotency_key,
            request_hash=context.request_hash,
            response=response,
            redis_client=context.redis_client,
            idem_rows=context.idem_rows,
        )
        self._append_financial_audit(
            "PROVIDER_WITHDRAW_INTENT_CREATED",
            context.owner,
            {
                "withdrawalId": response["withdrawalId"],
                "amountUsdc": money_str(context.amount_usdc),
                "status": response["status"],
                "ticketHash": row.ticket.ticket_hash,
                "deadline": row.deadline,
                "idempotencyKey": context.idempotency_key,
                "requestMeta": context.request_meta or {},
            },
        )
        from src.services.analytics.gateway_events import emit_settlement_claim_requested

        await emit_settlement_claim_requested(
            context.owner, claim_usdc=context.amount_usdc
        )
        return response

    async def _create_provider_withdraw_intent_legacy(
        self,
        *,
        context: ProviderWithdrawLegacyContext,
    ) -> dict[str, Any]:
        try:
            self._assert_withdraw_vault_liquidity(context.amount_usdc)
        except RuntimeError as exc:
            self._raise_withdraw_runtime_error(str(exc))
            raise

        withdrawal_id = str(uuid4())
        requires_manual_review = context.amount_usdc >= parse_usdc(
            str(settings.withdrawal_auto_single_limit_usdc)
        )
        ticket_payload = self._reserve_provider_withdraw_and_prepare_ticket(
            owner=context.owner,
            withdrawal_id=withdrawal_id,
            amount_usdc=context.amount_usdc,
            ledger=context.ledger,
            requires_manual_review=requires_manual_review,
        )
        return await self._persist_provider_withdraw_intent_legacy(
            context=context,
            ticket_payload=ticket_payload,
            withdrawal_id=withdrawal_id,
        )

    async def create_provider_withdraw_intent(
        self,
        payload: dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[dict[str, Any]] = None,
    ) -> ProviderWithdrawResponse:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:provider_withdraw_intent"):
            idempotency_key = self._validate_idempotency_key(idempotency_key)
            await self._enforce_owner_write_rate_limit(
                owner, "provider_withdraw_intent"
            )

            rows = self._expire_stale_withdrawals(
                self._normalize_withdrawal_rows(), owner
            )
            request_hash = self._request_hash(
                {"ownerAddress": owner, "amountUsdc": self._requested_withdraw_amount_for_hash(payload)}
            )

            (
                existing_response,
                redis_client,
                idem_rows,
            ) = await self._begin_provider_withdraw_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if existing_response is not None:
                return existing_response

            explicit_amount = payload.get("amountUsdc") or payload.get("amount_usdc")
            if explicit_amount is not None:
                pending_response = await self._resolve_pending_withdrawal_response(
                    rows=rows, owner=owner,
                    amount_usdc=parse_usdc(str(explicit_amount)),
                    idempotency_key=idempotency_key, request_hash=request_hash, redis_client=redis_client,
                    idem_rows=idem_rows,
                )
                if pending_response is not None:
                    return pending_response

            ledger = self._load_balance_ledger()
            available_receivable = parse_usdc(
                ledger.provider_receivable_balance(owner)
            )
            mature_receivable = self._read_provider_mature_receivable(
                owner, available_receivable
            )
            amount_usdc, effective_payload = self._resolve_provider_withdraw_amount_payload(
                payload=payload,
                available_receivable=available_receivable,
                mature_receivable=mature_receivable,
            )

            pending_response = await self._resolve_pending_withdrawal_response(
                rows=rows,
                owner=owner,
                amount_usdc=amount_usdc,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                redis_client=redis_client,
                idem_rows=idem_rows,
            )
            if pending_response is not None:
                return pending_response

            context = self._build_withdraw_create_context(
                owner=owner,
                payload=effective_payload,
                available_receivable=available_receivable,
            )

            if hasattr(self.storage, "process_withdrawal_request_atomic"):
                return await self._create_provider_withdraw_intent_atomic(
                    owner=owner,
                    amount_usdc=context.amount_usdc,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    request_meta=request_meta,
                    redis_client=redis_client,
                    idem_rows=idem_rows,
                )

            return await self._create_provider_withdraw_intent_legacy(
                context=ProviderWithdrawLegacyContext(
                    owner=owner,
                    amount_usdc=context.amount_usdc,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    request_meta=request_meta,
                    redis_client=redis_client,
                    idem_rows=idem_rows,
                    rows=rows,
                    ledger=ledger,
                )
            )

    async def list_provider_withdrawals(
        self, owner_wallet: str
    ) -> ProviderWithdrawListResponse:
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
    ) -> ProviderWithdrawResponse:
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

            amount_usdc = parse_usdc(target.amount_usdc or Decimal("0"))
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
    ) -> ProviderWithdrawResponse:
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
                            withdrawal_id=withdrawal_id,
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

            amount_usdc = parse_usdc(target.amount_usdc or Decimal("0"))
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
                    "amountUsdc": money_str(amount_usdc),
                    "requestMeta": request_meta or {},
                },
            )
            # Analytics: settlement_claim_completed + withdrawal_completed
            from src.services.analytics.gateway_events import (
                emit_settlement_claim_completed,
                emit_withdrawal_completed,
            )
            await emit_settlement_claim_completed(
                owner, claim_usdc=amount_usdc, tx_hash=normalized_tx_hash,
            )
            await emit_withdrawal_completed(
                owner, amount_usdc=amount_usdc, tx_hash=normalized_tx_hash, role="provider",
            )
            return {
                "withdrawalId": str(target.id or ""),
                "status": "COMPLETED",
                "txHash": normalized_tx_hash,
            }
