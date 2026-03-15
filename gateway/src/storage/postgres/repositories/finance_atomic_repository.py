from __future__ import annotations

import time
from decimal import Decimal
from typing import Any, Callable, Optional

from src.domain.storage_entities import (
    BalanceMutationResult,
    BuyerChargeResult,
    DepositIntentRow,
    UsageLogRow,
    WithdrawalDecision,
)

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
            return Decimal("0"), Decimal("0"), Decimal("0")
        return self._q6(hit[0]), self._q6(hit[1]), self._q6(hit[2])

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
            SELECT COALESCE(SUM(COALESCE(unit_price, 0) - COALESCE(protocol_fee, 0)), 0)
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

    def _append_withdrawal_audit(
        self,
        cur: Any,
        *,
        action: str,
        owner: str,
        request_id: str,
        amount: Decimal,
        risk_level: str,
        risk_reason_code: Optional[str],
        result_status: str,
        message: str,
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_audit_log (
                action_type, business_type, risk_level, owner_address, request_id,
                amount_delta, result_status, error_code, message
            ) VALUES (%s, 'withdraw', %s::synapse_risk_level, %s, %s, %s, %s, %s, %s)
            """,
            (
                action,
                risk_level,
                owner,
                request_id,
                str(amount),
                result_status,
                risk_reason_code,
                message,
            ),
        )

    def _resolve_red_reason(self, amount: Decimal, historical_net_income: Decimal, is_high_risk: bool) -> Optional[str]:
        if amount > historical_net_income:
            return "WITHDRAW_EXCEEDS_HISTORICAL_NET_INCOME"
        if is_high_risk:
            return "HIGH_RISK_SELLER_TAGGED"
        return None

    def process_withdrawal_request_atomic(
        self,
        *,
        seller_address: str,
        amount_usdc: Decimal,
        request_id: str,
        idempotency_key: str,
        request_meta: Optional[dict[str, Any]],
        single_limit_usdc: Decimal,
        rolling_24h_limit_usdc: Decimal,
        window_seconds: int,
        high_risk_override: bool,
        sign_ticket_factory: Optional[Callable[[Decimal], dict[str, Any]]] = None,
    ) -> WithdrawalDecision:
        owner = str(seller_address or "").strip().lower()
        now = int(time.time())
        amount = self._q6(amount_usdc)
        _ = request_meta
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
                        cur.execute(
                            """
                            INSERT INTO synapse_withdrawal_intents (
                                id, owner_address, tx_hash, status, request_id, idempotency_key,
                                amount_usdc, created_at, updated_at
                            ) VALUES (%s, %s, NULL, 'REJECTED', %s, %s, %s, %s, %s)
                            """,
                            (withdrawal_id, owner, request_id, idempotency_key, str(amount), now, now),
                        )
                        self._append_withdrawal_audit(
                            cur,
                            action="PROVIDER_WITHDRAW_REJECTED",
                            owner=owner,
                            request_id=request_id,
                            amount=amount,
                            risk_level="red",
                            risk_reason_code=red_reason,
                            result_status="REJECTED",
                            message="Withdrawal blocked by risk policy.",
                        )
                        conn.commit()
                        return WithdrawalDecision(
                            decision="red",
                            withdrawalId=withdrawal_id,
                            status="REJECTED",
                            riskReasonCode=red_reason,
                            message="Withdrawal blocked by risk policy.",
                        )

                    is_yellow = amount >= self._q6(single_limit_usdc) or (rolling_24h + amount) >= self._q6(rolling_24h_limit_usdc)
                    next_available = self._q6(available_balance - amount)
                    if is_yellow:
                        status = "PENDING_MANUAL_REVIEW"
                        cur.execute(
                            self._balance_upsert_sql,
                            (owner, "seller", str(next_available), str(pending_balance), str(self._q6(frozen_balance + amount)), now),
                        )
                        ticket = {}
                        message = "Withdrawal requested. Amounts over $100 require manual security review (ETA: 12-24 hrs)."
                        risk_level = "yellow"
                    else:
                        status = "APPROVED_AUTO"
                        cur.execute(
                            self._balance_upsert_sql,
                            (owner, "seller", str(next_available), str(self._q6(pending_balance + amount)), str(frozen_balance), now),
                        )
                        ticket = sign_ticket_factory(amount) if sign_ticket_factory is not None else {}
                        message = ""
                        risk_level = "green"

                    cur.execute(
                        """
                        INSERT INTO synapse_withdrawal_intents (
                            id, owner_address, tx_hash, status, request_id, idempotency_key,
                            amount_usdc, created_at, updated_at
                        ) VALUES (%s, %s, NULL, %s::synapse_withdraw_status, %s, %s, %s, %s, %s)
                        ON CONFLICT (id)
                        DO UPDATE SET
                            owner_address = EXCLUDED.owner_address,
                            status = EXCLUDED.status,
                            request_id = EXCLUDED.request_id,
                            idempotency_key = EXCLUDED.idempotency_key,
                            amount_usdc = EXCLUDED.amount_usdc,
                            updated_at = EXCLUDED.updated_at
                        """,
                        (withdrawal_id, owner, status, request_id, idempotency_key, str(amount), now, now),
                    )

                    self._append_withdrawal_audit(
                        cur,
                        action="PROVIDER_WITHDRAW_INTENT_CREATED",
                        owner=owner,
                        request_id=request_id,
                        amount=amount,
                        risk_level=risk_level,
                        risk_reason_code=None,
                        result_status=status,
                        message=message,
                    )
                conn.commit()
                return WithdrawalDecision(
                    decision="yellow" if is_yellow else "green",
                    withdrawalId=withdrawal_id,
                    status=status,
                    amountUsdc=float(amount),
                    ticket=ticket,
                    message=message,
                )
            except Exception:
                conn.rollback()
                raise

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

    def register_deposit_intent_atomic(
        self,
        owner_wallet: str,
        tx_hash: str,
        request_id: str,
        intent_row: DepositIntentRow,
    ) -> DepositIntentRow:
        owner = str(owner_wallet or "").strip().lower()
        tx = str(tx_hash or "").strip().lower()
        now = int(time.time())
        amount_usdc = self._q6(intent_row.amount_usdc)
        if amount_usdc <= Decimal("0"):
            raise RuntimeError("INVALID_DEPOSIT_AMOUNT")

        row_id = str(intent_row.id or "").strip() or f"dep-{now}-{tx[-8:]}"
        row = DepositIntentRow(
            id=row_id,
            ownerAddress=owner,
            txHash=tx,
            requestId=request_id or intent_row.request_id,
            buyerAddress=intent_row.buyer_address,
            amountUsdc=amount_usdc,
            idempotencyKey=intent_row.idempotency_key,
            status=intent_row.status or "PENDING_CONFIRMATION",
            createdAt=int(intent_row.created_at or now),
            updatedAt=now,
        )

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
                            """
                            SELECT id, owner_address, tx_hash, request_id, buyer_address, amount_usdc,
                                   idempotency_key, status, created_at, updated_at
                            FROM synapse_deposit_intents
                            WHERE tx_hash = %s AND owner_address = %s
                            """,
                            (tx, owner),
                        )
                        hit = lookup_cur.fetchone()
                        if hit is not None:
                            return DepositIntentRow(
                                id=str(hit[0]),
                                ownerAddress=str(hit[1]),
                                txHash=str(hit[2]),
                                requestId=hit[3],
                                buyerAddress=hit[4],
                                amountUsdc=self._q6(hit[5]),
                                idempotencyKey=hit[6],
                                status=str(hit[7]),
                                createdAt=int(hit[8]),
                                updatedAt=int(hit[9]),
                            )
                    raise RuntimeError("DEPOSIT_ALREADY_PROCESSED")

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
                    INSERT INTO synapse_deposit_intents (
                        id, owner_address, tx_hash, request_id, buyer_address, amount_usdc,
                        idempotency_key, status, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        owner_address = EXCLUDED.owner_address,
                        tx_hash = EXCLUDED.tx_hash,
                        request_id = EXCLUDED.request_id,
                        buyer_address = EXCLUDED.buyer_address,
                        amount_usdc = EXCLUDED.amount_usdc,
                        idempotency_key = EXCLUDED.idempotency_key,
                        status = EXCLUDED.status,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        row.id,
                        row.owner_address,
                        row.tx_hash,
                        row.request_id,
                        row.buyer_address,
                        str(row.amount_usdc),
                        row.idempotency_key,
                        row.status,
                        row.created_at,
                        row.updated_at,
                    ),
                )
            conn.commit()
        return row

    def confirm_deposit_intent_atomic(self, owner_wallet: str, deposit_intent_id: str, event_key: str, confirmations: int) -> DepositIntentRow:
        owner = str(owner_wallet or "").strip().lower()
        intent_id = str(deposit_intent_id or "").strip()
        if not intent_id:
            raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")
        now = int(time.time())

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, owner_address, tx_hash, request_id, buyer_address, amount_usdc,
                           idempotency_key, status, created_at, updated_at
                    FROM synapse_deposit_intents
                    WHERE id = %s AND owner_address = %s
                    FOR UPDATE
                    """,
                    (intent_id, owner),
                )
                hit = cur.fetchone()
                if hit is None:
                    raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")

                row = DepositIntentRow(
                    id=str(hit[0]),
                    ownerAddress=str(hit[1]),
                    txHash=str(hit[2]),
                    requestId=hit[3],
                    buyerAddress=hit[4],
                    amountUsdc=self._q6(hit[5]),
                    idempotencyKey=hit[6],
                    status=str(hit[7]),
                    createdAt=int(hit[8]),
                    updatedAt=int(hit[9]),
                )

                if row.status.upper() == "CONFIRMED":
                    return row
                if row.status.upper() not in {"PENDING_CONFIRMATION", "PENDING"}:
                    raise RuntimeError("DEPOSIT_STATUS_INVALID")

                available_balance, pending_balance, frozen_balance = self._load_locked_balance_triplet(cur, owner, "buyer", now)
                if pending_balance < row.amount_usdc:
                    raise RuntimeError("DEPOSIT_PENDING_BALANCE_INCONSISTENT")

                next_available = self._q6(available_balance + row.amount_usdc)
                next_pending = self._q6(pending_balance - row.amount_usdc)
                cur.execute(
                    self._balance_upsert_sql,
                    (owner, "buyer", str(next_available), str(next_pending), str(frozen_balance), now),
                )

                cur.execute(
                    "UPDATE synapse_deposit_intents SET status = %s, updated_at = %s WHERE id = %s AND owner_address = %s",
                    ("CONFIRMED", now, row.id, owner),
                )

                self._append_withdrawal_audit(
                    cur,
                    action="BUYER_DEPOSIT_CONFIRMED",
                    owner=owner,
                    request_id=row.request_id or event_key,
                    amount=row.amount_usdc,
                    risk_level="green",
                    risk_reason_code=None,
                    result_status="CONFIRMED",
                    message=f"confirmations={int(confirmations)}",
                )
            conn.commit()
        return DepositIntentRow(
            id=row.id,
            ownerAddress=row.owner_address,
            txHash=row.tx_hash,
            requestId=row.request_id,
            buyerAddress=row.buyer_address,
            amountUsdc=row.amount_usdc,
            idempotencyKey=row.idempotency_key,
            status="CONFIRMED",
            createdAt=row.created_at,
            updatedAt=now,
        )

    def charge_buyer_and_record_usage_atomic(
        self,
        *,
        owner_wallet: str,
        seller_wallet: str,
        total_charge: Decimal,
        seller_net: Decimal,
        platform_fee_total: Decimal,
        usage_row: UsageLogRow,
    ) -> BuyerChargeResult:
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

                row = UsageLogRow(
                    id=usage_row.id,
                    ts=int(usage_row.ts or now),
                    requestId=usage_row.request_id,
                    serviceId=usage_row.service_id,
                    buyerAddress=(usage_row.buyer_address or owner),
                    sellerAddress=(usage_row.seller_address or seller),
                    status=usage_row.status or "accepted",
                    unitPrice=usage_row.unit_price,
                    protocolFee=usage_row.protocol_fee,
                    routingTax=usage_row.routing_tax,
                    totalCharge=usage_row.total_charge or self._q6(total_charge),
                    businessType=usage_row.business_type,
                    riskLevel=usage_row.risk_level,
                )
                cur.execute(
                    """
                    INSERT INTO synapse_usage_log (
                        id, ts, request_id, service_id, buyer_address, seller_address,
                        status, unit_price, protocol_fee, routing_tax, total_charge,
                        business_type, risk_level
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::synapse_business_type, %s::synapse_risk_level)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        ts = EXCLUDED.ts,
                        request_id = EXCLUDED.request_id,
                        service_id = EXCLUDED.service_id,
                        buyer_address = EXCLUDED.buyer_address,
                        seller_address = EXCLUDED.seller_address,
                        status = EXCLUDED.status,
                        unit_price = EXCLUDED.unit_price,
                        protocol_fee = EXCLUDED.protocol_fee,
                        routing_tax = EXCLUDED.routing_tax,
                        total_charge = EXCLUDED.total_charge,
                        business_type = EXCLUDED.business_type,
                        risk_level = EXCLUDED.risk_level
                    """,
                    (
                        row.id,
                        int(row.ts),
                        row.request_id,
                        row.service_id,
                        row.buyer_address,
                        row.seller_address,
                        row.status,
                        str(self._q6(row.unit_price)) if row.unit_price is not None else None,
                        str(self._q6(row.protocol_fee)) if row.protocol_fee is not None else None,
                        str(self._q6(row.routing_tax)) if row.routing_tax is not None else None,
                        str(self._q6(row.total_charge)) if row.total_charge is not None else None,
                        row.business_type,
                        row.risk_level,
                    ),
                )

                cur.execute(
                    """
                    INSERT INTO synapse_audit_log (
                        action_type, business_type, risk_level, owner_address,
                        amount_delta, before_balance, after_balance, result_status, message
                    ) VALUES (%s, 'charge', 'green', %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        "BUYER_CHARGE_ATOMIC",
                        owner,
                        str(-self._q6(total_charge)),
                        str(before_buyer),
                        str(buyer_after),
                        "SUCCEEDED",
                        f"seller={seller}",
                    ),
                )

            conn.commit()
        return BuyerChargeResult(buyerBalanceAfter=float(buyer_after))

    def reserve_seller_withdraw_atomic(self, owner_wallet: str, amount_usdc: Decimal) -> BalanceMutationResult:
        owner = str(owner_wallet or "").strip().lower()
        now = int(time.time())

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                before_available, before_pending, before_frozen = self._load_locked_balance_triplet(cur, owner, "seller", now)
                if before_available < self._q6(amount_usdc):
                    raise RuntimeError("INSUFFICIENT_SELLER_RECEIVABLE")
                after_available = self._q6(before_available - self._q6(amount_usdc))
                after_pending = self._q6(before_pending + self._q6(amount_usdc))

                cur.execute(
                    self._balance_upsert_sql,
                    (owner, "seller", str(after_available), str(after_pending), str(before_frozen), now),
                )

            conn.commit()
        return BalanceMutationResult(beforeBalance=float(before_available), afterBalance=float(after_available))

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
