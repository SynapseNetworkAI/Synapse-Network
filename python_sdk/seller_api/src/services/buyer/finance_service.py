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
            rows = self.repo.load_refund_intents()
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
            self.repo.save_refund_intents(rows, now)

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
        rows = self.repo.load_refund_intents()
        filtered = [
            row for row in rows if normalize_wallet(str(row.get("ownerAddress") or "")) == normalized_owner
        ]
        filtered.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
        return filtered
