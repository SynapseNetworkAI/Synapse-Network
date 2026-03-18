from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Protocol


def _connect(dsn: str):
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(dsn, row_factory=dict_row)


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
    today_refund_usdc: Decimal
    today_withdrawal_usdc: Decimal
    owner_liability_usdc: Decimal
    provider_payable_usdc: Decimal
    platform_fee_balance_usdc: Decimal
    vault_ledger_delta_usdc: Decimal
    pending_deposit_count: int
    pending_withdrawal_count: int
    projected_at: datetime | None


@dataclass(slots=True)
class GatewayActivityTrendPoint:
    bucket_date: date
    deposit_usdc: Decimal
    charge_usdc: Decimal
    refund_usdc: Decimal
    withdrawal_usdc: Decimal
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


class GatewayDashboardProjectionRepository(Protocol):
    def get_snapshot(self) -> GatewayDashboardSnapshot: ...
    def get_finance_snapshot(self) -> GatewayFinanceSnapshot: ...
    def list_activity_trends(self) -> list[GatewayActivityTrendPoint]: ...
    def get_operations_snapshot(self) -> GatewayOperationsSnapshot: ...


class InMemoryGatewayDashboardProjectionRepository:
    def __init__(
        self,
        snapshot: GatewayDashboardSnapshot,
        finance_snapshot: GatewayFinanceSnapshot,
        activity_trends: list[GatewayActivityTrendPoint],
        operations_snapshot: GatewayOperationsSnapshot,
    ) -> None:
        self._snapshot = snapshot
        self._finance_snapshot = finance_snapshot
        self._activity_trends = activity_trends
        self._operations_snapshot = operations_snapshot

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
                today_refund_usdc=Decimal("42.25"),
                today_withdrawal_usdc=Decimal("310.50"),
                owner_liability_usdc=Decimal("8450.10"),
                provider_payable_usdc=Decimal("3920.45"),
                platform_fee_balance_usdc=Decimal("128.75"),
                vault_ledger_delta_usdc=Decimal("0.50"),
                pending_deposit_count=2,
                pending_withdrawal_count=1,
                projected_at=datetime(2026, 3, 16, 8, 5, tzinfo=timezone.utc),
            ),
            activity_trends=[
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 10),
                    deposit_usdc=Decimal("920.00"),
                    charge_usdc=Decimal("780.20"),
                    refund_usdc=Decimal("31.40"),
                    withdrawal_usdc=Decimal("240.00"),
                    net_flow_usdc=Decimal("648.60"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 11),
                    deposit_usdc=Decimal("1110.25"),
                    charge_usdc=Decimal("830.00"),
                    refund_usdc=Decimal("25.15"),
                    withdrawal_usdc=Decimal("210.00"),
                    net_flow_usdc=Decimal("875.10"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 12),
                    deposit_usdc=Decimal("1185.50"),
                    charge_usdc=Decimal("910.30"),
                    refund_usdc=Decimal("0.00"),
                    withdrawal_usdc=Decimal("320.00"),
                    net_flow_usdc=Decimal("865.50"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 13),
                    deposit_usdc=Decimal("980.00"),
                    charge_usdc=Decimal("845.90"),
                    refund_usdc=Decimal("16.20"),
                    withdrawal_usdc=Decimal("180.00"),
                    net_flow_usdc=Decimal("783.80"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 14),
                    deposit_usdc=Decimal("1320.15"),
                    charge_usdc=Decimal("990.10"),
                    refund_usdc=Decimal("45.00"),
                    withdrawal_usdc=Decimal("275.00"),
                    net_flow_usdc=Decimal("1000.15"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 15),
                    deposit_usdc=Decimal("1460.00"),
                    charge_usdc=Decimal("1210.50"),
                    refund_usdc=Decimal("38.75"),
                    withdrawal_usdc=Decimal("290.00"),
                    net_flow_usdc=Decimal("1131.25"),
                ),
                GatewayActivityTrendPoint(
                    bucket_date=date(2026, 3, 16),
                    deposit_usdc=Decimal("1640.00"),
                    charge_usdc=Decimal("1280.40"),
                    refund_usdc=Decimal("42.25"),
                    withdrawal_usdc=Decimal("310.50"),
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
        )

    def get_snapshot(self) -> GatewayDashboardSnapshot:
        return self._snapshot

    def get_finance_snapshot(self) -> GatewayFinanceSnapshot:
        return self._finance_snapshot

    def list_activity_trends(self) -> list[GatewayActivityTrendPoint]:
        return self._activity_trends

    def get_operations_snapshot(self) -> GatewayOperationsSnapshot:
        return self._operations_snapshot


class PostgresGatewayDashboardProjectionRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

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
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    today_charge_usdc,
                    today_deposit_usdc,
                    today_refund_usdc,
                    today_withdrawal_usdc,
                    owner_liability_usdc,
                    provider_payable_usdc,
                    platform_fee_balance_usdc,
                    vault_ledger_delta_usdc,
                    pending_deposit_count,
                    pending_withdrawal_count,
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
                today_refund_usdc=Decimal("0"),
                today_withdrawal_usdc=Decimal("0"),
                owner_liability_usdc=Decimal("0"),
                provider_payable_usdc=Decimal("0"),
                platform_fee_balance_usdc=Decimal("0"),
                vault_ledger_delta_usdc=Decimal("0"),
                pending_deposit_count=0,
                pending_withdrawal_count=0,
                projected_at=None,
            )
        return GatewayFinanceSnapshot(
            today_charge_usdc=Decimal(str(row["today_charge_usdc"])),
            today_deposit_usdc=Decimal(str(row["today_deposit_usdc"])),
            today_refund_usdc=Decimal(str(row["today_refund_usdc"])),
            today_withdrawal_usdc=Decimal(str(row["today_withdrawal_usdc"])),
            owner_liability_usdc=Decimal(str(row["owner_liability_usdc"])),
            provider_payable_usdc=Decimal(str(row["provider_payable_usdc"])),
            platform_fee_balance_usdc=Decimal(str(row["platform_fee_balance_usdc"])),
            vault_ledger_delta_usdc=Decimal(str(row["vault_ledger_delta_usdc"])),
            pending_deposit_count=int(row["pending_deposit_count"]),
            pending_withdrawal_count=int(row["pending_withdrawal_count"]),
            projected_at=row["projected_at"],
        )

    def list_activity_trends(self) -> list[GatewayActivityTrendPoint]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    bucket_date,
                    deposit_usdc,
                    charge_usdc,
                    refund_usdc,
                    withdrawal_usdc,
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
                refund_usdc=Decimal(str(row["refund_usdc"])),
                withdrawal_usdc=Decimal(str(row["withdrawal_usdc"])),
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