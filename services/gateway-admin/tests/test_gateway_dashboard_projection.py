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


def test_resolve_projection_expr_defaults_when_column_is_missing() -> None:
    columns = frozenset({"today_charge_usdc"})

    resolved = gateway_dashboard._resolve_projection_expr(
        columns,
        "today_invocation_count",
        default_sql="0::bigint",
    )

    assert resolved == "0::bigint"


class _FakeCursor:
    def __init__(self, rows: list[dict[str, object]] | dict[str, object] | None = None) -> None:
        if isinstance(rows, list):
            self._rows = rows
            self._row = rows[0] if rows else None
        else:
            self._row = rows
            self._rows = []
        self.executed_sql: list[str] = []

    def __enter__(self) -> "_FakeCursor":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
        self.executed_sql.append(sql)

    def fetchone(self) -> dict[str, object] | None:
        return self._row

    def fetchall(self) -> list[dict[str, object]]:
        return self._rows


class _FakeConnection:
    def __init__(self, cursor: _FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> "_FakeConnection":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def cursor(self) -> _FakeCursor:
        return self._cursor


def test_get_finance_snapshot_defaults_new_metrics_for_legacy_projection(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")
    cursor = _FakeCursor(
        {
            "today_charge_usdc": "12.50",
            "today_deposit_usdc": "14.00",
            "today_consumer_refund_usdc": "1.00",
            "today_provider_withdrawal_usdc": "2.00",
            "today_invocation_count": 0,
            "today_platform_fee_earned_usdc": "0",
            "today_provider_earned_usdc": "0",
            "consumer_liability_usdc": "9.00",
            "refundable_consumer_balance_usdc": "8.00",
            "provider_payable_usdc": "7.00",
            "provider_available_to_withdraw_usdc": "6.00",
            "provider_locked_balance_usdc": "1.00",
            "platform_fee_balance_usdc": "0.50",
            "vault_ledger_delta_usdc": "0.00",
            "pending_deposit_count": 1,
            "pending_provider_withdrawal_count": 2,
            "chain_confirmed_not_ledger_confirmed_count": 0,
            "deposit_p95_sync_delay_seconds": 30,
            "recently_completed_outflows_usdc": "3.00",
            "projected_at": None,
        }
    )

    monkeypatch.setattr(
        repository,
        "_get_projection_columns",
        lambda table_name: frozenset(
            {
                "today_charge_usdc",
                "today_deposit_usdc",
                "today_refund_usdc",
                "today_withdrawal_usdc",
                "owner_liability_usdc",
                "refundable_consumer_balance_usdc",
                "provider_payable_usdc",
                "provider_available_to_withdraw_usdc",
                "provider_locked_balance_usdc",
                "platform_fee_balance_usdc",
                "vault_ledger_delta_usdc",
                "pending_deposit_count",
                "pending_withdrawal_count",
                "chain_confirmed_not_ledger_confirmed_count",
                "deposit_p95_sync_delay_seconds",
                "recently_completed_outflows_usdc",
                "projected_at",
            }
        ),
    )
    monkeypatch.setattr(gateway_dashboard, "_connect", lambda dsn: _FakeConnection(cursor))

    finance = repository.get_finance_snapshot()

    assert finance.today_invocation_count == 0
    assert finance.today_platform_fee_earned_usdc == gateway_dashboard.Decimal("0")
    assert finance.today_provider_earned_usdc == gateway_dashboard.Decimal("0")
    assert "0::bigint AS today_invocation_count" in cursor.executed_sql[0]


def test_list_activity_trends_defaults_new_metrics_for_legacy_projection(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")
    cursor = _FakeCursor(
        [
            {
                "bucket_date": gateway_dashboard.date(2026, 3, 22),
                "deposit_usdc": "14.00",
                "charge_usdc": "12.50",
                "consumer_refund_usdc": "1.00",
                "provider_withdrawal_usdc": "2.00",
                "net_flow_usdc": "11.00",
                "invocation_count": 0,
                "platform_fee_earned_usdc": "0",
                "provider_earned_usdc": "0",
            }
        ]
    )

    monkeypatch.setattr(
        repository,
        "_get_projection_columns",
        lambda table_name: frozenset(
            {
                "bucket_date",
                "deposit_usdc",
                "charge_usdc",
                "refund_usdc",
                "withdrawal_usdc",
                "net_flow_usdc",
            }
        ),
    )
    monkeypatch.setattr(gateway_dashboard, "_connect", lambda dsn: _FakeConnection(cursor))

    trends = repository.list_activity_trends()

    assert len(trends) == 1
    assert trends[0].invocation_count == 0
    assert trends[0].platform_fee_earned_usdc == gateway_dashboard.Decimal("0")
    assert trends[0].provider_earned_usdc == gateway_dashboard.Decimal("0")
    assert "0::bigint AS invocation_count" in cursor.executed_sql[0]


def test_get_operations_snapshot_defaults_new_task_fields_for_legacy_projection(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")
    cursor = _FakeCursor(
        {
            "gateway_status": "healthy",
            "indexer_last_processed_at": None,
            "backfill_last_scan_at": None,
            "backfill_last_scanned_block": None,
            "recent_gateway_failures": 0,
            "failed_deposit_count": 0,
            "recent_audit_alerts": 0,
            "last_reconciliation_at": None,
            "reconciliation_alert": False,
            "reconciliation_delta_usdc": "0",
            "reconciliation_last_error": None,
            "projected_at": None,
            "indexer_running": False,
            "indexer_last_heartbeat_at": None,
            "indexer_last_error": None,
            "indexer_poll_interval_sec": 0,
            "backfill_enabled": False,
            "backfill_last_recovered": 0,
            "backfill_last_error": None,
            "reconciliation_enabled": False,
        }
    )

    monkeypatch.setattr(
        repository,
        "_get_projection_columns",
        lambda table_name: frozenset(
            {
                "gateway_status",
                "indexer_last_processed_at",
                "backfill_last_scan_at",
                "backfill_last_scanned_block",
                "recent_gateway_failures",
                "failed_deposit_count",
                "recent_audit_alerts",
                "last_reconciliation_at",
                "reconciliation_alert",
                "reconciliation_delta_usdc",
                "reconciliation_last_error",
                "projected_at",
            }
        ),
    )
    monkeypatch.setattr(gateway_dashboard, "_connect", lambda dsn: _FakeConnection(cursor))

    snapshot = repository.get_operations_snapshot()

    assert snapshot.indexer_running is False
    assert snapshot.indexer_poll_interval_sec == 0
    assert snapshot.backfill_enabled is False
    assert snapshot.backfill_last_recovered == 0
    assert snapshot.reconciliation_enabled is False
    assert "FALSE::boolean AS indexer_running" in cursor.executed_sql[0]


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