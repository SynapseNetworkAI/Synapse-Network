from __future__ import annotations

import json
from typing import Any, List, Optional
from uuid import uuid4

from src.domain.audit import AuditLogEntry
from src.domain.audit import AuditLogRow, SystemAuditLogRow

from ..database_manager import DatabaseManager


class AuditLogRepository:
    def __init__(self, db: DatabaseManager, audit_insert_sql: str):
        self._db = db
        _ = audit_insert_sql

    @staticmethod
    def _str_detail(details: dict, key: str) -> Optional[str]:
        value = details.get(key)
        return value if isinstance(value, str) else None

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

    @staticmethod
    def _event_id(prefix: str) -> str:
        return f"{prefix}-{uuid4().hex}"

    def _build_system_row(self, entry: AuditLogEntry) -> SystemAuditLogRow:
        details = entry.details if isinstance(entry.details, dict) else {}
        return SystemAuditLogRow(
            actionType=entry.action,
            ownerAddress=entry.owner_address,
            actor=self._str_detail(details, "actor"),
            requestId=self._str_detail(details, "requestId"),
            traceId=self._str_detail(details, "traceId"),
            resourceType=self._str_detail(details, "resourceType"),
            resourceId=self._str_detail(details, "resourceId"),
            resultStatus=self._str_detail(details, "resultStatus"),
            errorCode=self._str_detail(details, "errorCode"),
            ipAddress=self._str_detail(details, "clientIp"),
            userAgent=self._str_detail(details, "userAgent"),
            detailJson=details,
        )

    def _build_finance_row(self, entry: AuditLogEntry) -> AuditLogRow:
        details = entry.details if isinstance(entry.details, dict) else {}
        return AuditLogRow(
            actionType=entry.action,
            ownerAddress=entry.owner_address,
            message=self._str_detail(details, "message"),
            requestId=self._str_detail(details, "requestId"),
            traceId=self._str_detail(details, "traceId"),
            txHash=self._str_detail(details, "txHash"),
            counterpartyAddress=self._str_detail(details, "counterpartyAddress"),
            direction=self._str_detail(details, "direction"),
            status=self._str_detail(details, "status"),
            riskReasonCode=self._str_detail(details, "riskReasonCode"),
            ledgerId=self._str_detail(details, "ledgerId"),
            clientIp=self._str_detail(details, "clientIp"),
            userAgent=self._str_detail(details, "userAgent"),
            amountDelta=details.get("deltaAmount"),
            beforeBalance=details.get("beforeBalance"),
            afterBalance=details.get("afterBalance"),
            resultStatus=self._str_detail(details, "resultStatus"),
            errorCode=self._str_detail(details, "errorCode"),
            businessType=self._str_detail(details, "businessType") or "charge",
            riskLevel=self._str_detail(details, "riskLevel") or "green",
        )

    def append_audit_row(self, entry: AuditLogEntry) -> None:
        if entry.domain == "system":
            self.append_system_audit_log(self._build_system_row(entry))
            return
        self.append_audit_log(self._build_finance_row(entry))

    def append_audit_log(self, row: AuditLogRow) -> None:
        detail_json = {
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
        with self._db.tx_cursor() as cur:
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
                    json.dumps(detail_json),
                ),
            )

    def append_system_audit_log(self, row: SystemAuditLogRow) -> None:
        detail_json = dict(row.detail_json or {})
        detail_json.setdefault("domain", "system")
        detail_json.setdefault("actor", row.actor)
        detail_json.setdefault("requestId", row.request_id)
        detail_json.setdefault("traceId", row.trace_id)
        detail_json.setdefault("resourceType", row.resource_type)
        detail_json.setdefault("resourceId", row.resource_id)
        detail_json.setdefault("resultStatus", row.result_status)
        detail_json.setdefault("errorCode", row.error_code)
        detail_json.setdefault("clientIp", row.ip_address)
        detail_json.setdefault("userAgent", row.user_agent)
        detail_json.setdefault("ownerAddress", row.owner_address)
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_audit_events (
                    event_id, event_type, business_type, owner_id,
                    result_status, error_code, detail_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    self._event_id("system"),
                    row.action_type,
                    "system",
                    row.owner_address,
                    row.result_status,
                    row.error_code,
                    json.dumps(detail_json),
                ),
            )

    def append_to_audit_collection(self, item: AuditLogEntry) -> None:
        if isinstance(item, AuditLogEntry):
            self.append_audit_row(item)

    def replace_audit_collection(self, rows: List[AuditLogEntry]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_audit_events WHERE business_type <> 'system'")
        for row in rows:
            if isinstance(row, AuditLogEntry):
                self.append_audit_row(row)

    def read_audit_rows(
        self, owner_wallet: Optional[str] = None, limit: int = 200
    ) -> List[AuditLogEntry]:
        sql = (
            "SELECT event_id, event_type, business_type, owner_id, amount_delta, result_status, error_code, detail_json, "
            "extract(epoch from created_at)::bigint "
            "FROM synapse_audit_events WHERE business_type <> 'system'"
        )
        params: List[object] = []

        if owner_wallet:
            sql += " AND lower(owner_id) = lower(%s)"
            params.append(owner_wallet)

        sql += " ORDER BY created_at DESC LIMIT %s"
        params.append(max(1, min(limit, 1000)))

        with self._db.readonly_cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        result: List[AuditLogEntry] = []
        for (
            row_id,
            action_type,
            business_type,
            owner_address,
            amount_delta,
            result_status,
            error_code,
            detail_json,
            created_at,
        ) in rows:
            details = self._payload_dict(detail_json)
            details.setdefault("businessType", str(business_type or "charge"))
            details.setdefault("ownerAddress", str(owner_address or ""))
            details.setdefault(
                "deltaAmount", float(amount_delta) if amount_delta is not None else 0.0
            )
            details.setdefault("resultStatus", result_status)
            details.setdefault("errorCode", error_code)
            result.append(
                AuditLogEntry(
                    id=str(row_id or ""),
                    timestamp=int(created_at or 0),
                    action=str(action_type or ""),
                    domain="finance",
                    ownerAddress=str(owner_address or ""),
                    details=details,
                )
            )
        return result

    def read_system_audit_rows(
        self, owner_wallet: Optional[str] = None, limit: int = 200
    ) -> List[AuditLogEntry]:
        sql = (
            "SELECT event_id, event_type, owner_id, result_status, error_code, detail_json, "
            "extract(epoch from created_at)::bigint "
            "FROM synapse_audit_events WHERE business_type = 'system'"
        )
        params: List[object] = []

        if owner_wallet:
            sql += " AND lower(owner_id) = lower(%s)"
            params.append(owner_wallet)

        sql += " ORDER BY created_at DESC LIMIT %s"
        params.append(max(1, min(limit, 1000)))

        with self._db.readonly_cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        result: List[AuditLogEntry] = []
        for (
            row_id,
            action_type,
            owner_address,
            result_status,
            error_code,
            detail_json,
            created_at,
        ) in rows:
            details = self._payload_dict(detail_json)
            details.setdefault("domain", "system")
            details.setdefault("resultStatus", result_status)
            details.setdefault("errorCode", error_code)
            details.setdefault("ownerAddress", str(owner_address or ""))
            result.append(
                AuditLogEntry(
                    id=str(row_id or ""),
                    timestamp=int(created_at or 0),
                    action=str(action_type or ""),
                    domain="system",
                    ownerAddress=str(owner_address or ""),
                    details=details,
                )
            )
        return result
