from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from ..database_manager import DatabaseManager


class AuditLogRepository:
    def __init__(self, db: DatabaseManager, audit_insert_sql: str):
        self._db = db
        self._audit_insert_sql = audit_insert_sql

    def append_audit_row(self, row: Dict[str, Any]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute(self._audit_insert_sql, ("audit_log", json.dumps(row, ensure_ascii=False)))

    def append_to_audit_collection(self, item: Any) -> None:
        row = item if isinstance(item, dict) else {"raw": item}
        with self._db.tx_cursor() as cur:
            cur.execute(self._audit_insert_sql, ("audit_log", json.dumps(row, ensure_ascii=False)))

    def replace_audit_collection(self, rows: List[Dict[str, Any]]) -> None:
        with self._db.tx_cursor() as cur:
            cur.execute("DELETE FROM synapse_audit_log WHERE collection_name = %s", ("audit_log",))
            for row in rows:
                cur.execute(self._audit_insert_sql, ("audit_log", json.dumps(row, ensure_ascii=False)))

    def read_audit_rows(self, owner_wallet: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
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

        result = [row[0] for row in rows if isinstance(row[0], dict)]
        result.sort(key=lambda item: int(item.get("timestamp") or 0), reverse=True)
        return result
