from typing import Any, Dict, List, Optional
import asyncio
import time
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.redis_lock import RedisLockManager
from src.services.balance_mixins import BalanceAuditMixin, BalanceRedisGuardMixin
from src.storage.finance_repository import FinanceRepository
from src.storage.base import BaseStorage


class BuyerFinanceService(BalanceAuditMixin, BalanceRedisGuardMixin):
    """Buyer-side funding/refund domain service (deposit + refund)."""

    def __init__(
        self,
        storage: BaseStorage,
        mutation_lock: RedisLockManager,
        guard_delegate: Optional[BalanceRedisGuardMixin] = None,
    ):
        self.storage = storage
        self.repo = FinanceRepository(storage)
        self._mutation_lock = mutation_lock
        self._guard_delegate = guard_delegate

    async def _get_redis_client(self):
        if self._guard_delegate is not None:
            return await self._guard_delegate._get_redis_client()  # type: ignore[attr-defined]
        return await super()._get_redis_client()

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

    def _load_balance_ledger(self) -> Dict[str, Any]:
        return self.repo.load_balance_ledger()

    def _save_balance_ledger(self, ledger: Dict[str, Any]) -> None:
        self.repo.save_balance_ledger(ledger)

    def _parse_refund_amount_usdc(self, payload: Dict[str, Any], available: float) -> float:
        raw = payload.get("amountUsdc")
        try:
            amount = round(float(raw), 6)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be a number."},
            )

        if amount < 10:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be >= 10 USDC."},
            )
        if amount > available:
            raise HTTPException(
                status_code=400,
                detail={"code": "INSUFFICIENT_BUYER_BALANCE", "message": "amountUsdc exceeds buyer available balance."},
            )
        return amount

    def _find_pending_refund(self, rows: List[Dict[str, Any]], owner_wallet: str) -> Optional[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("status") or "").upper() == "PENDING":
                return row
        return None

    def _find_refund_by_id(self, rows: List[Dict[str, Any]], owner_wallet: str, refund_id: str) -> Optional[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        target = str(refund_id or "").strip()
        if not target:
            return None
        for row in rows:
            if str(row.get("id") or "") != target:
                continue
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            return row
        return None

    def _build_pending_refund_response(self, row: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "refundId": str(row.get("id") or ""),
            "signature": str(row.get("signature") or ""),
            "amountRefunded": round(float(row.get("amountUsdc") or 0.0), 6),
            "status": str(row.get("status") or "PENDING"),
            "gasPayer": "BUYER",
            "gasModel": "BUYER_PAYS_ONCHAIN",
        }

    def _normalize_tx_hash_or_raise(self, tx_hash: str) -> str:
        normalized = str(tx_hash or "").strip().lower()
        if not normalized.startswith("0x") or len(normalized) != 66:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_TX_HASH", "message": "txHash must be a 66-char 0x-prefixed hash."},
            )
        return normalized

    def _assert_no_refund_tx_replay(
        self,
        rows: List[Dict[str, Any]],
        owner_wallet: str,
        tx_hash: str,
        current_refund_id: str,
    ) -> None:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("id") or "") == current_refund_id:
                continue
            if str(row.get("txHash") or "").strip().lower() != tx_hash:
                continue
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_TX_REPLAY_DETECTED",
                    "message": "txHash is already bound to another refund intent.",
                },
            )

    def _assert_refund_completable(self, target: Dict[str, Any], tx_hash: str) -> Optional[Dict[str, Any]]:
        status = str(target.get("status") or "").upper()
        if status == "COMPLETED":
            existing_tx = str(target.get("txHash") or "")
            if existing_tx and existing_tx != tx_hash:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "REFUND_ALREADY_COMPLETED",
                        "message": "Refund already completed with a different txHash.",
                    },
                )
            return {
                "refundId": str(target.get("id") or ""),
                "status": "COMPLETED",
                "txHash": existing_tx,
            }
        if status != "PENDING":
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_NOT_PENDING",
                    "message": f"Refund status={status} cannot be completed.",
                },
            )
        return None

    def _consume_locked_refund_amount(self, owner: str, amount_usdc: float) -> None:
        ledger = self._load_balance_ledger()
        buyers_locked = ledger.get("buyersLocked", {})
        locked = round(float(buyers_locked.get(owner, 0.0)), 6)
        if locked + 1e-9 < amount_usdc:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "REFUND_LOCK_INCONSISTENT",
                    "message": "Locked buyer balance is insufficient for this refund intent.",
                },
            )
        buyers_locked[owner] = round(max(0.0, locked - amount_usdc), 6)
        ledger["buyersLocked"] = buyers_locked
        self._save_balance_ledger(ledger)

    def _reserve_buyer_refund_amount(self, owner: str, amount_usdc: float) -> None:
        ledger = self._load_balance_ledger()
        buyers = ledger.get("buyers", {})
        buyers_locked = ledger.get("buyersLocked", {})
        available_balance = round(float(buyers.get(owner, 0.0)), 6)
        if amount_usdc > available_balance:
            raise HTTPException(
                status_code=400,
                detail={"code": "INSUFFICIENT_BUYER_BALANCE", "message": "amountUsdc exceeds buyer available balance."},
            )
        buyers[owner] = round(float(buyers.get(owner, 0.0)) - amount_usdc, 6)
        buyers_locked[owner] = round(float(buyers_locked.get(owner, 0.0)) + amount_usdc, 6)
        ledger["buyers"] = buyers
        ledger["buyersLocked"] = buyers_locked
        self._save_balance_ledger(ledger)

    async def _finalize_refund_idempotency(
        self,
        *,
        owner: str,
        idempotency_key: str,
        request_hash: str,
        response: Dict[str, Any],
        redis_client: Optional[Any],
        idem_rows: List[Dict[str, Any]],
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
        pending: Dict[str, Any],
        owner: str,
        amount_usdc: float,
        idempotency_key: str,
        request_hash: str,
        redis_client: Optional[Any],
        idem_rows: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        pending_amount = round(float(pending.get("amountUsdc") or 0.0), 6)
        if pending_amount != amount_usdc:
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

            intents = self.repo.load_deposit_intents()
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
            self.repo.save_deposit_intents(intents)

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
        rows = self.repo.load_deposit_intents()
        return [
            row
            for row in rows
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

            ledger = self._load_balance_ledger()
            buyers = ledger.get("buyers", {})
            available_balance = round(float(buyers.get(owner, 0.0)), 6)
            amount_usdc = self._parse_refund_amount_usdc(payload, available_balance)

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

            rows = self.repo.load_refund_intents()
            pending = self._find_pending_refund(rows, owner)
            if pending is not None:
                return await self._handle_pending_refund(
                    pending=pending,
                    owner=owner,
                    amount_usdc=amount_usdc,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                    redis_client=redis_client,
                    idem_rows=idem_rows,
                )

            now = int(time.time())
            refund_id = str(uuid4())
            signature = f"mock-refund-signature-{refund_id[:12]}"

            self._reserve_buyer_refund_amount(owner, amount_usdc)

            refund_row = {
                "id": refund_id,
                "ownerAddress": owner,
                "amountUsdc": round(amount_usdc, 6),
                "reason": reason,
                "status": "PENDING",
                "signature": signature,
                "gasPayer": "BUYER",
                "gasModel": "BUYER_PAYS_ONCHAIN",
                "idempotencyKey": idempotency_key,
                "createdAt": now,
                "updatedAt": now,
                "requestMeta": request_meta or {},
            }
            rows.append(refund_row)
            self.repo.save_refund_intents(rows, now)

            response = {
                "refundId": refund_id,
                "signature": signature,
                "amountRefunded": round(amount_usdc, 6),
                "status": "PENDING",
                "gasPayer": "BUYER",
                "gasModel": "BUYER_PAYS_ONCHAIN",
            }
            await self._finalize_refund_idempotency(
                owner=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
                redis_client=redis_client,
                idem_rows=idem_rows,
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
        rows = self.repo.load_refund_intents()
        filtered = [
            row for row in rows if normalize_wallet(str(row.get("ownerAddress") or "")) == normalized_owner
        ]
        filtered.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
        return filtered

    async def complete_refund_intent(
        self,
        owner_wallet: str,
        refund_id: str,
        tx_hash: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        owner = normalize_wallet(owner_wallet)
        async with self._mutation_lock.lock(f"{owner}:refund_complete"):
            await self._enforce_owner_write_rate_limit(owner, "refund_complete")
            rows = self.repo.load_refund_intents()
            target = self._find_refund_by_id(rows, owner, refund_id)
            if target is None:
                raise HTTPException(
                    status_code=404,
                    detail={"code": "REFUND_NOT_FOUND", "message": "Refund intent not found."},
                )

            normalized_tx_hash = self._normalize_tx_hash_or_raise(tx_hash)
            self._assert_no_refund_tx_replay(rows, owner, normalized_tx_hash, str(target.get("id") or ""))
            completed = self._assert_refund_completable(target, normalized_tx_hash)
            if completed is not None:
                return completed

            amount_usdc = round(float(target.get("amountUsdc") or 0.0), 6)
            self._consume_locked_refund_amount(owner, amount_usdc)

            now = int(time.time())
            target["status"] = "COMPLETED"
            target["txHash"] = normalized_tx_hash
            target["completedAt"] = now
            target["updatedAt"] = now
            target["completeMeta"] = request_meta or {}
            self.repo.save_refund_intents(rows, now)

            self._append_financial_audit(
                "REFUND_INTENT_COMPLETED",
                owner,
                {
                    "refundId": str(target.get("id") or ""),
                    "txHash": normalized_tx_hash,
                    "amountUsdc": amount_usdc,
                    "requestMeta": request_meta or {},
                },
            )
            return {
                "refundId": str(target.get("id") or ""),
                "status": "COMPLETED",
                "txHash": normalized_tx_hash,
            }
