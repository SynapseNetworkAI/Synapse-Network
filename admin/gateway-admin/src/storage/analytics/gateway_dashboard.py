import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from functools import lru_cache
from typing import Any, Protocol


_ZERO_BIGINT_SQL = "0::bigint"
_ZERO_NUMERIC_SQL = "0::numeric"


def _connect(dsn: str) -> Any:
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(dsn, row_factory=dict_row)  # type: ignore[arg-type]


@lru_cache(maxsize=16)
def _get_table_columns(dsn: str, table_name: str) -> frozenset[str]:
    with _connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table_name,),
        )
        rows = cur.fetchall()
    return frozenset(str(row["column_name"]) for row in rows)


def _resolve_projection_column(
    columns: frozenset[str],
    canonical_name: str,
    legacy_alias: str | None = None,
) -> str:
    if canonical_name in columns:
        return canonical_name
    if legacy_alias and legacy_alias in columns:
        return legacy_alias
    candidates = tuple(candidate for candidate in (canonical_name, legacy_alias) if candidate)
    raise KeyError(f"projection column not found, candidates={candidates}")


def _resolve_projection_expr(
    columns: frozenset[str],
    canonical_name: str,
    legacy_alias: str | None = None,
    *,
    default_sql: str,
) -> str:
    if canonical_name in columns:
        return canonical_name
    if legacy_alias and legacy_alias in columns:
        return legacy_alias
    return default_sql


@dataclass(slots=True)
class GatewayDashboardSnapshot:
    deposit_exceptions: int
    audit_alerts: int
    vault_ledger_delta: Decimal
    gateway_status: str
    last_reconciliation_at: datetime | None


@dataclass(slots=True)
class GatewayFinanceSnapshot:
    today_charge_usdc: Decimal
    today_deposit_usdc: Decimal
    today_consumer_refund_usdc: Decimal
    today_provider_withdrawal_usdc: Decimal
    today_invocation_count: int
    today_platform_fee_earned_usdc: Decimal
    today_provider_earned_usdc: Decimal
    consumer_liability_usdc: Decimal
    refundable_consumer_balance_usdc: Decimal
    provider_payable_usdc: Decimal
    provider_available_to_withdraw_usdc: Decimal
    provider_locked_balance_usdc: Decimal
    platform_fee_balance_usdc: Decimal
    vault_ledger_delta_usdc: Decimal
    pending_deposit_count: int
    pending_provider_withdrawal_count: int
    chain_confirmed_not_ledger_confirmed_count: int
    deposit_p95_sync_delay_seconds: int
    recently_completed_outflows_usdc: Decimal
    projected_at: datetime | None


@dataclass(slots=True)
class GatewayActivityTrendPoint:
    bucket_date: date
    deposit_usdc: Decimal
    charge_usdc: Decimal
    invocation_count: int
    platform_fee_earned_usdc: Decimal
    provider_earned_usdc: Decimal
    consumer_refund_usdc: Decimal
    provider_withdrawal_usdc: Decimal
    net_flow_usdc: Decimal


@dataclass(slots=True)
class GatewayOperationsSnapshot:
    gateway_status: str
    indexer_last_processed_at: datetime | None
    backfill_last_scan_at: datetime | None
    backfill_last_scanned_block: int | None
    recent_gateway_failures: int
    failed_deposit_count: int
    recent_audit_alerts: int
    last_reconciliation_at: datetime | None
    reconciliation_alert: bool
    reconciliation_delta_usdc: Decimal
    reconciliation_last_error: str | None
    projected_at: datetime | None


@dataclass(slots=True)
class GatewayReconciliationRuntimeState:
    last_check_at: datetime | None
    chain_vault_usdc: Decimal | None
    ledger_obligation_usdc: Decimal | None
    delta_usdc: Decimal | None
    alert: bool
    updated_at: datetime | None


class GatewayDashboardProjectionRepository(Protocol):
    def get_snapshot(self) -> GatewayDashboardSnapshot: ...
    def get_finance_snapshot(self) -> GatewayFinanceSnapshot: ...
    def list_activity_trends(self) -> list[GatewayActivityTrendPoint]: ...
    def get_operations_snapshot(self) -> GatewayOperationsSnapshot: ...
    def get_reconciliation_runtime_state(self) -> GatewayReconciliationRuntimeState: ...


class InMemoryGatewayDashboardProjectionRepository:
    def __init__(
        self,
        snapshot: GatewayDashboardSnapshot,
        finance_snapshot: GatewayFinanceSnapshot,
        activity_trends: list[GatewayActivityTrendPoint],
        operations_snapshot: GatewayOperationsSnapshot,
        reconciliation_runtime_state: GatewayReconciliationRuntimeState,
    ) -> None:
        self._snapshot = snapshot
        self._finance_snapshot = finance_snapshot
        self._activity_trends = activity_trends
        self._operations_snapshot = operations_snapshot
        self._reconciliation_runtime_state = reconciliation_runtime_state

    @classmethod
    def seed_demo(cls) -> "InMemoryGatewayDashboardProjectionRepository":
        return cls(
            snapshot=GatewayDashboardSnapshot(
                deposit_exceptions=2,
                audit_alerts=1,
                vault_ledger_delta=Decimal("0.50"),
                gateway_status="degraded",
                last_reconciliation_at=datetime(2026, 3, 16, 8, 0, tzinfo=timezone.utc),
            ),
            finance_snapshot=GatewayFinanceSnapshot(
                today_charge_usdc=Decimal("1280.40"),
                today_deposit_usdc=Decimal("1640.00"),
                today_consumer_refund_usdc=Decimal("42.25"),
                today_provider_withdrawal_usdc=Decimal("310.50"),
                today_invocation_count=342,
                today_platform_fee_earned_usdc=Decimal("196.40"),
                today_provider_earned_usdc=Decimal("1084.00"),
                consumer_liability_usdc=Decimal("8450.10"),
                refundable_consumer_balance_usdc=Decimal("7320.35"),
                provider_payable_usdc=Decimal("3920.45"),
                provider_available_to_withdraw_usdc=Decimal("3510.20"),
                provider_locked_balance_usdc=Decimal("410.25"),
                platform_fee_balance_usdc=Decimal("128.75"),
                vault_ledger_delta_usdc=Decimal("0.50"),
                pending_deposit_count=2,
                pending_provider_withdrawal_count=1,
                chain_confirmed_not_ledger_confirmed_count=1,
                deposit_p95_sync_delay_seconds=184,
                recently_completed_outflows_usdc=Decimal("186.40"),
                projected_at=datetime(2026, 3, 16, 8, 5, tzinfo=timezone.utc),
            ),
            activity_trends=[
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 10),
                    deposit_usdc=Decimal("920.00"),
                    charge_usdc=Decimal("780.20"),
                    invocation_count=218,
                    platform_fee_earned_usdc=Decimal("118.20"),
                    provider_earned_usdc=Decimal("662.00"),
                    consumer_refund_usdc=Decimal("31.40"),
                    provider_withdrawal_usdc=Decimal("240.00"),
                    net_flow_usdc=Decimal("648.60"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 11),
                    deposit_usdc=Decimal("1110.25"),
                    charge_usdc=Decimal("830.00"),
                    invocation_count=226,
                    platform_fee_earned_usdc=Decimal("126.00"),
                    provider_earned_usdc=Decimal("704.00"),
                    consumer_refund_usdc=Decimal("25.15"),
                    provider_withdrawal_usdc=Decimal("210.00"),
                    net_flow_usdc=Decimal("875.10"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 12),
                    deposit_usdc=Decimal("1185.50"),
                    charge_usdc=Decimal("910.30"),
                    invocation_count=244,
                    platform_fee_earned_usdc=Decimal("141.30"),
                    provider_earned_usdc=Decimal("769.00"),
                    consumer_refund_usdc=Decimal("0.00"),
                    provider_withdrawal_usdc=Decimal("320.00"),
                    net_flow_usdc=Decimal("865.50"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 13),
                    deposit_usdc=Decimal("980.00"),
                    charge_usdc=Decimal("845.90"),
                    invocation_count=231,
                    platform_fee_earned_usdc=Decimal("129.90"),
                    provider_earned_usdc=Decimal("716.00"),
                    consumer_refund_usdc=Decimal("16.20"),
                    provider_withdrawal_usdc=Decimal("180.00"),
                    net_flow_usdc=Decimal("783.80"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 14),
                    deposit_usdc=Decimal("1320.15"),
                    charge_usdc=Decimal("990.10"),
                    invocation_count=268,
                    platform_fee_earned_usdc=Decimal("150.10"),
                    provider_earned_usdc=Decimal("840.00"),
                    consumer_refund_usdc=Decimal("45.00"),
                    provider_withdrawal_usdc=Decimal("275.00"),
                    net_flow_usdc=Decimal("1000.15"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 15),
                    deposit_usdc=Decimal("1460.00"),
                    charge_usdc=Decimal("1210.50"),
                    invocation_count=316,
                    platform_fee_earned_usdc=Decimal("186.50"),
                    provider_earned_usdc=Decimal("1024.00"),
                    consumer_refund_usdc=Decimal("38.75"),
                    provider_withdrawal_usdc=Decimal("290.00"),
                    net_flow_usdc=Decimal("1131.25"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 16),
                    deposit_usdc=Decimal("1640.00"),
                    charge_usdc=Decimal("1280.40"),
                    invocation_count=342,
                    platform_fee_earned_usdc=Decimal("196.40"),
                    provider_earned_usdc=Decimal("1084.00"),
                    consumer_refund_usdc=Decimal("42.25"),
                    provider_withdrawal_usdc=Decimal("310.50"),
                    net_flow_usdc=Decimal("1287.25"),
                ),
            ],
            operations_snapshot=GatewayOperationsSnapshot(
                gateway_status="degraded",
                indexer_last_processed_at=datetime(2026, 3, 16, 8, 3, tzinfo=timezone.utc),
                backfill_last_scan_at=datetime(2026, 3, 16, 7, 58, tzinfo=timezone.utc),
                backfill_last_scanned_block=19450321,
                recent_gateway_failures=1,
                failed_deposit_count=2,
                recent_audit_alerts=1,
                last_reconciliation_at=datetime(2026, 3, 16, 8, 0, tzinfo=timezone.utc),
                reconciliation_alert=True,
                reconciliation_delta_usdc=Decimal("0.50"),
                reconciliation_last_error="vault_delta_detected",
                projected_at=datetime(2026, 3, 16, 8, 5, tzinfo=timezone.utc),
            ),
            reconciliation_runtime_state=GatewayReconciliationRuntimeState(
                last_check_at=datetime(2026, 3, 16, 8, 0, tzinfo=timezone.utc),
                chain_vault_usdc=Decimal("8449.60"),
                ledger_obligation_usdc=Decimal("8450.10"),
                delta_usdc=Decimal("0.50"),
                alert=True,
                updated_at=datetime(2026, 3, 16, 8, 0, tzinfo=timezone.utc),
            ),
        )

    def get_snapshot(self) -> GatewayDashboardSnapshot:
        return self._snapshot

    def get_finance_snapshot(self) -> GatewayFinanceSnapshot:
        return self._finance_snapshot

    def list_activity_trends(self) -> list[GatewayActivityTrendPoint]:
        return self._activity_trends

    def get_operations_snapshot(self) -> GatewayOperationsSnapshot:
        return self._operations_snapshot

    def get_reconciliation_runtime_state(self) -> GatewayReconciliationRuntimeState:
        return self._reconciliation_runtime_state


class PostgresGatewayDashboardProjectionRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def _get_projection_columns(self, table_name: str) -> frozenset[str]:
        return _get_table_columns(self._dsn, table_name)

    @staticmethod
    def _payload_dict(payload: Any) -> dict[str, Any]:
        if isinstance(payload, dict):
            return payload
        if isinstance(payload, memoryview):
            payload = payload.tobytes().decode("utf-8")
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        if isinstance(payload, str) and payload.strip():
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError:
                return {}
            return parsed if isinstance(parsed, dict) else {}
        return {}

    @staticmethod
    def _coerce_timestamp(value: Any) -> datetime | None:
        if value in (None, ""):
            return None
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        try:
            timestamp = int(value)
        except (TypeError, ValueError):
            return None
        return datetime.fromtimestamp(timestamp, tz=timezone.utc)

    def get_snapshot(self) -> GatewayDashboardSnapshot:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    deposit_exceptions,
                    audit_alerts,
                    vault_ledger_delta_usdc,
                    gateway_status,
                    last_reconciliation_at
                FROM synapse_admin_dashboard_projection
                LIMIT 1
                """
            )
            row = cur.fetchone()
        if row is None:
            return GatewayDashboardSnapshot(
                deposit_exceptions=0,
                audit_alerts=0,
                vault_ledger_delta=Decimal("0"),
                gateway_status="unknown",
                last_reconciliation_at=None,
            )
        return GatewayDashboardSnapshot(
            deposit_exceptions=int(row["deposit_exceptions"]),
            audit_alerts=int(row["audit_alerts"]),
            vault_ledger_delta=Decimal(str(row["vault_ledger_delta_usdc"])),
            gateway_status=str(row["gateway_status"]),
            last_reconciliation_at=row["last_reconciliation_at"],
        )

    def get_finance_snapshot(self) -> GatewayFinanceSnapshot:
        columns = self._get_projection_columns("synapse_admin_dashboard_finance_projection")
        refund_column = _resolve_projection_column(columns, "today_consumer_refund_usdc", "today_refund_usdc")
        withdrawal_column = _resolve_projection_column(columns, "today_provider_withdrawal_usdc", "today_withdrawal_usdc")
        liability_column = _resolve_projection_column(columns, "consumer_liability_usdc", "owner_liability_usdc")
        today_invocation_count_column = _resolve_projection_expr(
            columns,
            "today_invocation_count",
            default_sql=_ZERO_BIGINT_SQL,
        )
        today_platform_fee_earned_column = _resolve_projection_expr(
            columns,
            "today_platform_fee_earned_usdc",
            default_sql=_ZERO_NUMERIC_SQL,
        )
        today_provider_earned_column = _resolve_projection_expr(
            columns,
            "today_provider_earned_usdc",
            default_sql=_ZERO_NUMERIC_SQL,
        )
        pending_withdrawal_column = _resolve_projection_column(
            columns,
            "pending_provider_withdrawal_count",
            "pending_withdrawal_count",
        )
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    today_charge_usdc,
                    today_deposit_usdc,
                    {refund_column} AS today_consumer_refund_usdc,
                    {withdrawal_column} AS today_provider_withdrawal_usdc,
                    {today_invocation_count_column} AS today_invocation_count,
                    {today_platform_fee_earned_column} AS today_platform_fee_earned_usdc,
                    {today_provider_earned_column} AS today_provider_earned_usdc,
                    {liability_column} AS consumer_liability_usdc,
                    refundable_consumer_balance_usdc,
                    provider_payable_usdc,
                    provider_available_to_withdraw_usdc,
                    provider_locked_balance_usdc,
                    platform_fee_balance_usdc,
                    vault_ledger_delta_usdc,
                    pending_deposit_count,
                    {pending_withdrawal_column} AS pending_provider_withdrawal_count,
                    chain_confirmed_not_ledger_confirmed_count,
                    deposit_p95_sync_delay_seconds,
                    recently_completed_outflows_usdc,
                    projected_at
                FROM synapse_admin_dashboard_finance_projection
                LIMIT 1
                """
            )
            row = cur.fetchone()
        if row is None:
            return GatewayFinanceSnapshot(
                today_charge_usdc=Decimal("0"),
                today_deposit_usdc=Decimal("0"),
                today_consumer_refund_usdc=Decimal("0"),
                today_provider_withdrawal_usdc=Decimal("0"),
                today_invocation_count=0,
                today_platform_fee_earned_usdc=Decimal("0"),
                today_provider_earned_usdc=Decimal("0"),
                consumer_liability_usdc=Decimal("0"),
                refundable_consumer_balance_usdc=Decimal("0"),
                provider_payable_usdc=Decimal("0"),
                provider_available_to_withdraw_usdc=Decimal("0"),
                provider_locked_balance_usdc=Decimal("0"),
                platform_fee_balance_usdc=Decimal("0"),
                vault_ledger_delta_usdc=Decimal("0"),
                pending_deposit_count=0,
                pending_provider_withdrawal_count=0,
                chain_confirmed_not_ledger_confirmed_count=0,
                deposit_p95_sync_delay_seconds=0,
                recently_completed_outflows_usdc=Decimal("0"),
                projected_at=None,
            )
        return GatewayFinanceSnapshot(
            today_charge_usdc=Decimal(str(row["today_charge_usdc"])),
            today_deposit_usdc=Decimal(str(row["today_deposit_usdc"])),
            today_consumer_refund_usdc=Decimal(str(row["today_consumer_refund_usdc"])),
            today_provider_withdrawal_usdc=Decimal(str(row["today_provider_withdrawal_usdc"])),
            today_invocation_count=int(row["today_invocation_count"]),
            today_platform_fee_earned_usdc=Decimal(str(row["today_platform_fee_earned_usdc"])),
            today_provider_earned_usdc=Decimal(str(row["today_provider_earned_usdc"])),
            consumer_liability_usdc=Decimal(str(row["consumer_liability_usdc"])),
            refundable_consumer_balance_usdc=Decimal(str(row["refundable_consumer_balance_usdc"])),
            provider_payable_usdc=Decimal(str(row["provider_payable_usdc"])),
            provider_available_to_withdraw_usdc=Decimal(str(row["provider_available_to_withdraw_usdc"])),
            provider_locked_balance_usdc=Decimal(str(row["provider_locked_balance_usdc"])),
            platform_fee_balance_usdc=Decimal(str(row["platform_fee_balance_usdc"])),
            vault_ledger_delta_usdc=Decimal(str(row["vault_ledger_delta_usdc"])),
            pending_deposit_count=int(row["pending_deposit_count"]),
            pending_provider_withdrawal_count=int(row["pending_provider_withdrawal_count"]),
            chain_confirmed_not_ledger_confirmed_count=int(row["chain_confirmed_not_ledger_confirmed_count"]),
            deposit_p95_sync_delay_seconds=int(row["deposit_p95_sync_delay_seconds"]),
            recently_completed_outflows_usdc=Decimal(str(row["recently_completed_outflows_usdc"])),
            projected_at=row["projected_at"],
        )

    def list_activity_trends(self) -> list[GatewayActivityTrendPoint]:
        columns = self._get_projection_columns("synapse_admin_dashboard_activity_trend_projection")
        refund_column = _resolve_projection_column(columns, "consumer_refund_usdc", "refund_usdc")
        withdrawal_column = _resolve_projection_column(columns, "provider_withdrawal_usdc", "withdrawal_usdc")
        invocation_count_column = _resolve_projection_expr(
            columns,
            "invocation_count",
            default_sql=_ZERO_BIGINT_SQL,
        )
        platform_fee_earned_column = _resolve_projection_expr(
            columns,
            "platform_fee_earned_usdc",
            default_sql=_ZERO_NUMERIC_SQL,
        )
        provider_earned_column = _resolve_projection_expr(
            columns,
            "provider_earned_usdc",
            default_sql=_ZERO_NUMERIC_SQL,
        )
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    bucket_date,
                    deposit_usdc,
                    charge_usdc,
                    {invocation_count_column} AS invocation_count,
                    {platform_fee_earned_column} AS platform_fee_earned_usdc,
                    {provider_earned_column} AS provider_earned_usdc,
                    {refund_column} AS consumer_refund_usdc,
                    {withdrawal_column} AS provider_withdrawal_usdc,
                    net_flow_usdc
                FROM synapse_admin_dashboard_activity_trend_projection
                ORDER BY bucket_date ASC
                """
            )
            rows = cur.fetchall()
        return [
            GatewayActivityTrendPoint(
                bucket_date=row["bucket_date"],
                deposit_usdc=Decimal(str(row["deposit_usdc"])),
                charge_usdc=Decimal(str(row["charge_usdc"])),
                invocation_count=int(row["invocation_count"]),
                platform_fee_earned_usdc=Decimal(str(row["platform_fee_earned_usdc"])),
                provider_earned_usdc=Decimal(str(row["provider_earned_usdc"])),
                consumer_refund_usdc=Decimal(str(row["consumer_refund_usdc"])),
                provider_withdrawal_usdc=Decimal(str(row["provider_withdrawal_usdc"])),
                net_flow_usdc=Decimal(str(row["net_flow_usdc"])),
            )
            for row in rows
        ]

    def get_operations_snapshot(self) -> GatewayOperationsSnapshot:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    gateway_status,
                    indexer_last_processed_at,
                    backfill_last_scan_at,
                    backfill_last_scanned_block,
                    recent_gateway_failures,
                    failed_deposit_count,
                    recent_audit_alerts,
                    last_reconciliation_at,
                    reconciliation_alert,
                    reconciliation_delta_usdc,
                    reconciliation_last_error,
                    projected_at
                FROM synapse_admin_dashboard_operations_projection
                LIMIT 1
                """
            )
            row = cur.fetchone()
        if row is None:
            return GatewayOperationsSnapshot(
                gateway_status="unknown",
                indexer_last_processed_at=None,
                backfill_last_scan_at=None,
                backfill_last_scanned_block=None,
                recent_gateway_failures=0,
                failed_deposit_count=0,
                recent_audit_alerts=0,
                last_reconciliation_at=None,
                reconciliation_alert=False,
                reconciliation_delta_usdc=Decimal("0"),
                reconciliation_last_error=None,
                projected_at=None,
            )
        return GatewayOperationsSnapshot(
            gateway_status=str(row["gateway_status"]),
            indexer_last_processed_at=row["indexer_last_processed_at"],
            backfill_last_scan_at=row["backfill_last_scan_at"],
            backfill_last_scanned_block=row["backfill_last_scanned_block"],
            recent_gateway_failures=int(row["recent_gateway_failures"]),
            failed_deposit_count=int(row["failed_deposit_count"]),
            recent_audit_alerts=int(row["recent_audit_alerts"]),
            last_reconciliation_at=row["last_reconciliation_at"],
            reconciliation_alert=bool(row["reconciliation_alert"]),
            reconciliation_delta_usdc=Decimal(str(row["reconciliation_delta_usdc"])),
            reconciliation_last_error=row["reconciliation_last_error"],
            projected_at=row["projected_at"],
        )

    def get_reconciliation_runtime_state(self) -> GatewayReconciliationRuntimeState:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT payload, updated_at
                FROM synapse_runtime_state
                WHERE state_key = 'deposit_reconciliation_state'
                LIMIT 1
                """
            )
            row = cur.fetchone()
        if row is None:
            return GatewayReconciliationRuntimeState(
                last_check_at=None,
                chain_vault_usdc=None,
                ledger_obligation_usdc=None,
                delta_usdc=None,
                alert=False,
                updated_at=None,
            )

        payload = self._payload_dict(row.get("payload"))
        chain_vault = payload.get("chainVaultUsdc")
        ledger_obligation = payload.get("ledgerObligationUsdc")
        delta = payload.get("deltaUsdc")
        return GatewayReconciliationRuntimeState(
            last_check_at=self._coerce_timestamp(payload.get("lastCheckAt")),
            chain_vault_usdc=Decimal(str(chain_vault)) if chain_vault is not None else None,
            ledger_obligation_usdc=Decimal(str(ledger_obligation)) if ledger_obligation is not None else None,
            delta_usdc=Decimal(str(delta)) if delta is not None else None,
            alert=bool(payload.get("alert") or False),
            updated_at=row.get("updated_at"),
        )