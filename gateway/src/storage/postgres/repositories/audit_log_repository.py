from __future__ import annotations

import json
from typing import List, Optional

from src.domain.audit import AuditLogEntry
from src.domain.storage_entities import AuditLogRow, SystemAuditLogRow

from ..database_manager import DatabaseManager


class AuditLogRepository:
    def __init__(self, db: DatabaseManager, audit_insert_sql: str):
        self._db = db
        _ = audit_insert_sql

    @staticmethod
    def _str_detail(details: dict, key: str) -> Optional[str]:
        value = details.get(key)
        return value if isinstance(value, str) else None

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
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_audit_log (
                    action_type, business_type, risk_level, owner_address, actor,
                    request_id, trace_id, tx_hash, counterparty_address, direction, status,
                    risk_reason_code, ledger_id, client_ip, user_agent,
                    amount_delta, before_balance, after_balance, result_status, error_code, message
                ) VALUES (
                    %s, %s::synapse_business_type, %s::synapse_risk_level, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    row.action_type,
                    row.business_type,
                    row.risk_level,
                    row.owner_address,
                    row.actor,
                    row.request_id,
                    row.trace_id,
                    row.tx_hash,
                    row.counterparty_address,
                    row.direction,
                    row.status,
                    row.risk_reason_code,
                    row.ledger_id,
                    row.client_ip,
                    row.user_agent,
                    str(row.amount_delta) if row.amount_delta is not None else None,
                    str(row.before_balance) if row.before_balance is not None else None,
                    str(row.after_balance) if row.after_balance is not None else None,
                    row.result_status,
                    row.error_code,
                    row.message,
                ),
            )

    def append_system_audit_log(self, row: SystemAuditLogRow) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_system_activity_log (
                    action_type, owner_address, actor, request_id, trace_id,
                    resource_type, resource_id, result_status, error_code,
                    ip_address, user_agent, detail_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    row.action_type,
                    row.owner_address,
                    row.actor,
                    row.request_id,
                    row.trace_id,
                    row.resource_type,
                    row.resource_id,
                    row.result_status,
                    row.error_code,
                    row.ip_address,
                    row.user_agent,
                    json.dumps(row.detail_json or {}),
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
            "trace_id, counterparty_address, direction, status, risk_reason_code, ledger_id, client_ip, user_agent, "
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
            trace_id,
            counterparty_address,
            direction,
            status,
            risk_reason_code,
            ledger_id,
            client_ip,
            user_agent,
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
                "traceId": trace_id,
                "txHash": tx_hash,
                "counterpartyAddress": counterparty_address,
                "direction": direction,
                "status": status,
                "riskReasonCode": risk_reason_code,
                "ledgerId": ledger_id,
                "clientIp": client_ip,
                "userAgent": user_agent,
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
                    domain="finance",
                    ownerAddress=str(owner_address or ""),
                    details=details,
                )
            )
        return result

    def read_system_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[AuditLogEntry]:
        sql = (
            "SELECT id, action_type, owner_address, actor, request_id, trace_id, "
            "resource_type, resource_id, result_status, error_code, ip_address, user_agent, detail_json, "
            "extract(epoch from created_at)::bigint "
            "FROM synapse_system_activity_log"
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
            owner_address,
            actor,
            request_id,
            trace_id,
            resource_type,
            resource_id,
            result_status,
            error_code,
            ip_address,
            user_agent,
            detail_json,
            created_at,
        ) in rows:
            details = detail_json if isinstance(detail_json, dict) else {}
            details.setdefault("actor", actor)
            details.setdefault("requestId", request_id)
            details.setdefault("traceId", trace_id)
            details.setdefault("resourceType", resource_type)
            details.setdefault("resourceId", resource_id)
            details.setdefault("resultStatus", result_status)
            details.setdefault("errorCode", error_code)
            details.setdefault("clientIp", ip_address)
            details.setdefault("userAgent", user_agent)
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
