import json
from dataclasses import dataclass
from typing import Any, Protocol

import httpx


ANALYTICS_TABLE = "synapse_analytics.events"
CONSUMER_FUNNEL_EVENTS = (
    "page_viewed",
    "wallet_connected",
    "consumer_signup_completed",
    "quote_generated",
    "deposit_completed",
    "invoke_started",
    "invoke_completed",
)
CRITICAL_EVENTS = ("page_viewed", "wallet_connected", "invoke_completed", "deposit_completed")
WINDOW_SQL: dict[str, str] = {
    "1h": "INTERVAL 1 HOUR",
    "24h": "INTERVAL 24 HOUR",
    "7d": "INTERVAL 7 DAY",
    "30d": "INTERVAL 30 DAY",
}


def _float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _rate(numerator: float, denominator: float) -> float:
    if denominator <= 0:
        return 0.0
    return round(numerator / denominator, 4)


def _first(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return rows[0] if rows else {}


def _event_in(events: tuple[str, ...]) -> str:
    return ", ".join(f"'{event}'" for event in events)


def _list_item(row: dict[str, Any], key: str = "key") -> dict[str, Any]:
    return {
        "key": str(row.get(key) or "unknown"),
        "label": str(row.get("label") or row.get(key) or "unknown"),
        "count": _int(row.get("count")),
        "value": _float(row.get("value")),
        "rate": _float(row.get("rate")),
    }


@dataclass(slots=True)
class AnalyticsDashboardQueryResult:
    rows: list[dict[str, Any]]
    source_status: str = "healthy"
    error: str | None = None


class AnalyticsDashboardRepository(Protocol):
    def get_overview(self, window: str) -> dict: ...
    def get_consumer_funnel(self, window: str) -> dict: ...
    def get_invocation_revenue(self, window: str) -> dict: ...
    def get_provider_revenue(self, window: str) -> dict: ...
    def get_money_flow(self, window: str) -> dict: ...
    def get_risk_health(self, window: str) -> dict: ...
    def get_data_quality(self, window: str) -> dict: ...


class ClickHouseAnalyticsDashboardRepository:
    def __init__(self, url: str, *, timeout_sec: float = 5.0) -> None:
        self._url = url.rstrip("/") + "/"
        self._timeout_sec = timeout_sec

    def _safe_query_json_rows(self, sql: str) -> AnalyticsDashboardQueryResult:
        try:
            with httpx.Client(timeout=self._timeout_sec) as client:
                response = client.post(self._url, content=sql.encode("utf-8"), headers={"Content-Type": "text/plain"})
                response.raise_for_status()
            rows = [json.loads(line) for line in response.text.splitlines() if line.strip()]
            return AnalyticsDashboardQueryResult(rows=rows)
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
            return AnalyticsDashboardQueryResult(rows=[], source_status="degraded", error=str(exc))

    @staticmethod
    def _window_clause(window: str) -> str:
        return WINDOW_SQL.get(window, WINDOW_SQL["24h"])

    @classmethod
    def _event_window_where(cls, window: str) -> str:
        return f"timestamp >= now() - {cls._window_clause(window)}"

    @staticmethod
    def _bucket_expr(window: str) -> str:
        if window == "24h":
            return "toStartOfHour(timestamp)"
        return "toDate(timestamp)"

    def get_overview(self, window: str) -> dict:
        result = self._safe_query_json_rows(
            f"""
            SELECT
              countIf(event_name = 'invoke_completed') AS invoke_completed_count,
              countIf(event_name = 'invoke_failed') AS invoke_failed_count,
              countIf(event_name = 'budget_blocked') AS budget_blocked_count,
              countIf(event_name = 'risk_rule_triggered' AND lower(JSONExtractString(properties, 'severity')) IN ('critical','high')) AS critical_risk_events,
              uniqExactIf(distinct_id, event_name IN ('invoke_completed','invoke_started')) AS active_consumers,
              uniqExactIf(JSONExtractString(properties, 'provider_id'), event_name IN ('invoke_completed','provider_revenue_received','provider_health_degraded')) AS active_providers,
              sumIf(JSONExtractFloat(properties, 'price_usdc'), event_name = 'invoke_completed') AS gmv_usdc,
              sumIf(JSONExtractFloat(properties, 'platform_fee_usdc'), event_name = 'provider_revenue_received') AS platform_fee_usdc,
              sumIf(JSONExtractFloat(properties, 'provider_net_usdc'), event_name = 'provider_revenue_received') AS provider_net_usdc
            FROM {ANALYTICS_TABLE}
            WHERE {self._event_window_where(window)}
            FORMAT JSONEachRow
            """
        )
        row = _first(result.rows)
        completed = _int(row.get("invoke_completed_count"))
        failed = _int(row.get("invoke_failed_count"))
        success_rate = _rate(completed, completed + failed)
        critical_risk_events = _int(row.get("critical_risk_events"))
        budget_blocked_count = _int(row.get("budget_blocked_count"))
        overall_status = "nominal"
        if result.source_status != "healthy" or critical_risk_events > 0 or (completed + failed > 0 and success_rate < 0.9):
            overall_status = "degraded"
        elif budget_blocked_count > 0 or (completed + failed > 0 and success_rate < 0.97):
            overall_status = "monitoring"

        cards = [
            {"key": "gmv_usdc", "label": "GMV USDC", "value": _float(row.get("gmv_usdc")), "unit": "USDC", "tone": "green", "detail": "sum(price_usdc) from invoke_completed."},
            {"key": "invoke_completed", "label": "Paid Invokes", "value": completed, "unit": "count", "tone": "green" if completed else "gray", "detail": "count(invoke_completed)."},
            {"key": "invoke_success_rate", "label": "Success Rate", "value": success_rate, "unit": "rate", "tone": "green" if success_rate >= 0.97 else "orange", "detail": "completed / completed+failed."},
            {"key": "platform_fee_usdc", "label": "Platform Fee", "value": _float(row.get("platform_fee_usdc")), "unit": "USDC", "tone": "green", "detail": "sum(platform_fee_usdc) from provider_revenue_received."},
            {"key": "provider_net_usdc", "label": "Provider Net", "value": _float(row.get("provider_net_usdc")), "unit": "USDC", "tone": "green", "detail": "sum(provider_net_usdc) credited to providers."},
            {"key": "analytics_health", "label": "Analytics Health", "value": overall_status, "unit": "status", "tone": "red" if overall_status == "degraded" else "orange" if overall_status == "monitoring" else "green", "detail": result.error or "ClickHouse analytics stream is queryable."},
        ]
        alerts = []
        if result.error:
            alerts.append({"severity": "critical", "title": "ClickHouse analytics unavailable", "detail": result.error, "href": "/system"})
        if critical_risk_events > 0:
            alerts.append({"severity": "critical", "title": "Critical risk events", "detail": f"{critical_risk_events} high/critical risk_rule_triggered events.", "href": "/risk"})
        if budget_blocked_count > 0:
            alerts.append({"severity": "warning", "title": "Budget blocks", "detail": f"{budget_blocked_count} budget_blocked events in this window.", "href": f"/dashboard/analytics/risk-health?window={window}&focus=budget_blocked"})

        return {"window": window, "overallStatus": overall_status, "cards": cards, "alerts": alerts}

    def get_consumer_funnel(self, window: str) -> dict:
        result = self._safe_query_json_rows(
            f"""
            SELECT
              event_name AS eventName,
              uniqExact(distinct_id) AS users,
              count() AS events
            FROM {ANALYTICS_TABLE}
            WHERE event_name IN ({_event_in(CONSUMER_FUNNEL_EVENTS)})
              AND {self._event_window_where(window)}
            GROUP BY event_name
            FORMAT JSONEachRow
            """
        )
        by_event = {str(row.get("eventName")): row for row in result.rows}
        steps: list[dict[str, Any]] = []
        previous_users: int | None = None
        for event_name in CONSUMER_FUNNEL_EVENTS:
            row = by_event.get(event_name, {})
            users = _int(row.get("users"))
            events = _int(row.get("events"))
            conversion_rate = 1.0 if previous_users is None else _rate(users, previous_users)
            steps.append(
                {
                    "eventName": event_name,
                    "label": event_name.replace("_", " "),
                    "users": users,
                    "events": events,
                    "conversionRate": conversion_rate,
                    "dropoffRate": round(1 - conversion_rate, 4),
                }
            )
            previous_users = users

        first_invoke_result = self._safe_query_json_rows(
            f"""
            SELECT uniqExact(distinct_id) AS first_invoke_users
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'invoke_completed'
              AND JSONExtractBool(properties, 'is_first_invoke')
              AND {self._event_window_where(window)}
            FORMAT JSONEachRow
            """
        )
        first_invoke_users = _int(_first(first_invoke_result.rows).get("first_invoke_users"))
        first_step_users = steps[0]["users"] if steps else 0
        quote_users = next((step["users"] for step in steps if step["eventName"] == "quote_generated"), 0)
        deposit_users = next((step["users"] for step in steps if step["eventName"] == "deposit_completed"), 0)
        completed_users = next((step["users"] for step in steps if step["eventName"] == "invoke_completed"), 0)
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

    def get_invocation_revenue(self, window: str) -> dict:
        summary = self._safe_query_json_rows(
            f"""
            SELECT
              countIf(event_name = 'quote_generated') AS quote_count,
              countIf(event_name = 'invoke_started') AS invoke_started_count,
              countIf(event_name = 'invoke_completed') AS invoke_completed_count,
              countIf(event_name = 'invoke_failed') AS invoke_failed_count,
              sumIf(JSONExtractFloat(properties, 'price_usdc'), event_name = 'invoke_completed') AS gmv_usdc,
              avgIf(JSONExtractFloat(properties, 'price_usdc'), event_name = 'invoke_completed') AS price_avg_usdc,
              sumIf(JSONExtractFloat(properties, 'platform_fee_usdc'), event_name = 'provider_revenue_received') AS platform_fee_usdc,
              sumIf(JSONExtractFloat(properties, 'provider_net_usdc'), event_name = 'provider_revenue_received') AS provider_net_usdc,
              quantileIf(0.50)(JSONExtractFloat(properties, 'latency_ms'), event_name = 'invoke_completed') AS latency_p50_ms,
              quantileIf(0.95)(JSONExtractFloat(properties, 'latency_ms'), event_name = 'invoke_completed') AS latency_p95_ms,
              quantileIf(0.99)(JSONExtractFloat(properties, 'latency_ms'), event_name = 'invoke_completed') AS latency_p99_ms
            FROM {ANALYTICS_TABLE}
            WHERE {self._event_window_where(window)}
            FORMAT JSONEachRow
            """
        )
        row = _first(summary.rows)
        completed = _int(row.get("invoke_completed_count"))
        failed = _int(row.get("invoke_failed_count"))
        stage_rows = self._safe_query_json_rows(
            f"""
            SELECT
              JSONExtractString(properties, 'failure_stage') AS key,
              JSONExtractString(properties, 'failure_stage') AS label,
              count() AS count,
              count() AS value
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'invoke_failed' AND {self._event_window_where(window)}
            GROUP BY key
            ORDER BY count DESC
            LIMIT 8
            FORMAT JSONEachRow
            """
        ).rows
        error_rows = self._safe_query_json_rows(
            f"""
            SELECT
              JSONExtractString(properties, 'error_code') AS key,
              JSONExtractString(properties, 'error_code') AS label,
              count() AS count,
              count() AS value
            FROM {ANALYTICS_TABLE}
            WHERE event_name IN ('invoke_failed','budget_blocked') AND {self._event_window_where(window)}
            GROUP BY key
            ORDER BY count DESC
            LIMIT 8
            FORMAT JSONEachRow
            """
        ).rows
        bucket_expr = self._bucket_expr(window)
        trend_rows = self._safe_query_json_rows(
            f"""
            SELECT
              toString({bucket_expr}) AS bucket,
              countIf(event_name = 'invoke_completed') AS invokeCompleted,
              countIf(event_name = 'invoke_failed') AS invokeFailed,
              sumIf(JSONExtractFloat(properties, 'price_usdc'), event_name = 'invoke_completed') AS gmvUsdc,
              sumIf(JSONExtractFloat(properties, 'platform_fee_usdc'), event_name = 'provider_revenue_received') AS platformFeeUsdc,
              sumIf(JSONExtractFloat(properties, 'provider_net_usdc'), event_name = 'provider_revenue_received') AS providerNetUsdc
            FROM {ANALYTICS_TABLE}
            WHERE {self._event_window_where(window)}
              AND event_name IN ('invoke_completed','invoke_failed','provider_revenue_received')
            GROUP BY bucket
            ORDER BY bucket ASC
            FORMAT JSONEachRow
            """
        ).rows
        return {
            "window": window,
            "quoteCount": _int(row.get("quote_count")),
            "invokeStartedCount": _int(row.get("invoke_started_count")),
            "invokeCompletedCount": completed,
            "invokeFailedCount": failed,
            "successRate": _rate(completed, completed + failed),
            "gmvUsdc": _float(row.get("gmv_usdc")),
            "priceAvgUsdc": _float(row.get("price_avg_usdc")),
            "platformFeeUsdc": _float(row.get("platform_fee_usdc")),
            "providerNetUsdc": _float(row.get("provider_net_usdc")),
            "latencyMs": {"p50": _float(row.get("latency_p50_ms")), "p95": _float(row.get("latency_p95_ms")), "p99": _float(row.get("latency_p99_ms"))},
            "failureStages": [_list_item(item) for item in stage_rows],
            "errorCodes": [_list_item(item) for item in error_rows],
            "trend": [
                {
                    "bucket": str(item.get("bucket") or ""),
                    "invokeCompleted": _int(item.get("invokeCompleted")),
                    "invokeFailed": _int(item.get("invokeFailed")),
                    "gmvUsdc": _float(item.get("gmvUsdc")),
                    "platformFeeUsdc": _float(item.get("platformFeeUsdc")),
                    "providerNetUsdc": _float(item.get("providerNetUsdc")),
                }
                for item in trend_rows
            ],
        }

    def get_provider_revenue(self, window: str) -> dict:
        summary = self._safe_query_json_rows(
            f"""
            SELECT
              uniqExactIf(JSONExtractString(properties, 'provider_id'), event_name = 'provider_revenue_received') AS revenue_provider_count,
              uniqExactIf(JSONExtractString(properties, 'provider_id'), event_name = 'provider_first_revenue_received') AS first_revenue_provider_count,
              avgIf(JSONExtractFloat(properties, 'time_since_listing_ms'), event_name = 'provider_first_revenue_received') AS avg_time_since_listing_ms,
              sumIf(JSONExtractFloat(properties, 'gross_usdc'), event_name = 'provider_revenue_received') AS provider_gross_usdc,
              sumIf(JSONExtractFloat(properties, 'platform_fee_usdc'), event_name = 'provider_revenue_received') AS platform_fee_usdc,
              sumIf(JSONExtractFloat(properties, 'provider_net_usdc'), event_name = 'provider_revenue_received') AS provider_net_usdc,
              sumIf(JSONExtractFloat(properties, 'claim_usdc'), event_name = 'settlement_claim_completed') AS settlement_completed_usdc,
              countIf(event_name = 'settlement_claim_requested') AS settlement_requested_count,
              countIf(event_name = 'settlement_claim_completed') AS settlement_completed_count,
              countIf(event_name = 'settlement_claim_failed') AS settlement_failed_count,
              quantileIf(0.95)(JSONExtractFloat(properties, 'time_to_confirm_ms'), event_name = 'settlement_claim_completed') AS settlement_p95_confirm_ms
            FROM {ANALYTICS_TABLE}
            WHERE {self._event_window_where(window)}
            FORMAT JSONEachRow
            """
        )
        row = _first(summary.rows)
        requested = _int(row.get("settlement_requested_count"))
        failed = _int(row.get("settlement_failed_count"))
        funnel_rows = self._safe_query_json_rows(
            f"""
            SELECT
              event_name AS eventName,
              event_name AS label,
              count() AS count,
              sum(multiIf(
                event_name IN ('provider_revenue_received','provider_first_revenue_received'),
                JSONExtractFloat(properties, 'gross_usdc'),
                JSONExtractFloat(properties, 'claim_usdc')
              )) AS amountUsdc
            FROM {ANALYTICS_TABLE}
            WHERE event_name IN ('provider_revenue_received','provider_first_revenue_received','settlement_claim_requested','settlement_claim_completed','settlement_claim_failed')
              AND {self._event_window_where(window)}
            GROUP BY event_name
            FORMAT JSONEachRow
            """
        ).rows
        top_rows = self._safe_query_json_rows(
            f"""
            SELECT
              JSONExtractString(properties, 'provider_id') AS providerId,
              any(JSONExtractString(properties, 'service_id')) AS serviceId,
              sum(JSONExtractFloat(properties, 'gross_usdc')) AS grossUsdc,
              sum(JSONExtractFloat(properties, 'provider_net_usdc')) AS providerNetUsdc,
              count() AS invokeCount
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'provider_revenue_received' AND {self._event_window_where(window)}
            GROUP BY providerId
            ORDER BY providerNetUsdc DESC
            LIMIT 10
            FORMAT JSONEachRow
            """
        ).rows
        return {
            "window": window,
            "revenueProviderCount": _int(row.get("revenue_provider_count")),
            "firstRevenueProviderCount": _int(row.get("first_revenue_provider_count")),
            "avgTimeSinceListingMs": _float(row.get("avg_time_since_listing_ms")),
            "providerGrossUsdc": _float(row.get("provider_gross_usdc")),
            "platformFeeUsdc": _float(row.get("platform_fee_usdc")),
            "providerNetUsdc": _float(row.get("provider_net_usdc")),
            "pendingSettlementUsdc": 0,
            "settlementCompletedUsdc": _float(row.get("settlement_completed_usdc")),
            "settlementFailureRate": _rate(failed, requested),
            "settlementP95ConfirmMs": _float(row.get("settlement_p95_confirm_ms")),
            "settlementFunnel": [
                {
                    "eventName": str(item.get("eventName") or ""),
                    "label": str(item.get("label") or ""),
                    "count": _int(item.get("count")),
                    "amountUsdc": _float(item.get("amountUsdc")),
                    "conversionRate": 1.0 if str(item.get("eventName")) == "provider_revenue_received" else _rate(_int(item.get("count")), max(requested, 1)),
                }
                for item in funnel_rows
            ],
            "topProviders": [
                {
                    "providerId": str(item.get("providerId") or "unknown"),
                    "serviceId": str(item.get("serviceId") or "unknown"),
                    "grossUsdc": _float(item.get("grossUsdc")),
                    "providerNetUsdc": _float(item.get("providerNetUsdc")),
                    "invokeCount": _int(item.get("invokeCount")),
                }
                for item in top_rows
            ],
        }

    def get_money_flow(self, window: str) -> dict:
        row = _first(
            self._safe_query_json_rows(
                f"""
                SELECT
                  sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'deposit_completed') AS deposit_usdc,
                  countIf(event_name = 'deposit_failed') AS deposit_failed_count,
                  sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'withdrawal_completed') AS withdrawal_usdc,
                  countIf(event_name = 'withdrawal_failed') AS withdrawal_failed_count,
                  sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'refund_completed') AS refund_usdc,
                  quantileIf(0.50)(JSONExtractFloat(properties, 'time_to_confirm_ms'), event_name IN ('deposit_completed','withdrawal_completed')) AS confirm_p50_ms,
                  quantileIf(0.95)(JSONExtractFloat(properties, 'time_to_confirm_ms'), event_name IN ('deposit_completed','withdrawal_completed')) AS confirm_p95_ms
                FROM {ANALYTICS_TABLE}
                WHERE {self._event_window_where(window)}
                FORMAT JSONEachRow
                """
            ).rows
        )
        deposit_errors = self._safe_query_json_rows(
            f"""
            SELECT JSONExtractString(properties, 'error_code') AS key, JSONExtractString(properties, 'error_code') AS label, count() AS count, count() AS value
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'deposit_failed' AND {self._event_window_where(window)}
            GROUP BY key ORDER BY count DESC LIMIT 8 FORMAT JSONEachRow
            """
        ).rows
        withdrawal_errors = self._safe_query_json_rows(
            f"""
            SELECT JSONExtractString(properties, 'error_code') AS key, JSONExtractString(properties, 'error_code') AS label, count() AS count, count() AS value
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'withdrawal_failed' AND {self._event_window_where(window)}
            GROUP BY key ORDER BY count DESC LIMIT 8 FORMAT JSONEachRow
            """
        ).rows
        deposit_failure_samples = self._safe_query_json_rows(
            f"""
            SELECT
              toString(timestamp) AS eventTimestamp,
              JSONExtractString(properties, 'error_code') AS errorCode,
              JSONExtractFloat(properties, 'amount_usdc') AS amountUsdc,
              JSONExtractString(properties, 'env') AS env,
              JSONExtractString(properties, 'correlation_id') AS correlationId,
              JSONExtractString(properties, 'tx_hash') AS txHash
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'deposit_failed' AND {self._event_window_where(window)}
            ORDER BY timestamp DESC
            LIMIT 10
            FORMAT JSONEachRow
            """
        ).rows
        return {
            "window": window,
            "depositUsdc": _float(row.get("deposit_usdc")),
            "depositFailedCount": _int(row.get("deposit_failed_count")),
            "withdrawalUsdc": _float(row.get("withdrawal_usdc")),
            "withdrawalFailedCount": _int(row.get("withdrawal_failed_count")),
            "refundUsdc": _float(row.get("refund_usdc")),
            "confirmLatencyMs": {"p50": _float(row.get("confirm_p50_ms")), "p95": _float(row.get("confirm_p95_ms"))},
            "depositErrors": [_list_item(item) for item in deposit_errors],
            "depositFailureSamples": [
                {
                    "timestamp": str(item.get("eventTimestamp") or item.get("timestamp") or ""),
                    "errorCode": str(item.get("errorCode") or "unknown"),
                    "amountUsdc": _float(item.get("amountUsdc")),
                    "env": str(item.get("env") or "unknown"),
                    "correlationId": str(item.get("correlationId") or ""),
                    "txHash": str(item.get("txHash") or ""),
                }
                for item in deposit_failure_samples
            ],
            "withdrawalErrors": [_list_item(item) for item in withdrawal_errors],
            "financeContext": {},
        }

    def get_risk_health(self, window: str) -> dict:
        summary = _first(
            self._safe_query_json_rows(
                f"""
                SELECT
                  countIf(event_name = 'risk_rule_triggered' AND lower(JSONExtractString(properties, 'severity')) IN ('critical','high')) AS critical_risk_events,
                  countIf(event_name = 'provider_health_degraded') AS provider_health_degraded_count,
                  sumIf(greatest(JSONExtractFloat(properties, 'required_usdc') - JSONExtractFloat(properties, 'available_usdc'), 0), event_name = 'budget_blocked') AS budget_gap_usdc
                FROM {ANALYTICS_TABLE}
                WHERE {self._event_window_where(window)}
                FORMAT JSONEachRow
                """
            ).rows
        )
        risk_rules = self._safe_query_json_rows(
            f"""
            SELECT JSONExtractString(properties, 'rule_code') AS key, JSONExtractString(properties, 'rule_code') AS label, count() AS count, count() AS value
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'risk_rule_triggered' AND {self._event_window_where(window)}
            GROUP BY key ORDER BY count DESC LIMIT 8 FORMAT JSONEachRow
            """
        ).rows
        surfaces = self._safe_query_json_rows(
            f"""
            SELECT JSONExtractString(properties, 'surface') AS key, JSONExtractString(properties, 'surface') AS label, count() AS count, count() AS value
            FROM {ANALYTICS_TABLE}
            WHERE event_name IN ('risk_rule_triggered','budget_blocked','invoke_failed') AND {self._event_window_where(window)}
            GROUP BY key ORDER BY count DESC LIMIT 8 FORMAT JSONEachRow
            """
        ).rows
        provider_rows = self._safe_query_json_rows(
            f"""
            SELECT
              JSONExtractString(properties, 'provider_id') AS providerId,
              any(JSONExtractString(properties, 'service_id')) AS serviceId,
              count() AS count,
              any(JSONExtractString(properties, 'reason')) AS reason
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'provider_health_degraded' AND {self._event_window_where(window)}
            GROUP BY providerId ORDER BY count DESC LIMIT 8 FORMAT JSONEachRow
            """
        ).rows
        budget_blocks = self._safe_query_json_rows(
            f"""
            SELECT
              concat(
                if(empty(JSONExtractString(properties, 'error_code')), 'unknown', JSONExtractString(properties, 'error_code')),
                '-',
                if(empty(JSONExtractString(properties, 'service_id')), 'unknown', JSONExtractString(properties, 'service_id')),
                '-',
                if(empty(JSONExtractString(properties, 'surface')), 'unknown', JSONExtractString(properties, 'surface'))
              ) AS key,
              if(empty(JSONExtractString(properties, 'error_code')), 'unknown', JSONExtractString(properties, 'error_code')) AS errorCode,
              if(empty(JSONExtractString(properties, 'service_id')), 'unknown', JSONExtractString(properties, 'service_id')) AS serviceId,
              if(empty(JSONExtractString(properties, 'surface')), 'unknown', JSONExtractString(properties, 'surface')) AS surface,
              count() AS count,
              sum(JSONExtractFloat(properties, 'required_usdc')) AS requiredUsdc,
              sum(JSONExtractFloat(properties, 'available_usdc')) AS availableUsdc,
              sum(greatest(JSONExtractFloat(properties, 'required_usdc') - JSONExtractFloat(properties, 'available_usdc'), 0)) AS gapUsdc
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'budget_blocked' AND {self._event_window_where(window)}
            GROUP BY errorCode, serviceId, surface
            ORDER BY count DESC
            LIMIT 10
            FORMAT JSONEachRow
            """
        ).rows
        budget_block_samples = self._safe_query_json_rows(
            f"""
            SELECT
              toString(timestamp) AS eventTimestamp,
              if(empty(JSONExtractString(properties, 'service_id')), 'unknown', JSONExtractString(properties, 'service_id')) AS serviceId,
              if(empty(JSONExtractString(properties, 'error_code')), 'unknown', JSONExtractString(properties, 'error_code')) AS errorCode,
              JSONExtractFloat(properties, 'required_usdc') AS requiredUsdc,
              JSONExtractFloat(properties, 'available_usdc') AS availableUsdc,
              JSONExtractString(properties, 'correlation_id') AS correlationId,
              if(empty(JSONExtractString(properties, 'surface')), 'unknown', JSONExtractString(properties, 'surface')) AS surface
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'budget_blocked' AND {self._event_window_where(window)}
            ORDER BY timestamp DESC
            LIMIT 10
            FORMAT JSONEachRow
            """
        ).rows
        refund_reasons = self._safe_query_json_rows(
            f"""
            SELECT
              JSONExtractString(properties, 'reason_code') AS key,
              JSONExtractString(properties, 'reason_code') AS label,
              count() AS count,
              sum(JSONExtractFloat(properties, 'amount_usdc')) AS value
            FROM {ANALYTICS_TABLE}
            WHERE event_name = 'refund_completed' AND {self._event_window_where(window)}
            GROUP BY key ORDER BY count DESC LIMIT 8 FORMAT JSONEachRow
            """
        ).rows
        return {
            "window": window,
            "criticalRiskEvents": _int(summary.get("critical_risk_events")),
            "riskRules": [_list_item(item) for item in risk_rules],
            "surfaces": [_list_item(item) for item in surfaces],
            "providerHealthDegradedCount": _int(summary.get("provider_health_degraded_count")),
            "degradedProviders": [
                {
                    "providerId": str(item.get("providerId") or "unknown"),
                    "serviceId": str(item.get("serviceId") or "unknown"),
                    "count": _int(item.get("count")),
                    "reason": str(item.get("reason") or "unknown"),
                }
                for item in provider_rows
            ],
            "budgetGapUsdc": _float(summary.get("budget_gap_usdc")),
            "budgetBlocks": [
                {
                    "key": str(item.get("key") or "unknown"),
                    "errorCode": str(item.get("errorCode") or "unknown"),
                    "serviceId": str(item.get("serviceId") or "unknown"),
                    "surface": str(item.get("surface") or "unknown"),
                    "count": _int(item.get("count")),
                    "requiredUsdc": _float(item.get("requiredUsdc")),
                    "availableUsdc": _float(item.get("availableUsdc")),
                    "gapUsdc": _float(item.get("gapUsdc")),
                }
                for item in budget_blocks
            ],
            "budgetBlockSamples": [
                {
                    "timestamp": str(item.get("eventTimestamp") or item.get("timestamp") or ""),
                    "serviceId": str(item.get("serviceId") or "unknown"),
                    "errorCode": str(item.get("errorCode") or "unknown"),
                    "requiredUsdc": _float(item.get("requiredUsdc")),
                    "availableUsdc": _float(item.get("availableUsdc")),
                    "correlationId": str(item.get("correlationId") or ""),
                    "surface": str(item.get("surface") or "unknown"),
                }
                for item in budget_block_samples
            ],
            "refundReasons": [_list_item(item) for item in refund_reasons],
        }

    def get_data_quality(self, window: str) -> dict:
        result = self._safe_query_json_rows(
            f"""
            SELECT
              count() AS event_count,
              uniqExact(event_id) AS unique_event_ids,
              count() - uniqExact(event_id) AS duplicate_count,
              countIf(startsWith(distinct_id, '0x') OR length(distinct_id) = 42 OR position(properties, '0x') > 0) AS privacy_violations,
              countIf(event_name = 'invoke_completed' AND (NOT JSONHas(properties, 'service_id') OR NOT JSONHas(properties, 'provider_id') OR NOT JSONHas(properties, 'price_usdc'))) AS invoke_completed_missing,
              countIf(event_name = 'invoke_failed' AND (NOT JSONHas(properties, 'error_code') OR NOT JSONHas(properties, 'failure_stage'))) AS invoke_failed_missing,
              countIf(event_name = 'deposit_completed' AND (NOT JSONHas(properties, 'amount_usdc') OR NOT JSONHas(properties, 'time_to_confirm_ms'))) AS deposit_completed_missing,
              countIf(source = 'file' OR source = 'file_backend' OR JSONExtractString(properties, 'backend') = 'file') AS file_backend_fallback_events
            FROM {ANALYTICS_TABLE}
            WHERE {self._event_window_where(window)}
            FORMAT JSONEachRow
            """
        )
        row = _first(result.rows)
        source_rows = self._safe_query_json_rows(
            f"""
            SELECT source, count() AS count
            FROM {ANALYTICS_TABLE}
            WHERE {self._event_window_where(window)}
            GROUP BY source
            FORMAT JSONEachRow
            """
        ).rows
        freshness_rows = self._safe_query_json_rows(
            f"""
            SELECT event_name AS eventName, max(timestamp) AS lastSeenAt, count() AS count
            FROM {ANALYTICS_TABLE}
            WHERE event_name IN ({_event_in(CRITICAL_EVENTS)})
              AND {self._event_window_where(window)}
            GROUP BY event_name
            FORMAT JSONEachRow
            """
        ).rows
        xor_rows = self._safe_query_json_rows(
            f"""
            SELECT count() AS xor_violations
            FROM (
              SELECT
                coalesce(JSONExtractString(properties, 'request_id'), JSONExtractString(properties, 'quote_id')) AS correlation_id,
                countIf(event_name = 'invoke_completed') AS completed,
                countIf(event_name = 'invoke_failed') AS failed
              FROM {ANALYTICS_TABLE}
              WHERE event_name IN ('invoke_completed','invoke_failed')
                AND {self._event_window_where(window)}
              GROUP BY correlation_id
              HAVING correlation_id != '' AND completed > 0 AND failed > 0
            )
            FORMAT JSONEachRow
            """
        ).rows
        event_count = _int(row.get("event_count"))
        duplicate_rate = _rate(_int(row.get("duplicate_count")), event_count)
        missing_required = _int(row.get("invoke_completed_missing")) + _int(row.get("invoke_failed_missing")) + _int(row.get("deposit_completed_missing"))
        xor_violations = _int(_first(xor_rows).get("xor_violations"))
        source_coverage = {str(item.get("source") or "unknown"): _int(item.get("count")) for item in source_rows}
        by_event = {str(item.get("eventName")): item for item in freshness_rows}
        critical_freshness = [
            {
                "eventName": event_name,
                "seen": event_name in by_event,
                "lastSeenAt": str(by_event.get(event_name, {}).get("lastSeenAt") or ""),
                "count": _int(by_event.get(event_name, {}).get("count")),
            }
            for event_name in CRITICAL_EVENTS
        ]
        overall_status = "nominal"
        if result.source_status != "healthy" or event_count == 0 or any(not item["seen"] for item in critical_freshness) or _int(row.get("privacy_violations")) > 0 or xor_violations > 0:
            overall_status = "degraded"
        elif duplicate_rate > 0.01 or missing_required > 0 or _int(row.get("file_backend_fallback_events")) > 0:
            overall_status = "monitoring"
        return {
            "window": window,
            "overallStatus": overall_status,
            "eventCount": event_count,
            "duplicateRate": duplicate_rate,
            "criticalEventsFreshness": critical_freshness,
            "sourceCoverage": source_coverage,
            "privacyViolations": _int(row.get("privacy_violations")),
            "missingRequiredProperties": missing_required,
            "xorViolations": xor_violations,
            "kafkaLag": 0,
            "clickhouseLag": 0,
            "fileBackendFallbackEvents": _int(row.get("file_backend_fallback_events")),
            "schemaIssueSamples": [
                {"eventName": "invoke_completed", "issue": "missing required properties", "count": _int(row.get("invoke_completed_missing"))},
                {"eventName": "invoke_failed", "issue": "missing required properties", "count": _int(row.get("invoke_failed_missing"))},
                {"eventName": "deposit_completed", "issue": "missing required properties", "count": _int(row.get("deposit_completed_missing"))},
            ],
        }
