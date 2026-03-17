from __future__ import annotations

import json
import time
from decimal import Decimal
from typing import Any, Callable, Optional
from uuid import uuid4

from src.domain.audit import AuditLogRow
from src.domain.execution import (
    CompleteWithdrawTxCommand,
    DepositIntentConfirmCommand,
    DepositIntentRegisterCommand,
    PreparedWithdrawTicket,
    ReserveSellerWithdrawCommand,
    WithdrawalAtomicRequestCommand,
    WithdrawalDecision,
)
from src.domain.finance import (
    BalanceMutationResult,
    BuyerChargeResult,
    ChargeBuyerUsageCommand,
    UsageLogRow,
)
from src.domain.ledger import DepositIntentRow
from src.domain.runtime_state import DepositMetadataState
from src.utils.datetime_utils import now_dt_str, to_dt_str

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
        _ = audit_insert_sql
        self._restricted_session_statuses = restricted_session_statuses

    @staticmethod
    def _owner_id(wallet: str) -> str:
        return f"owner:{str(wallet or '').lower()}"

    @staticmethod
    def _seller_id(wallet: str) -> str:
        return f"seller:{str(wallet or '').lower()}"

    @staticmethod
    def _account_identity(wallet: str, account_type: str) -> tuple[str, str]:
        normalized_wallet = str(wallet or "").lower()
        normalized_type = str(account_type or "").lower()
        if normalized_type == "buyer":
            return f"owner_vault::{normalized_wallet}", "owner_vault"
        if normalized_type == "seller":
            return f"seller_receivable::{normalized_wallet}", "seller_receivable"
        return "platform_revenue::main", "platform_revenue"

    def _ensure_owner_account(self, cur: Any, wallet: str, updated_at: str) -> str:
        normalized_wallet = str(wallet or "").lower()
        owner_id = self._owner_id(normalized_wallet)
        cur.execute(
            """
            INSERT INTO synapse_owner_accounts (
                owner_id, owner_wallet, status, default_currency, created_at, updated_at
            ) VALUES (%s, %s, 'active', 'USDC', %s, %s)
            ON CONFLICT (owner_id)
            DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, updated_at = EXCLUDED.updated_at
            """,
            (owner_id, normalized_wallet, updated_at, updated_at),
        )
        return owner_id

    def _ensure_seller_profile(self, cur: Any, wallet: str, updated_at: str) -> str:
        normalized_wallet = str(wallet or "").lower()
        self._ensure_owner_account(cur, normalized_wallet, updated_at)
        seller_id = self._seller_id(normalized_wallet)
        cur.execute(
            """
            INSERT INTO synapse_seller_profiles (
                seller_id, owner_wallet, display_name, status, created_at, updated_at
            ) VALUES (%s, %s, %s, 'active', %s, %s)
            ON CONFLICT (seller_id)
            DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, updated_at = EXCLUDED.updated_at
            """,
            (seller_id, normalized_wallet, normalized_wallet, updated_at, updated_at),
        )
        return seller_id

    def _ensure_ledger_account(
        self, cur: Any, wallet: str, account_type: str, updated_at: str
    ) -> str:
        account_id, account_kind = self._account_identity(wallet, account_type)
        if account_kind == "owner_vault":
            owner_id = self._ensure_owner_account(cur, wallet, updated_at)
            cur.execute(
                """
                INSERT INTO synapse_ledger_accounts (
                    account_id, account_kind, owner_id, seller_id, currency, status, created_at, updated_at
                ) VALUES (%s, %s, %s, NULL, 'USDC', 'active', %s, %s)
                ON CONFLICT (account_id)
                DO UPDATE SET owner_id = EXCLUDED.owner_id, updated_at = EXCLUDED.updated_at
                """,
                (account_id, account_kind, owner_id, updated_at, updated_at),
            )
            return account_id
        if account_kind == "seller_receivable":
            seller_id = self._ensure_seller_profile(cur, wallet, updated_at)
            cur.execute(
                """
                INSERT INTO synapse_ledger_accounts (
                    account_id, account_kind, owner_id, seller_id, currency, status, created_at, updated_at
                ) VALUES (%s, %s, NULL, %s, 'USDC', 'active', %s, %s)
                ON CONFLICT (account_id)
                DO UPDATE SET seller_id = EXCLUDED.seller_id, updated_at = EXCLUDED.updated_at
                """,
                (account_id, account_kind, seller_id, updated_at, updated_at),
            )
            return account_id
        cur.execute(
            """
            INSERT INTO synapse_ledger_accounts (
                account_id, account_kind, owner_id, seller_id, currency, status, created_at, updated_at
            ) VALUES (%s, %s, NULL, NULL, 'USDC', 'active', %s, %s)
            ON CONFLICT (account_id)
            DO UPDATE SET updated_at = EXCLUDED.updated_at
            """,
            (account_id, account_kind, updated_at, updated_at),
        )
        return account_id

    def _upsert_balance_triplet(
        self,
        cur: Any,
        wallet: str,
        account_type: str,
        available_balance: Decimal,
        pending_balance: Decimal,
        frozen_balance: Decimal,
        updated_at: str,
    ) -> None:
        account_id = self._ensure_ledger_account(cur, wallet, account_type, updated_at)
        cur.execute(
            self._balance_upsert_sql,
            (
                account_id,
                str(self._q6(available_balance)),
                str(self._q6(pending_balance)),
                str(self._q6(frozen_balance)),
                updated_at,
            ),
        )

    @staticmethod
    def _event_id(prefix: str) -> str:
        return f"{prefix}-{uuid4().hex}"

    @staticmethod
    def _audit_detail_json(row: AuditLogRow) -> dict[str, Any]:
        return {
            "domain": "finance",
            "riskLevel": row.risk_level,
            "actor": row.actor,
            "requestId": row.request_id,
            "traceId": row.trace_id,
            "txHash": row.tx_hash,
            "counterpartyAddress": row.counterparty_address,
            "direction": row.direction,
            "status": row.status,
            "riskReasonCode": row.risk_reason_code,
            "ledgerId": row.ledger_id,
            "clientIp": row.client_ip,
            "userAgent": row.user_agent,
            "beforeBalance": str(row.before_balance) if row.before_balance is not None else None,
            "afterBalance": str(row.after_balance) if row.after_balance is not None else None,
            "message": row.message,
            "ownerAddress": row.owner_address,
        }

    @staticmethod
    def _deposit_state_key(deposit_id: str) -> str:
        return f"vault_deposit_meta::{deposit_id}"

    @staticmethod
    def _payload_dict(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except Exception:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    def _upsert_runtime_state(
        self, cur: Any, state_key: str, payload: dict[str, Any], updated_at: str
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
            VALUES (%s, %s::jsonb, %s)
            ON CONFLICT (state_key)
            DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
            """,
            (state_key, json.dumps(payload), updated_at),
        )

    def _load_deposit_runtime_meta(
        self, cur: Any, deposit_id: str
    ) -> DepositMetadataState:
        cur.execute(
            "SELECT payload FROM synapse_runtime_state WHERE state_key = %s",
            (self._deposit_state_key(deposit_id),),
        )
        row = cur.fetchone()
        payload = self._payload_dict(row[0]) if row is not None else {}
        return DepositMetadataState.model_validate(payload)

    def _build_deposit_intent_row(
        self,
        owner: str,
        tx: str,
        request_id: str,
        intent_row: DepositIntentRow,
        amount_usdc: Decimal,
        now: int,
        now_text: str,
    ) -> DepositIntentRow:
        row_id = str(intent_row.id or "").strip() or f"dep-{now}-{tx[-8:]}"
        return DepositIntentRow(
            id=row_id,
            ownerAddress=owner,
            txHash=tx,
            requestId=request_id or intent_row.request_id,
            buyerAddress=intent_row.buyer_address,
            amountUsdc=amount_usdc,
            idempotencyKey=intent_row.idempotency_key,
            status=intent_row.status or "PENDING_CONFIRMATION",
            createdAt=to_dt_str(intent_row.created_at or now_text, now_text)
            or now_text,
            updatedAt=now_text,
        )

    def _read_existing_deposit_intent_by_tx(
        self, tx: str, owner: str, now_text: str
    ) -> DepositIntentRow | None:
        with self._db.readonly_cursor() as lookup_cur:
            lookup_cur.execute(
                """
                SELECT vd.deposit_id, oa.owner_wallet, vd.tx_hash, vd.request_id,
                       vd.amount_usdc, vd.status, vd.created_at, vd.updated_at
                FROM synapse_vault_deposits AS vd
                INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = vd.owner_id
                WHERE vd.tx_hash = %s AND oa.owner_wallet = %s
                """,
                (tx, owner),
            )
            hit = lookup_cur.fetchone()
            if hit is None:
                return None
            lookup_cur.execute(
                "SELECT payload FROM synapse_runtime_state WHERE state_key = %s",
                (self._deposit_state_key(str(hit[0])),),
            )
            meta_hit = lookup_cur.fetchone()
        meta = DepositMetadataState.model_validate(
            self._payload_dict(meta_hit[0]) if meta_hit is not None else {}
        )
        return DepositIntentRow(
            id=str(hit[0]),
            ownerAddress=str(hit[1]),
            txHash=str(hit[2]),
            requestId=hit[3],
            buyerAddress=meta.buyer_address,
            amountUsdc=self._q6(hit[4]),
            idempotencyKey=meta.idempotency_key,
            status=str(hit[5]),
            createdAt=to_dt_str(hit[6], now_text) or now_text,
            updatedAt=to_dt_str(hit[7], now_text) or now_text,
        )

    def _persist_deposit_intent(
        self, cur: Any, owner: str, row: DepositIntentRow, now_text: str
    ) -> None:
        owner_id = self._ensure_owner_account(cur, owner, now_text)
        cur.execute(
            """
            INSERT INTO synapse_vault_deposits (
                deposit_id, owner_id, tx_hash, amount_usdc, status,
                block_number, request_id, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, NULL, %s, %s, %s)
            ON CONFLICT (deposit_id)
            DO UPDATE SET
                owner_id = EXCLUDED.owner_id,
                tx_hash = EXCLUDED.tx_hash,
                amount_usdc = EXCLUDED.amount_usdc,
                status = EXCLUDED.status,
                request_id = EXCLUDED.request_id,
                updated_at = EXCLUDED.updated_at
            """,
            (
                row.id,
                owner_id,
                row.tx_hash,
                str(row.amount_usdc),
                row.status,
                row.request_id,
                row.created_at,
                row.updated_at,
            ),
        )
        self._upsert_runtime_state(
            cur,
            self._deposit_state_key(row.id),
                DepositMetadataState(
                    buyerAddress=row.buyer_address,
                    idempotencyKey=row.idempotency_key,
                ).model_dump(by_alias=True, mode="json"),
            row.updated_at,
        )

    def _append_finance_audit_row(self, cur: Any, row: AuditLogRow) -> None:
        cur.execute(
            """
            INSERT INTO synapse_audit_events (
                event_id, event_type, business_type, owner_id,
                amount_delta, result_status, error_code, detail_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                self._event_id("audit"),
                row.action_type,
                row.business_type,
                row.owner_address,
                str(row.amount_delta) if row.amount_delta is not None else None,
                row.result_status,
                row.error_code,
                json.dumps(self._audit_detail_json(row)),
            ),
        )

    def _load_locked_balance_triplet(
        self, cur: Any, owner: str, account_type: str, now: int
    ) -> tuple[Decimal, Decimal, Decimal]:
        now_text = to_dt_str(now, now_dt_str())
        account_id = self._ensure_ledger_account(cur, owner, account_type, now_text)
        cur.execute(self._balance_for_update_sql, (account_id,))
        hit = cur.fetchone()
        if hit is None:
            self._upsert_balance_triplet(
                cur,
                owner,
                account_type,
                Decimal("0"),
                Decimal("0"),
                Decimal("0"),
                now_text,
            )
            return Decimal("0"), Decimal("0"), Decimal("0")
        return self._q6(hit[0]), self._q6(hit[1]), self._q6(hit[2])

    def _compute_withdrawal_risk_metrics(
        self, cur: Any, owner: str, now: int, window_seconds: int
    ) -> tuple[Decimal, Decimal, bool]:
        window_start = now - max(1, int(window_seconds))
        cur.execute(
            """
            SELECT COALESCE(SUM(amount_usdc), 0)
            FROM synapse_withdrawal_intents
            WHERE owner_address = %s
              AND created_at >= %s
              AND status <> 'REJECTED'
            """,
            (owner, to_dt_str(window_start, now_dt_str())),
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
        business_type: str,
        owner: str,
        request_id: str,
        amount: Decimal,
        risk_level: str,
        risk_reason_code: Optional[str],
        result_status: str,
        message: str,
    ) -> None:
        self._append_finance_audit_row(
            cur,
            AuditLogRow(
                actionType=action,
                businessType=business_type,
                riskLevel=risk_level,
                ownerAddress=owner,
                requestId=request_id,
                amountDelta=amount,
                resultStatus=result_status,
                errorCode=risk_reason_code,
                message=message,
                status=result_status,
            ),
        )

    def _resolve_red_reason(
        self, amount: Decimal, historical_net_income: Decimal, is_high_risk: bool
    ) -> Optional[str]:
        if amount > historical_net_income:
            return "WITHDRAW_EXCEEDS_HISTORICAL_NET_INCOME"
        if is_high_risk:
            return "HIGH_RISK_SELLER_TAGGED"
        return None

    def process_withdrawal_request_atomic(
        self,
        command: WithdrawalAtomicRequestCommand,
    ) -> WithdrawalDecision:
        owner = str(command.seller_address or "").strip().lower()
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        amount = self._q6(command.amount_usdc)
        _ = command.request_meta
        if amount <= Decimal("0"):
            raise RuntimeError("INVALID_WITHDRAW_AMOUNT")

        with self._db.connect() as conn:
            try:
                with conn.cursor() as cur:
                    available_balance, pending_balance, frozen_balance = (
                        self._load_locked_balance_triplet(cur, owner, "seller", now)
                    )
                    if available_balance < amount:
                        raise RuntimeError("INSUFFICIENT_SELLER_RECEIVABLE")

                    rolling_24h, historical_net_income, high_risk_from_db = (
                        self._compute_withdrawal_risk_metrics(
                            cur, owner, now, command.window_seconds
                        )
                    )
                    is_high_risk = bool(command.high_risk_override or high_risk_from_db)
                    red_reason = self._resolve_red_reason(
                        amount, historical_net_income, is_high_risk
                    )
                    withdrawal_id = f"wd-{now}-{owner[-8:]}"

                    if red_reason:
                        cur.execute(
                            """
                            INSERT INTO synapse_withdrawal_intents (
                                id, owner_address, tx_hash, status, request_id, idempotency_key,
                                amount_usdc, created_at, updated_at
                            ) VALUES (%s, %s, NULL, 'REJECTED', %s, %s, %s, %s, %s)
                            """,
                            (
                                withdrawal_id,
                                owner,
                                command.request_id,
                                command.idempotency_key,
                                str(amount),
                                now_text,
                                now_text,
                            ),
                        )
                        self._append_withdrawal_audit(
                            cur,
                            action="PROVIDER_WITHDRAW_REJECTED",
                            business_type="withdraw",
                            owner=owner,
                            request_id=command.request_id,
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

                    is_yellow = amount >= self._q6(command.single_limit_usdc) or (
                        rolling_24h + amount
                    ) >= self._q6(command.rolling_24h_limit_usdc)
                    next_available = self._q6(available_balance - amount)
                    if is_yellow:
                        status = "PENDING_MANUAL_REVIEW"
                        self._upsert_balance_triplet(
                            cur,
                            owner,
                            "seller",
                            next_available,
                            pending_balance,
                            self._q6(frozen_balance + amount),
                            now_text,
                        )
                        ticket = {}
                        message = "Withdrawal requested. Amounts over $100 require manual security review (ETA: 12-24 hrs)."
                        risk_level = "yellow"
                    else:
                        status = "APPROVED_AUTO"
                        self._upsert_balance_triplet(
                            cur,
                            owner,
                            "seller",
                            next_available,
                            self._q6(pending_balance + amount),
                            frozen_balance,
                            now_text,
                        )
                        prepared_ticket = (
                            command.sign_ticket_factory(amount)
                            if command.sign_ticket_factory is not None
                            else None
                        )
                        ticket = (
                            dict(prepared_ticket.ticket)
                            if isinstance(prepared_ticket, PreparedWithdrawTicket)
                            else {}
                        )
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
                        (
                            withdrawal_id,
                            owner,
                            status,
                            command.request_id,
                            command.idempotency_key,
                            str(amount),
                            now_text,
                            now_text,
                        ),
                    )

                    self._append_withdrawal_audit(
                        cur,
                        action="PROVIDER_WITHDRAW_INTENT_CREATED",
                        business_type="withdraw",
                        owner=owner,
                        request_id=command.request_id,
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
        cur.execute(
            "SELECT payload->>'status' FROM synapse_runtime_state WHERE state_key = %s",
            (f"auth_session::{str(wallet or '').lower()}",),
        )
        row = cur.fetchone()
        if row is None:
            return False
        return str(row[0] or "").strip().lower() in self._restricted_session_statuses

    def _is_account_restricted_for_charge(
        self, cur: Any, wallet: str, account_type: str, now: int
    ) -> bool:
        _, _, frozen_balance = self._load_locked_balance_triplet(
            cur, wallet, account_type, now
        )
        if frozen_balance <= Decimal("0"):
            return False
        return self._is_wallet_restricted(cur, wallet)

    def register_deposit_intent_atomic(
        self,
        command: DepositIntentRegisterCommand,
    ) -> DepositIntentRow:
        owner = str(command.owner_wallet or "").strip().lower()
        tx = str(command.tx_hash or "").strip().lower()
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        amount_usdc = self._q6(command.intent_row.amount_usdc)
        if amount_usdc <= Decimal("0"):
            raise RuntimeError("INVALID_DEPOSIT_AMOUNT")

        row = self._build_deposit_intent_row(
            owner,
            tx,
            command.request_id,
            command.intent_row,
            amount_usdc,
            now,
            now_text,
        )

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_deposit_dedup (tx_hash, owner_address, request_id) VALUES (%s, %s, %s)",
                        (tx, owner, command.request_id or None),
                    )
                except _INTEGRITY_ERRORS:
                    conn.rollback()
                    existing = self._read_existing_deposit_intent_by_tx(
                        tx, owner, now_text
                    )
                    if existing is not None:
                        return existing
                    raise RuntimeError("DEPOSIT_ALREADY_PROCESSED")

                available_balance, pending_balance, frozen_balance = (
                    self._load_locked_balance_triplet(cur, owner, "buyer", now)
                )
                self._upsert_balance_triplet(
                    cur,
                    owner,
                    "buyer",
                    available_balance,
                    self._q6(pending_balance + amount_usdc),
                    frozen_balance,
                    now_text,
                )

                self._persist_deposit_intent(cur, owner, row, now_text)
            conn.commit()
        return row

    def confirm_deposit_intent_atomic(
        self,
        command: DepositIntentConfirmCommand,
    ) -> DepositIntentRow:
        owner = str(command.owner_wallet or "").strip().lower()
        intent_id = str(command.deposit_intent_id or "").strip()
        if not intent_id:
            raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT vd.deposit_id, oa.owner_wallet, vd.tx_hash, vd.request_id,
                           vd.amount_usdc, vd.status, vd.created_at, vd.updated_at
                    FROM synapse_vault_deposits AS vd
                    INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = vd.owner_id
                    WHERE vd.deposit_id = %s AND oa.owner_wallet = %s
                    FOR UPDATE
                    """,
                    (intent_id, owner),
                )
                hit = cur.fetchone()
                if hit is None:
                    raise RuntimeError("DEPOSIT_INTENT_NOT_FOUND")

                meta = self._load_deposit_runtime_meta(cur, str(hit[0]))

                row = DepositIntentRow(
                    id=str(hit[0]),
                    ownerAddress=str(hit[1]),
                    txHash=str(hit[2]),
                    requestId=hit[3],
                    buyerAddress=meta.buyer_address,
                    amountUsdc=self._q6(hit[4]),
                    idempotencyKey=meta.idempotency_key,
                    status=str(hit[5]),
                    createdAt=to_dt_str(hit[6], now_text) or now_text,
                    updatedAt=to_dt_str(hit[7], now_text) or now_text,
                )

                available_balance, pending_balance, frozen_balance = (
                    self._load_locked_balance_triplet(cur, owner, "buyer", now)
                )

                if row.status.upper() == "CONFIRMED":
                    if pending_balance >= row.amount_usdc:
                        next_available = self._q6(available_balance + row.amount_usdc)
                        next_pending = self._q6(pending_balance - row.amount_usdc)
                        self._upsert_balance_triplet(
                            cur,
                            owner,
                            "buyer",
                            next_available,
                            next_pending,
                            frozen_balance,
                            now_text,
                        )
                        cur.execute(
                            "UPDATE synapse_vault_deposits SET updated_at = %s WHERE deposit_id = %s AND owner_id = %s",
                            (now_text, row.id, self._owner_id(owner)),
                        )
                        self._append_withdrawal_audit(
                            cur,
                            action="BUYER_DEPOSIT_CONFIRMED_REPAIRED",
                            business_type="deposit",
                            owner=owner,
                            request_id=row.request_id or command.event_key,
                            amount=row.amount_usdc,
                            risk_level="yellow",
                            risk_reason_code="DEPOSIT_CONFIRM_REPAIR",
                            result_status="CONFIRMED",
                            message="repair_pending_to_available",
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
                            updatedAt=now_text,
                        )
                    return row
                if row.status.upper() not in {"PENDING_CONFIRMATION", "PENDING"}:
                    raise RuntimeError("DEPOSIT_STATUS_INVALID")
                if pending_balance < row.amount_usdc:
                    raise RuntimeError("DEPOSIT_PENDING_BALANCE_INCONSISTENT")

                next_available = self._q6(available_balance + row.amount_usdc)
                next_pending = self._q6(pending_balance - row.amount_usdc)
                self._upsert_balance_triplet(
                    cur,
                    owner,
                    "buyer",
                    next_available,
                    next_pending,
                    frozen_balance,
                    now_text,
                )

                cur.execute(
                    "UPDATE synapse_vault_deposits SET status = %s, updated_at = %s WHERE deposit_id = %s AND owner_id = %s",
                    ("CONFIRMED", now_text, row.id, self._owner_id(owner)),
                )

                self._append_withdrawal_audit(
                    cur,
                    action="BUYER_DEPOSIT_CONFIRMED",
                    business_type="deposit",
                    owner=owner,
                    request_id=row.request_id or command.event_key,
                    amount=row.amount_usdc,
                    risk_level="green",
                    risk_reason_code=None,
                    result_status="CONFIRMED",
                            message=f"confirmations={int(command.confirmations)}",
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
            updatedAt=now_text,
        )

    def charge_buyer_and_record_usage_atomic(
        self,
        command: ChargeBuyerUsageCommand,
    ) -> BuyerChargeResult:
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        owner = str(command.owner_wallet or "").strip().lower()
        seller = str(command.seller_wallet or "").strip().lower()

        def _load_balance(
            cur: Any, wallet: str, account_type: str, column_name: str
        ) -> Decimal:
            hit = self._load_locked_balance_triplet(cur, wallet, account_type, now)
            idx = {"available_balance": 0, "pending_balance": 1, "frozen_balance": 2}[
                column_name
            ]
            return self._q6(hit[idx])

        def _set_available(
            cur: Any, wallet: str, account_type: str, available_value: Decimal
        ) -> None:
            current_pending = _load_balance(
                cur, wallet, account_type, "pending_balance"
            )
            current_frozen = _load_balance(cur, wallet, account_type, "frozen_balance")
            self._upsert_balance_triplet(
                cur,
                wallet,
                account_type,
                self._q6(available_value),
                self._q6(current_pending),
                self._q6(current_frozen),
                now_text,
            )

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                if self._is_account_restricted_for_charge(cur, owner, "buyer", now):
                    raise RuntimeError("BUYER_RESTRICTED_RISK_BLOCK")
                if self._is_account_restricted_for_charge(cur, seller, "seller", now):
                    raise RuntimeError("SELLER_RESTRICTED_RISK_BLOCK")

                before_buyer = _load_balance(cur, owner, "buyer", "available_balance")
                if before_buyer < self._q6(command.total_charge):
                    raise RuntimeError("INSUFFICIENT_BALANCE")

                seller_before = _load_balance(
                    cur, seller, "seller", "available_balance"
                )
                platform_before = _load_balance(
                    cur, "__platform__", "platform_fee", "available_balance"
                )
                buyer_after = self._q6(before_buyer - self._q6(command.total_charge))
                seller_after = self._q6(seller_before + self._q6(command.seller_net))
                platform_after = self._q6(
                    platform_before + self._q6(command.platform_fee_total)
                )

                _set_available(cur, owner, "buyer", buyer_after)
                _set_available(cur, seller, "seller", seller_after)
                _set_available(cur, "__platform__", "platform_fee", platform_after)

                row = UsageLogRow(
                    id=command.usage_row.id,
                    ts=int(command.usage_row.ts or now),
                    requestId=command.usage_row.request_id,
                    serviceId=command.usage_row.service_id,
                    buyerAddress=(command.usage_row.buyer_address or owner),
                    sellerAddress=(command.usage_row.seller_address or seller),
                    status=command.usage_row.status or "accepted",
                    unitPrice=command.usage_row.unit_price,
                    protocolFee=command.usage_row.protocol_fee,
                    routingTax=command.usage_row.routing_tax,
                    totalCharge=command.usage_row.total_charge or self._q6(command.total_charge),
                    businessType=command.usage_row.business_type,
                    riskLevel=command.usage_row.risk_level,
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
                        str(self._q6(row.unit_price))
                        if row.unit_price is not None
                        else None,
                        str(self._q6(row.protocol_fee))
                        if row.protocol_fee is not None
                        else None,
                        str(self._q6(row.routing_tax))
                        if row.routing_tax is not None
                        else None,
                        str(self._q6(row.total_charge))
                        if row.total_charge is not None
                        else None,
                        row.business_type,
                        row.risk_level,
                    ),
                )

                self._append_finance_audit_row(
                    cur,
                    AuditLogRow(
                        actionType="BUYER_CHARGE_ATOMIC",
                        businessType="charge",
                        riskLevel="green",
                        ownerAddress=owner,
                        amountDelta=-self._q6(command.total_charge),
                        beforeBalance=before_buyer,
                        afterBalance=buyer_after,
                        resultStatus="SUCCEEDED",
                        status="SUCCEEDED",
                        message=f"seller={seller}",
                    ),
                )

            conn.commit()
        return BuyerChargeResult(buyerBalanceAfter=float(buyer_after))

    def reserve_seller_withdraw_atomic(
        self, command: ReserveSellerWithdrawCommand
    ) -> BalanceMutationResult:
        owner = str(command.owner_wallet or "").strip().lower()
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())

        with self._db.connect() as conn:
            with conn.cursor() as cur:
                before_available, before_pending, before_frozen = (
                    self._load_locked_balance_triplet(cur, owner, "seller", now)
                )
                if before_available < self._q6(command.amount_usdc):
                    raise RuntimeError("INSUFFICIENT_SELLER_RECEIVABLE")
                after_available = self._q6(before_available - self._q6(command.amount_usdc))
                after_pending = self._q6(before_pending + self._q6(command.amount_usdc))

                self._upsert_balance_triplet(
                    cur,
                    owner,
                    "seller",
                    after_available,
                    after_pending,
                    before_frozen,
                    now_text,
                )

            conn.commit()
        return BalanceMutationResult(
            beforeBalance=float(before_available), afterBalance=float(after_available)
        )

    def complete_withdraw_tx_atomic(
        self, command: CompleteWithdrawTxCommand
    ) -> bool:
        with self._db.connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        "INSERT INTO synapse_withdraw_tx_dedup (owner_address, tx_hash, kind) VALUES (%s, %s, %s)",
                        (command.owner_wallet, command.tx_hash, command.kind),
                    )
                except _INTEGRITY_ERRORS:
                    conn.rollback()
                    return False
            conn.commit()
        return True
