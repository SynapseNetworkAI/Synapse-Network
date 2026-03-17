from __future__ import annotations

import json
from typing import Any, Callable, List

from src.domain.gateway import RouterConfigRow
from src.domain.ledger import DepositIntentRow, WithdrawalIntentRow
from src.domain.finance import (
    RefundIntentRow,
    UsageLogRow,
)
from src.domain.runtime_state import DepositMetadataState
from src.domain.system import ProcessedDepositEventRow, RuntimeStateRow
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager


class GatewayStateRepository:
    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6

    @staticmethod
    def _owner_id(wallet: str) -> str:
        return f"owner:{str(wallet or '').lower()}"

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

    def read_deposit_intents(self) -> List[DepositIntentRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    vd.deposit_id,
                    oa.owner_wallet,
                    vd.tx_hash,
                    vd.request_id,
                    rs.payload,
                    vd.amount_usdc,
                    vd.status,
                    vd.created_at,
                    vd.updated_at
                FROM synapse_vault_deposits AS vd
                INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = vd.owner_id
                LEFT JOIN synapse_runtime_state AS rs
                    ON rs.state_key = CONCAT('vault_deposit_meta::', vd.deposit_id)
                ORDER BY created_at ASC
                """
            )
            rows = cur.fetchall()
        return [
            DepositIntentRow(
                id=str(row_id),
                ownerAddress=str(owner),
                txHash=str(tx_hash),
                requestId=request_id,
                buyerAddress=DepositMetadataState.model_validate(
                    self._payload_dict(meta_payload)
                ).buyer_address,
                amountUsdc=self._q6(amount_usdc),
                idempotencyKey=DepositMetadataState.model_validate(
                    self._payload_dict(meta_payload)
                ).idempotency_key,
                status=str(status),
                createdAt=to_dt_str(created_at, "") or "",
                updatedAt=to_dt_str(updated_at, "") or "",
            )
            for row_id, owner, tx_hash, request_id, meta_payload, amount_usdc, status, created_at, updated_at in rows
        ]

    def _normalize_deposit_intent_row(self, row: DepositIntentRow) -> DepositIntentRow | None:
        entity = row

        row_id = str(entity.id or "").strip()
        owner = str(entity.owner_address or "").strip().lower()
        tx_hash = str(entity.tx_hash or "").strip().lower()
        if not row_id or not owner:
            return None
        if not (tx_hash.startswith("0x") and len(tx_hash) == 66):
            return None
        return entity

    def write_deposit_intents(
        self, rows: List[DepositIntentRow]
    ) -> None:
        with self._db.tx_cursor() as cur:
            for row in rows:
                entity = self._normalize_deposit_intent_row(row)
                if entity is None:
                    continue
                updated_at = to_dt_str(entity.updated_at, now_dt_str())
                owner_id = self._ensure_owner_account(
                    cur,
                    entity.owner_address.lower(),
                    updated_at,
                )
                cur.execute(
                    """
                    INSERT INTO synapse_vault_deposits (
                        deposit_id, owner_id, tx_hash, amount_usdc, status,
                        block_number, request_id, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, NULL, %s, %s, %s)
                    ON CONFLICT (tx_hash)
                    DO UPDATE SET
                        owner_id = EXCLUDED.owner_id,
                        request_id = EXCLUDED.request_id,
                        amount_usdc = EXCLUDED.amount_usdc,
                        status = EXCLUDED.status,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        entity.id,
                        owner_id,
                        entity.tx_hash.lower(),
                        entity.request_id,
                        str(self._q6(entity.amount_usdc)),
                        entity.status,
                        to_dt_str(entity.created_at, now_dt_str()),
                        updated_at,
                    ),
                )
                self._upsert_runtime_state(
                    cur,
                    self._deposit_state_key(entity.id),
                    DepositMetadataState(
                        buyerAddress=entity.buyer_address.lower()
                        if entity.buyer_address
                        else None,
                        idempotencyKey=entity.idempotency_key,
                    ).model_dump(by_alias=True, mode="json"),
                    updated_at,
                )

    def read_refund_intents(self) -> List[RefundIntentRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT id, owner_address, tx_hash, status, request_id, buyer_address,
                       amount_usdc, idempotency_key, created_at, updated_at
                FROM synapse_refund_intents
                ORDER BY created_at ASC
                """
            )
            rows = cur.fetchall()
        return [
            RefundIntentRow(
                id=str(row_id),
                ownerAddress=str(owner),
                txHash=tx_hash,
                status=str(status),
                requestId=request_id,
                buyerAddress=buyer_address,
                amountUsdc=self._q6(amount_usdc),
                idempotencyKey=idempotency_key,
                createdAt=to_dt_str(created_at, "") or "",
                updatedAt=to_dt_str(updated_at, "") or "",
            )
            for row_id, owner, tx_hash, status, request_id, buyer_address, amount_usdc, idempotency_key, created_at, updated_at in rows
        ]

    def write_refund_intents(
        self, rows: List[RefundIntentRow], updated_at: str | int
    ) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_refund_intents")
            for row in rows:
                cur.execute(
                    """
                    INSERT INTO synapse_refund_intents (
                        id, owner_address, tx_hash, status, request_id, buyer_address,
                        amount_usdc, idempotency_key, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        owner_address = EXCLUDED.owner_address,
                        tx_hash = EXCLUDED.tx_hash,
                        status = EXCLUDED.status,
                        request_id = EXCLUDED.request_id,
                        buyer_address = EXCLUDED.buyer_address,
                        amount_usdc = EXCLUDED.amount_usdc,
                        idempotency_key = EXCLUDED.idempotency_key,
                        created_at = EXCLUDED.created_at,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        row.id,
                        row.owner_address.lower(),
                        row.tx_hash.lower() if row.tx_hash else None,
                        row.status,
                        row.request_id,
                        row.buyer_address.lower() if row.buyer_address else None,
                        str(self._q6(row.amount_usdc)),
                        row.idempotency_key,
                        to_dt_str(row.created_at or updated_at, now_dt_str()),
                        to_dt_str(row.updated_at or updated_at, now_dt_str()),
                    ),
                )

    def read_withdrawal_intents(self) -> List[WithdrawalIntentRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT id, owner_address, tx_hash, status, request_id, idempotency_key,
                       amount_usdc, amount_wei, fee_wei, nonce, deadline, signature,
                       chain_id, contract_address, signer_address, created_at, updated_at
                FROM synapse_withdrawal_intents
                ORDER BY created_at ASC
                """
            )
            rows = cur.fetchall()
        return [
            WithdrawalIntentRow(
                id=str(row_id),
                ownerAddress=str(owner),
                txHash=tx_hash,
                status=str(status),
                requestId=request_id,
                idempotencyKey=idempotency_key,
                amountUsdc=self._q6(amount_usdc),
                amountWei=amount_wei,
                feeWei=fee_wei,
                nonce=nonce,
                deadline=deadline,
                signature=signature,
                chainId=chain_id,
                contractAddress=contract_address,
                signerAddress=signer_address,
                createdAt=to_dt_str(created_at, "") or "",
                updatedAt=to_dt_str(updated_at, "") or "",
            )
            for (
                row_id,
                owner,
                tx_hash,
                status,
                request_id,
                idempotency_key,
                amount_usdc,
                amount_wei,
                fee_wei,
                nonce,
                deadline,
                signature,
                chain_id,
                contract_address,
                signer_address,
                created_at,
                updated_at,
            ) in rows
        ]

    def write_withdrawal_intents(
        self, rows: List[WithdrawalIntentRow], updated_at: str | int
    ) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_withdrawal_intents")
            for row in rows:
                cur.execute(
                    """
                    INSERT INTO synapse_withdrawal_intents (
                        id, owner_address, tx_hash, status, request_id, idempotency_key,
                        amount_usdc, amount_wei, fee_wei, nonce, deadline, signature,
                        chain_id, contract_address, signer_address, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s::synapse_withdraw_status, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id)
                    DO UPDATE SET
                        owner_address = EXCLUDED.owner_address,
                        tx_hash = EXCLUDED.tx_hash,
                        status = EXCLUDED.status,
                        request_id = EXCLUDED.request_id,
                        idempotency_key = EXCLUDED.idempotency_key,
                        amount_usdc = EXCLUDED.amount_usdc,
                        amount_wei = EXCLUDED.amount_wei,
                        fee_wei = EXCLUDED.fee_wei,
                        nonce = EXCLUDED.nonce,
                        deadline = EXCLUDED.deadline,
                        signature = EXCLUDED.signature,
                        chain_id = EXCLUDED.chain_id,
                        contract_address = EXCLUDED.contract_address,
                        signer_address = EXCLUDED.signer_address,
                        created_at = EXCLUDED.created_at,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        row.id,
                        row.owner_address.lower(),
                        row.tx_hash.lower() if row.tx_hash else None,
                        row.status,
                        row.request_id,
                        row.idempotency_key,
                        str(self._q6(row.amount_usdc)),
                        row.amount_wei,
                        row.fee_wei,
                        row.nonce,
                        row.deadline,
                        row.signature,
                        row.chain_id,
                        row.contract_address,
                        row.signer_address,
                        to_dt_str(row.created_at or updated_at, now_dt_str()),
                        to_dt_str(row.updated_at or updated_at, now_dt_str()),
                    ),
                )

    def read_router_config_rows(self) -> List[RouterConfigRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT owner_address, daily_limit_usdc, created_at, updated_at FROM synapse_router_config ORDER BY updated_at DESC"
            )
            rows = cur.fetchall()
        return [
            RouterConfigRow(
                ownerAddress=str(owner),
                dailyLimitUsdc=float(self._q6(limit)),
                createdAt=to_dt_str(created, "") or "",
                updatedAt=to_dt_str(updated, "") or "",
            )
            for owner, limit, created, updated in rows
        ]

    def write_router_config_rows(
        self, rows: List[RouterConfigRow], updated_at: str | int
    ) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_router_config")
            for row in rows:
                owner = row.owner_address.lower()
                if not owner:
                    continue
                cur.execute(
                    "INSERT INTO synapse_router_config (owner_address, daily_limit_usdc, created_at, updated_at) VALUES (%s, %s, %s, %s)",
                    (
                        owner,
                        str(self._q6(row.daily_limit_usdc)),
                        to_dt_str(row.created_at or updated_at, now_dt_str()),
                        to_dt_str(row.updated_at or updated_at, now_dt_str()),
                    ),
                )

    def read_usage_log_rows(self) -> List[UsageLogRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT id, ts, request_id, service_id, buyer_address, seller_address,
                       status, unit_price, protocol_fee, routing_tax, total_charge,
                       business_type, risk_level
                FROM synapse_usage_log
                ORDER BY ts DESC
                """
            )
            rows = cur.fetchall()
        return [
            UsageLogRow(
                id=str(row_id),
                ts=int(ts),
                requestId=request_id,
                serviceId=service_id,
                buyerAddress=buyer,
                sellerAddress=seller,
                status=status,
                unitPrice=self._q6(unit_price) if unit_price is not None else None,
                protocolFee=self._q6(protocol_fee)
                if protocol_fee is not None
                else None,
                routingTax=self._q6(routing_tax) if routing_tax is not None else None,
                totalCharge=self._q6(total_charge)
                if total_charge is not None
                else None,
                businessType=str(business_type or "charge"),
                riskLevel=str(risk_level or "green"),
            )
            for (
                row_id,
                ts,
                request_id,
                service_id,
                buyer,
                seller,
                status,
                unit_price,
                protocol_fee,
                routing_tax,
                total_charge,
                business_type,
                risk_level,
            ) in rows
        ]

    def write_usage_log_rows(self, rows: List[UsageLogRow]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_usage_log")
            for row in rows:
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
                        row.buyer_address.lower() if row.buyer_address else None,
                        row.seller_address.lower() if row.seller_address else None,
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

    def read_processed_deposit_event_keys(self) -> List[str]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT dedup_key FROM synapse_processed_deposit_events ORDER BY updated_at DESC"
            )
            rows = cur.fetchall()
        return [str(row[0]) for row in rows if row and row[0] is not None]

    def write_processed_deposit_event_keys(
        self, keys: List[str], updated_at: str | int
    ) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_processed_deposit_events")
            for key in keys:
                dedup_key = str(key or "").strip()
                if not dedup_key:
                    continue
                entity = ProcessedDepositEventRow(
                    dedupKey=dedup_key,
                    updatedAt=to_dt_str(updated_at, now_dt_str()) or now_dt_str(),
                )
                cur.execute(
                    "INSERT INTO synapse_processed_deposit_events (dedup_key, updated_at) VALUES (%s, %s)",
                    (entity.dedup_key, entity.updated_at),
                )

    def read_runtime_state(self, state_key: str) -> dict[str, Any]:
        entity = self.read_runtime_state_row(state_key)
        return entity.payload if entity is not None else {}

    def read_runtime_state_row(self, state_key: str) -> RuntimeStateRow | None:
        key = str(state_key or "").strip()
        if not key:
            return None
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT state_key, payload, updated_at FROM synapse_runtime_state WHERE state_key = %s",
                (key,),
            )
            row = cur.fetchone()
        if not row:
            return None
        payload = row[1]
        return RuntimeStateRow(
            stateKey=str(row[0] or key),
            payload=dict(payload) if isinstance(payload, dict) else {},
            updatedAt=to_dt_str(row[2], "") or "",
        )

    def write_runtime_state(self, state_key: str, payload: dict[str, Any]) -> None:
        entity = RuntimeStateRow(
            stateKey=str(state_key or "").strip(),
            payload=dict(payload or {}),
            updatedAt=now_dt_str(),
        )
        self.write_runtime_state_row(entity)

    def write_runtime_state_row(self, row: RuntimeStateRow) -> None:
        if not row.state_key:
            return
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (state_key)
                DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
                """,
                (row.state_key, json.dumps(row.payload, ensure_ascii=False)),
            )
