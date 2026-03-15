from typing import Any, Dict, List, Optional
import asyncio
import time
from uuid import uuid4
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.core.redis_lock import RedisLockManager
from src.domain.finance import BalanceLedger
from src.domain.finance import WithdrawalIntentRow
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
INSUFFICIENT_RECEIVABLE_MESSAGE = "amountUsdc exceeds seller receivable."


class SellerWithdrawService(
    BalanceAuditMixin, BalanceRedisGuardMixin, BalanceWithdrawSigningMixin
):
    """Seller-side withdrawal domain service."""

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

    def _normalize_rows(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("rows"), list):
            return [item for item in raw["rows"] if isinstance(item, dict)]
        return []

    def _normalize_withdrawal_rows(self) -> List[Dict[str, Any]]:
        raw_rows = self.storage.get_data_manager().system.gateway_state.read_withdrawal_intents()
        rows: List[Dict[str, Any]] = []
        if isinstance(raw_rows, list):
            for row in raw_rows:
                if isinstance(row, WithdrawalIntentRow):
                    rows.append(row.model_dump(by_alias=True, mode="json"))
                elif isinstance(row, dict):
                    rows.append(row)
        for row in rows:
            status = str(row.get("status") or "").upper()
            if not status or status == "PENDING":
                row["status"] = "REQUESTED"
            else:
                row["status"] = status
        return rows

    def _save_withdrawal_rows(self, rows: List[Dict[str, Any]]) -> None:
        repo = self.storage.get_data_manager().system.gateway_state
        try:
            # Preserve full dict payload for in-memory/non-SQL repositories.
            repo.write_withdrawal_intents(rows, int(time.time()))
        except Exception:
            typed_rows = [
                WithdrawalIntentRow.model_validate(row)
                for row in rows
                if isinstance(row, dict)
            ]
            repo.write_withdrawal_intents(typed_rows, int(time.time()))

    def _load_balance_ledger(self) -> BalanceLedger:
        return self.storage.get_data_manager().finance.balance.read_balance_ledger()

    def _save_balance_ledger(self, ledger: BalanceLedger) -> None:
        ledger.updated_at = int(time.time())
        self.storage.get_data_manager().finance.balance.write_balance_ledger(ledger)

    def _get_pending_withdrawal(
        self, rows: List[Dict[str, Any]], owner_wallet: str
    ) -> Optional[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("status") or "").upper() in ACTIVE_WITHDRAWAL_STATUSES:
                return row
        return None

    def _find_withdrawal_by_id(
        self, rows: List[Dict[str, Any]], owner_wallet: str, withdrawal_id: str
    ) -> Optional[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        target = str(withdrawal_id or "").strip()
        if not target:
            return None
        for row in rows:
            if str(row.get("id") or "") != target:
                continue
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
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
                        "code": "INSUFFICIENT_SELLER_RECEIVABLE",
                        "message": "No seller receivable available for withdrawal.",
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
                    "code": "INSUFFICIENT_SELLER_RECEIVABLE",
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

    def _build_pending_withdraw_response(self, row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "withdrawalId": str(row.get("id") or ""),
            "status": str(row.get("status") or "REQUESTED"),
            "amountUsdc": round(float(row.get("amountUsdc") or 0.0), 6),
            "ticket": row.get("ticket") if isinstance(row.get("ticket"), dict) else {},
            "message": str(row.get("message") or ""),
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
        self, target: Dict[str, Any], tx_hash: str
    ) -> Optional[Dict[str, Any]]:
        status = str(target.get("status") or "").upper()
        if status == "COMPLETED":
            existing_tx = str(target.get("txHash") or "")
            if existing_tx and existing_tx != tx_hash:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "WITHDRAWAL_ALREADY_COMPLETED",
                        "message": "Withdrawal already completed with a different txHash.",
                    },
                )
            return {
                "withdrawalId": str(target.get("id") or ""),
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
        rows: List[Dict[str, Any]],
        owner_wallet: str,
        tx_hash: str,
        current_withdrawal_id: str,
    ) -> None:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("id") or "") == current_withdrawal_id:
                continue
            if str(row.get("txHash") or "").strip().lower() != tx_hash:
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
        locked = round(float(ledger.sellers_locked.get(owner, 0.0)), 6)
        if locked + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "WITHDRAWAL_LOCK_INCONSISTENT",
                    "message": "Locked seller receivable is insufficient for this withdrawal intent.",
                },
            )
        ledger.sellers_locked[owner] = round(max(0.0, locked - amount_usdc), 6)
        self._save_balance_ledger(ledger)

    def _reserve_withdraw_amount(
        self, owner: str, amount_usdc: float, ledger: BalanceLedger
    ) -> None:
        ledger.sellers[owner] = round(
            float(ledger.sellers.get(owner, 0.0)) - amount_usdc, 6
        )
        ledger.sellers_locked[owner] = round(
            float(ledger.sellers_locked.get(owner, 0.0)) + amount_usdc, 6
        )
        if hasattr(self.storage, "reserve_seller_withdraw_atomic"):
            try:
                getattr(self.storage, "reserve_seller_withdraw_atomic")(
                    owner_wallet=owner,
                    amount_usdc=Decimal(str(amount_usdc)).quantize(
                        Decimal("0.000001"), rounding=ROUND_HALF_UP
                    ),
                )
            except RuntimeError as exc:
                if str(exc) == "INSUFFICIENT_SELLER_RECEIVABLE":
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "code": "INSUFFICIENT_SELLER_RECEIVABLE",
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
    ) -> Dict[str, Any]:
        requires_manual_review = amount_usdc >= WITHDRAW_AUTO_APPROVAL_LIMIT_USDC
        amount_wei = int(round(amount_usdc * float(10**USDC_DECIMALS)))

        if requires_manual_review:
            return {
                "requiresManualReview": True,
                "amountWei": amount_wei,
                "feeWei": 0,
                "nonce": 0,
                "chainId": 0,
                "deadline": 0,
                "signature": "",
                "signerAddress": "",
                "ticket": {},
            }

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

        return {
            "requiresManualReview": False,
            "amountWei": amount_wei,
            "feeWei": fee_wei,
            "nonce": nonce,
            "chainId": chain_id,
            "deadline": deadline,
            "signature": signature,
            "signerAddress": signer_address,
            "ticket": {
                "amount": str(amount_wei),
                "fee": str(fee_wei),
                "nonce": nonce,
                "deadline": deadline,
                "signature": signature,
                "chainId": chain_id,
                "contractAddress": normalize_wallet(settings.router_address),
            },
        }

    def _build_atomic_signing_ticket(
        self, owner: str, amount_usdc: Decimal
    ) -> Dict[str, Any]:
        payload = self._prepare_withdraw_ticket(
            owner=owner, amount_usdc=float(amount_usdc)
        )
        if bool(payload.get("requiresManualReview")):
            return {}
        return payload.get("ticket") if isinstance(payload.get("ticket"), dict) else {}

    def process_withdrawal_request(
        self,
        *,
        seller_address: str,
        amount_usdc: Decimal,
        request_id: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if not hasattr(self.storage, "process_withdrawal_request_atomic"):
            raise RuntimeError("WITHDRAWAL_ATOMIC_NOT_SUPPORTED")

        owner = normalize_wallet(seller_address)
        high_risk_override = owner in settings.withdrawal_high_risk_seller_addresses
        window_seconds = max(1, int(settings.withdrawal_window_hours)) * 3600

        try:
            return getattr(self.storage, "process_withdrawal_request_atomic")(
                seller_address=owner,
                amount_usdc=amount_usdc,
                request_id=request_id,
                idempotency_key=idempotency_key,
                request_meta=request_meta,
                single_limit_usdc=Decimal(
                    str(settings.withdrawal_auto_single_limit_usdc)
                ),
                rolling_24h_limit_usdc=Decimal(
                    str(settings.withdrawal_auto_24h_limit_usdc)
                ),
                window_seconds=window_seconds,
                high_risk_override=high_risk_override,
                sign_ticket_factory=lambda value: self._build_atomic_signing_ticket(
                    owner, value
                ),
            )
        except RuntimeError as exc:
            code = str(exc)
            if code == "INSUFFICIENT_SELLER_RECEIVABLE":
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INSUFFICIENT_SELLER_RECEIVABLE",
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
            seller_address=owner,
            amount_usdc=Decimal(str(amount_usdc)).quantize(
                Decimal("0.000001"), rounding=ROUND_HALF_UP
            ),
            request_id=request_id,
            idempotency_key=idempotency_key,
            request_meta=request_meta,
        )
        response = {
            "withdrawalId": str(atomic_result.get("withdrawalId") or ""),
            "status": str(atomic_result.get("status") or "REQUESTED"),
            "amountUsdc": round(
                float(atomic_result.get("amountUsdc") or amount_usdc), 6
            ),
            "ticket": atomic_result.get("ticket")
            if isinstance(atomic_result.get("ticket"), dict)
            else {},
            "message": str(atomic_result.get("message") or ""),
        }
        await self._finish_provider_withdraw_idempotency(
            owner=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response=response,
            redis_client=redis_client,
            idem_rows=idem_rows,
        )
        if str(atomic_result.get("decision") or "").lower() == "red":
            raise HTTPException(
                status_code=403,
                detail={
                    "code": str(
                        atomic_result.get("riskReasonCode")
                        or "WITHDRAWAL_BLOCKED_BY_RISK_POLICY"
                    ),
                    "message": str(
                        atomic_result.get("message")
                        or "Withdrawal blocked by risk policy."
                    ),
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
        rows: List[Dict[str, Any]],
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
            normalize_wallet(str(pending.get("ownerAddress") or "")) == owner
            and round(float(pending.get("amountUsdc") or 0.0), 6) == amount_usdc
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
        ticket_payload: Dict[str, Any],
    ) -> tuple[Dict[str, Any], Dict[str, Any]]:
        requires_manual_review = bool(ticket_payload.get("requiresManualReview"))
        amount_wei = int(ticket_payload.get("amountWei") or 0)
        fee_wei = int(ticket_payload.get("feeWei") or 0)
        nonce = int(ticket_payload.get("nonce") or 0)
        chain_id = int(ticket_payload.get("chainId") or 0)
        deadline = int(ticket_payload.get("deadline") or 0)
        signature = str(ticket_payload.get("signature") or "")
        signer_address = str(ticket_payload.get("signerAddress") or "")
        ticket = (
            ticket_payload.get("ticket")
            if isinstance(ticket_payload.get("ticket"), dict)
            else {}
        )

        now = int(time.time())
        withdrawal_id = str(uuid4())
        status = "PENDING_MANUAL_REVIEW" if requires_manual_review else "APPROVED_AUTO"
        message = (
            "Withdrawal requested. Amounts over $100 require manual security review (ETA: 12-24 hrs)."
            if requires_manual_review
            else ""
        )
        row = {
            "id": withdrawal_id,
            "ownerAddress": owner,
            "amountUsdc": amount_usdc,
            "amountWei": str(amount_wei),
            "feeWei": str(fee_wei),
            "nonce": nonce,
            "deadline": deadline,
            "signature": signature,
            "chainId": chain_id,
            "contractAddress": normalize_wallet(settings.router_address),
            "signerAddress": signer_address,
            "status": status,
            "businessType": "withdraw",
            "riskLevel": "yellow" if requires_manual_review else "green",
            "idempotencyKey": idempotency_key,
            "createdAt": now,
            "updatedAt": now,
            "requestMeta": request_meta or {},
            "message": message,
            "ticket": ticket,
        }
        response = {
            "withdrawalId": withdrawal_id,
            "status": status,
            "amountUsdc": amount_usdc,
            "ticket": ticket,
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

            request_hash = self._request_hash(
                {
                    "ownerAddress": owner,
                    "amountUsdc": self._requested_withdraw_amount_for_hash(payload),
                }
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

            ledger = self._load_balance_ledger()
            available_receivable = round(float(ledger.sellers.get(owner, 0.0)), 6)
            amount_usdc = self._parse_withdraw_amount_usdc(
                payload, available_receivable
            )

            rows = self._normalize_withdrawal_rows()
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

            if hasattr(self.storage, "process_withdrawal_request_atomic"):
                return await self._create_provider_withdraw_intent_atomic(
                    owner=owner,
                    amount_usdc=amount_usdc,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    request_meta=request_meta,
                    redis_client=redis_client,
                    idem_rows=idem_rows,
                )

            ticket_payload = self._prepare_withdraw_ticket(
                owner=owner, amount_usdc=amount_usdc
            )
            self._reserve_withdraw_amount(owner, amount_usdc, ledger)
            row, response = self._build_withdraw_row_and_response(
                owner=owner,
                amount_usdc=amount_usdc,
                idempotency_key=idempotency_key,
                request_meta=request_meta,
                ticket_payload=ticket_payload,
            )
            rows.append(row)
            self._save_withdrawal_rows(rows)
            await self._finish_provider_withdraw_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
                redis_client=redis_client,
                idem_rows=idem_rows,
            )

            self._append_financial_audit(
                "PROVIDER_WITHDRAW_INTENT_CREATED",
                owner,
                {
                    "withdrawalId": response["withdrawalId"],
                    "amountUsdc": amount_usdc,
                    "status": response["status"],
                    "nonce": row.get("nonce"),
                    "deadline": row.get("deadline"),
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
            if normalize_wallet(str(row.get("ownerAddress") or "")) == owner
        ]
        filtered.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
        return filtered

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
                        owner_wallet=owner,
                        tx_hash=normalized_tx_hash,
                        kind="provider_withdraw",
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
                rows, owner, normalized_tx_hash, str(target.get("id") or "")
            )
            completed = self._assert_withdrawal_completable(target, normalized_tx_hash)
            if completed is not None:
                return completed

            amount_usdc = round(float(target.get("amountUsdc") or 0.0), 6)
            self._consume_locked_withdraw_amount(owner, amount_usdc)

            now = int(time.time())
            target["status"] = "COMPLETED"
            target["txHash"] = normalized_tx_hash
            target["completedAt"] = now
            target["updatedAt"] = now
            target["completeMeta"] = request_meta or {}
            self._save_withdrawal_rows(rows)

            self._append_financial_audit(
                "PROVIDER_WITHDRAW_COMPLETED",
                owner,
                {
                    "withdrawalId": str(target.get("id") or ""),
                    "txHash": normalized_tx_hash,
                    "amountUsdc": amount_usdc,
                    "requestMeta": request_meta or {},
                },
            )
            return {
                "withdrawalId": str(target.get("id") or ""),
                "status": "COMPLETED",
                "txHash": normalized_tx_hash,
            }
