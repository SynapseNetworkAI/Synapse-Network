from datetime import datetime, timezone
from decimal import Decimal

import psycopg

from src.storage.analytics import gateway_dashboard


def _utc(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def test_get_snapshot_returns_empty_when_projection_is_missing(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")

    monkeypatch.setattr(
        repository,
        "_get_projection_columns",
        lambda table_name: frozenset(),
    )

    snapshot = repository.get_snapshot()

    assert snapshot.gateway_status == "unknown"
    assert snapshot.deposit_exceptions == 0
    assert snapshot.vault_ledger_delta == gateway_dashboard.Decimal("0")
    assert snapshot.last_reconciliation_at is None


def test_get_table_columns_uses_visible_search_path_schemas(monkeypatch) -> None:
    cursor = _FakeCursor([{"column_name": "gateway_status"}])

    gateway_dashboard._get_table_columns.cache_clear()
    monkeypatch.setattr(gateway_dashboard, "_connect", lambda dsn: _FakeConnection(cursor))

    columns = gateway_dashboard._get_table_columns(
        "postgresql://example",
        "synapse_admin_dashboard_operations_projection",
    )

    assert columns == frozenset({"gateway_status"})
    sql = _executed_sql(cursor)
    assert "current_schemas(true)" in sql
    assert "current_schema()" not in sql

    gateway_dashboard._get_table_columns.cache_clear()


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


def _executed_sql(cursor: _FakeCursor) -> str:
    return " ".join(cursor.executed_sql[0].split()).lower()


def _assert_native_projection_sql(cursor: _FakeCursor) -> None:
    sql = _executed_sql(cursor)
    assert "row_to_json" not in sql
    assert "select *" not in sql


def test_projection_mappers_fail_fast_on_flattened_json_types() -> None:
    try:
        gateway_dashboard._projection_datetime({"projected_at": "2026-03-16T08:05:00Z"}, "projected_at")
    except TypeError as exc:
        assert "must be datetime" in str(exc)
    else:
        raise AssertionError("expected TypeError for flattened timestamp string")

    try:
        gateway_dashboard._projection_date({"bucket_date": "2026-03-16"}, "bucket_date")
    except TypeError as exc:
        assert "must be date" in str(exc)
    else:
        raise AssertionError("expected TypeError for flattened date string")


def test_runtime_timestamp_accepts_legacy_runtime_shapes() -> None:
    naive = datetime(2026, 3, 16, 8, 5)

    assert gateway_dashboard._runtime_timestamp(None) is None
    assert gateway_dashboard._runtime_timestamp("") is None
    assert gateway_dashboard._runtime_timestamp(0) == datetime.fromtimestamp(0, tz=timezone.utc)
    assert gateway_dashboard._runtime_timestamp("0") == datetime.fromtimestamp(0, tz=timezone.utc)
    assert gateway_dashboard._runtime_timestamp("not-a-timestamp") is None
    assert gateway_dashboard._runtime_timestamp(naive) == naive.replace(tzinfo=timezone.utc)


def test_get_finance_snapshot_maps_native_projection_row(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")
    cursor = _FakeCursor(
        {
            "today_charge_usdc": Decimal("12.50"),
            "today_deposit_usdc": Decimal("14.00"),
            "today_consumer_refund_usdc": Decimal("1.00"),
            "today_provider_withdrawal_usdc": Decimal("2.00"),
            "today_invocation_count": 0,
            "today_platform_fee_earned_usdc": Decimal("0"),
            "today_provider_earned_usdc": Decimal("0"),
            "consumer_liability_usdc": Decimal("9.00"),
            "refundable_consumer_balance_usdc": Decimal("8.00"),
            "provider_payable_usdc": Decimal("7.00"),
            "provider_available_to_withdraw_usdc": Decimal("6.00"),
            "provider_locked_balance_usdc": Decimal("1.00"),
            "platform_fee_balance_usdc": Decimal("0.50"),
            "vault_ledger_delta_usdc": Decimal("0.00"),
            "pending_deposit_count": 1,
            "pending_provider_withdrawal_count": 2,
            "chain_confirmed_not_ledger_confirmed_count": 0,
            "deposit_p95_sync_delay_seconds": 30,
            "recently_completed_outflows_usdc": Decimal("3.00"),
            "projected_at": _utc(2026, 3, 16, 8, 5),
        }
    )

    monkeypatch.setattr(repository, "_get_projection_columns", lambda table_name: frozenset({"projected_at"}))
    monkeypatch.setattr(gateway_dashboard, "_connect", lambda dsn: _FakeConnection(cursor))

    finance = repository.get_finance_snapshot()

    assert finance.today_invocation_count == 0
    assert finance.today_platform_fee_earned_usdc == gateway_dashboard.Decimal("0")
    assert finance.today_provider_earned_usdc == gateway_dashboard.Decimal("0")
    assert finance.projected_at == _utc(2026, 3, 16, 8, 5)
    _assert_native_projection_sql(cursor)


def test_get_finance_snapshot_returns_empty_when_projection_is_missing(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")

    monkeypatch.setattr(
        repository,
        "_get_projection_columns",
        lambda table_name: frozenset(),
    )

    finance = repository.get_finance_snapshot()

    assert finance.today_charge_usdc == gateway_dashboard.Decimal("0")
    assert finance.pending_deposit_count == 0
    assert finance.projected_at is None


def test_list_activity_trends_maps_native_projection_rows(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")
    cursor = _FakeCursor(
        [
            {
                "bucket_date": gateway_dashboard.date(2026, 3, 22),
                "deposit_usdc": Decimal("14.00"),
                "charge_usdc": Decimal("12.50"),
                "consumer_refund_usdc": Decimal("1.00"),
                "provider_withdrawal_usdc": Decimal("2.00"),
                "net_flow_usdc": Decimal("11.00"),
                "invocation_count": 0,
                "platform_fee_earned_usdc": Decimal("0"),
                "provider_earned_usdc": Decimal("0"),
            }
        ]
    )

    monkeypatch.setattr(repository, "_get_projection_columns", lambda table_name: frozenset({"bucket_date"}))
    monkeypatch.setattr(gateway_dashboard, "_connect", lambda dsn: _FakeConnection(cursor))

    trends = repository.list_activity_trends()

    assert len(trends) == 1
    assert trends[0].invocation_count == 0
    assert trends[0].platform_fee_earned_usdc == gateway_dashboard.Decimal("0")
    assert trends[0].provider_earned_usdc == gateway_dashboard.Decimal("0")
    _assert_native_projection_sql(cursor)


def test_list_activity_trends_returns_empty_when_projection_is_missing(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")

    monkeypatch.setattr(
        repository,
        "_get_projection_columns",
        lambda table_name: frozenset(),
    )

    assert repository.list_activity_trends() == []


def test_get_operations_snapshot_maps_native_projection_row(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")
    cursor = _FakeCursor(
        {
            "gateway_status": "healthy",
            "indexer_last_processed_at": _utc(2026, 3, 16, 8, 3),
            "backfill_last_scan_at": _utc(2026, 3, 16, 7, 58),
            "backfill_last_scanned_block": None,
            "recent_gateway_failures": 0,
            "failed_deposit_count": 0,
            "recent_audit_alerts": 0,
            "last_reconciliation_at": _utc(2026, 3, 16, 8),
            "reconciliation_alert": False,
            "reconciliation_delta_usdc": Decimal("0"),
            "reconciliation_last_error": None,
            "projected_at": _utc(2026, 3, 16, 8, 5),
            "indexer_running": False,
            "indexer_last_heartbeat_at": _utc(2026, 3, 16, 8, 4),
            "indexer_last_error": None,
            "indexer_poll_interval_sec": 0,
            "backfill_enabled": False,
            "backfill_last_recovered": 0,
            "backfill_last_error": None,
            "reconciliation_enabled": False,
        }
    )

    monkeypatch.setattr(repository, "_get_projection_columns", lambda table_name: frozenset({"projected_at"}))
    monkeypatch.setattr(gateway_dashboard, "_connect", lambda dsn: _FakeConnection(cursor))

    snapshot = repository.get_operations_snapshot()

    assert snapshot.indexer_running is False
    assert snapshot.indexer_poll_interval_sec == 0
    assert snapshot.backfill_enabled is False
    assert snapshot.backfill_last_recovered == 0
    assert snapshot.reconciliation_enabled is False
    assert snapshot.indexer_last_heartbeat_at == _utc(2026, 3, 16, 8, 4)
    assert snapshot.last_reconciliation_at == _utc(2026, 3, 16, 8)
    _assert_native_projection_sql(cursor)


def test_get_operations_snapshot_returns_empty_when_projection_is_missing(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")

    monkeypatch.setattr(
        repository,
        "_get_projection_columns",
        lambda table_name: frozenset(),
    )

    operations = repository.get_operations_snapshot()

    assert operations.gateway_status == "unknown"
    assert operations.indexer_running is False
    assert operations.reconciliation_delta_usdc == gateway_dashboard.Decimal("0")
    assert operations.projected_at is None


def test_get_reconciliation_runtime_state_returns_empty_when_readonly_access_is_denied(monkeypatch) -> None:
    repository = gateway_dashboard.PostgresGatewayDashboardProjectionRepository("postgresql://example")

    def _raise_permission_denied(_: str):
        raise psycopg.errors.InsufficientPrivilege("permission denied for table synapse_runtime_state")

    monkeypatch.setattr(gateway_dashboard, "_connect", _raise_permission_denied)

    state = repository.get_reconciliation_runtime_state()

    assert state.last_check_at is None
    assert state.chain_vault_usdc is None
    assert state.ledger_obligation_usdc is None
    assert state.delta_usdc is None
    assert state.alert is False
    assert state.updated_at is None


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
