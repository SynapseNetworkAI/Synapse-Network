from src.storage.analytics.analytics_dashboard import ClickHouseAnalyticsDashboardRepository


def test_clickhouse_data_quality_marks_raw_wallet_and_missing_critical_events_as_degraded(monkeypatch) -> None:
    repository = ClickHouseAnalyticsDashboardRepository("http://clickhouse.invalid")

    def fake_query(sql: str):
        if "uniqExact(event_id)" in sql:
            return type(
                "Result",
                (),
                {
                    "rows": [
                        {
                            "event_count": 10,
                            "unique_event_ids": 9,
                            "duplicate_count": 1,
                            "privacy_violations": 1,
                            "invoke_completed_missing": 0,
                            "invoke_failed_missing": 0,
                            "deposit_completed_missing": 0,
                            "file_backend_fallback_events": 0,
                        }
                    ],
                    "source_status": "healthy",
                    "error": None,
                },
            )()
        if "SELECT source" in sql:
            return type("Result", (), {"rows": [{"source": "gateway", "count": 10}], "source_status": "healthy", "error": None})()
        if "max(timestamp)" in sql:
            return type(
                "Result",
                (),
                {
                    "rows": [
                        {"eventName": "page_viewed", "lastSeenAt": "2026-04-16 00:00:00", "count": 8},
                    ],
                    "source_status": "healthy",
                    "error": None,
                },
            )()
        return type("Result", (), {"rows": [{"xor_violations": 0}], "source_status": "healthy", "error": None})()

    monkeypatch.setattr(repository, "_safe_query_json_rows", fake_query)

    payload = repository.get_data_quality("24h")

    assert payload["overallStatus"] == "degraded"
    assert payload["duplicateRate"] == 0.1
    assert payload["privacyViolations"] == 1
    assert any(item["eventName"] == "invoke_completed" and item["seen"] is False for item in payload["criticalEventsFreshness"])


def test_clickhouse_consumer_funnel_preserves_zero_rows_defaults(monkeypatch) -> None:
    repository = ClickHouseAnalyticsDashboardRepository("http://clickhouse.invalid")

    monkeypatch.setattr(
        repository,
        "_safe_query_json_rows",
        lambda _sql: type("Result", (), {"rows": [], "source_status": "healthy", "error": None})(),
    )

    payload = repository.get_consumer_funnel("24h")

    assert payload["steps"][0]["eventName"] == "page_viewed"
    assert payload["steps"][0]["users"] == 0
    assert payload["summary"]["activationRate"] == 0


def test_clickhouse_invocation_revenue_counts_started_events(monkeypatch) -> None:
    repository = ClickHouseAnalyticsDashboardRepository("http://clickhouse.invalid")

    def fake_query(sql: str):
        if "countIf(event_name = 'quote_generated')" in sql:
            return type(
                "Result",
                (),
                {
                    "rows": [
                        {
                            "quote_count": 3,
                            "invoke_started_count": 2,
                            "invoke_completed_count": 1,
                            "invoke_failed_count": 1,
                            "gmv_usdc": 0.02,
                            "price_avg_usdc": 0.02,
                            "platform_fee_usdc": 0.003,
                            "provider_net_usdc": 0.017,
                            "latency_p50_ms": 120,
                            "latency_p95_ms": 180,
                            "latency_p99_ms": 220,
                        }
                    ],
                    "source_status": "healthy",
                    "error": None,
                },
            )()
        return type("Result", (), {"rows": [], "source_status": "healthy", "error": None})()

    monkeypatch.setattr(repository, "_safe_query_json_rows", fake_query)

    payload = repository.get_invocation_revenue("24h")

    assert payload["quoteCount"] == 3
    assert payload["invokeStartedCount"] == 2
    assert payload["invokeCompletedCount"] == 1
    assert payload["successRate"] == 0.5


def test_clickhouse_overview_budget_alert_links_to_risk_drilldown(monkeypatch) -> None:
    repository = ClickHouseAnalyticsDashboardRepository("http://clickhouse.invalid")

    monkeypatch.setattr(
        repository,
        "_safe_query_json_rows",
        lambda _sql: type(
            "Result",
            (),
            {
                "rows": [
                    {
                        "invoke_completed_count": 6,
                        "invoke_failed_count": 0,
                        "budget_blocked_count": 2,
                        "critical_risk_events": 0,
                        "gmv_usdc": 2.62,
                        "platform_fee_usdc": 0.24,
                        "provider_net_usdc": 2.18,
                    }
                ],
                "source_status": "healthy",
                "error": None,
            },
        )(),
    )

    payload = repository.get_overview("7d")

    assert payload["overallStatus"] == "monitoring"
    assert payload["alerts"][0]["title"] == "Budget blocks"
    assert payload["alerts"][0]["href"] == "/dashboard/analytics/risk-health?window=7d&focus=budget_blocked"


def test_clickhouse_risk_health_returns_budget_block_breakdown_and_samples(monkeypatch) -> None:
    repository = ClickHouseAnalyticsDashboardRepository("http://clickhouse.invalid")

    def fake_query(sql: str):
        if "budget_gap_usdc" in sql and "countIf(event_name = 'provider_health_degraded')" in sql:
            return type("Result", (), {"rows": [{"critical_risk_events": 0, "provider_health_degraded_count": 0, "budget_gap_usdc": 0}], "source_status": "healthy", "error": None})()
        if "GROUP BY errorCode, serviceId, surface" in sql:
            return type(
                "Result",
                (),
                {
                    "rows": [
                        {
                            "key": "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED-svc.echo-gateway_api",
                            "errorCode": "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED",
                            "serviceId": "svc.echo",
                            "surface": "gateway_api",
                            "count": 2,
                            "requiredUsdc": 2.5,
                            "availableUsdc": 37.5,
                            "gapUsdc": 0,
                        }
                    ],
                    "source_status": "healthy",
                    "error": None,
                },
            )()
        if "event_name = 'budget_blocked'" in sql and "ORDER BY timestamp DESC" in sql:
            return type(
                "Result",
                (),
                {
                    "rows": [
                        {
                            "timestamp": "2026-04-11 02:32:58",
                            "serviceId": "svc.echo",
                            "errorCode": "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED",
                            "requiredUsdc": 1.25,
                            "availableUsdc": 18.75,
                            "correlationId": "req-owner-cap-invoke-001",
                            "surface": "gateway_api",
                        }
                    ],
                    "source_status": "healthy",
                    "error": None,
                },
            )()
        return type("Result", (), {"rows": [], "source_status": "healthy", "error": None})()

    monkeypatch.setattr(repository, "_safe_query_json_rows", fake_query)

    payload = repository.get_risk_health("7d")

    assert payload["budgetBlocks"][0]["errorCode"] == "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED"
    assert payload["budgetBlocks"][0]["serviceId"] == "svc.echo"
    assert payload["budgetBlockSamples"][0]["correlationId"] == "req-owner-cap-invoke-001"


def test_clickhouse_money_flow_returns_deposit_failure_samples(monkeypatch) -> None:
    repository = ClickHouseAnalyticsDashboardRepository("http://clickhouse.invalid")

    def fake_query(sql: str):
        if "deposit_failed_count" in sql:
            return type("Result", (), {"rows": [{"deposit_usdc": 10, "deposit_failed_count": 2, "withdrawal_usdc": 0, "withdrawal_failed_count": 0, "refund_usdc": 0, "confirm_p50_ms": 0, "confirm_p95_ms": 0}], "source_status": "healthy", "error": None})()
        if "event_name = 'deposit_failed'" in sql and "ORDER BY timestamp DESC" in sql:
            return type(
                "Result",
                (),
                {
                    "rows": [
                        {
                            "timestamp": "2026-04-16 15:58:58",
                            "errorCode": "INVALID_INTENT",
                            "amountUsdc": 10,
                            "env": "staging",
                            "correlationId": "",
                            "txHash": "",
                        }
                    ],
                    "source_status": "healthy",
                    "error": None,
                },
            )()
        if "event_name = 'deposit_failed'" in sql:
            return type("Result", (), {"rows": [{"key": "INVALID_INTENT", "label": "INVALID_INTENT", "count": 2, "value": 2}], "source_status": "healthy", "error": None})()
        return type("Result", (), {"rows": [], "source_status": "healthy", "error": None})()

    monkeypatch.setattr(repository, "_safe_query_json_rows", fake_query)

    payload = repository.get_money_flow("7d")

    assert payload["depositFailedCount"] == 2
    assert payload["depositErrors"][0]["key"] == "INVALID_INTENT"
    assert payload["depositFailureSamples"][0]["errorCode"] == "INVALID_INTENT"
    assert payload["depositFailureSamples"][0]["env"] == "staging"
