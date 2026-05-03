import json
from datetime import datetime
from typing import Any

import psycopg
from psycopg.rows import dict_row

from src.storage.analytics.analytics_dashboard import (
    AnalyticsDashboardQueryResult,
    CONSUMER_FUNNEL_EVENTS,
    _float,
    _int,
    _list_item,
    _money,
    _rate,
)
from src.storage.analytics.postgres_data_quality import build_data_quality

WINDOW_SECONDS: dict[str, int] = {
    "1h": 60 * 60,
    "24h": 24 * 60 * 60,
    "7d": 7 * 24 * 60 * 60,
    "30d": 30 * 24 * 60 * 60,
}
DEGRADED_SUCCESS_RATE = 0.9
MONITORING_SUCCESS_RATE = 0.97


class AnalyticsDashboardPayload(dict[str, Any]):
    """Named admin analytics payload for stable repository method contracts."""


def _percentile(values: list[float], percentile: float) -> float:
    numeric = sorted(value for value in values if isinstance(value, (int, float)))
    if not numeric:
        return 0.0
    if len(numeric) == 1:
        return float(numeric[0])
    index = (len(numeric) - 1) * percentile
    lower = int(index)
    upper = min(lower + 1, len(numeric) - 1)
    if lower == upper:
        return float(numeric[lower])
    fraction = index - lower
    return float(numeric[lower] + (numeric[upper] - numeric[lower]) * fraction)


def _top_items(
    values: list[dict[str, Any]],
    *,
    key_field: str,
    limit: int = 8,
    value_field: str | None = None,
) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, Any]] = {}
    for item in values:
        key = str(item.get(key_field) or "unknown")
        bucket = buckets.setdefault(key, {"key": key, "label": key, "count": 0, "value": 0.0})
        bucket["count"] += 1
        bucket["value"] += _float(item.get(value_field)) if value_field else 1
    return sorted(buckets.values(), key=lambda row: row["count"], reverse=True)[:limit]
class PostgresAnalyticsDashboardRepository:
    """Admin Analytics read model backed only by Gateway Postgres analytics rows.

    The repository intentionally does not call ClickHouse. It reads the Gateway
    analytics outbox payload shape (`event_id`, `event_name`, `timestamp`,
    `distinct_id`, `source`, `properties`) and produces the same API payloads as
    the legacy ClickHouse repository so admin-front can keep its contract while
    the analytics source moves to Postgres.
    """

    def __init__(self, dsn: str, *, timeout_sec: float = 5.0) -> None:
        self._dsn = dsn
        self._timeout_sec = timeout_sec

    def _safe_events(self, window: str) -> AnalyticsDashboardQueryResult:
        try:
            seconds = WINDOW_SECONDS.get(window, WINDOW_SECONDS["24h"])
            with psycopg.connect(self._dsn, row_factory=dict_row, connect_timeout=self._timeout_sec) as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT event_id, event_name, event_key, payload, created_at
                    FROM synapse_analytics_outbox
                    WHERE created_at >= now() - (%s || ' seconds')::interval
                    ORDER BY created_at ASC
                    """,
                    (seconds,),
                )
                rows = cur.fetchall()
            return AnalyticsDashboardQueryResult(rows=[self._normalize_event(dict(row)) for row in rows])
        except Exception as exc:  # pragma: no cover: defensive degraded path requires a live broken Postgres connection
            return AnalyticsDashboardQueryResult(rows=[], source_status="degraded", error=str(exc))

    @staticmethod
    def _normalize_event(row: dict[str, Any]) -> dict[str, Any]:
        payload = row.get("payload") or {}
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                payload = {}
        properties = payload.get("properties") if isinstance(payload, dict) else {}
        if not isinstance(properties, dict):
            properties = {}
        return {
            "event_id": str(payload.get("event_id") or row.get("event_id") or ""),
            "event_name": str(payload.get("event_name") or row.get("event_name") or ""),
            "timestamp": payload.get("timestamp") or row.get("created_at"),
            "distinct_id": str(payload.get("distinct_id") or row.get("event_key") or ""),
            "source": str(payload.get("source") or "gateway"),
            "properties": properties,
        }

    @staticmethod
    def _bucket(event: dict[str, Any], window: str) -> str:
        timestamp = event.get("timestamp")
        if isinstance(timestamp, datetime):
            dt = timestamp
        else:
            try:
                dt = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
            except ValueError:
                return ""
        if window == "24h":
            return dt.replace(minute=0, second=0, microsecond=0).isoformat()
        return dt.date().isoformat()

    @staticmethod
    def _prop(event: dict[str, Any], key: str) -> Any:
        props = event.get("properties") or {}
        return props.get(key) if isinstance(props, dict) else None

    @classmethod
    def _prop_str(cls, event: dict[str, Any], key: str, fallback: str = "") -> str:
        value = cls._prop(event, key)
        return str(value if value not in (None, "") else fallback)

    @classmethod
    def _prop_num(cls, event: dict[str, Any], key: str) -> float:
        return _float(cls._prop(event, key))

    @classmethod
    def _has_prop(cls, event: dict[str, Any], key: str) -> bool:
        props = event.get("properties") or {}
        return isinstance(props, dict) and key in props and props[key] not in (None, "")

    @staticmethod
    def _events_named(events: list[dict[str, Any]], *names: str) -> list[dict[str, Any]]:
        expected = set(names)
        return [event for event in events if event.get("event_name") in expected]

    @classmethod
    def _sum_prop_for(cls, events: list[dict[str, Any]], event_name: str, key: str) -> float:
        return sum(cls._prop_num(event, key) for event in cls._events_named(events, event_name))

    @classmethod
    def _critical_risk_count(cls, events: list[dict[str, Any]]) -> int:
        return sum(
            1
            for event in cls._events_named(events, "risk_rule_triggered")
            if cls._prop_str(event, "severity").lower() in {"critical", "high"}
        )

    @staticmethod
    def _overview_status(source_status: str, critical_count: int, budget_count: int, completed: int, failed: int, success_rate: float) -> str:
        attempts = completed + failed
        if source_status != "healthy" or critical_count > 0 or (attempts > 0 and success_rate < DEGRADED_SUCCESS_RATE):
            return "degraded"
        if budget_count > 0 or (attempts > 0 and success_rate < MONITORING_SUCCESS_RATE):
            return "monitoring"
        return "nominal"

    @classmethod
    def _overview_cards(cls, events: list[dict[str, Any]], completed: int, success_rate: float, status: str, error: str | None) -> list[dict[str, Any]]:
        return [
            {"key": "gmv_usdc", "label": "GMV USDC", "value": _money(cls._sum_prop_for(events, "invoke_completed", "price_usdc")), "unit": "USDC", "tone": "green", "detail": "sum(price_usdc) from Postgres invoke_completed events."},
            {"key": "invoke_completed", "label": "Paid Invokes", "value": completed, "unit": "count", "tone": "green" if completed else "gray", "detail": "count(invoke_completed)."},
            {"key": "invoke_success_rate", "label": "Success Rate", "value": success_rate, "unit": "rate", "tone": "green" if success_rate >= MONITORING_SUCCESS_RATE else "orange", "detail": "completed / completed+failed."},
            {"key": "platform_fee_usdc", "label": "Platform Fee", "value": _money(cls._sum_prop_for(events, "provider_revenue_received", "platform_fee_usdc")), "unit": "USDC", "tone": "green", "detail": "sum(platform_fee_usdc) from Postgres provider_revenue_received events."},
            {"key": "provider_net_usdc", "label": "Provider Net", "value": _money(cls._sum_prop_for(events, "provider_revenue_received", "provider_net_usdc")), "unit": "USDC", "tone": "green", "detail": "sum(provider_net_usdc) credited to providers."},
            {"key": "analytics_health", "label": "Analytics Health", "value": status, "unit": "status", "tone": "red" if status == "degraded" else "orange" if status == "monitoring" else "green", "detail": error or "Postgres analytics outbox is queryable."},
        ]

    @staticmethod
    def _overview_alerts(error: str | None, critical_count: int, budget_count: int, window: str) -> list[dict[str, str]]:
        alerts = []
        if error:
            alerts.append({"severity": "critical", "title": "Postgres analytics unavailable", "detail": error, "href": "/system"})
        if critical_count > 0:
            alerts.append({"severity": "critical", "title": "Critical risk events", "detail": f"{critical_count} high/critical risk_rule_triggered events.", "href": "/risk"})
        if budget_count > 0:
            alerts.append({"severity": "warning", "title": "Budget blocks", "detail": f"{budget_count} budget_blocked events in this window.", "href": f"/dashboard/analytics/risk-health?window={window}&focus=budget_blocked"})
        return alerts

    def get_overview(self, window: str) -> AnalyticsDashboardPayload:
        result = self._safe_events(window)
        events = result.rows
        completed = len(self._events_named(events, "invoke_completed"))
        failed = len(self._events_named(events, "invoke_failed"))
        success_rate = _rate(completed, completed + failed)
        critical_risk_events = self._critical_risk_count(events)
        budget_blocked_count = len(self._events_named(events, "budget_blocked"))
        overall_status = self._overview_status(result.source_status, critical_risk_events, budget_blocked_count, completed, failed, success_rate)
        cards = self._overview_cards(events, completed, success_rate, overall_status, result.error)
        alerts = self._overview_alerts(result.error, critical_risk_events, budget_blocked_count, window)
        return {"window": window, "overallStatus": overall_status, "cards": cards, "alerts": alerts}

    @staticmethod
    def _distinct_user_count(events: list[dict[str, Any]]) -> int:
        return len({str(event.get("distinct_id") or "") for event in events if event.get("distinct_id")})

    @classmethod
    def _consumer_funnel_steps(cls, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        steps: list[dict[str, Any]] = []
        previous_users: int | None = None
        for event_name in CONSUMER_FUNNEL_EVENTS:
            rows = cls._events_named(events, event_name)
            users = cls._distinct_user_count(rows)
            conversion_rate = 1.0 if previous_users is None else _rate(users, previous_users)
            steps.append(
                {
                    "eventName": event_name,
                    "label": event_name.replace("_", " "),
                    "users": users,
                    "events": len(rows),
                    "conversionRate": conversion_rate,
                    "dropoffRate": round(1 - conversion_rate, 4),
                }
            )
            previous_users = users
        return steps

    @classmethod
    def _first_invoke_user_count(cls, events: list[dict[str, Any]]) -> int:
        rows = [event for event in cls._events_named(events, "invoke_completed") if cls._prop(event, "is_first_invoke") is True]
        return cls._distinct_user_count(rows)

    @staticmethod
    def _step_users(steps: list[dict[str, Any]], event_name: str) -> int:
        users_by_event = {str(step.get("eventName")): _int(step.get("users")) for step in steps}
        return users_by_event.get(event_name, 0)

    def get_consumer_funnel(self, window: str) -> AnalyticsDashboardPayload:
        events = self._safe_events(window).rows
        steps = self._consumer_funnel_steps(events)
        first_invoke_users = self._first_invoke_user_count(events)
        first_step_users = _int(steps[0]["users"]) if steps else 0
        quote_users = self._step_users(steps, "quote_generated")
        deposit_users = self._step_users(steps, "deposit_completed")
        completed_users = self._step_users(steps, "invoke_completed")
        return {
            "window": window,
            "steps": steps,
            "summary": {
                "activationRate": _rate(completed_users, first_step_users),
                "firstInvokeUsers": first_invoke_users,
                "quoteToInvokeRate": _rate(completed_users, quote_users),
                "depositToFirstInvokeRate": _rate(first_invoke_users, deposit_users),
            },
        }

    @classmethod
    def _top_prop_items(cls, events: list[dict[str, Any]], key: str, *event_names: str) -> list[dict[str, Any]]:
        rows = [{"key": cls._prop_str(event, key, "unknown")} for event in cls._events_named(events, *event_names)]
        return [_list_item(item) for item in _top_items(rows, key_field="key")]

    @classmethod
    def _invocation_trend(cls, events: list[dict[str, Any]], window: str) -> list[dict[str, Any]]:
        trend: dict[str, dict[str, Any]] = {}
        for event in cls._events_named(events, "invoke_completed", "invoke_failed", "provider_revenue_received"):
            bucket = cls._bucket(event, window)
            if not bucket:
                continue
            item = trend.setdefault(bucket, {"bucket": bucket, "invokeCompleted": 0, "invokeFailed": 0, "gmvUsdc": 0.0, "platformFeeUsdc": 0.0, "providerNetUsdc": 0.0})
            event_name = event.get("event_name")
            if event_name == "invoke_completed":
                item["invokeCompleted"] += 1
                item["gmvUsdc"] += cls._prop_num(event, "price_usdc")
            elif event_name == "invoke_failed":
                item["invokeFailed"] += 1
            elif event_name == "provider_revenue_received":
                item["platformFeeUsdc"] += cls._prop_num(event, "platform_fee_usdc")
                item["providerNetUsdc"] += cls._prop_num(event, "provider_net_usdc")
        return [
            {
                "bucket": item["bucket"],
                "invokeCompleted": _int(item["invokeCompleted"]),
                "invokeFailed": _int(item["invokeFailed"]),
                "gmvUsdc": _money(item["gmvUsdc"]),
                "platformFeeUsdc": _money(item["platformFeeUsdc"]),
                "providerNetUsdc": _money(item["providerNetUsdc"]),
            }
            for item in sorted(trend.values(), key=lambda row: row["bucket"])
        ]

    def get_invocation_revenue(self, window: str) -> AnalyticsDashboardPayload:
        events = self._safe_events(window).rows
        completed_events = self._events_named(events, "invoke_completed")
        failed_events = self._events_named(events, "invoke_failed")
        provider_revenue_events = self._events_named(events, "provider_revenue_received")
        completed = len(completed_events)
        failed = len(failed_events)
        latency_values = [self._prop_num(event, "latency_ms") for event in completed_events]
        gmv_usdc = self._sum_prop_for(events, "invoke_completed", "price_usdc")
        return {
            "window": window,
            "quoteCount": len(self._events_named(events, "quote_generated")),
            "invokeStartedCount": len(self._events_named(events, "invoke_started")),
            "invokeCompletedCount": completed,
            "invokeFailedCount": failed,
            "successRate": _rate(completed, completed + failed),
            "gmvUsdc": _money(gmv_usdc),
            "priceAvgUsdc": _money(gmv_usdc / completed if completed else 0),
            "platformFeeUsdc": _money(sum(self._prop_num(event, "platform_fee_usdc") for event in provider_revenue_events)),
            "providerNetUsdc": _money(sum(self._prop_num(event, "provider_net_usdc") for event in provider_revenue_events)),
            "latencyMs": {"p50": _percentile(latency_values, 0.50), "p95": _percentile(latency_values, 0.95), "p99": _percentile(latency_values, 0.99)},
            "failureStages": self._top_prop_items(failed_events, "failure_stage", "invoke_failed"),
            "errorCodes": self._top_prop_items(events, "error_code", "invoke_failed", "budget_blocked"),
            "trend": self._invocation_trend(events, window),
        }

    @classmethod
    def _provider_settlement_amount(cls, name: str, rows: list[dict[str, Any]]) -> float:
        if name in {"provider_revenue_received", "provider_first_revenue_received"}:
            return sum(cls._prop_num(event, "gross_usdc") for event in rows)
        return sum(cls._prop_num(event, "claim_usdc") for event in rows)

    @classmethod
    def _provider_settlement_funnel(cls, events: list[dict[str, Any]], requested: int) -> list[dict[str, Any]]:
        funnel_names = ("provider_revenue_received", "provider_first_revenue_received", "settlement_claim_requested", "settlement_claim_completed", "settlement_claim_failed")
        funnel = []
        for name in funnel_names:
            rows = cls._events_named(events, name)
            amount = cls._provider_settlement_amount(name, rows)
            conversion_rate = 1.0 if name == "provider_revenue_received" else _rate(len(rows), max(requested, 1))
            funnel.append({"eventName": name, "label": name, "count": len(rows), "amountUsdc": _money(amount), "conversionRate": conversion_rate})
        return funnel

    @classmethod
    def _top_provider_rows(cls, revenue_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        top: dict[str, dict[str, Any]] = {}
        for event in revenue_events:
            provider_id = cls._prop_str(event, "provider_id", "unknown")
            item = top.setdefault(provider_id, {"providerId": provider_id, "serviceId": cls._prop_str(event, "service_id", "unknown"), "grossUsdc": 0.0, "providerNetUsdc": 0.0, "invokeCount": 0})
            item["grossUsdc"] += cls._prop_num(event, "gross_usdc")
            item["providerNetUsdc"] += cls._prop_num(event, "provider_net_usdc")
            item["invokeCount"] += 1
        return [
            {
                "providerId": row["providerId"],
                "serviceId": row["serviceId"],
                "grossUsdc": _money(row["grossUsdc"]),
                "providerNetUsdc": _money(row["providerNetUsdc"]),
                "invokeCount": _int(row["invokeCount"]),
            }
            for row in sorted(top.values(), key=lambda item: item["providerNetUsdc"], reverse=True)[:10]
        ]

    @classmethod
    def _distinct_provider_count(cls, events: list[dict[str, Any]]) -> int:
        return len({cls._prop_str(event, "provider_id") for event in events if cls._prop_str(event, "provider_id")})

    @classmethod
    def _avg_prop(cls, events: list[dict[str, Any]], key: str) -> float:
        return sum(cls._prop_num(event, key) for event in events) / len(events) if events else 0.0

    def get_provider_revenue(self, window: str) -> AnalyticsDashboardPayload:
        events = self._safe_events(window).rows
        revenue_events = self._events_named(events, "provider_revenue_received")
        first_revenue_events = self._events_named(events, "provider_first_revenue_received")
        requested = len(self._events_named(events, "settlement_claim_requested"))
        failed = len(self._events_named(events, "settlement_claim_failed"))
        completed_claims = self._events_named(events, "settlement_claim_completed")
        return {
            "window": window,
            "revenueProviderCount": self._distinct_provider_count(revenue_events),
            "firstRevenueProviderCount": self._distinct_provider_count(first_revenue_events),
            "avgTimeSinceListingMs": self._avg_prop(first_revenue_events, "time_since_listing_ms"),
            "providerGrossUsdc": _money(sum(self._prop_num(event, "gross_usdc") for event in revenue_events)),
            "platformFeeUsdc": _money(sum(self._prop_num(event, "platform_fee_usdc") for event in revenue_events)),
            "providerNetUsdc": _money(sum(self._prop_num(event, "provider_net_usdc") for event in revenue_events)),
            "pendingSettlementUsdc": "0.000000",
            "settlementCompletedUsdc": _money(sum(self._prop_num(event, "claim_usdc") for event in completed_claims)),
            "settlementFailureRate": _rate(failed, requested),
            "settlementP95ConfirmMs": _percentile([self._prop_num(event, "time_to_confirm_ms") for event in completed_claims], 0.95),
            "settlementFunnel": self._provider_settlement_funnel(events, requested),
            "topProviders": self._top_provider_rows(revenue_events),
        }

    def get_money_flow(self, window: str) -> AnalyticsDashboardPayload:
        events = self._safe_events(window).rows
        deposit_failed = self._events_named(events, "deposit_failed")
        withdrawal_failed = self._events_named(events, "withdrawal_failed")
        confirmed = self._events_named(events, "deposit_completed", "withdrawal_completed")
        return {
            "window": window,
            "depositUsdc": _money(sum(self._prop_num(event, "amount_usdc") for event in self._events_named(events, "deposit_completed"))),
            "depositFailedCount": len(deposit_failed),
            "withdrawalUsdc": _money(sum(self._prop_num(event, "amount_usdc") for event in self._events_named(events, "withdrawal_completed"))),
            "withdrawalFailedCount": len(withdrawal_failed),
            "refundUsdc": _money(sum(self._prop_num(event, "amount_usdc") for event in self._events_named(events, "refund_completed"))),
            "confirmLatencyMs": {"p50": _percentile([self._prop_num(event, "time_to_confirm_ms") for event in confirmed], 0.50), "p95": _percentile([self._prop_num(event, "time_to_confirm_ms") for event in confirmed], 0.95)},
            "depositErrors": [_list_item(item) for item in _top_items([{"key": self._prop_str(event, "error_code", "unknown")} for event in deposit_failed], key_field="key")],
            "depositFailureSamples": [{"timestamp": str(event.get("timestamp") or ""), "errorCode": self._prop_str(event, "error_code", "unknown"), "amountUsdc": _money(self._prop_num(event, "amount_usdc")), "env": self._prop_str(event, "env", "unknown"), "correlationId": self._prop_str(event, "correlation_id"), "txHash": self._prop_str(event, "tx_hash")} for event in sorted(deposit_failed, key=lambda row: str(row.get("timestamp") or ""), reverse=True)[:10]],
            "withdrawalErrors": [_list_item(item) for item in _top_items([{"key": self._prop_str(event, "error_code", "unknown")} for event in withdrawal_failed], key_field="key")],
            "financeContext": {},
        }

    @classmethod
    def _critical_risk_events(cls, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [event for event in cls._events_named(events, "risk_rule_triggered") if cls._prop_str(event, "severity").lower() in {"critical", "high"}]

    @classmethod
    def _budget_block_buckets(cls, budget: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        budget_blocks: dict[str, dict[str, Any]] = {}
        for event in budget:
            error_code = cls._prop_str(event, "error_code", "unknown")
            service_id = cls._prop_str(event, "service_id", "unknown")
            surface = cls._prop_str(event, "surface", "unknown")
            key = f"{error_code}-{service_id}-{surface}"
            item = budget_blocks.setdefault(key, {"key": key, "errorCode": error_code, "serviceId": service_id, "surface": surface, "count": 0, "requiredUsdc": 0.0, "availableUsdc": 0.0, "gapUsdc": 0.0})
            required = cls._prop_num(event, "required_usdc")
            available = cls._prop_num(event, "available_usdc")
            item["count"] += 1
            item["requiredUsdc"] += required
            item["availableUsdc"] += available
            item["gapUsdc"] += max(required - available, 0)
        return budget_blocks

    @classmethod
    def _budget_gap_usdc(cls, budget: list[dict[str, Any]]) -> float:
        return sum(max(cls._prop_num(event, "required_usdc") - cls._prop_num(event, "available_usdc"), 0) for event in budget)

    @staticmethod
    def _format_budget_blocks(budget_blocks: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "key": row["key"],
                "errorCode": row["errorCode"],
                "serviceId": row["serviceId"],
                "surface": row["surface"],
                "count": _int(row["count"]),
                "requiredUsdc": _money(row["requiredUsdc"]),
                "availableUsdc": _money(row["availableUsdc"]),
                "gapUsdc": _money(row["gapUsdc"]),
            }
            for row in sorted(budget_blocks.values(), key=lambda item: item["count"], reverse=True)[:10]
        ]

    @classmethod
    def _budget_block_samples(cls, budget: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {
                "timestamp": str(event.get("timestamp") or ""),
                "serviceId": cls._prop_str(event, "service_id", "unknown"),
                "errorCode": cls._prop_str(event, "error_code", "unknown"),
                "requiredUsdc": _money(cls._prop_num(event, "required_usdc")),
                "availableUsdc": _money(cls._prop_num(event, "available_usdc")),
                "correlationId": cls._prop_str(event, "correlation_id"),
                "surface": cls._prop_str(event, "surface", "unknown"),
            }
            for event in sorted(budget, key=lambda row: str(row.get("timestamp") or ""), reverse=True)[:10]
        ]

    @classmethod
    def _degraded_provider_rows(cls, degraded: list[dict[str, Any]]) -> list[dict[str, Any]]:
        provider_rows = _top_items(
            [
                {
                    "providerId": cls._prop_str(event, "provider_id", "unknown"),
                    "serviceId": cls._prop_str(event, "service_id", "unknown"),
                    "reason": cls._prop_str(event, "reason", "unknown"),
                }
                for event in degraded
            ],
            key_field="providerId",
        )
        return [
            {
                "providerId": str(item.get("key") or "unknown"),
                "serviceId": str(item.get("serviceId") or "unknown"),
                "count": _int(item.get("count")),
                "reason": str(item.get("reason") or "unknown"),
            }
            for item in provider_rows
        ]

    def get_risk_health(self, window: str) -> AnalyticsDashboardPayload:
        events = self._safe_events(window).rows
        critical = self._critical_risk_events(events)
        degraded = self._events_named(events, "provider_health_degraded")
        budget = self._events_named(events, "budget_blocked")
        budget_blocks = self._budget_block_buckets(budget)
        return {
            "window": window,
            "criticalRiskEvents": len(critical),
            "riskRules": self._top_prop_items(events, "rule_code", "risk_rule_triggered"),
            "surfaces": self._top_prop_items(events, "surface", "risk_rule_triggered", "budget_blocked", "invoke_failed"),
            "providerHealthDegradedCount": len(degraded),
            "degradedProviders": self._degraded_provider_rows(degraded),
            "budgetGapUsdc": _money(self._budget_gap_usdc(budget)),
            "budgetBlocks": self._format_budget_blocks(budget_blocks),
            "budgetBlockSamples": self._budget_block_samples(budget),
            "refundReasons": self._refund_reason_rows(events),
        }

    @classmethod
    def _refund_reason_rows(cls, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows = [{"key": cls._prop_str(event, "reason_code", "unknown"), "value": cls._prop_num(event, "amount_usdc")} for event in cls._events_named(events, "refund_completed")]
        return [_list_item(item) for item in _top_items(rows, key_field="key", value_field="value")]

    def get_data_quality(self, window: str) -> AnalyticsDashboardPayload:
        result = self._safe_events(window)
        return build_data_quality(window, result.source_status, result.rows)
