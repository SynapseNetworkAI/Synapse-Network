from typing import Any, Dict, List

from src.core.common import normalize_wallet
from src.domain.finance import UsageLogRow
from src.storage.base import BaseStorage


class ProviderAnalyticsService:
    """Compute provider earnings and call analytics from persisted gateway settlement logs."""

    def __init__(self, storage: BaseStorage):
        self.storage = storage

    def _load_invocation_billings(self) -> List[UsageLogRow]:
        raw_rows = (
            self.storage.get_data_manager().system.gateway_state.read_invocation_billing_rows()
        )
        if not isinstance(raw_rows, list):
            return []
        rows: List[UsageLogRow] = []
        for row in raw_rows:
            if isinstance(row, UsageLogRow):
                rows.append(row)
            elif isinstance(row, dict):
                rows.append(UsageLogRow.model_validate(row))
        return rows

    def _load_provider_receivable(self, owner_wallet: str) -> float:
        ledger = self.storage.get_data_manager().finance.balance.read_balance_ledger()
        return ledger.provider_receivable_balance(owner_wallet)

    def _provider_rows(self, owner_wallet: str) -> List[UsageLogRow]:
        rows = self._load_invocation_billings()
        return [
            row
            for row in rows
            if normalize_wallet(str(row.provider_address or "")) == owner_wallet
        ]

    def _row_created_at(self, row: UsageLogRow) -> int:
        return int(row.ts or 0)

    def _row_request_id(self, row: UsageLogRow) -> str:
        return str(row.request_id or "").strip()

    def _deduplicate_by_request_id(
        self, rows: List[UsageLogRow]
    ) -> tuple[Dict[str, UsageLogRow], int]:
        dedup: Dict[str, UsageLogRow] = {}
        duplicate_dropped = 0
        for row in rows:
            request_id = self._row_request_id(row)
            if not request_id:
                continue
            current = dedup.get(request_id)
            if current is None:
                dedup[request_id] = row
                continue

            duplicate_dropped += 1
            if self._row_created_at(row) >= self._row_created_at(current):
                dedup[request_id] = row
        return dedup, duplicate_dropped

    def _settled_rows(
        self, dedup_rows: Dict[str, UsageLogRow]
    ) -> List[UsageLogRow]:
        settled = [
            row
            for row in dedup_rows.values()
            if str(row.status or "").lower() == "succeeded"
        ]
        settled.sort(key=self._row_created_at, reverse=True)
        return settled

    def _metric_value(self, row: UsageLogRow, *field_names: str) -> float:
        for field_name in field_names:
            value = getattr(row, field_name, None)
            if value is not None:
                return float(value)
        return 0.0

    def _sum_metric(self, rows: List[UsageLogRow], *field_names: str) -> float:
        total = 0.0
        for row in rows:
            total += self._metric_value(row, *field_names)
        return round(total, 6)

    def _to_recent_calls(
        self, settled: List[UsageLogRow], limit: int
    ) -> List[Dict[str, Any]]:
        return [
            {
                "requestId": self._row_request_id(row),
                "serviceId": str(row.service_id or ""),
                "status": str(row.status or "unknown"),
                "unitPrice": round(float(row.unit_price or 0.0), 6),
                "protocolFee": round(float(row.protocol_fee or 0.0), 6),
                "routingTax": round(float(row.routing_tax or 0.0), 6),
                "providerNet": round(
                    max(float((row.total_charge or 0.0) - (row.protocol_fee or 0.0)), 0.0),
                    6,
                ),
                "createdAt": self._row_created_at(row),
            }
            for row in settled[: max(1, int(limit))]
        ]

    def get_provider_earnings_summary(
        self, owner_wallet: str, limit: int = 200
    ) -> Dict[str, Any]:
        """Build idempotent provider summary using request_id deduplication for succeeded provider calls."""
        owner = normalize_wallet(owner_wallet)
        provider_rows = self._provider_rows(owner)
        dedup, duplicate_dropped = self._deduplicate_by_request_id(provider_rows)
        settled = self._settled_rows(dedup)

        total_earned = self._sum_metric(settled, "unit_price")
        total_protocol_fee = self._sum_metric(settled, "protocol_fee")
        total_routing_tax = self._sum_metric(settled, "routing_tax")
        provider_net_total = round(
            sum(
                max(float((row.total_charge or 0.0) - (row.protocol_fee or 0.0)), 0.0)
                for row in settled
            ),
            6,
        )
        provider_receivable = self._load_provider_receivable(owner)
        recent_calls = self._to_recent_calls(settled, limit)

        return {
            "ownerAddress": owner,
            "totalApiCalls": len(settled),
            "totalEarned": total_earned,
            "totalProtocolFee": total_protocol_fee,
            "totalRoutingTax": total_routing_tax,
            "providerNetEarned": provider_net_total,
            "providerReceivable": provider_receivable,
            "duplicateRowsDropped": duplicate_dropped,
            "idempotencyKey": "request_id",
            "recentCalls": recent_calls,
        }
