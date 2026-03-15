from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from src.domain.audit import AuditLogEntry

from ..database_manager import DatabaseManager


class AuditLogRepository:
    def __init__(self, db: DatabaseManager, audit_insert_sql: str):
        self._db = db
        self._audit_insert_sql = audit_insert_sql

    def append_audit_row(self, entry: AuditLogEntry) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute(self._audit_insert_sql, ("audit_log", json.dumps(entry.model_dump(by_alias=True), ensure_ascii=False)))

    def append_to_audit_collection(self, item: Any) -> None:
        if isinstance(item, AuditLogEntry):
            row = item.model_dump(by_alias=True)
        elif isinstance(item, dict):
            row = item
        else:
            row = {"raw": item}
        with self._db.tx_cursor() as cur:
            cur.execute(self._audit_insert_sql, ("audit_log", json.dumps(row, ensure_ascii=False)))

    def replace_audit_collection(self, rows: List[Dict[str, Any]]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_audit_log WHERE collection_name = %s", ("audit_log",))
            for row in rows:
                cur.execute(self._audit_insert_sql, ("audit_log", json.dumps(row, ensure_ascii=False)))

    def read_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[AuditLogEntry]:
        sql = "SELECT payload FROM synapse_audit_log WHERE collection_name = %s"
        params: List[Any] = ["audit_log"]

        if owner_wallet:
            sql += " AND lower(payload->>'ownerAddress') = lower(%s)"
            params.append(owner_wallet)

        sql += " ORDER BY id DESC LIMIT %s"
        params.append(max(1, min(limit, 1000)))

        with self._db.readonly_cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        result = [AuditLogEntry.model_validate(row[0]) for row in rows if isinstance(row[0], dict)]
        result.sort(key=lambda entry: entry.timestamp, reverse=True)
        return result
