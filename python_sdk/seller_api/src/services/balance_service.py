from typing import Dict, Any, List, Optional
import asyncio
import time
from uuid import uuid4

from fastapi import HTTPException

from src.storage.base import BaseStorage
from src.core.common import normalize_wallet
from src.core.config import settings
from src.core.redis_lock import RedisLockManager
from src.services.balance_mixins import (
    BalanceAuditMixin,
    BalanceRedisGuardMixin,
    BalanceWithdrawSigningMixin,
    USDC_DECIMALS,
)


class BalanceService(BalanceAuditMixin, BalanceRedisGuardMixin, BalanceWithdrawSigningMixin):
    """Financial safety service orchestrator with Redis-first idempotency/rate-limit/locks."""

    def __init__(self, storage: BaseStorage):
        self.storage = storage
        self._mutation_lock = RedisLockManager(
            redis_getter=self._get_redis_client,
            key_prefix="finance:mutation-lock",
            acquire_timeout_sec=5.0,
            poll_interval_sec=0.03,
        )

    def _normalize_withdrawal_rows(self) -> List[Dict[str, Any]]:
        rows = self._normalize_rows(self.storage.get_collection("provider_withdrawal_intents"))
        for row in rows:
            if "status" not in row:
                row["status"] = "PENDING"
        return rows

    def _save_withdrawal_rows(self, rows: List[Dict[str, Any]]) -> None:
        self.storage.save_collection("provider_withdrawal_intents", {"rows": rows, "updatedAt": int(time.time())})

    def _load_balance_ledger(self) -> Dict[str, Any]:
        ledger = self.storage.get_collection("balance_ledger") or {}
        if not isinstance(ledger, dict):
            ledger = {}
        buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
        sellers = ledger.get("sellers") if isinstance(ledger.get("sellers"), dict) else {}
        sellers_locked = ledger.get("sellersLocked") if isinstance(ledger.get("sellersLocked"), dict) else {}
        platform = ledger.get("platform") if isinstance(ledger.get("platform"), dict) else {}
        platform.setdefault("feeAccrued", 0.0)
        ledger["buyers"] = buyers
        ledger["sellers"] = sellers
        ledger["sellersLocked"] = sellers_locked
        ledger["platform"] = platform
        ledger.setdefault("updatedAt", int(time.time()))
        return ledger

    def _save_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        next_ledger = dict(ledger)
        next_ledger["updatedAt"] = int(time.time())
        self.storage.save_collection("balance_ledger", next_ledger)

    def _get_pending_withdrawal(self, rows: List[Dict[str, Any]], owner_wallet: str) -> Optional[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("status") or "").upper() == "PENDING":
                return row
        return None

    def _find_withdrawal_by_id(self, rows: List[Dict[str, Any]], owner_wallet: str, withdrawal_id: str) -> Optional[Dict[str, Any]]:
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

    def _parse_withdraw_amount_usdc(self, payload: Dict[str, Any], available: float) -> float:
        raw = payload.get("amountUsdc")
        if raw is None:
            if available <= 0:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INSUFFICIENT_SELLER_RECEIVABLE", "message": "No seller receivable available for withdrawal."},
                )
            return round(available, 6)
        try:
            amount = float(raw)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be a number."},
            )
        amount = round(amount, 6)
        if amount <= 0:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be greater than 0."},
            )
        if amount > available:
            raise HTTPException(
                status_code=400,
                detail={"code": "INSUFFICIENT_SELLER_RECEIVABLE", "message": "amountUsdc exceeds seller receivable."},
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
            "status": str(row.get("status") or "PENDING"),
            "amountUsdc": round(float(row.get("amountUsdc") or 0.0), 6),
            "ticket": row.get("ticket") if isinstance(row.get("ticket"), dict) else {},
        }

    def _normalize_tx_hash_or_raise(self, tx_hash: str) -> str:
        normalized = str(tx_hash or "").strip().lower()
        if not normalized.startswith("0x") or len(normalized) != 66:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_TX_HASH", "message": "txHash must be a 66-char 0x-prefixed hash."},
            )
        return normalized

    def _assert_withdrawal_completable(self, target: Dict[str, Any], tx_hash: str) -> Optional[Dict[str, Any]]:
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
        if status != "PENDING":
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "WITHDRAWAL_NOT_PENDING",
                    "message": f"Withdrawal status={status} cannot be completed.",
                },
            )
        return None

    def _assert_no_withdraw_tx_replay(self, rows: List[Dict[str, Any]], owner_wallet: str, tx_hash: str, current_withdrawal_id: str) -> None:
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
        sellers_locked = ledger.get("sellersLocked", {})
        locked = round(float(sellers_locked.get(owner, 0.0)), 6)
        if locked + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "WITHDRAWAL_LOCK_INCONSISTENT",
                    "message": "Locked seller receivable is insufficient for this withdrawal intent.",
                },
            )
        sellers_locked[owner] = round(max(0.0, locked - amount_usdc), 6)
        ledger["sellersLocked"] = sellers_locked
        self._save_balance_ledger(ledger)

    async def get_balance(self, owner_wallet: str) -> Dict[str, Any]:
        """Only return current authenticated owner's balance summary."""
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        balance_data = self.storage.get_collection("balance_ledger") or {}
        if not isinstance(balance_data, dict):
            balance_data = {}

        buyers = balance_data.get("buyers") if isinstance(balance_data.get("buyers"), dict) else {}
        sellers = balance_data.get("sellers") if isinstance(balance_data.get("sellers"), dict) else {}
        sellers_locked = balance_data.get("sellersLocked") if isinstance(balance_data.get("sellersLocked"), dict) else {}
        platform = balance_data.get("platform") if isinstance(balance_data.get("platform"), dict) else {}

        return {
            "ownerAddress": normalized_owner,
            "buyerBalance": round(float(buyers.get(normalized_owner, 0.0)), 6),
            "sellerReceivable": round(float(sellers.get(normalized_owner, 0.0)), 6),
            "sellerLocked": round(float(sellers_locked.get(normalized_owner, 0.0)), 6),
            "platformFeeAccrued": round(float(platform.get("feeAccrued", 0.0)), 6),
            "updatedAt": int(balance_data.get("updatedAt") or 0),
        }

    def _normalize_intents(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("intents"), list):
            return [item for item in raw["intents"] if isinstance(item, dict)]
        return []

    def _normalize_rows(self, raw: Any) -> List[Dict[str, Any]]:
        if isinstance(raw, list):
            return [item for item in raw if isinstance(item, dict)]
        if isinstance(raw, dict) and isinstance(raw.get("rows"), list):
            return [item for item in raw["rows"] if isinstance(item, dict)]
        return []

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

            tx_hash = str(intent.get("txHash") or "").strip()
            if not tx_hash.startswith("0x") or len(tx_hash) != 66:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_TX_HASH", "message": "txHash must be a 66-char 0x-prefixed hash."},
                )

            amount_usdc = float(intent.get("amountUsdc") or 0)
            if amount_usdc <= 0:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be greater than 0."},
                )

            intents = self._normalize_intents(self.storage.get_collection("deposit_intents"))
            request_payload = {
                "ownerAddress": owner,
                "txHash": tx_hash.lower(),
                "amountUsdc": round(amount_usdc, 6),
            }
            request_hash = self._request_hash(request_payload)
            redis_client = await self._get_redis_client()

            redis_hit = await self._check_idempotency_redis(
                scope="deposit_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if redis_hit is not None:
                return redis_hit

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
                    return redis_retry

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
                    return idem_hit

            self._validate_unique_recent_deposit(intents, owner, tx_hash)

            now = int(time.time())
            next_intent = dict(intent)
            next_intent["ownerAddress"] = owner
            next_intent["buyerAddress"] = owner
            next_intent["txHash"] = tx_hash
            next_intent["amountUsdc"] = round(amount_usdc, 6)
            next_intent["idempotencyKey"] = idempotency_key
            next_intent.setdefault("id", str(uuid4()))
            next_intent.setdefault("status", "PENDING")
            next_intent.setdefault("createdAt", now)
            next_intent["updatedAt"] = now
            intents.append(next_intent)
            self.storage.save_collection("deposit_intents", intents)

            response = dict(next_intent)
            if redis_client is None:
                self._record_idempotent_response(
                    rows=idem_rows,
                    scope="deposit_intent",
                    owner_wallet=owner,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    response=response,
                )
            await self._complete_idempotency_redis(
                scope="deposit_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
            )
            self._append_financial_audit(
                "DEPOSIT_INTENT_REGISTERED",
                owner,
                {
                    "depositIntentId": next_intent.get("id"),
                    "txHash": next_intent.get("txHash"),
                    "amountUsdc": next_intent.get("amountUsdc"),
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return next_intent

    async def list_deposit_intents(self, owner_wallet: str) -> list:
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        rows = self._normalize_intents(self.storage.get_collection("deposit_intents"))
        return [
            row for row in rows
            if normalize_wallet(str(row.get("ownerAddress") or row.get("buyerAddress") or "")) == normalized_owner
        ]

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

            amount_usdc = float(payload.get("amountUsdc") or 0)
            if amount_usdc < 10:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be >= 10 USDC."},
                )

            reason = str(payload.get("reason") or "").strip()
            if len(reason) > 256:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_REASON", "message": "reason must be <= 256 chars."},
                )

            request_payload = {
                "ownerAddress": owner,
                "amountUsdc": round(amount_usdc, 6),
                "reason": reason,
            }
            request_hash = self._request_hash(request_payload)
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

            now = int(time.time())
            rows = self._normalize_rows(self.storage.get_collection("refund_intents"))
            refund_id = str(uuid4())
            signature = f"mock-refund-signature-{refund_id[:12]}"
            refund_row = {
                "id": refund_id,
                "ownerAddress": owner,
                "amountUsdc": round(amount_usdc, 6),
                "reason": reason,
                "status": "PENDING",
                "signature": signature,
                "idempotencyKey": idempotency_key,
                "createdAt": now,
                "updatedAt": now,
            }
            rows.append(refund_row)
            self.storage.save_collection("refund_intents", {"rows": rows, "updatedAt": now})

            response = {
                "refundId": refund_id,
                "signature": signature,
                "amountRefunded": round(amount_usdc, 6),
                "status": "PENDING",
            }
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
            self._append_financial_audit(
                "REFUND_INTENT_CREATED",
                owner,
                {
                    "refundId": refund_id,
                    "amountUsdc": round(amount_usdc, 6),
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return response

    async def list_refunds(self, owner_wallet: str) -> List[Dict[str, Any]]:
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        rows = self._normalize_rows(self.storage.get_collection("refund_intents"))
        filtered = [
            row for row in rows if normalize_wallet(str(row.get("ownerAddress") or "")) == normalized_owner
        ]
        filtered.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
        return filtered

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
            await self._enforce_owner_write_rate_limit(owner, "provider_withdraw_intent")

            request_hash = self._request_hash(
                {
                    "ownerAddress": owner,
                    "amountUsdc": self._requested_withdraw_amount_for_hash(payload),
                }
            )
            existing_response, redis_client, idem_rows = await self._begin_provider_withdraw_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if existing_response is not None:
                return existing_response

            ledger = self._load_balance_ledger()
            sellers = ledger.get("sellers", {})
            available_receivable = round(float(sellers.get(owner, 0.0)), 6)
            amount_usdc = self._parse_withdraw_amount_usdc(payload, available_receivable)

            rows = self._normalize_withdrawal_rows()
            pending = self._get_pending_withdrawal(rows, owner)
            if pending is not None:
                if normalize_wallet(str(pending.get("ownerAddress") or "")) == owner and round(float(pending.get("amountUsdc") or 0.0), 6) == amount_usdc:
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

            private_key = self._require_withdraw_signer()
            nonce, chain_id = self._resolve_withdraw_nonce_and_chain(owner)
            deadline = int(time.time()) + self._resolve_withdraw_deadline_sec()

            amount_wei = int(round(amount_usdc * float(10**USDC_DECIMALS)))
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

            sellers[owner] = round(float(sellers.get(owner, 0.0)) - amount_usdc, 6)
            sellers_locked = ledger.get("sellersLocked", {})
            sellers_locked[owner] = round(float(sellers_locked.get(owner, 0.0)) + amount_usdc, 6)
            ledger["sellers"] = sellers
            ledger["sellersLocked"] = sellers_locked
            self._save_balance_ledger(ledger)

            now = int(time.time())
            withdrawal_id = str(uuid4())
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
                "status": "PENDING",
                "idempotencyKey": idempotency_key,
                "createdAt": now,
                "updatedAt": now,
                "requestMeta": request_meta or {},
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
            rows.append(row)
            self._save_withdrawal_rows(rows)

            response = {
                "withdrawalId": withdrawal_id,
                "status": "PENDING",
                "amountUsdc": amount_usdc,
                "ticket": row["ticket"],
            }
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
                    "withdrawalId": withdrawal_id,
                    "amountUsdc": amount_usdc,
                    "nonce": nonce,
                    "deadline": deadline,
                    "idempotencyKey": idempotency_key,
                    "requestMeta": request_meta or {},
                },
            )
            return response

    async def list_provider_withdrawals(self, owner_wallet: str) -> List[Dict[str, Any]]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        rows = self._normalize_withdrawal_rows()
        filtered = [
            row for row in rows if normalize_wallet(str(row.get("ownerAddress") or "")) == owner
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
            await self._enforce_owner_write_rate_limit(owner, "provider_withdraw_complete")
            rows = self._normalize_withdrawal_rows()
            target = self._find_withdrawal_by_id(rows, owner, withdrawal_id)
            if target is None:
                raise HTTPException(
                    status_code=404,
                    detail={"code": "WITHDRAWAL_NOT_FOUND", "message": "Provider withdrawal intent not found."},
                )

            normalized_tx_hash = self._normalize_tx_hash_or_raise(tx_hash)
            self._assert_no_withdraw_tx_replay(rows, owner, normalized_tx_hash, str(target.get("id") or ""))
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

    async def get_router_config(self, owner_wallet: str) -> Dict[str, Any]:
        await asyncio.sleep(0)
        owner = normalize_wallet(owner_wallet)
        raw = self.storage.get_collection("router_config")
        rows: List[Dict[str, Any]]
        if isinstance(raw, list):
            rows = [item for item in raw if isinstance(item, dict)]
        elif isinstance(raw, dict) and isinstance(raw.get("rows"), list):
            rows = [item for item in raw.get("rows", []) if isinstance(item, dict)]
        else:
            rows = []

        found = next((row for row in rows if normalize_wallet(str(row.get("ownerAddress") or "")) == owner), None)
        if not found:
            return {"ownerAddress": owner, "dailyLimitUsdc": 0.0, "updatedAt": None}

        return {
            "ownerAddress": owner,
            "dailyLimitUsdc": round(float(found.get("dailyLimitUsdc") or 0.0), 6),
            "updatedAt": int(found.get("updatedAt") or 0) or None,
        }

    async def set_router_config(
        self,
        owner_wallet: str,
        daily_limit_usdc: float,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:router_config"):
            await self._enforce_owner_write_rate_limit(owner, "router_config")
            if daily_limit_usdc < 0 or daily_limit_usdc > 10_000:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INVALID_DAILY_LIMIT",
                        "message": "dailyLimitUsdc must be within [0, 10000].",
                    },
                )

            now = int(time.time())
            raw = self.storage.get_collection("router_config")
            rows: List[Dict[str, Any]]
            if isinstance(raw, list):
                rows = [item for item in raw if isinstance(item, dict)]
            elif isinstance(raw, dict) and isinstance(raw.get("rows"), list):
                rows = [item for item in raw.get("rows", []) if isinstance(item, dict)]
            else:
                rows = []

            existing = next((row for row in rows if normalize_wallet(str(row.get("ownerAddress") or "")) == owner), None)
            if existing is None:
                existing = {
                    "id": str(uuid4()),
                    "ownerAddress": owner,
                    "dailyLimitUsdc": round(float(daily_limit_usdc), 6),
                    "createdAt": now,
                    "updatedAt": now,
                }
                rows.append(existing)
            else:
                existing["dailyLimitUsdc"] = round(float(daily_limit_usdc), 6)
                existing["updatedAt"] = now

            self.storage.save_collection("router_config", {"rows": rows, "updatedAt": now})
            self._append_financial_audit(
                "ROUTER_CONFIG_UPDATED",
                owner,
                {
                    "dailyLimitUsdc": existing.get("dailyLimitUsdc"),
                    "requestMeta": request_meta or {},
                },
            )
            return {
                "ownerAddress": owner,
                "dailyLimitUsdc": existing.get("dailyLimitUsdc"),
                "updatedAt": existing.get("updatedAt"),
            }
