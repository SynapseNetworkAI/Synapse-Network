"""Gateway state repository — typed invocation billing read/write paths."""
from __future__ import annotations

from typing import List

from src.domain.finance import UsageLogRow
from src.utils.datetime_utils import now_dt_str


class GatewayStateBillingMixin:
    """Read/write invocation billing through the typed billing table first."""

    def read_invocation_billing_rows(self) -> List[UsageLogRow]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    inv.invocation_id,
                    inv.agent_id,
                    inv.idempotency_key,
                    inv.service_id,
                    inv.status,
                    inv.charged_usdc,
                    inv.started_at,
                    inv.finished_at,
                    inv.created_at,
                    COALESCE(billing.payload, rs.payload) AS payload
                FROM synapse_invocations inv
                LEFT JOIN synapse_invocation_billing billing
                  ON billing.invocation_id = inv.invocation_id
                LEFT JOIN synapse_runtime_state rs
                  ON rs.state_key = CONCAT('invocation_billing::', inv.invocation_id)
                WHERE inv.charged_usdc IS NOT NULL
                   OR billing.invocation_id IS NOT NULL
                   OR rs.state_key IS NOT NULL
                ORDER BY inv.created_at DESC
                """
            )
            rows = cur.fetchall()
        return [self._project_usage_log_row(*row) for row in rows]

    def write_invocation_billing_rows(self, rows: List[UsageLogRow]) -> None:
        with self._db.tx_cursor() as cur:
            for row in rows:
                invocation_id = str(row.id or "").strip()
                if not invocation_id:
                    continue
                state = self._build_invocation_billing_state(row)
                updated_at = now_dt_str()
                self._upsert_invocation_billing(cur, invocation_id, state, updated_at)
                self._upsert_runtime_state(
                    cur,
                    self._invocation_billing_state_key(invocation_id),
                    state.model_dump(by_alias=True, mode="json"),
                    updated_at,
                )
