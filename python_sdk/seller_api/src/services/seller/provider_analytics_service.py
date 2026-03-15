from typing import Any, Dict, List

from src.core.common import normalize_wallet
from src.domain.finance import BalanceLedger
from src.storage.base import BaseStorage


class ProviderAnalyticsService:
    """Compute provider earnings and call analytics from persisted gateway settlement logs."""

    def __init__(self, storage: BaseStorage):
        self.storage = storage

    def _load_usage_rows(self) -> List[Dict[str, Any]]:
        raw_rows = self.storage.get_data_manager().system.gateway_state.read_usage_log_rows()
        return [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []

    def _load_seller_receivable(self, owner_wallet: str) -> float:
        ledger = self.storage.get_data_manager().finance.balance.read_balance_ledger()
        return round(float(ledger.sellers.get(owner_wallet, 0.0)), 6)

    def _seller_rows(self, owner_wallet: str) -> List[Dict[str, Any]]:
        rows = self._load_usage_rows()
        return [row for row in rows if normalize_wallet(str(row.get("seller") or "")) == owner_wallet]

    def _row_created_at(self, row: Dict[str, Any]) -> int:
        return int(row.get("created_at") or row.get("createdAt") or 0)

    def _row_request_id(self, row: Dict[str, Any]) -> str:
        return str(row.get("request_id") or row.get("requestId") or "").strip()

    def _deduplicate_by_request_id(self, rows: List[Dict[str, Any]]) -> tuple[Dict[str, Dict[str, Any]], int]:
        dedup: Dict[str, Dict[str, Any]] = {}
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

    def _settled_rows(self, dedup_rows: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        settled = [
            row for row in dedup_rows.values() if str(row.get("status") or "").lower() == "succeeded"
        ]
        settled.sort(key=self._row_created_at, reverse=True)
        return settled

    def _sum_metric(self, rows: List[Dict[str, Any]], *keys: str) -> float:
        total = 0.0
        for row in rows:
            value = None
            for key in keys:
                if key in row:
                    value = row.get(key)
                    break
            total += float(value or 0.0)
        return round(total, 6)

    def _to_recent_calls(self, settled: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
        return [
            {
                "requestId": self._row_request_id(row),
                "serviceId": str(row.get("service_id") or row.get("serviceId") or ""),
                "status": str(row.get("status") or "unknown"),
                "unitPrice": round(float(row.get("unit_price") or row.get("unitPrice") or 0.0), 6),
                "protocolFee": round(float(row.get("protocol_fee") or row.get("platform_fee") or row.get("platformFee") or 0.0), 6),
                "routingTax": round(float(row.get("routing_tax") or row.get("routingTax") or 0.0), 6),
                "sellerNet": round(float(row.get("seller_net") or row.get("sellerNet") or 0.0), 6),
                "createdAt": self._row_created_at(row),
            }
            for row in settled[: max(1, int(limit))]
        ]

    def get_provider_earnings_summary(self, owner_wallet: str, limit: int = 200) -> Dict[str, Any]:
        """Build idempotent provider summary using request_id deduplication for succeeded seller calls."""
        owner = normalize_wallet(owner_wallet)
        seller_rows = self._seller_rows(owner)
        dedup, duplicate_dropped = self._deduplicate_by_request_id(seller_rows)
        settled = self._settled_rows(dedup)

        total_earned = self._sum_metric(settled, "unit_price", "unitPrice")
        total_protocol_fee = self._sum_metric(settled, "protocol_fee", "platform_fee", "platformFee")
        total_routing_tax = self._sum_metric(settled, "routing_tax", "routingTax")
        seller_net_total = self._sum_metric(settled, "seller_net", "sellerNet")
        seller_receivable = self._load_seller_receivable(owner)
        recent_calls = self._to_recent_calls(settled, limit)

        return {
            "ownerAddress": owner,
            "totalApiCalls": len(settled),
            "totalEarned": total_earned,
            "totalProtocolFee": total_protocol_fee,
            "totalRoutingTax": total_routing_tax,
            "sellerNetEarned": seller_net_total,
            "sellerReceivable": seller_receivable,
            "duplicateRowsDropped": duplicate_dropped,
            "idempotencyKey": "request_id",
            "recentCalls": recent_calls,
        }