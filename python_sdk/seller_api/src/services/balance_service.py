from typing import Dict, Any, List, Optional
from src.storage.base import BaseStorage
from src.core.common import normalize_wallet
from src.core.config import settings
from fastapi import HTTPException
import asyncio
import hashlib
import json
import re
import time
from uuid import uuid4

class BalanceService:
    def __init__(self, storage: BaseStorage):
        self.storage = storage
        # 内存锁，模拟生产环境下的 Redis Redlock。
        # 在处理高频扣费时，必须警惕数据库并发带来的“超扣/漏扣”问题
        self._lock = asyncio.Lock()

    async def get_balance(self, owner_wallet: str) -> Dict[str, Any]:
        """[网关防弹层] 按 owner 读取余额摘要，避免返回全量账本。"""
        await asyncio.sleep(0)
        normalized_owner = normalize_wallet(owner_wallet)
        balance_data = self.storage.get_collection("balance_ledger") or {}
        if not isinstance(balance_data, dict):
            balance_data = {}

        buyers = balance_data.get("buyers") if isinstance(balance_data.get("buyers"), dict) else {}
        sellers = balance_data.get("sellers") if isinstance(balance_data.get("sellers"), dict) else {}
        platform = balance_data.get("platform") if isinstance(balance_data.get("platform"), dict) else {}

        return {
            "ownerAddress": normalized_owner,
            "buyerBalance": round(float(buyers.get(normalized_owner, 0.0)), 6),
            "sellerReceivable": round(float(sellers.get(normalized_owner, 0.0)), 6),
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

    def _request_hash(self, payload: Dict[str, Any]) -> str:
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def _load_idempotency_rows(self) -> List[Dict[str, Any]]:
        rows = self._normalize_rows(self.storage.get_collection("idempotency_keys"))
        now = int(time.time())
        filtered = [row for row in rows if int(row.get("expiresAt") or 0) > now]
        max_rows = max(500, int(settings.finance_idempotency_max_rows))
        if len(filtered) > max_rows:
            filtered.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
            filtered = filtered[:max_rows]
        if len(filtered) != len(rows):
            self.storage.save_collection("idempotency_keys", {"rows": filtered, "updatedAt": now})
        return filtered

    def _save_idempotency_rows(self, rows: List[Dict[str, Any]]) -> None:
        max_rows = max(500, int(settings.finance_idempotency_max_rows))
        if len(rows) > max_rows:
            rows.sort(key=lambda row: int(row.get("createdAt") or 0), reverse=True)
            rows = rows[:max_rows]
        self.storage.save_collection("idempotency_keys", {"rows": rows, "updatedAt": int(time.time())})

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

    def _append_financial_audit(self, action: str, owner_wallet: str, details: Dict[str, Any]) -> None:
        self.storage.append_to_collection(
            "audit_log",
            {
                "id": str(uuid4()),
                "timestamp": int(time.time()),
                "action": action,
                "ownerAddress": normalize_wallet(owner_wallet),
                "details": details,
            },
        )

    def _finance_audit_actions(self) -> set[str]:
        return {
            "DEPOSIT_INTENT_REGISTERED",
            "REFUND_INTENT_CREATED",
            "ROUTER_CONFIG_UPDATED",
            "FINANCE_RATE_LIMIT_HIT",
        }

    def _enforce_owner_write_rate_limit(self, owner_wallet: str, action: str) -> None:
        owner = normalize_wallet(owner_wallet)
        now = int(time.time())
        window_sec = 60
        max_per_min = max(1, int(settings.finance_write_rate_limit_per_min))
        raw = self.storage.get_collection("finance_write_rate_limit")
        rows = self._normalize_rows(raw)

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
        if now - window_start >= window_sec:
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
        self.storage.save_collection("finance_write_rate_limit", {"rows": rows, "updatedAt": now})

    def _try_get_idempotent_response(
        self,
        *,
        rows: List[Dict[str, Any]],
        scope: str,
        owner_wallet: str,
        idempotency_key: str,
        request_hash: str,
    ) -> Dict[str, Any] | None:
        owner = normalize_wallet(owner_wallet)
        for row in rows:
            if row.get("scope") != scope:
                continue
            if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                continue
            if str(row.get("idempotencyKey") or "") != idempotency_key:
                continue
            if str(row.get("requestHash") or "") != request_hash:
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
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "DEPOSIT_REPLAY_DETECTED",
                        "message": "Duplicate deposit txHash detected in replay-protection window.",
                    },
                )

    async def register_deposit_intent(
        self,
        intent: Dict[str, Any],
        owner_wallet: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        [网关防弹层] 处理买家发起的 Deposit Intent。
        所有资金写入必须加锁，防止并发重入。
        """
        async with self._lock:
            idempotency_key = self._validate_idempotency_key(idempotency_key)
            self._enforce_owner_write_rate_limit(owner_wallet, "deposit_intent")

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
            idem_rows = self._load_idempotency_rows()
            normalized_owner = normalize_wallet(owner_wallet)
            request_payload = {
                "ownerAddress": normalized_owner,
                "txHash": tx_hash.lower(),
                "amountUsdc": round(amount_usdc, 6),
            }
            request_hash = self._request_hash(request_payload)

            idem_hit = self._try_get_idempotent_response(
                rows=idem_rows,
                scope="deposit_intent",
                owner_wallet=normalized_owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
            )
            if idem_hit is not None:
                return idem_hit

            self._validate_unique_recent_deposit(intents, normalized_owner, tx_hash)

            # 这里可以进行业务防伪、状态校验等
            now = int(time.time())
            next_intent = dict(intent)
            next_intent["ownerAddress"] = normalized_owner
            next_intent["buyerAddress"] = normalized_owner
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
            self._record_idempotent_response(
                rows=idem_rows,
                scope="deposit_intent",
                owner_wallet=normalized_owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
            )
            self._append_financial_audit(
                "DEPOSIT_INTENT_REGISTERED",
                normalized_owner,
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
        async with self._lock:
            idempotency_key = self._validate_idempotency_key(idempotency_key)
            self._enforce_owner_write_rate_limit(owner_wallet, "refund_intent")

            amount_usdc = float(payload.get("amountUsdc") or 0)
            if amount_usdc < 0:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be >= 0."},
                )

            reason = str(payload.get("reason") or "").strip()
            if len(reason) > 256:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INVALID_REASON", "message": "reason must be <= 256 chars."},
                )

            normalized_owner = normalize_wallet(owner_wallet)
            request_payload = {
                "ownerAddress": normalized_owner,
                "amountUsdc": round(amount_usdc, 6),
                "reason": reason,
            }
            request_hash = self._request_hash(request_payload)
            idem_rows = self._load_idempotency_rows()
            idem_hit = self._try_get_idempotent_response(
                rows=idem_rows,
                scope="refund_intent",
                owner_wallet=normalized_owner,
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
                "ownerAddress": normalized_owner,
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
            self._record_idempotent_response(
                rows=idem_rows,
                scope="refund_intent",
                owner_wallet=normalized_owner,
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                response=response,
            )
            self._append_financial_audit(
                "REFUND_INTENT_CREATED",
                normalized_owner,
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
        async with self._lock:
            self._enforce_owner_write_rate_limit(owner_wallet, "router_config")
            if daily_limit_usdc < 0 or daily_limit_usdc > 1_000_000_000:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INVALID_DAILY_LIMIT",
                        "message": "dailyLimitUsdc must be within [0, 1000000000].",
                    },
                )

            owner = normalize_wallet(owner_wallet)
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

    async def list_finance_audit_logs(self, owner_wallet: str, limit: int) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._list_finance_audit_logs_sync, owner_wallet, limit)

    def _list_finance_audit_logs_sync(self, owner_wallet: str, limit: int) -> List[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        if not hasattr(self.storage, "directory"):
            return []

        import os

        path = os.path.join(getattr(self.storage, "directory"), "audit_log.jsonl")
        if not os.path.exists(path):
            return []

        allowed_actions = self._finance_audit_actions()
        rows: List[Dict[str, Any]] = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except Exception:
                    continue
                if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                    continue
                action = str(row.get("action") or "")
                if action not in allowed_actions:
                    continue
                rows.append(row)

        rows.sort(key=lambda item: int(item.get("timestamp") or 0), reverse=True)
        return rows[: max(1, min(limit, 500))]
