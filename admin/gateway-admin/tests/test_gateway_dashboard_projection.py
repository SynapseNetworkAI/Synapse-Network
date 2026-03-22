from src.storage.analytics import gateway_dashboard


def test_resolve_projection_column_prefers_primary_name() -> None:
    columns = frozenset({"today_refund_usdc", "today_consumer_refund_usdc"})

    resolved = gateway_dashboard._resolve_projection_column(
        columns,
        "today_consumer_refund_usdc",
        "today_refund_usdc",
    )

    assert resolved == "today_consumer_refund_usdc"


def test_resolve_projection_column_falls_back_to_legacy_name() -> None:
    columns = frozenset({"today_refund_usdc", "pending_withdrawal_count"})

    refund_column = gateway_dashboard._resolve_projection_column(
        columns,
        "today_consumer_refund_usdc",
        "today_refund_usdc",
    )
    withdrawal_count_column = gateway_dashboard._resolve_projection_column(
        columns,
        "pending_provider_withdrawal_count",
        "pending_withdrawal_count",
    )

    assert refund_column == "today_refund_usdc"
    assert withdrawal_count_column == "pending_withdrawal_count"


def test_resolve_projection_column_raises_when_no_candidate_exists() -> None:
    columns = frozenset({"today_charge_usdc"})

    try:
        gateway_dashboard._resolve_projection_column(columns, "consumer_refund_usdc", "refund_usdc")
    except KeyError as exc:
        assert "projection column not found" in str(exc)
    else:
        raise AssertionError("expected KeyError when projection columns are missing")


def test_seed_demo_exposes_funds_observability_metrics() -> None:
    repository = gateway_dashboard.InMemoryGatewayDashboardProjectionRepository.seed_demo()

    finance = repository.get_finance_snapshot()
    trends = repository.list_activity_trends()

    assert finance.today_invocation_count == 342
    assert finance.today_platform_fee_earned_usdc == gateway_dashboard.Decimal("196.40")
    assert finance.today_provider_earned_usdc == gateway_dashboard.Decimal("1084.00")
    assert trends[-1].invocation_count == 342
    assert trends[-1].platform_fee_earned_usdc == gateway_dashboard.Decimal("196.40")
    assert trends[-1].provider_earned_usdc == gateway_dashboard.Decimal("1084.00")