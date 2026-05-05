import json
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from functools import lru_cache
from typing import Any, Protocol

import psycopg
from psycopg.rows import dict_row

from src.storage.analytics.gateway_dashboard_demo import build_seed_demo_repository


def _connect(dsn: str) -> Any:
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
    raise KeyError("projection column not found")  # noqa: TRY003 - stable test-facing projection error


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


def _row_payload(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    payload = row.get("payload")
    if isinstance(payload, dict):
        return payload
    return row


def _projection_value(
    row: dict[str, Any],
    canonical_name: str,
    legacy_alias: str | None = None,
    *,
    default: Any = None,
) -> Any:
    if canonical_name in row:
        return row[canonical_name]
    if legacy_alias and legacy_alias in row:
        return row[legacy_alias]
    return default


def _projection_decimal(
    row: dict[str, Any],
    canonical_name: str,
    legacy_alias: str | None = None,
    *,
    default: str = "0",
) -> Decimal:
    return Decimal(str(_projection_value(row, canonical_name, legacy_alias, default=default)))


def _projection_int(
    row: dict[str, Any],
    canonical_name: str,
    legacy_alias: str | None = None,
    *,
    default: int = 0,
) -> int:
    return int(_projection_value(row, canonical_name, legacy_alias, default=default) or 0)


@dataclass(slots=True)
class GatewayDashboardSnapshot:
    deposit_exceptions: int
    audit_alerts: int
    vault_ledger_delta: Decimal
    gateway_status: str
    last_reconciliation_at: datetime | None


def _empty_dashboard_snapshot() -> GatewayDashboardSnapshot:
    return GatewayDashboardSnapshot(
        deposit_exceptions=0,
        audit_alerts=0,
        vault_ledger_delta=Decimal("0"),
        gateway_status="unknown",
        last_reconciliation_at=None,
    )


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


def _empty_finance_snapshot() -> GatewayFinanceSnapshot:
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
    indexer_running: bool
    indexer_last_processed_at: datetime | None
    indexer_last_heartbeat_at: datetime | None
    indexer_last_error: str | None
    indexer_poll_interval_sec: int
    backfill_enabled: bool
    backfill_last_scan_at: datetime | None
    backfill_last_scanned_block: int | None
    backfill_last_recovered: int
    backfill_last_error: str | None
    recent_gateway_failures: int
    failed_deposit_count: int
    recent_audit_alerts: int
    reconciliation_enabled: bool
    last_reconciliation_at: datetime | None
    reconciliation_alert: bool
    reconciliation_delta_usdc: Decimal
    reconciliation_last_error: str | None
    projected_at: datetime | None


def _empty_operations_snapshot() -> GatewayOperationsSnapshot:
    return GatewayOperationsSnapshot(
        gateway_status="unknown",
        indexer_running=False,
        indexer_last_processed_at=None,
        indexer_last_heartbeat_at=None,
        indexer_last_error=None,
        indexer_poll_interval_sec=0,
        backfill_enabled=False,
        backfill_last_scan_at=None,
        backfill_last_scanned_block=None,
        backfill_last_recovered=0,
        backfill_last_error=None,
        recent_gateway_failures=0,
        failed_deposit_count=0,
        recent_audit_alerts=0,
        reconciliation_enabled=False,
        last_reconciliation_at=None,
        reconciliation_alert=False,
        reconciliation_delta_usdc=Decimal("0"),
        reconciliation_last_error=None,
        projected_at=None,
    )


def _operations_snapshot_from_row(row: dict[str, Any]) -> GatewayOperationsSnapshot:
    return GatewayOperationsSnapshot(
        gateway_status=str(row["gateway_status"]),
        indexer_running=bool(row.get("indexer_running") or False),
        indexer_last_processed_at=row.get("indexer_last_processed_at"),
        indexer_last_heartbeat_at=row.get("indexer_last_heartbeat_at"),
        indexer_last_error=row.get("indexer_last_error"),
        indexer_poll_interval_sec=int(row.get("indexer_poll_interval_sec") or 0),
        backfill_enabled=bool(row.get("backfill_enabled") or False),
        backfill_last_scan_at=row.get("backfill_last_scan_at"),
        backfill_last_scanned_block=row.get("backfill_last_scanned_block"),
        backfill_last_recovered=int(row.get("backfill_last_recovered") or 0),
        backfill_last_error=row.get("backfill_last_error"),
        recent_gateway_failures=int(row["recent_gateway_failures"]),
        failed_deposit_count=int(row["failed_deposit_count"]),
        recent_audit_alerts=int(row["recent_audit_alerts"]),
        reconciliation_enabled=bool(row.get("reconciliation_enabled") or False),
        last_reconciliation_at=row.get("last_reconciliation_at"),
        reconciliation_alert=bool(row["reconciliation_alert"]),
        reconciliation_delta_usdc=Decimal(str(row["reconciliation_delta_usdc"])),
        reconciliation_last_error=row.get("reconciliation_last_error"),
        projected_at=row.get("projected_at"),
    )


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
        return build_seed_demo_repository(
            cls,
            GatewayDashboardSnapshot,
            GatewayFinanceSnapshot,
            GatewayActivityTrendPoint,
            GatewayOperationsSnapshot,
            GatewayReconciliationRuntimeState,
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
        columns = self._get_projection_columns("synapse_admin_dashboard_projection")
        if not columns:
            return _empty_dashboard_snapshot()
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
            return _empty_dashboard_snapshot()
        return GatewayDashboardSnapshot(
            deposit_exceptions=int(row["deposit_exceptions"]),
            audit_alerts=int(row["audit_alerts"]),
            vault_ledger_delta=Decimal(str(row["vault_ledger_delta_usdc"])),
            gateway_status=str(row["gateway_status"]),
            last_reconciliation_at=row["last_reconciliation_at"],
        )

    def get_finance_snapshot(self) -> GatewayFinanceSnapshot:
        columns = self._get_projection_columns("synapse_admin_dashboard_finance_projection")
        if not columns:
            return _empty_finance_snapshot()
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT row_to_json(projection_row) AS payload
                FROM (
                    SELECT *
                    FROM synapse_admin_dashboard_finance_projection
                    LIMIT 1
                ) AS projection_row
                """
            )
            row = cur.fetchone()
        payload = _row_payload(row)
        if payload is None:
            return _empty_finance_snapshot()
        return GatewayFinanceSnapshot(
            today_charge_usdc=_projection_decimal(payload, "today_charge_usdc"),
            today_deposit_usdc=_projection_decimal(payload, "today_deposit_usdc"),
            today_consumer_refund_usdc=_projection_decimal(payload, "today_consumer_refund_usdc", "today_refund_usdc"),
            today_provider_withdrawal_usdc=_projection_decimal(
                payload,
                "today_provider_withdrawal_usdc",
                "today_withdrawal_usdc",
            ),
            today_invocation_count=_projection_int(payload, "today_invocation_count"),
            today_platform_fee_earned_usdc=_projection_decimal(payload, "today_platform_fee_earned_usdc"),
            today_provider_earned_usdc=_projection_decimal(payload, "today_provider_earned_usdc"),
            consumer_liability_usdc=_projection_decimal(payload, "consumer_liability_usdc", "owner_liability_usdc"),
            refundable_consumer_balance_usdc=_projection_decimal(payload, "refundable_consumer_balance_usdc"),
            provider_payable_usdc=_projection_decimal(payload, "provider_payable_usdc"),
            provider_available_to_withdraw_usdc=_projection_decimal(payload, "provider_available_to_withdraw_usdc"),
            provider_locked_balance_usdc=_projection_decimal(payload, "provider_locked_balance_usdc"),
            platform_fee_balance_usdc=_projection_decimal(payload, "platform_fee_balance_usdc"),
            vault_ledger_delta_usdc=_projection_decimal(payload, "vault_ledger_delta_usdc"),
            pending_deposit_count=_projection_int(payload, "pending_deposit_count"),
            pending_provider_withdrawal_count=_projection_int(
                payload,
                "pending_provider_withdrawal_count",
                "pending_withdrawal_count",
            ),
            chain_confirmed_not_ledger_confirmed_count=_projection_int(
                payload,
                "chain_confirmed_not_ledger_confirmed_count",
            ),
            deposit_p95_sync_delay_seconds=_projection_int(payload, "deposit_p95_sync_delay_seconds"),
            recently_completed_outflows_usdc=_projection_decimal(payload, "recently_completed_outflows_usdc"),
            projected_at=payload.get("projected_at"),
        )

    def list_activity_trends(self) -> list[GatewayActivityTrendPoint]:
        columns = self._get_projection_columns("synapse_admin_dashboard_activity_trend_projection")
        if not columns:
            return []
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT row_to_json(projection_row) AS payload
                FROM (
                    SELECT *
                    FROM synapse_admin_dashboard_activity_trend_projection
                    ORDER BY bucket_date ASC
                ) AS projection_row
                """
            )
            rows = cur.fetchall()
        payloads = [payload for row in rows if (payload := _row_payload(row)) is not None]
        return [
            GatewayActivityTrendPoint(
                bucket_date=payload["bucket_date"],
                deposit_usdc=_projection_decimal(payload, "deposit_usdc"),
                charge_usdc=_projection_decimal(payload, "charge_usdc"),
                invocation_count=_projection_int(payload, "invocation_count"),
                platform_fee_earned_usdc=_projection_decimal(payload, "platform_fee_earned_usdc"),
                provider_earned_usdc=_projection_decimal(payload, "provider_earned_usdc"),
                consumer_refund_usdc=_projection_decimal(payload, "consumer_refund_usdc", "refund_usdc"),
                provider_withdrawal_usdc=_projection_decimal(payload, "provider_withdrawal_usdc", "withdrawal_usdc"),
                net_flow_usdc=_projection_decimal(payload, "net_flow_usdc"),
            )
            for payload in payloads
        ]

    def get_operations_snapshot(self) -> GatewayOperationsSnapshot:
        columns = self._get_projection_columns("synapse_admin_dashboard_operations_projection")
        if not columns:
            return _empty_operations_snapshot()
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT row_to_json(projection_row) AS payload
                FROM (
                    SELECT *
                    FROM synapse_admin_dashboard_operations_projection
                    LIMIT 1
                ) AS projection_row
                """
            )
            row = cur.fetchone()
        payload = _row_payload(row)
        if payload is None:
            return _empty_operations_snapshot()
        return _operations_snapshot_from_row(payload)

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
