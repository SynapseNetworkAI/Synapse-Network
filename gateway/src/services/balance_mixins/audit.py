import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional
from uuid import uuid4

from src.core.common import normalize_wallet
from src.domain.audit import AuditLogEntry

logger = logging.getLogger(__name__)


class BalanceAuditMixin:
    def _append_financial_audit(
        self, action: str, owner_wallet: str, details: Dict[str, Any]
    ) -> None:
        entry = AuditLogEntry(
            id=str(uuid4()),
            timestamp=int(time.time()),
            action=action,
            owner_address=normalize_wallet(owner_wallet),
            details=details,
        )
        self.storage.get_data_manager().audit.logs.append_audit_row(entry)
        if action in {
            "FINANCE_RATE_LIMIT_HIT",
            "DEPOSIT_REPLAY_DETECTED",
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        }:
            logger.warning(
                "finance_anomaly action=%s owner=%s details=%s",
                action,
                normalize_wallet(owner_wallet),
                details,
            )

    def _finance_audit_actions(self) -> set[str]:
        return {
            "DEPOSIT_INTENT_REGISTERED",
            "REFUND_INTENT_CREATED",
            "PROVIDER_WITHDRAW_INTENT_CREATED",
            "PROVIDER_WITHDRAW_COMPLETED",
            "PROVIDER_WITHDRAW_CANCELLED",
            "ROUTER_CONFIG_UPDATED",
            "FINANCE_RATE_LIMIT_HIT",
            "DEPOSIT_REPLAY_DETECTED",
            "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        }

    async def list_finance_audit_logs(
        self, owner_wallet: str, limit: int
    ) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(
            self._list_finance_audit_logs_sync, owner_wallet, limit
        )

    def _read_audit_rows_from_storage(
        self, owner: str, limit: int
    ) -> Optional[List[Dict[str, Any]]]:
        try:
            rows = self.storage.get_data_manager().audit.logs.read_audit_rows(
                owner_wallet=owner, limit=max(1, min(limit, 500))
            )
            return [
                row.model_dump(by_alias=True) if isinstance(row, AuditLogEntry) else row
                for row in rows
            ]
        except Exception:
            return None

    def _read_audit_rows_from_jsonl(self, owner: str) -> List[Dict[str, Any]]:
        if not hasattr(self.storage, "directory"):
            return []

        import os

        path = os.path.join(getattr(self.storage, "directory"), "audit_log.jsonl")
        if not os.path.exists(path):
            return []

        rows: List[Dict[str, Any]] = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                raw = line.strip()
                if not raw:
                    continue
                try:
                    row = json.loads(raw)
                except Exception:
                    continue
                if normalize_wallet(str(row.get("ownerAddress") or "")) != owner:
                    continue
                rows.append(row)
        return rows

    def _list_finance_audit_logs_sync(
        self, owner_wallet: str, limit: int
    ) -> List[Dict[str, Any]]:
        owner = normalize_wallet(owner_wallet)
        allowed_actions = self._finance_audit_actions()

        rows = self._read_audit_rows_from_storage(owner, limit)
        if rows is None:
            rows = self._read_audit_rows_from_jsonl(owner)

        rows = [row for row in rows if str(row.get("action") or "") in allowed_actions]

        rows.sort(key=lambda item: int(item.get("timestamp") or 0), reverse=True)
        return rows[: max(1, min(limit, 500))]
