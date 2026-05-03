from src.api import deps
from src.core.config import get_settings
from src.storage.analytics.analytics_dashboard import ClickHouseAnalyticsDashboardRepository
from src.storage.analytics.postgres_analytics_dashboard import PostgresAnalyticsDashboardRepository


def _postgres_event(
    event_id: str,
    event_name: str,
    *,
    distinct_id: str = "hashed-user",
    timestamp: str = "2026-04-16T00:00:00+00:00",
    source: str = "gateway",
    properties: dict | None = None,
) -> dict:
    return {
        "event_id": event_id,
        "event_name": event_name,
        "timestamp": timestamp,
        "distinct_id": distinct_id,
        "source": source,
        "properties": properties or {},
    }


def _stub_postgres_events(monkeypatch, repository: PostgresAnalyticsDashboardRepository, events: list[dict], *, source_status: str = "healthy") -> None:
    monkeypatch.setattr(
        repository,
        "_safe_events",
        lambda _window: type("Result", (), {"rows": events, "source_status": source_status, "error": None})(),
    )


def test_analytics_dependency_uses_postgres_repository_by_default(monkeypatch) -> None:
    monkeypatch.setenv("ANALYTICS_CLICKHOUSE_URL", "http://clickhouse.test:8123")
    get_settings.cache_clear()
    deps.get_analytics_dashboard_repository.cache_clear()

    repository = deps.get_analytics_dashboard_repository()

    assert isinstance(repository, PostgresAnalyticsDashboardRepository)

    deps.get_analytics_dashboard_repository.cache_clear()
    get_settings.cache_clear()


def test_analytics_dependency_keeps_clickhouse_escape_hatch(monkeypatch) -> None:
    monkeypatch.setenv("ADMIN_ANALYTICS_SOURCE", "clickhouse")
    monkeypatch.setenv("ANALYTICS_CLICKHOUSE_URL", "http://clickhouse.test:8123")
    get_settings.cache_clear()
    deps.get_analytics_dashboard_repository.cache_clear()

    repository = deps.get_analytics_dashboard_repository()

    assert isinstance(repository, ClickHouseAnalyticsDashboardRepository)

    deps.get_analytics_dashboard_repository.cache_clear()
    get_settings.cache_clear()


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


def test_postgres_overview_reads_outbox_payloads(monkeypatch) -> None:
    repository = PostgresAnalyticsDashboardRepository("postgresql://example.invalid/db")
    events = [
        {
            "event_id": "evt-1",
            "event_name": "invoke_completed",
            "timestamp": "2026-04-16T00:00:00+00:00",
            "distinct_id": "hashed-consumer",
            "source": "gateway",
            "properties": {"price_usdc": "1.250000"},
        },
        {
            "event_id": "evt-2",
            "event_name": "provider_revenue_received",
            "timestamp": "2026-04-16T00:00:01+00:00",
            "distinct_id": "hashed-provider",
            "source": "gateway",
            "properties": {"platform_fee_usdc": "0.125000", "provider_net_usdc": "1.125000"},
        },
    ]
    monkeypatch.setattr(
        repository,
        "_safe_events",
        lambda _window: type("Result", (), {"rows": events, "source_status": "healthy", "error": None})(),
    )

    payload = repository.get_overview("24h")

    assert payload["cards"][0]["key"] == "gmv_usdc"
    assert payload["cards"][0]["value"] == "1.250000"
    assert next(card for card in payload["cards"] if card["key"] == "analytics_health")["detail"] == "Postgres analytics outbox is queryable."


def test_postgres_data_quality_does_not_treat_tx_hash_as_privacy_violation(monkeypatch) -> None:
    repository = PostgresAnalyticsDashboardRepository("postgresql://example.invalid/db")
    events = [
        {
            "event_id": "evt-1",
            "event_name": "page_viewed",
            "timestamp": "2026-04-16T00:00:00+00:00",
            "distinct_id": "hashed-user",
            "source": "gateway",
            "properties": {},
        },
        {
            "event_id": "evt-2",
            "event_name": "wallet_connected",
            "timestamp": "2026-04-16T00:00:00+00:00",
            "distinct_id": "hashed-user",
            "source": "gateway",
            "properties": {},
        },
        {
            "event_id": "evt-3",
            "event_name": "invoke_completed",
            "timestamp": "2026-04-16T00:00:00+00:00",
            "distinct_id": "hashed-user",
            "source": "gateway",
            "properties": {
                "service_id": "svc.echo",
                "provider_id": "provider-1",
                "price_usdc": "1.000000",
                "tx_hash": "0x" + "a" * 64,
            },
        },
        {
            "event_id": "evt-4",
            "event_name": "deposit_completed",
            "timestamp": "2026-04-16T00:00:00+00:00",
            "distinct_id": "hashed-user",
            "source": "gateway",
            "properties": {"amount_usdc": "10.000000", "time_to_confirm_ms": 100},
        },
    ]
    monkeypatch.setattr(
        repository,
        "_safe_events",
        lambda _window: type("Result", (), {"rows": events, "source_status": "healthy", "error": None})(),
    )

    payload = repository.get_data_quality("24h")

    assert payload["overallStatus"] == "nominal"
    assert payload["privacyViolations"] == 0
    assert payload["missingRequiredProperties"] == 0


def test_postgres_repository_projects_all_admin_analytics_views(monkeypatch) -> None:
    repository = PostgresAnalyticsDashboardRepository("postgresql://example.invalid/db")
    events = [
        _postgres_event("evt-page", "page_viewed"),
        _postgres_event("evt-wallet", "wallet_connected"),
        _postgres_event("evt-signup", "consumer_signup_completed"),
        _postgres_event("evt-quote", "quote_generated"),
        _postgres_event("evt-deposit", "deposit_completed", properties={"amount_usdc": "25", "time_to_confirm_ms": 100}),
        _postgres_event("evt-started", "invoke_started"),
        _postgres_event(
            "evt-completed-1",
            "invoke_completed",
            timestamp="2026-04-16T00:10:00+00:00",
            properties={"service_id": "svc.echo", "provider_id": "provider-1", "price_usdc": "2.000000", "latency_ms": 100, "is_first_invoke": True, "request_id": "req-1"},
        ),
        _postgres_event(
            "evt-completed-2",
            "invoke_completed",
            timestamp="2026-04-16T00:20:00+00:00",
            properties={"service_id": "svc.echo", "provider_id": "provider-1", "price_usdc": "4.000000", "latency_ms": 300, "request_id": "req-2"},
        ),
        _postgres_event(
            "evt-failed",
            "invoke_failed",
            timestamp="2026-04-16T00:30:00+00:00",
            properties={"error_code": "UPSTREAM_TIMEOUT", "failure_stage": "provider", "surface": "gateway_api", "quote_id": "quote-failed"},
        ),
        _postgres_event(
            "evt-provider-revenue",
            "provider_revenue_received",
            distinct_id="hashed-provider",
            properties={"provider_id": "provider-1", "service_id": "svc.echo", "gross_usdc": "6.000000", "platform_fee_usdc": "0.600000", "provider_net_usdc": "5.400000"},
        ),
        _postgres_event(
            "evt-first-provider-revenue",
            "provider_first_revenue_received",
            distinct_id="hashed-provider",
            properties={"provider_id": "provider-1", "gross_usdc": "6.000000", "time_since_listing_ms": 1200},
        ),
        _postgres_event("evt-claim-requested", "settlement_claim_requested", properties={"claim_usdc": "5.400000"}),
        _postgres_event("evt-claim-completed", "settlement_claim_completed", properties={"claim_usdc": "5.400000", "time_to_confirm_ms": 500}),
        _postgres_event("evt-claim-failed", "settlement_claim_failed", properties={"claim_usdc": "1.000000"}),
        _postgres_event("evt-deposit-failed", "deposit_failed", properties={"error_code": "INVALID_INTENT", "amount_usdc": "3", "env": "staging", "correlation_id": "dep-1", "tx_hash": "0xabc"}),
        _postgres_event("evt-withdrawal-completed", "withdrawal_completed", properties={"amount_usdc": "2", "time_to_confirm_ms": 200}),
        _postgres_event("evt-withdrawal-failed", "withdrawal_failed", properties={"amount_usdc": "1", "error_code": "CHAIN_REVERT"}),
        _postgres_event("evt-refund", "refund_completed", properties={"amount_usdc": "1.5", "reason_code": "consumer_refund"}),
        _postgres_event("evt-risk", "risk_rule_triggered", properties={"severity": "critical", "rule_code": "velocity_limit", "surface": "gateway_api"}),
        _postgres_event(
            "evt-budget",
            "budget_blocked",
            properties={"error_code": "OWNER_LIMIT", "service_id": "svc.echo", "surface": "gateway_api", "required_usdc": "10", "available_usdc": "7"},
        ),
        _postgres_event("evt-provider-health", "provider_health_degraded", properties={"provider_id": "provider-1", "service_id": "svc.echo", "reason": "probe_failed"}),
        _postgres_event("evt-privacy", "page_viewed", distinct_id="hashed-privacy", properties={"wallet_address": "0x" + "1" * 40}),
    ]
    _stub_postgres_events(monkeypatch, repository, events)

    overview = repository.get_overview("24h")
    funnel = repository.get_consumer_funnel("24h")
    invocation = repository.get_invocation_revenue("24h")
    provider = repository.get_provider_revenue("24h")
    money = repository.get_money_flow("24h")
    risk = repository.get_risk_health("24h")
    quality = repository.get_data_quality("24h")

    assert overview["overallStatus"] == "degraded"
    assert any(alert["title"] == "Critical risk events" for alert in overview["alerts"])
    assert funnel["summary"]["firstInvokeUsers"] == 1
    assert invocation["invokeCompletedCount"] == 2
    assert invocation["gmvUsdc"] == "6.000000"
    assert invocation["latencyMs"]["p95"] == 290.0
    assert invocation["failureStages"][0]["key"] == "provider"
    assert provider["revenueProviderCount"] == 1
    assert provider["settlementCompletedUsdc"] == "5.400000"
    assert provider["topProviders"][0]["providerNetUsdc"] == "5.400000"
    assert money["depositFailedCount"] == 1
    assert money["depositFailureSamples"][0]["correlationId"] == "dep-1"
    assert risk["budgetGapUsdc"] == "3.000000"
    assert risk["budgetBlocks"][0]["gapUsdc"] == "3.000000"
    assert quality["overallStatus"] == "degraded"
    assert quality["privacyViolations"] == 1
    assert quality["sourceCoverage"]["gateway"] == len(events)


def test_postgres_safe_events_reports_degraded_when_postgres_is_unavailable(monkeypatch) -> None:
    repository = PostgresAnalyticsDashboardRepository("postgresql://example.invalid/db")

    def raise_connect(*_args, **_kwargs):
        raise RuntimeError("postgres unavailable")

    monkeypatch.setattr("src.storage.analytics.postgres_analytics_dashboard.psycopg.connect", raise_connect)

    result = repository._safe_events("24h")

    assert result.rows == []
    assert result.source_status == "degraded"
    assert result.error == "postgres unavailable"


def test_postgres_normalizes_json_payload_rows() -> None:
    row = {
        "event_id": "row-event-id",
        "event_name": "row-event",
        "event_key": "row-key",
        "created_at": "2026-04-16T00:00:00+00:00",
        "payload": '{"event_id":"payload-event-id","event_name":"payload-event","timestamp":"2026-04-16T00:01:00+00:00","distinct_id":"payload-user","source":"gateway","properties":{"price_usdc":"1.23"}}',
    }

    normalized = PostgresAnalyticsDashboardRepository._normalize_event(row)

    assert normalized["event_id"] == "payload-event-id"
    assert normalized["event_name"] == "payload-event"
    assert normalized["distinct_id"] == "payload-user"
    assert normalized["properties"]["price_usdc"] == "1.23"


def test_clickhouse_data_quality_does_not_treat_tx_hash_as_privacy_violation(monkeypatch) -> None:
    repository = ClickHouseAnalyticsDashboardRepository("http://clickhouse.invalid")
    captured_sql: list[str] = []

    def fake_query(sql: str):
        captured_sql.append(sql)
        if "uniqExact(event_id)" in sql:
            return type(
                "Result",
                (),
                {
                    "rows": [
                        {
                            "event_count": 1,
                            "unique_event_ids": 1,
                            "duplicate_count": 0,
                            "privacy_violations": 0,
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
            return type("Result", (), {"rows": [{"source": "gateway", "count": 1}], "source_status": "healthy", "error": None})()
        if "max(timestamp)" in sql:
            return type(
                "Result",
                (),
                {
                    "rows": [
                        {"eventName": "page_viewed", "lastSeenAt": "2026-04-16 00:00:00", "count": 1},
                        {"eventName": "wallet_connected", "lastSeenAt": "2026-04-16 00:00:00", "count": 1},
                        {"eventName": "invoke_completed", "lastSeenAt": "2026-04-16 00:00:00", "count": 1},
                        {"eventName": "deposit_completed", "lastSeenAt": "2026-04-16 00:00:00", "count": 1},
                    ],
                    "source_status": "healthy",
                    "error": None,
                },
            )()
        return type("Result", (), {"rows": [{"xor_violations": 0}], "source_status": "healthy", "error": None})()

    monkeypatch.setattr(repository, "_safe_query_json_rows", fake_query)

    payload = repository.get_data_quality("24h")

    quality_sql = next(sql for sql in captured_sql if "uniqExact(event_id)" in sql)
    assert "position(properties, '0x')" not in quality_sql
    assert "JSONExtractString(properties, 'tx_hash')" not in quality_sql
    assert payload["privacyViolations"] == 0


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
    assert payload["gmvUsdc"] == "0.020000"
    assert payload["priceAvgUsdc"] == "0.020000"
    assert payload["platformFeeUsdc"] == "0.003000"
    assert payload["providerNetUsdc"] == "0.017000"


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
    assert payload["budgetBlocks"][0]["requiredUsdc"] == "2.500000"
    assert payload["budgetBlocks"][0]["availableUsdc"] == "37.500000"
    assert payload["budgetBlocks"][0]["gapUsdc"] == "0.000000"
    assert payload["budgetBlockSamples"][0]["correlationId"] == "req-owner-cap-invoke-001"
    assert payload["budgetBlockSamples"][0]["requiredUsdc"] == "1.250000"
    assert payload["budgetBlockSamples"][0]["availableUsdc"] == "18.750000"


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
    assert payload["depositUsdc"] == "10.000000"
    assert payload["withdrawalUsdc"] == "0.000000"
    assert payload["refundUsdc"] == "0.000000"
    assert payload["depositErrors"][0]["key"] == "INVALID_INTENT"
    assert payload["depositFailureSamples"][0]["errorCode"] == "INVALID_INTENT"
    assert payload["depositFailureSamples"][0]["amountUsdc"] == "10.000000"
    assert payload["depositFailureSamples"][0]["env"] == "staging"
