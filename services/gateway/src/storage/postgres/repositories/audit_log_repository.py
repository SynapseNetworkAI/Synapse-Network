from __future__ import annotations

import json
from typing import Any, List, Optional
from uuid import uuid4

from src.core.common import normalize_wallet
from src.domain.audit import AuditLogEntry
from src.domain.audit import AuditLogRow, SystemAuditLogRow

from ..database_manager import DatabaseManager


class AuditLogRepository:
    _ANOMALY_ACTIONS = {
        "FINANCE_RATE_LIMIT_HIT",
        "DEPOSIT_REPLAY_DETECTED",
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
    }

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

    @staticmethod
    def _owner_id(wallet: str) -> str:
        normalized = normalize_wallet(wallet)
        return f"owner:{normalized}" if normalized else ""

    @classmethod
    def _owner_id_candidates(cls, wallet: str) -> list[str]:
        normalized = normalize_wallet(wallet)
        if not normalized:
            return []
        return [cls._owner_id(normalized), normalized]

    @staticmethod
    def _owner_address_from_row(owner_id: Any, details: dict[str, Any]) -> str:
        detail_owner = normalize_wallet(str(details.get("ownerAddress") or ""))
        if detail_owner:
            return detail_owner
        raw_owner = str(owner_id or "")
        if raw_owner.startswith("owner:"):
            return normalize_wallet(raw_owner.split(":", 1)[1])
        return normalize_wallet(raw_owner)

    def _build_system_row(self, entry: AuditLogEntry) -> SystemAuditLogRow:
        details = entry.details if isinstance(entry.details, dict) else {}
        return SystemAuditLogRow(
            actionType=entry.action,
            ownerAddress=entry.owner_address,
            agentId=self._str_detail(details, "agentId"),
            credentialId=self._str_detail(details, "credentialId"),
            serviceId=self._str_detail(details, "serviceId"),
            quoteId=self._str_detail(details, "quoteId"),
            invocationId=self._str_detail(details, "invocationId"),
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
        default_business_type = "anomaly" if entry.action in self._ANOMALY_ACTIONS else "charge"
        return AuditLogRow(
            actionType=entry.action,
            ownerAddress=entry.owner_address,
            agentId=self._str_detail(details, "agentId"),
            credentialId=self._str_detail(details, "credentialId"),
            serviceId=self._str_detail(details, "serviceId"),
            quoteId=self._str_detail(details, "quoteId"),
            invocationId=self._str_detail(details, "invocationId"),
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
            businessType=self._str_detail(details, "businessType") or default_business_type,
            riskLevel=self._str_detail(details, "riskLevel") or "green",
            detailJson=details,
        )

    def append_audit_row(self, entry: AuditLogEntry) -> None:
        if entry.domain == "system":
            self.append_system_audit_log(self._build_system_row(entry))
            return
        if self._should_skip_finance_entry(entry):
            return
        self.append_audit_log(self._build_finance_row(entry))

    def _has_existing_deposit_intent_registered_audit(
        self, owner_wallet: str, tx_hash: str
    ) -> bool:
        owner_id = self._owner_id(owner_wallet)
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT 1
                FROM synapse_audit_events
                WHERE event_type = %s
                  AND lower(owner_id) = lower(%s)
                  AND lower(detail_json->>'txHash') = lower(%s)
                LIMIT 1
                """,
                ("DEPOSIT_INTENT_REGISTERED", owner_id, tx_hash),
            )
            return cur.fetchone() is not None

    def _has_existing_rate_limit_audit(
        self,
        owner_wallet: str,
        action: str,
        backend: str,
        bucket: str,
    ) -> bool:
        owner_id = self._owner_id(owner_wallet)
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT 1
                FROM synapse_audit_events
                WHERE event_type = %s
                  AND lower(owner_id) = lower(%s)
                  AND coalesce(detail_json->>'action', '') = %s
                  AND coalesce(detail_json->>'backend', '') = %s
                  AND coalesce(detail_json->>'rateLimitBucket', '') = %s
                LIMIT 1
                """,
                ("FINANCE_RATE_LIMIT_HIT", owner_id, action, backend, bucket),
            )
            return cur.fetchone() is not None

    def _extract_rate_limit_bucket(self, details: dict[str, Any]) -> str:
        bucket = self._str_detail(details, "rateLimitBucket")
        if bucket:
            return bucket

        raw_bucket = details.get("windowBucket")
        if raw_bucket is not None:
            bucket = str(raw_bucket)
        else:
            raw_start = details.get("windowStart")
            if raw_start is None:
                bucket = ""
            else:
                try:
                    bucket = str(int(raw_start) // 60)
                except Exception:
                    bucket = str(raw_start)

        if bucket:
            details["rateLimitBucket"] = bucket
        return bucket

    def _should_skip_deposit_registered_audit(
        self, owner_wallet: str, details: dict[str, Any]
    ) -> bool:
        tx_hash = self._str_detail(details, "txHash")
        if not tx_hash:
            return False
        return self._has_existing_deposit_intent_registered_audit(owner_wallet, tx_hash)

    def _should_skip_rate_limit_audit(
        self, owner_wallet: str, details: dict[str, Any]
    ) -> bool:
        action = self._str_detail(details, "action") or ""
        backend = self._str_detail(details, "backend") or ""
        bucket = self._extract_rate_limit_bucket(details)
        if not (action and backend and bucket):
            return False
        return self._has_existing_rate_limit_audit(owner_wallet, action, backend, bucket)

    def _should_skip_finance_entry(self, entry: AuditLogEntry) -> bool:
        details = entry.details if isinstance(entry.details, dict) else {}
        if entry.action == "DEPOSIT_INTENT_REGISTERED":
            return self._should_skip_deposit_registered_audit(
                entry.owner_address, details
            )

        if entry.action == "FINANCE_RATE_LIMIT_HIT":
            return self._should_skip_rate_limit_audit(entry.owner_address, details)
        return False

    def append_audit_log(self, row: AuditLogRow) -> None:
        detail_json = dict(row.detail_json or {})
        detail_json.setdefault("domain", "finance")
        detail_json.setdefault("businessType", row.business_type)
        detail_json.setdefault("riskLevel", row.risk_level)
        detail_json.setdefault("actor", row.actor)
        detail_json.setdefault("requestId", row.request_id)
        detail_json.setdefault("traceId", row.trace_id)
        detail_json.setdefault("txHash", row.tx_hash)
        detail_json.setdefault("counterpartyAddress", row.counterparty_address)
        detail_json.setdefault("direction", row.direction)
        detail_json.setdefault("status", row.status)
        detail_json.setdefault("riskReasonCode", row.risk_reason_code)
        detail_json.setdefault("ledgerId", row.ledger_id)
        detail_json.setdefault("clientIp", row.client_ip)
        detail_json.setdefault("userAgent", row.user_agent)
        detail_json.setdefault(
            "beforeBalance",
            str(row.before_balance) if row.before_balance is not None else None,
        )
        detail_json.setdefault(
            "afterBalance",
            str(row.after_balance) if row.after_balance is not None else None,
        )
        detail_json.setdefault("message", row.message)
        detail_json.setdefault("ownerAddress", row.owner_address)
        detail_json.setdefault("agentId", row.agent_id)
        detail_json.setdefault("credentialId", row.credential_id)
        detail_json.setdefault("serviceId", row.service_id)
        detail_json.setdefault("quoteId", row.quote_id)
        detail_json.setdefault("invocationId", row.invocation_id)
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_audit_events (
                    event_id, event_type, business_type, owner_id,
                    agent_id, credential_id, service_id, quote_id, invocation_id,
                    amount_delta, result_status, error_code, detail_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    self._event_id("audit"),
                    row.action_type,
                    row.business_type,
                    self._owner_id(row.owner_address),
                    row.agent_id,
                    row.credential_id,
                    row.service_id,
                    row.quote_id,
                    row.invocation_id,
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
        detail_json.setdefault("agentId", row.agent_id)
        detail_json.setdefault("credentialId", row.credential_id)
        detail_json.setdefault("serviceId", row.service_id)
        detail_json.setdefault("quoteId", row.quote_id)
        detail_json.setdefault("invocationId", row.invocation_id)
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_audit_events (
                    event_id, event_type, business_type, owner_id,
                    agent_id, credential_id, service_id, quote_id, invocation_id,
                    result_status, error_code, detail_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    self._event_id("system"),
                    row.action_type,
                    "system",
                    self._owner_id(row.owner_address),
                    row.agent_id,
                    row.credential_id,
                    row.service_id,
                    row.quote_id,
                    row.invocation_id,
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
            owner_candidates = self._owner_id_candidates(owner_wallet)
            if owner_candidates:
                sql += " AND (lower(owner_id) = lower(%s) OR lower(owner_id) = lower(%s))"
                params.extend(owner_candidates)

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
            resolved_owner = self._owner_address_from_row(owner_address, details)
            details.setdefault("businessType", str(business_type or "charge"))
            details.setdefault("ownerAddress", resolved_owner)
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
                    ownerAddress=resolved_owner,
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
            owner_candidates = self._owner_id_candidates(owner_wallet)
            if owner_candidates:
                sql += " AND (lower(owner_id) = lower(%s) OR lower(owner_id) = lower(%s))"
                params.extend(owner_candidates)

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
            resolved_owner = self._owner_address_from_row(owner_address, details)
            details.setdefault("domain", "system")
            details.setdefault("resultStatus", result_status)
            details.setdefault("errorCode", error_code)
            details.setdefault("ownerAddress", resolved_owner)
            result.append(
                AuditLogEntry(
                    id=str(row_id or ""),
                    timestamp=int(created_at or 0),
                    action=str(action_type or ""),
                    domain="system",
                    ownerAddress=resolved_owner,
                    details=details,
                )
            )
        return result
