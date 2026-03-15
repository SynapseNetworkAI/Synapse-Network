from __future__ import annotations

import json
import time
from typing import Any, Callable, Dict, List

from src.domain.gateway import RouterConfigRow

from ..database_manager import DatabaseManager


class GatewayStateRepository:
    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6

    def _replace_table_with_payload(self, table_name: str, rows: List[Dict[str, Any]], id_sql: str, value_sql_builder) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute(f"DELETE FROM {table_name}")
            for row in rows:
                if not isinstance(row, dict):
                    continue
                values = value_sql_builder(row)
                if values is None:
                    continue
                cur.execute(id_sql, values)

    def read_deposit_intents(self) -> List[Dict[str, Any]]:
        with self._db.readonly_cursor() as cur:
            cur.execute("SELECT payload FROM synapse_deposit_intents ORDER BY created_at ASC")
            rows = cur.fetchall()
        return [row[0] for row in rows if isinstance(row[0], dict)]

    def write_deposit_intents(self, rows: List[Dict[str, Any]]) -> None:
        self._replace_table_with_payload(
            "synapse_deposit_intents",
            rows,
            """
            INSERT INTO synapse_deposit_intents (id, owner_address, tx_hash, status, created_at, updated_at, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id)
            DO UPDATE SET owner_address = EXCLUDED.owner_address, tx_hash = EXCLUDED.tx_hash, status = EXCLUDED.status,
                          created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
            """,
            lambda row: (
                str(row.get("id") or ""),
                str(row.get("ownerAddress") or "").lower(),
                str(row.get("txHash") or "").lower(),
                str(row.get("status") or "PENDING_CONFIRMATION"),
                int(row.get("createdAt") or 0),
                int(row.get("updatedAt") or 0),
                json.dumps(row, ensure_ascii=False),
            ) if str(row.get("id") or "").strip() else None,
        )

    def read_refund_intents(self) -> List[Dict[str, Any]]:
        with self._db.readonly_cursor() as cur:
            cur.execute("SELECT payload FROM synapse_refund_intents ORDER BY created_at ASC")
            rows = cur.fetchall()
        return [row[0] for row in rows if isinstance(row[0], dict)]

    def write_refund_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._replace_table_with_payload(
            "synapse_refund_intents",
            rows,
            """
            INSERT INTO synapse_refund_intents (id, owner_address, tx_hash, status, amount_usdc, created_at, updated_at, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id)
            DO UPDATE SET owner_address = EXCLUDED.owner_address, tx_hash = EXCLUDED.tx_hash, status = EXCLUDED.status,
                          amount_usdc = EXCLUDED.amount_usdc, created_at = EXCLUDED.created_at,
                          updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
            """,
            lambda row: (
                str(row.get("id") or ""),
                str(row.get("ownerAddress") or "").lower(),
                str(row.get("txHash") or "").lower() or None,
                str(row.get("status") or "REQUESTED").upper(),
                str(self._q6(row.get("amountUsdc") or 0)),
                int(row.get("createdAt") or updated_at),
                int(row.get("updatedAt") or updated_at),
                json.dumps(row, ensure_ascii=False),
            ) if str(row.get("id") or "").strip() else None,
        )

    def read_withdrawal_intents(self) -> List[Dict[str, Any]]:
        with self._db.readonly_cursor() as cur:
            cur.execute("SELECT payload FROM synapse_withdrawal_intents ORDER BY created_at ASC")
            rows = cur.fetchall()
        return [row[0] for row in rows if isinstance(row[0], dict)]

    def write_withdrawal_intents(self, rows: List[Dict[str, Any]], updated_at: int) -> None:
        self._replace_table_with_payload(
            "synapse_withdrawal_intents",
            rows,
            """
            INSERT INTO synapse_withdrawal_intents (id, owner_address, tx_hash, status, amount_usdc, created_at, updated_at, payload)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id)
            DO UPDATE SET owner_address = EXCLUDED.owner_address, tx_hash = EXCLUDED.tx_hash, status = EXCLUDED.status,
                          amount_usdc = EXCLUDED.amount_usdc, created_at = EXCLUDED.created_at,
                          updated_at = EXCLUDED.updated_at, payload = EXCLUDED.payload
            """,
            lambda row: (
                str(row.get("id") or ""),
                str(row.get("ownerAddress") or "").lower(),
                str(row.get("txHash") or "").lower() or None,
                str(row.get("status") or "PENDING"),
                str(self._q6(row.get("amountUsdc") or 0)),
                int(row.get("createdAt") or updated_at),
                int(row.get("updatedAt") or updated_at),
                json.dumps(row, ensure_ascii=False),
            ) if str(row.get("id") or "").strip() else None,
        )

    def read_router_config_rows(self) -> List[RouterConfigRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute("SELECT owner_address, daily_limit_usdc, created_at, updated_at FROM synapse_router_config ORDER BY updated_at DESC")
            rows = cur.fetchall()
        return [
            RouterConfigRow(
                owner_address=str(owner),
                daily_limit_usdc=float(self._q6(limit)),
                created_at=int(created),
                updated_at=int(updated),
            )
            for owner, limit, created, updated in rows
        ]

    def write_router_config_rows(self, rows: List[RouterConfigRow], updated_at: int) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_router_config")
            for row in rows:
                owner = row.owner_address.lower() if isinstance(row, RouterConfigRow) else str(row.get("ownerAddress") or "").lower()
                if not owner:
                    continue
                limit = row.daily_limit_usdc if isinstance(row, RouterConfigRow) else row.get("dailyLimitUsdc", 0)
                created = row.created_at if isinstance(row, RouterConfigRow) else int(row.get("createdAt") or updated_at)
                updated = row.updated_at if isinstance(row, RouterConfigRow) else int(row.get("updatedAt") or updated_at)
                cur.execute(
                    "INSERT INTO synapse_router_config (owner_address, daily_limit_usdc, created_at, updated_at) VALUES (%s, %s, %s, %s)",
                    (owner, str(self._q6(limit)), int(created), int(updated)),
                )

    def read_usage_log_rows(self) -> List[Dict[str, Any]]:
        with self._db.readonly_cursor() as cur:
            cur.execute("SELECT payload FROM synapse_usage_log ORDER BY ts DESC")
            rows = cur.fetchall()
        return [row[0] for row in rows if isinstance(row[0], dict)]

    def write_usage_log_rows(self, rows: List[Dict[str, Any]]) -> None:
        self._replace_table_with_payload(
            "synapse_usage_log",
            rows,
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
            DO UPDATE SET ts = EXCLUDED.ts, buyer_address = EXCLUDED.buyer_address, seller_address = EXCLUDED.seller_address,
                          status = EXCLUDED.status, total_charge = EXCLUDED.total_charge,
                          business_type = EXCLUDED.business_type, risk_level = EXCLUDED.risk_level,
                          payload = EXCLUDED.payload
            """,
            lambda row: (
                str(row.get("id") or f"usage-{int(time.time())}"),
                int(row.get("timestamp") or int(time.time())),
                str(row.get("buyer") or "").lower() or None,
                str(row.get("seller") or "").lower() or None,
                str(row.get("status") or ""),
                str(self._q6(row.get("totalCharge") or 0)),
                str(row.get("businessType") or "charge").lower(),
                str(row.get("riskLevel") or "green").lower(),
                json.dumps(row, ensure_ascii=False),
            ),
        )

    def read_processed_deposit_event_keys(self) -> List[str]:
        with self._db.readonly_cursor() as cur:
            cur.execute("SELECT dedup_key FROM synapse_processed_deposit_events ORDER BY updated_at DESC")
            rows = cur.fetchall()
        return [str(row[0]) for row in rows if row and row[0] is not None]

    def write_processed_deposit_event_keys(self, keys: List[str], updated_at: int) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_processed_deposit_events")
            for key in keys:
                dedup_key = str(key or "").strip()
                if not dedup_key:
                    continue
                cur.execute("INSERT INTO synapse_processed_deposit_events (dedup_key, updated_at) VALUES (%s, %s)", (dedup_key, int(updated_at)))
