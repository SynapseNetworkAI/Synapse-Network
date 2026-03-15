from __future__ import annotations

from typing import List, Optional

from src.domain.audit import AuditLogEntry
from src.domain.storage_entities import AuditLogRow

from ..database_manager import DatabaseManager


class AuditLogRepository:
    def __init__(self, db: DatabaseManager, audit_insert_sql: str):
        self._db = db
        _ = audit_insert_sql

    def append_audit_row(self, entry: AuditLogEntry) -> None:
        row = AuditLogRow(
            actionType=entry.action,
            ownerAddress=entry.owner_address,
            message=entry.details.get("message") if isinstance(entry.details.get("message"), str) else None,
            requestId=entry.details.get("requestId") if isinstance(entry.details.get("requestId"), str) else None,
            txHash=entry.details.get("txHash") if isinstance(entry.details.get("txHash"), str) else None,
            amountDelta=entry.details.get("deltaAmount"),
            beforeBalance=entry.details.get("beforeBalance"),
            afterBalance=entry.details.get("afterBalance"),
            resultStatus=entry.details.get("resultStatus") if isinstance(entry.details.get("resultStatus"), str) else None,
            errorCode=entry.details.get("errorCode") if isinstance(entry.details.get("errorCode"), str) else None,
            businessType=entry.details.get("businessType") if isinstance(entry.details.get("businessType"), str) else "charge",
            riskLevel=entry.details.get("riskLevel") if isinstance(entry.details.get("riskLevel"), str) else "green",
        )
        self.append_audit_log(row)

    def append_audit_log(self, row: AuditLogRow) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_audit_log (
                    action_type, business_type, risk_level, owner_address, actor,
                    request_id, tx_hash, amount_delta, before_balance, after_balance,
                    result_status, error_code, message
                ) VALUES (%s, %s::synapse_business_type, %s::synapse_risk_level, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    row.action_type,
                    row.business_type,
                    row.risk_level,
                    row.owner_address,
                    row.actor,
                    row.request_id,
                    row.tx_hash,
                    str(row.amount_delta) if row.amount_delta is not None else None,
                    str(row.before_balance) if row.before_balance is not None else None,
                    str(row.after_balance) if row.after_balance is not None else None,
                    row.result_status,
                    row.error_code,
                    row.message,
                ),
            )

    def append_to_audit_collection(self, item: AuditLogEntry) -> None:
        if isinstance(item, AuditLogEntry):
            self.append_audit_row(item)

    def replace_audit_collection(self, rows: List[AuditLogEntry]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_audit_log")
        for row in rows:
            if isinstance(row, AuditLogEntry):
                self.append_audit_row(row)

    def read_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[AuditLogEntry]:
        sql = (
            "SELECT id, action_type, business_type, risk_level, owner_address, actor, request_id, tx_hash, "
            "amount_delta, before_balance, after_balance, result_status, error_code, message, "
            "extract(epoch from created_at)::bigint "
            "FROM synapse_audit_log"
        )
        params: List[object] = []

        if owner_wallet:
            sql += " WHERE lower(owner_address) = lower(%s)"
            params.append(owner_wallet)

        sql += " ORDER BY id DESC LIMIT %s"
        params.append(max(1, min(limit, 1000)))

        with self._db.readonly_cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        result: List[AuditLogEntry] = []
        for (
            row_id,
            action_type,
            business_type,
            risk_level,
            owner_address,
            actor,
            request_id,
            tx_hash,
            amount_delta,
            before_balance,
            after_balance,
            result_status,
            error_code,
            message,
            created_at,
        ) in rows:
            details = {
                "businessType": str(business_type or "charge"),
                "riskLevel": str(risk_level or "green"),
                "actor": actor,
                "requestId": request_id,
                "txHash": tx_hash,
                "deltaAmount": float(amount_delta) if amount_delta is not None else 0.0,
                "beforeBalance": float(before_balance) if before_balance is not None else None,
                "afterBalance": float(after_balance) if after_balance is not None else None,
                "resultStatus": result_status,
                "errorCode": error_code,
                "message": message,
            }
            result.append(
                AuditLogEntry(
                    id=str(row_id or ""),
                    timestamp=int(created_at or 0),
                    action=str(action_type or ""),
                    ownerAddress=str(owner_address or ""),
                    details=details,
                )
            )
        return result
