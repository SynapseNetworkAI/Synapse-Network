from __future__ import annotations

import json
import time
from decimal import Decimal
from typing import Any, Callable, Dict, Optional

from ..database_manager import DatabaseManager

try:
    import psycopg  # type: ignore[import-not-found]
except Exception:  # pragma: no cover
    psycopg = None


_INTEGRITY_ERRORS = (psycopg.IntegrityError,) if psycopg is not None else (Exception,)


class FinanceAtomicRepository:
    def __init__(
        self,
        db: DatabaseManager,
        quantize6: Callable[[Any], Decimal],
        balance_upsert_sql: str,
        balance_for_update_sql: str,
        audit_insert_sql: str,
        restricted_session_statuses: tuple[str, ...],
    ):
        self._db = db
        self._q6 = quantize6
        self._balance_upsert_sql = balance_upsert_sql
        self._balance_for_update_sql = balance_for_update_sql
        self._audit_insert_sql = audit_insert_sql
        self._restricted_session_statuses = restricted_session_statuses

    def _load_locked_balance_triplet(self, cur: Any, owner: str, account_type: str, now: int) -> tuple[Decimal, Decimal, Decimal]:
        cur.execute(self._balance_for_update_sql, (owner, account_type))
        hit = cur.fetchone()
        if hit is None:
            cur.execute(self._balance_upsert_sql, (owner, account_type, "0", "0", "0", now))
            return (Decimal("0"), Decimal("0"), Decimal("0"))
        return (self._q6(hit[0]), self._q6(hit[1]), self._q6(hit[2]))

    def _compute_withdrawal_risk_metrics(self, cur: Any, owner: str, now: int, window_seconds: int) -> tuple[Decimal, Decimal, bool]:
        window_start = now - max(1, int(window_seconds))
        cur.execute(
            """
            SELECT COALESCE(SUM(amount_usdc), 0)
            FROM synapse_withdrawal_intents
            WHERE owner_address = %s
              AND created_at >= %s
              AND status <> 'REJECTED'
            """,
            (owner, window_start),
        )
        rolling_24h = self._q6((cur.fetchone() or [0])[0])

        cur.execute(
            """
            SELECT COALESCE(SUM(
                CASE
                    WHEN (payload->>'sellerNet') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                        THEN (payload->>'sellerNet')::numeric
                    WHEN total_charge IS NOT NULL
                        THEN total_charge
                    ELSE 0
                END
            ), 0)
            FROM synapse_usage_log
            WHERE lower(seller_address) = %s
              AND lower(status) IN ('accepted', 'succeeded', 'success', 'completed')
            """,
            (owner,),
        )
        historical_net_income = self._q6((cur.fetchone() or [0])[0])

        cur.execute(
            "SELECT 1 FROM synapse_seller_risk_flags WHERE owner_address = %s AND is_high_risk = TRUE LIMIT 1",
            (owner,),
        )
        high_risk_from_db = cur.fetchone() is not None
        return rolling_24h, historical_net_income, high_risk_from_db

    def _upsert_withdrawal_intent(
        self,
        cur: Any,
        *,
        withdrawal_id: str,
        owner: str,
        status: str,
        amount: Decimal,
        now: int,
        payload: Dict[str, Any],
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_withdrawal_intents (id, owner_address, tx_hash, status, amount_usdc, created_at, updated_at, payload)
            VALUES (%s, %s, NULL, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id)
            DO UPDATE SET status = EXCLUDED.status, amount_usdc = EXCLUDED.amount_usdc,
                          updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
            """,
            (withdrawal_id, owner, status, str(amount), now, now, json.dumps(payload, ensure_ascii=False)),
        )

    def _append_withdrawal_audit(
        self,
        cur: Any,
        *,
        withdrawal_id: str,
        now: int,
        action: str,
        owner: str,
        details: Dict[str, Any],
    ) -> None:
        cur.execute(
            self._audit_insert_sql,
            (
                "audit_log",
                json.dumps(
                    {
                        "id": f"audit-{withdrawal_id}",
                        "timestamp": now,
                        "action": action,
                        "ownerAddress": owner,
                        "details": details,
                    },
                    ensure_ascii=False,
                ),
            ),
        )

    def _resolve_red_reason(self, amount: Decimal, historical_net_income: Decimal, is_high_risk: bool) -> Optional[str]:
        if amount > historical_net_income:
            return "WITHDRAW_EXCEEDS_HISTORICAL_NET_INCOME"
        if is_high_risk:
            return "HIGH_RISK_SELLER_TAGGED"
        return None

    def _persist_red_withdrawal(
        self,
        cur: Any,
        *,
        withdrawal_id: str,
        owner: str,
        amount: Decimal,
        now: int,
        request_id: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]],
        red_reason: str,
        rolling_24h: Decimal,
        historical_net_income: Decimal,
    ) -> Dict[str, Any]:
        payload = {
            "id": withdrawal_id,
            "ownerAddress": owner,
            "amountUsdc": float(amount),
            "status": "REJECTED",
            "businessType": "withdraw",
            "riskLevel": "red",
            "riskReasonCode": red_reason,
            "requestId": request_id,
            "idempotencyKey": idempotency_key,
            "requestMeta": request_meta or {},
            "createdAt": now,
            "updatedAt": now,
        }
        self._upsert_withdrawal_intent(
            cur,
            withdrawal_id=withdrawal_id,
            owner=owner,
            status="REJECTED",
            amount=amount,
            now=now,
            payload=payload,
        )
        self._append_withdrawal_audit(
            cur,
            withdrawal_id=withdrawal_id,
            now=now,
            action="PROVIDER_WITHDRAW_REJECTED",
            owner=owner,
            details={
                "businessType": "withdraw",
                "riskLevel": "red",
                "riskReasonCode": red_reason,
                "amountUsdc": float(amount),
                "rolling24hWithdrawUsdc": float(rolling_24h),
                "historicalNetIncomeUsdc": float(historical_net_income),
                "requestId": request_id,
            },
        )
        return {
            "decision": "red",
            "withdrawalId": withdrawal_id,
            "status": "REJECTED",
            "riskReasonCode": red_reason,
            "message": "Withdrawal blocked by risk policy.",
        }

    def _persist_non_red_withdrawal(
        self,
        cur: Any,
        *,
        withdrawal_id: str,
        owner: str,
        amount: Decimal,
        now: int,
        request_context: Dict[str, Any],
        balances: tuple[Decimal, Decimal, Decimal],
        thresholds: tuple[Decimal, Decimal],
        risk_metrics: tuple[Decimal, Decimal],
        sign_ticket_factory: Optional[Callable[[Decimal], Dict[str, Any]]],
    ) -> Dict[str, Any]:
        request_id = str(request_context.get("requestId") or "")
        idempotency_key = str(request_context.get("idempotencyKey") or "")
        request_meta = request_context.get("requestMeta") if isinstance(request_context.get("requestMeta"), dict) else {}
        available_balance, pending_balance, frozen_balance = balances
        single_limit_usdc, rolling_24h_limit_usdc = thresholds
        rolling_24h, historical_net_income = risk_metrics
        is_yellow = amount >= self._q6(single_limit_usdc) or (rolling_24h + amount) >= self._q6(rolling_24h_limit_usdc)
        next_available = self._q6(available_balance - amount)
        if is_yellow:
            status = "PENDING_MANUAL_REVIEW"
            ticket: Dict[str, Any] = {}
            message = "Withdrawal requested. Amounts over $100 require manual security review (ETA: 12-24 hrs)."
            cur.execute(
                self._balance_upsert_sql,
                (owner, "seller", str(next_available), str(pending_balance), str(self._q6(frozen_balance + amount)), now),
            )
        else:
            status = "APPROVED_AUTO"
            ticket = sign_ticket_factory(amount) if sign_ticket_factory is not None else {}
            message = ""
            cur.execute(
                self._balance_upsert_sql,
                (owner, "seller", str(next_available), str(self._q6(pending_balance + amount)), str(frozen_balance), now),
            )

        payload = {
            "id": withdrawal_id,
            "ownerAddress": owner,
            "amountUsdc": float(amount),
            "status": status,
            "businessType": "withdraw",
            "riskLevel": "yellow" if is_yellow else "green",
            "requestId": request_id,
            "idempotencyKey": idempotency_key,
            "requestMeta": request_meta or {},
            "ticket": ticket,
            "message": message,
            "createdAt": now,
            "updatedAt": now,
        }
        self._upsert_withdrawal_intent(
            cur,
            withdrawal_id=withdrawal_id,
            owner=owner,
            status=status,
            amount=amount,
            now=now,
            payload=payload,
        )
        self._append_withdrawal_audit(
            cur,
            withdrawal_id=withdrawal_id,
            now=now,
            action="PROVIDER_WITHDRAW_INTENT_CREATED",
            owner=owner,
            details={
                "businessType": "withdraw",
                "riskLevel": "yellow" if is_yellow else "green",
                "amountUsdc": float(amount),
                "rolling24hWithdrawUsdc": float(rolling_24h),
                "historicalNetIncomeUsdc": float(historical_net_income),
                "requestId": request_id,
            },
        )
        return {
            "decision": "yellow" if is_yellow else "green",
            "withdrawalId": withdrawal_id,
            "status": status,
            "amountUsdc": float(amount),
            "ticket": ticket,
            "message": message,
        }

    def _is_wallet_restricted(self, cur: Any, wallet: str) -> bool:
        cur.execute("SELECT status FROM synapse_auth_sessions WHERE wallet_address = %s", (wallet,))
        row = cur.fetchone()
        if row is None:
            return False
        return str(row[0] or "").strip().lower() in self._restricted_session_statuses

    def _is_account_restricted_for_charge(self, cur: Any, wallet: str, account_type: str, now: int) -> bool:
        _, _, frozen_balance = self._load_locked_balance_triplet(cur, wallet, account_type, now)
        if frozen_balance <= Decimal("0"):
            return False
        return self._is_wallet_restricted(cur, wallet)

    def process_withdrawal_request_atomic(
        self,
        *,
        seller_address: str,
        amount_usdc: Decimal,
        request_id: str,
        idempotency_key: str,
        request_meta: Optional[Dict[str, Any]],
        single_limit_usdc: Decimal,
        rolling_24h_limit_usdc: Decimal,
        window_seconds: int,
        high_risk_override: bool,
        sign_ticket_factory: Optional[Callable[[Decimal], Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        owner = str(seller_address or "").strip().lower()
        now = int(time.time())
        amount = self._q6(amount_usdc)
        if amount <= Decimal("0"):
            raise RuntimeError("INVALID_WITHDRAW_AMOUNT")

        with self._db.connect() as conn:
            try:
                with conn.cursor() as cur:
                    available_balance, pending_balance, frozen_balance = self._load_locked_balance_triplet(cur, owner, "seller", now)

                    if available_balance < amount:
                        raise RuntimeError("INSUFFICIENT_SELLER_RECEIVABLE")

                    rolling_24h, historical_net_income, high_risk_from_db = self._compute_withdrawal_risk_metrics(
                        cur, owner, now, window_seconds
                    )
                    is_high_risk = bool(high_risk_override or high_risk_from_db)

                    red_reason = self._resolve_red_reason(amount, historical_net_income, is_high_risk)
                    withdrawal_id = f"wd-{now}-{owner[-8:]}"
                    if red_reason:
                        response = self._persist_red_withdrawal(
                            cur,
                            withdrawal_id=withdrawal_id,
                            owner=owner,
                            amount=amount,
                            now=now,
                            request_id=request_id,
                            idempotency_key=idempotency_key,
                            request_meta=request_meta,
                            red_reason=red_reason,
                            rolling_24h=rolling_24h,
                            historical_net_income=historical_net_income,
                        )
                        conn.commit()
                        return response

                    response = self._persist_non_red_withdrawal(
                        cur,
                        withdrawal_id=withdrawal_id,
                        owner=owner,
                        amount=amount,
                        now=now,
                        request_context={
                            "requestId": request_id,
                            "idempotencyKey": idempotency_key,
                            "requestMeta": request_meta or {},
                        },
                        balances=(available_balance, pending_balance, frozen_balance),
                        thresholds=(single_limit_usdc, rolling_24h_limit_usdc),
                        risk_metrics=(rolling_24h, historical_net_income),
                        sign_ticket_factory=sign_ticket_factory,
                    )
                conn.commit()
                return response
            except Exception:
                conn.rollback()
                raise

    def register_deposit_intent_atomic(self, owner_wallet: str, tx_hash: str, request_id: str, intent_row: Dict[str, Any]) -> Dict[str, Any]:
        owner = str(owner_wallet or "").strip().lower()
        tx = str(tx_hash or "").strip().lower()
        now = int(time.time())
        row = dict(intent_row)
        row.setdefault("ownerAddress", owner)
        row.setdefault("txHash", tx)
        row.setdefault("status", "PENDING_CONFIRMATION")
        row.setdefault("createdAt", now)
        row["updatedAt"] = now
        amount_usdc = self._q6(row.get("amountUsdc") or 0)
        if amount_usdc <= Decimal("0"):
            raise RuntimeError("INVALID_DEPOSIT_AMOUNT")
        row_id = str(row.get("id") or "").strip() or f"dep-{now}-{tx[-8:]}"
        row["id"] = row_id

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_deposit_dedup (tx_hash, owner_address, request_id) VALUES (%s, %s, %s)",
                        (tx, owner, request_id or None),
                    )
                except _INTEGRITY_ERRORS:
                    conn.rollback()
                    with self._db.readonly_cursor() as lookup_cur:
                        lookup_cur.execute(
                            "SELECT payload FROM synapse_deposit_intents WHERE tx_hash = %s AND owner_address = %s",
                            (tx, owner),
                        )
                        hit = lookup_cur.fetchone()
                        if hit and isinstance(hit[0], dict):
                            return hit[0]
                    return {}

                available_balance, pending_balance, frozen_balance = self._load_locked_balance_triplet(cur, owner, "buyer", now)
                cur.execute(
                    self._balance_upsert_sql,
                    (
                        owner,
                        "buyer",
                        str(available_balance),
                        str(self._q6(pending_balance + amount_usdc)),
                        str(frozen_balance),
                        now,
                    ),
                )

                cur.execute(
                    """
                    INSERT INTO synapse_deposit_intents (id, owner_address, tx_hash, status, created_at, updated_at, payload)
                    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        owner_address = EXCLUDED.owner_address,
                        tx_hash = EXCLUDED.tx_hash,
                        status = EXCLUDED.status,
                        updated_at = EXCLUDED.updated_at,
                        payload = EXCLUDED.payload
                    """,
                    (
                        row_id,
                        owner,
                        tx,
                        str(row.get("status") or "PENDING_CONFIRMATION"),
                        int(row.get("createdAt") or now),
                        int(row.get("updatedAt") or now),
                        json.dumps(row, ensure_ascii=False),
                    ),
                )
            conn.commit()
        return row

    def confirm_deposit_intent_atomic(self, owner_wallet: str, deposit_intent_id: str, event_key: str, confirmations: int) -> Dict[str, Any]:
        owner = str(owner_wallet or "").strip().lower()
        intent_id = str(deposit_intent_id or "").strip()
        if not intent_id:
            raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")
        now = int(time.time())

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, status, amount_usdc, payload FROM synapse_deposit_intents WHERE id = %s AND owner_address = %s FOR UPDATE",
                    (intent_id, owner),
                )
                hit = cur.fetchone()
                if hit is None:
                    raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")

                row_id = str(hit[0] or intent_id)
                status = str(hit[1] or "").upper()
                amount = self._q6(hit[2] or 0)
                payload = hit[3] if isinstance(hit[3], dict) else {}

                if status == "CONFIRMED":
                    return payload

                if status not in {"PENDING_CONFIRMATION", "PENDING"}:
                    raise RuntimeError("DEPOSIT_STATUS_INVALID")

                available_balance, pending_balance, frozen_balance = self._load_locked_balance_triplet(cur, owner, "buyer", now)
                if pending_balance < amount:
                    raise RuntimeError("DEPOSIT_PENDING_BALANCE_INCONSISTENT")

                next_available = self._q6(available_balance + amount)
                next_pending = self._q6(pending_balance - amount)
                cur.execute(
                    self._balance_upsert_sql,
                    (owner, "buyer", str(next_available), str(next_pending), str(frozen_balance), now),
                )

                next_payload = dict(payload)
                next_payload["status"] = "CONFIRMED"
                next_payload["confirmedAt"] = now
                next_payload["confirmations"] = int(confirmations)
                next_payload["eventKey"] = str(event_key or "")
                next_payload["creditedAmountUsdc"] = float(amount)
                next_payload["availableAfter"] = float(next_available)
                next_payload["pendingAfter"] = float(next_pending)
                next_payload["updatedAt"] = now

                cur.execute(
                    """
                    UPDATE synapse_deposit_intents
                    SET status = %s, updated_at = %s, payload = %s::jsonb
                    WHERE id = %s AND owner_address = %s
                    """,
                    ("CONFIRMED", now, json.dumps(next_payload, ensure_ascii=False), row_id, owner),
                )
            conn.commit()
        return next_payload

    def charge_buyer_and_record_usage_atomic(
        self,
        *,
        owner_wallet: str,
        seller_wallet: str,
        total_charge: Decimal,
        seller_net: Decimal,
        platform_fee_total: Decimal,
        usage_row: Dict[str, Any],
    ) -> Dict[str, Any]:
        now = int(time.time())
        owner = str(owner_wallet or "").strip().lower()
        seller = str(seller_wallet or "").strip().lower()

        def _load_balance(cur: Any, wallet: str, account_type: str, column_name: str) -> Decimal:
            hit = self._load_locked_balance_triplet(cur, wallet, account_type, now)
            idx = {"available_balance": 0, "pending_balance": 1, "frozen_balance": 2}[column_name]
            return self._q6(hit[idx])

        def _set_available(cur: Any, wallet: str, account_type: str, available_value: Decimal) -> None:
            current_pending = _load_balance(cur, wallet, account_type, "pending_balance")
            current_frozen = _load_balance(cur, wallet, account_type, "frozen_balance")
            cur.execute(
                self._balance_upsert_sql,
                (wallet, account_type, str(self._q6(available_value)), str(self._q6(current_pending)), str(self._q6(current_frozen)), now),
            )

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                if self._is_account_restricted_for_charge(cur, owner, "buyer", now):
                    raise RuntimeError("BUYER_RESTRICTED_RISK_BLOCK")
                if self._is_account_restricted_for_charge(cur, seller, "seller", now):
                    raise RuntimeError("SELLER_RESTRICTED_RISK_BLOCK")

                before_buyer = _load_balance(cur, owner, "buyer", "available_balance")
                if before_buyer < self._q6(total_charge):
                    raise RuntimeError("INSUFFICIENT_BALANCE")

                seller_before = _load_balance(cur, seller, "seller", "available_balance")
                platform_before = _load_balance(cur, "__platform__", "platform_fee", "available_balance")
                buyer_after = self._q6(before_buyer - self._q6(total_charge))
                seller_after = self._q6(seller_before + self._q6(seller_net))
                platform_after = self._q6(platform_before + self._q6(platform_fee_total))

                _set_available(cur, owner, "buyer", buyer_after)
                _set_available(cur, seller, "seller", seller_after)
                _set_available(cur, "__platform__", "platform_fee", platform_after)

                usage_id = str(usage_row.get("id") or f"usage-{now}-{owner[-6:]}")
                payload = dict(usage_row)
                payload.setdefault("id", usage_id)
                payload.setdefault("timestamp", int(usage_row.get("timestamp") or now))
                payload.setdefault("buyer", owner)
                payload.setdefault("seller", seller)
                payload.setdefault("status", str(usage_row.get("status") or "accepted"))
                payload.setdefault("totalCharge", float(self._q6(total_charge)))
                cur.execute(
                    """
                    INSERT INTO synapse_usage_log (
                        id,
                        ts,
                        buyer_address,
                        seller_address,
                        status,
                        total_charge,
                        business_type,
                        risk_level,
                        payload
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s::synapse_business_type, %s::synapse_risk_level, %s::jsonb)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        ts = EXCLUDED.ts,
                        buyer_address = EXCLUDED.buyer_address,
                        seller_address = EXCLUDED.seller_address,
                        status = EXCLUDED.status,
                        total_charge = EXCLUDED.total_charge,
                        business_type = EXCLUDED.business_type,
                        risk_level = EXCLUDED.risk_level,
                        payload = EXCLUDED.payload
                    """,
                    (
                        usage_id,
                        int(payload.get("timestamp") or now),
                        str(payload.get("buyer") or owner),
                        str(payload.get("seller") or seller),
                        str(payload.get("status") or "accepted"),
                        str(self._q6(payload.get("totalCharge") or total_charge)),
                        "charge",
                        str(payload.get("riskLevel") or "green").lower(),
                        json.dumps(payload, ensure_ascii=False),
                    ),
                )

                audit_payload = {
                    "id": usage_row.get("id") or "",
                    "timestamp": now,
                    "action": "BUYER_CHARGE_ATOMIC",
                    "ownerAddress": owner,
                    "details": {
                        "beforeBalance": float(before_buyer),
                        "deltaAmount": float(-self._q6(total_charge)),
                        "afterBalance": float(self._q6(before_buyer - self._q6(total_charge))),
                        "seller": seller,
                    },
                }
                cur.execute(
                    self._audit_insert_sql,
                    ("audit_log", json.dumps(audit_payload, ensure_ascii=False)),
                )

            conn.commit()
        return {"buyerBalanceAfter": float(self._q6(before_buyer - self._q6(total_charge)))}

    def reserve_seller_withdraw_atomic(self, owner_wallet: str, amount_usdc: Decimal) -> Dict[str, float]:
        owner = str(owner_wallet or "").strip().lower()
        now = int(time.time())

        def _load_balances(cur: Any, wallet: str, account_type: str) -> tuple[Decimal, Decimal, Decimal]:
            return self._load_locked_balance_triplet(cur, wallet, account_type, now)

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                before_available, before_pending, before_frozen = _load_balances(cur, owner, "seller")
                if before_available < self._q6(amount_usdc):
                    raise RuntimeError("INSUFFICIENT_SELLER_RECEIVABLE")
                after_available = self._q6(before_available - self._q6(amount_usdc))
                after_pending = self._q6(before_pending + self._q6(amount_usdc))

                cur.execute(
                    self._balance_upsert_sql,
                    (
                        owner,
                        "seller",
                        str(after_available),
                        str(after_pending),
                        str(before_frozen),
                        now,
                    ),
                )

            conn.commit()
        return {
            "beforeBalance": float(before_available),
            "afterBalance": float(self._q6(before_available - self._q6(amount_usdc))),
        }

    def complete_withdraw_tx_atomic(self, owner_wallet: str, tx_hash: str, kind: str) -> bool:
        with self._db.connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_withdraw_tx_dedup (owner_address, tx_hash, kind) VALUES (%s, %s, %s)",
                        (owner_wallet, tx_hash, kind),
                    )
                except _INTEGRITY_ERRORS:
                    conn.rollback()
                    return False
            conn.commit()
        return True
