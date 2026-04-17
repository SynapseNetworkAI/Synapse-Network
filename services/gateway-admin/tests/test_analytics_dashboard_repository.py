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
