"""Finance atomic repository — deposit domain helpers and public atomics.

Contains: deposit intent persistence, register_deposit_intent_atomic,
confirm_deposit_intent_atomic.
"""
from __future__ import annotations

import json
import time
from decimal import Decimal
from typing import Any

from src.domain.execution import DepositIntentConfirmCommand, DepositIntentRegisterCommand
from src.domain.ledger import DepositIntentRow
from src.domain.runtime_state import DepositMetadataState
from src.utils.datetime_utils import now_dt_str, to_dt_str

from .finance_atomic_core_mixin import _INTEGRITY_ERRORS


class FinanceAtomicDepositMixin:
    """Deposit domain helpers and public atomic methods."""

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

    def _load_deposit_runtime_meta(
        self, cur: Any, deposit_id: str
    ) -> DepositMetadataState:
        cur.execute(
            "SELECT payload FROM synapse_runtime_state WHERE state_key = %s",
            (self._deposit_state_key(deposit_id),),  # type: ignore[attr-defined]
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
            consumerAddress=intent_row.consumer_address,
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
        with self._db.readonly_cursor() as lookup_cur:  # type: ignore[attr-defined]
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
                (self._deposit_state_key(str(hit[0])),),  # type: ignore[attr-defined]
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
            consumerAddress=meta.consumer_address,
            amountUsdc=self._q6(hit[4]),  # type: ignore[attr-defined]
            idempotencyKey=meta.idempotency_key,
            status=str(hit[5]),
            createdAt=to_dt_str(hit[6], now_text) or now_text,
            updatedAt=to_dt_str(hit[7], now_text) or now_text,
        )

    def _persist_deposit_intent(
        self, cur: Any, owner: str, row: DepositIntentRow, now_text: str
    ) -> None:
        owner_id = self._ensure_owner_account(cur, owner, now_text)  # type: ignore[attr-defined]
        target_account_id = self._ensure_ledger_account(  # type: ignore[attr-defined]
            cur, owner, "consumer", now_text
        )
        cur.execute(
            """
            INSERT INTO synapse_vault_deposits (
                deposit_id, owner_id, owner_address, target_account_id, tx_hash,
                amount_usdc, status, block_number, request_id, client_request_id,
                client_ip, user_agent, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (deposit_id)
            DO UPDATE SET
                owner_id = EXCLUDED.owner_id,
                owner_address = EXCLUDED.owner_address,
                target_account_id = EXCLUDED.target_account_id,
                tx_hash = EXCLUDED.tx_hash,
                amount_usdc = EXCLUDED.amount_usdc,
                status = EXCLUDED.status,
                request_id = EXCLUDED.request_id,
                client_request_id = EXCLUDED.client_request_id,
                client_ip = EXCLUDED.client_ip,
                user_agent = EXCLUDED.user_agent,
                updated_at = EXCLUDED.updated_at
            """,
            (
                row.id,
                owner_id,
                owner,
                target_account_id,
                row.tx_hash,
                str(row.amount_usdc),
                row.status,
                row.request_id,
                row.client_request_id,
                row.client_ip,
                row.user_agent,
                row.created_at,
                row.updated_at,
            ),
        )
        self._upsert_runtime_state(  # type: ignore[attr-defined]
            cur,
            self._deposit_state_key(row.id),  # type: ignore[attr-defined]
            DepositMetadataState(
                consumerAddress=row.consumer_address,
                idempotencyKey=row.idempotency_key,
            ).model_dump(by_alias=True, mode="json"),
            row.updated_at,
        )

    def register_deposit_intent_atomic(
        self,
        command: DepositIntentRegisterCommand,
    ) -> DepositIntentRow:
        owner = str(command.owner_wallet or "").strip().lower()
        tx = str(command.tx_hash or "").strip().lower()
        now = int(time.time())
        now_text = to_dt_str(now, now_dt_str())
        amount_usdc = self._q6(command.intent_row.amount_usdc)  # type: ignore[attr-defined]
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

        with self._db.connect() as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                try:
                    self._persist_deposit_intent(cur, owner, row, now_text)
                except _INTEGRITY_ERRORS:
                    conn.rollback()
                    existing = self._read_existing_deposit_intent_by_tx(
                        tx, owner, now_text
                    )
                    if existing is not None:
                        return existing
                    raise RuntimeError("DEPOSIT_ALREADY_PROCESSED")

                available_balance, pending_balance, frozen_balance = (
                    self._load_locked_balance_triplet(cur, owner, "consumer", now)  # type: ignore[attr-defined]
                )
                self._upsert_balance_triplet(  # type: ignore[attr-defined]
                    cur,
                    owner,
                    "consumer",
                    available_balance,
                    self._q6(pending_balance + amount_usdc),  # type: ignore[attr-defined]
                    frozen_balance,
                    now_text,
                )
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

        with self._db.connect() as conn:  # type: ignore[attr-defined]
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
                    consumerAddress=meta.consumer_address,
                    amountUsdc=self._q6(hit[4]),  # type: ignore[attr-defined]
                    idempotencyKey=meta.idempotency_key,
                    status=str(hit[5]),
                    createdAt=to_dt_str(hit[6], now_text) or now_text,
                    updatedAt=to_dt_str(hit[7], now_text) or now_text,
                )

                available_balance, pending_balance, frozen_balance = (
                    self._load_locked_balance_triplet(cur, owner, "consumer", now)  # type: ignore[attr-defined]
                )

                if row.status.upper() == "CONFIRMED":
                    if pending_balance >= row.amount_usdc:
                        next_available = self._q6(available_balance + row.amount_usdc)  # type: ignore[attr-defined]
                        next_pending = self._q6(pending_balance - row.amount_usdc)  # type: ignore[attr-defined]
                        self._upsert_balance_triplet(  # type: ignore[attr-defined]
                            cur, owner, "consumer", next_available, next_pending, frozen_balance, now_text,
                        )
                        cur.execute(
                            "UPDATE synapse_vault_deposits SET updated_at = %s WHERE deposit_id = %s AND owner_id = %s",
                            (now_text, row.id, self._owner_id(row.owner_address)),  # type: ignore[attr-defined]
                        )
                        self._append_withdrawal_audit(  # type: ignore[attr-defined]
                            cur,
                            action="CONSUMER_DEPOSIT_CONFIRMED_REPAIRED",
                            business_type="deposit",
                            owner=owner,
                            request_id=row.request_id or command.event_key,
                            amount=row.amount_usdc,
                            risk_level="yellow",
                            risk_reason_code="DEPOSIT_CONFIRM_REPAIR",
                            result_status="CONFIRMED",
                            message="repair_pending_to_available",
                            evidence={
                                "txHash": row.tx_hash,
                                "beforeBalance": available_balance,
                                "afterBalance": next_available,
                                "ledgerId": row.id,
                                "traceId": command.event_key,
                            },
                        )
                        conn.commit()
                        return DepositIntentRow(
                            id=row.id,
                            ownerAddress=row.owner_address,
                            txHash=row.tx_hash,
                            requestId=row.request_id,
                            consumerAddress=row.consumer_address,
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

                next_available = self._q6(available_balance + row.amount_usdc)  # type: ignore[attr-defined]
                next_pending = self._q6(pending_balance - row.amount_usdc)  # type: ignore[attr-defined]
                self._upsert_balance_triplet(  # type: ignore[attr-defined]
                    cur, owner, "consumer", next_available, next_pending, frozen_balance, now_text,
                )

                cur.execute(
                    "UPDATE synapse_vault_deposits SET status = %s, updated_at = %s WHERE deposit_id = %s AND owner_id = %s",
                    ("CONFIRMED", now_text, row.id, self._owner_id(owner)),  # type: ignore[attr-defined]
                )

                self._append_withdrawal_audit(  # type: ignore[attr-defined]
                    cur,
                    action="CONSUMER_DEPOSIT_CONFIRMED",
                    business_type="deposit",
                    owner=owner,
                    request_id=row.request_id or command.event_key,
                    amount=row.amount_usdc,
                    risk_level="green",
                    risk_reason_code=None,
                    result_status="CONFIRMED",
                    message=f"confirmations={int(command.confirmations)}",
                    evidence={
                        "txHash": row.tx_hash,
                        "beforeBalance": available_balance,
                        "afterBalance": next_available,
                        "ledgerId": row.id,
                        "traceId": command.event_key,
                    },
                )
            conn.commit()
        return DepositIntentRow(
            id=row.id,
            ownerAddress=row.owner_address,
            txHash=row.tx_hash,
            requestId=row.request_id,
            consumerAddress=row.consumer_address,
            amountUsdc=row.amount_usdc,
            idempotencyKey=row.idempotency_key,
            status="CONFIRMED",
            createdAt=row.created_at,
            updatedAt=now_text,
        )
