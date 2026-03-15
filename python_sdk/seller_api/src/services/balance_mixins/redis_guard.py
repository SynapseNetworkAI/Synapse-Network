import hashlib
import json
import re
import time
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import HTTPException

from src.core.common import normalize_wallet
from src.core.config import settings
from src.core.redis_client import get_redis_client
from src.services.repository_access import idempotency_repo

REDIS_IDEM_CLAIM_LUA = """
local existing = redis.call('GET', KEYS[1])
if existing then
    return {0, existing}
end
local payload = cjson.encode({
    requestHash = ARGV[1],
    status = 'processing',
    createdAt = tonumber(ARGV[2])
})
redis.call('SET', KEYS[1], payload, 'EX', tonumber(ARGV[3]))
return {1, ''}
"""

REDIS_RATE_LIMIT_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return current
"""


class BalanceRedisGuardMixin:
    async def _get_redis_client(self):
        return await get_redis_client()

    def _idem_key(self, scope: str, owner_wallet: str, idempotency_key: str) -> str:
        return f"finance:idem:{scope}:{normalize_wallet(owner_wallet)}:{idempotency_key}"

    def _request_hash(self, payload: Dict[str, Any]) -> str:
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def _load_idempotency_rows(self) -> List[Dict[str, Any]]:
        rows = idempotency_repo(self.storage).read_idempotency_rows()
        rows = [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
        now = int(time.time())
        filtered = [row for row in rows if int(row.get("expiresAt") or 0) > now]
        max_rows = max(500, int(settings.finance_idempotency_max_rows))
        if len(filtered) > max_rows:
            filtered.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
            filtered = filtered[:max_rows]
        if len(filtered) != len(rows):
            idempotency_repo(self.storage).write_idempotency_rows(filtered, now)
        return filtered

    def _save_idempotency_rows(self, rows: List[Dict[str, Any]]) -> None:
        max_rows = max(500, int(settings.finance_idempotency_max_rows))
        if len(rows) > max_rows:
            rows.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
            rows = rows[:max_rows]
        now = int(time.time())
        idempotency_repo(self.storage).write_idempotency_rows(rows, now)

    async def _check_idempotency_redis(
        self,
        *,
        scope: str,
        owner_wallet: str,
        idempotency_key: str,
        request_hash: str,
    ) -> Optional[Dict[str, Any]]:
        redis_client = await self._get_redis_client()
        if redis_client is None:
            return None

        raw = await redis_client.get(self._idem_key(scope, owner_wallet, idempotency_key))
        if not raw:
            return None

        try:
            parsed = json.loads(raw)
        except Exception:
            return None

        stored_hash = str(parsed.get("requestHash") or "")
        if stored_hash != request_hash:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
                    "message": "Idempotency key payload mismatch.",
                },
            )

        status = str(parsed.get("status") or "")
        if status == "done" and isinstance(parsed.get("response"), dict):
            return parsed.get("response")
        if status == "processing":
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "IDEMPOTENCY_REQUEST_IN_PROGRESS",
                    "message": "A request with this idempotency key is already processing.",
                },
            )
        return None

    async def _start_idempotency_redis(
        self,
        *,
        scope: str,
        owner_wallet: str,
        idempotency_key: str,
        request_hash: str,
    ) -> bool:
        redis_client = await self._get_redis_client()
        if redis_client is None:
            return False

        ttl_sec = max(300, int(settings.finance_idempotency_ttl_sec))
        key = self._idem_key(scope, owner_wallet, idempotency_key)
        now = int(time.time())
        try:
            result = await redis_client.eval(REDIS_IDEM_CLAIM_LUA, 1, key, request_hash, now, ttl_sec)
            if isinstance(result, list) and result and int(result[0]) == 1:
                return True
            return False
        except Exception:
            payload = {
                "requestHash": request_hash,
                "status": "processing",
                "createdAt": now,
            }
            return bool(
                await redis_client.set(
                    key,
                    json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
                    ex=ttl_sec,
                    nx=True,
                )
            )

    async def _complete_idempotency_redis(
        self,
        *,
        scope: str,
        owner_wallet: str,
        idempotency_key: str,
        request_hash: str,
        response: Dict[str, Any],
    ) -> None:
        redis_client = await self._get_redis_client()
        if redis_client is None:
            return
        ttl_sec = max(300, int(settings.finance_idempotency_ttl_sec))
        payload = {
            "requestHash": request_hash,
            "status": "done",
            "response": response,
            "updatedAt": int(time.time()),
        }
        await redis_client.set(
            self._idem_key(scope, owner_wallet, idempotency_key),
            json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
            ex=ttl_sec,
        )

    def _validate_idempotency_key(self, idempotency_key: str) -> str:
        key = str(idempotency_key or "").strip()
        if len(key) < 16 or len(key) > 128:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_IDEMPOTENCY_KEY", "message": "idempotency key length must be 16..128."},
            )
        if not re.fullmatch(r"[A-Za-z0-9._:-]+", key):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_IDEMPOTENCY_KEY",
                    "message": "idempotency key has invalid characters; allowed: A-Z a-z 0-9 . _ : -",
                },
            )
        return key

    def _rate_limit_context(self, owner_wallet: str) -> tuple[str, int, int, int]:
        owner = normalize_wallet(owner_wallet)
        now = int(time.time())
        window_sec = 60
        max_per_min = max(1, int(settings.finance_write_rate_limit_per_min))
        return owner, now, window_sec, max_per_min

    async def _enforce_owner_write_rate_limit_redis(
        self,
        owner: str,
        action: str,
        now: int,
        window_sec: int,
        max_per_min: int,
    ) -> bool:
        redis_client = await self._get_redis_client()
        if redis_client is None:
            return False

        window_bucket = now // window_sec
        redis_key = f"finance:rl:{owner}:{action}:{window_bucket}"
        try:
            current = int(await redis_client.eval(REDIS_RATE_LIMIT_LUA, 1, redis_key, window_sec + 5))
        except Exception:
            current = int(await redis_client.incr(redis_key))
            if current == 1:
                await redis_client.expire(redis_key, window_sec + 5)

        if current > max_per_min:
            self._append_financial_audit(
                "FINANCE_RATE_LIMIT_HIT",
                owner,
                {
                    "action": action,
                    "limitPerMin": max_per_min,
                    "windowBucket": window_bucket,
                    "backend": "redis",
                },
            )
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "FINANCE_RATE_LIMIT_EXCEEDED",
                    "message": f"Finance write rate limit exceeded for action={action}.",
                },
            )
        return True

    def _enforce_owner_write_rate_limit_fallback(
        self,
        owner: str,
        action: str,
        now: int,
        max_per_min: int,
    ) -> None:
        raw_rows = idempotency_repo(self.storage).read_rate_limit_rows()
        rows = [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []

        matched = next(
            (
                row
                for row in rows
                if normalize_wallet(str(row.get("ownerAddress") or "")) == owner and str(row.get("action") or "") == action
            ),
            None,
        )

        if matched is None:
            matched = {
                "id": str(uuid4()),
                "ownerAddress": owner,
                "action": action,
                "windowStart": now,
                "count": 0,
                "updatedAt": now,
            }
            rows.append(matched)

        window_start = int(matched.get("windowStart") or now)
        if now - window_start >= 60:
            matched["windowStart"] = now
            matched["count"] = 0

        count = int(matched.get("count") or 0)
        if count >= max_per_min:
            self._append_financial_audit(
                "FINANCE_RATE_LIMIT_HIT",
                owner,
                {
                    "action": action,
                    "limitPerMin": max_per_min,
                    "windowStart": int(matched.get("windowStart") or now),
                    "backend": "storage-fallback",
                },
            )
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "FINANCE_RATE_LIMIT_EXCEEDED",
                    "message": f"Finance write rate limit exceeded for action={action}.",
                },
            )

        matched["count"] = count + 1
        matched["updatedAt"] = now
        idempotency_repo(self.storage).write_rate_limit_rows(rows, now)

    async def _enforce_owner_write_rate_limit(self, owner_wallet: str, action: str) -> None:
        owner, now, window_sec, max_per_min = self._rate_limit_context(owner_wallet)
        used_redis = await self._enforce_owner_write_rate_limit_redis(owner, action, now, window_sec, max_per_min)
        if not used_redis:
            self._enforce_owner_write_rate_limit_fallback(owner, action, now, max_per_min)

    def _try_get_idempotent_response(
        self,
        *,
        rows: List[Dict[str, Any]],
        scope: str,
        owner_wallet: str,
        idempotency_key: str,
        request_hash: str,
    ) -> Optional[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if row.get("scope") != scope:
                continue
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("idempotencyKey") or "") != idempotency_key:
                continue
            if str(row.get("requestHash") or "") != request_hash:
                self._append_financial_audit(
                    "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
                    owner,
                    {"scope": scope, "idempotencyKey": idempotency_key},
                )
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
                        "message": "Idempotency key payload mismatch.",
                    },
                )
            response = row.get("response")
            return response if isinstance(response, dict) else None
        return None

    def _record_idempotent_response(
        self,
        *,
        rows: List[Dict[str, Any]],
        scope: str,
        owner_wallet: str,
        idempotency_key: str,
        request_hash: str,
        response: Dict[str, Any],
    ) -> None:
        now = int(time.time())
        owner = normalize_wallet(owner_wallet)
        expires_at = now + max(300, int(settings.finance_idempotency_ttl_sec))
        rows.append(
            {
                "id": str(uuid4()),
                "scope": scope,
                "ownerAddress": owner,
                "idempotencyKey": idempotency_key,
                "requestHash": request_hash,
                "response": response,
                "createdAt": now,
                "expiresAt": expires_at,
            }
        )
        self._save_idempotency_rows(rows)

    def _validate_unique_recent_deposit(self, rows: List[Dict[str, Any]], owner_wallet: str, tx_hash: str) -> None:
        owner = normalize_wallet(owner_wallet)
        now = int(time.time())
        replay_window = max(60, int(settings.finance_replay_window_sec))
        for row in rows:
            row_owner = normalize_wallet(str(row.get("ownerAddress") or row.get("buyerAddress") or ""))
            if row_owner != owner:
                continue
            if str(row.get("txHash") or "").strip().lower() != tx_hash.strip().lower():
                continue
            created_at = int(row.get("createdAt") or 0)
            if created_at and (now - created_at) <= replay_window:
                self._append_financial_audit(
                    "DEPOSIT_REPLAY_DETECTED",
                    owner,
                    {"txHash": tx_hash, "replayWindowSec": replay_window},
                )
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "DEPOSIT_REPLAY_DETECTED",
                        "message": "Duplicate deposit txHash detected in replay-protection window.",
                    },
                )

    async def _begin_provider_withdraw_idempotency(
        self,
        *,
        owner: str,
        idempotency_key: str,
        request_hash: str,
    ) -> tuple[Optional[Dict[str, Any]], Optional[Any], List[Dict[str, Any]]]:
        redis_client = await self._get_redis_client()
        redis_hit = await self._check_idempotency_redis(
            scope="provider_withdraw_intent",
            owner_wallet=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if redis_hit is not None:
            return redis_hit, redis_client, []

        started = await self._start_idempotency_redis(
            scope="provider_withdraw_intent",
            owner_wallet=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if not started:
            redis_retry = await self._check_idempotency_redis(
                scope="provider_withdraw_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if redis_retry is not None:
                return redis_retry, redis_client, []

        idem_rows: List[Dict[str, Any]] = []
        if redis_client is None:
            idem_rows = self._load_idempotency_rows()
            idem_hit = self._try_get_idempotent_response(
                rows=idem_rows,
                scope="provider_withdraw_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if idem_hit is not None:
                return idem_hit, redis_client, idem_rows

        return None, redis_client, idem_rows

    async def _finish_provider_withdraw_idempotency(
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
                scope="provider_withdraw_intent",
                owner_wallet=owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
            )
        await self._complete_idempotency_redis(
            scope="provider_withdraw_intent",
            owner_wallet=owner,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            response=response,
        )
