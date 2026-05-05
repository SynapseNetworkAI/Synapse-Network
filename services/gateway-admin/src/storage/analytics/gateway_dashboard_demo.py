from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any


_ACTIVITY_TRENDS = (
    ("2026-03-10", "920.00", "780.20", 218, "118.20", "662.00", "31.40", "240.00", "648.60"),
    ("2026-03-11", "1110.25", "830.00", 226, "126.00", "704.00", "25.15", "210.00", "875.10"),
    ("2026-03-12", "1185.50", "910.30", 244, "141.30", "769.00", "0.00", "320.00", "865.50"),
    ("2026-03-13", "980.00", "845.90", 231, "129.90", "716.00", "16.20", "180.00", "783.80"),
    ("2026-03-14", "1320.15", "990.10", 268, "150.10", "840.00", "45.00", "275.00", "1000.15"),
    ("2026-03-15", "1460.00", "1210.50", 316, "186.50", "1024.00", "38.75", "290.00", "1131.25"),
    ("2026-03-16", "1640.00", "1280.40", 342, "196.40", "1084.00", "42.25", "310.50", "1287.25"),
)


def _utc(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def _trend_rows(activity_trend_point_cls: Any) -> list[Any]:
    return [
        activity_trend_point_cls(
            bucket_date=date.fromisoformat(bucket_date),
            deposit_usdc=Decimal(deposit),
            charge_usdc=Decimal(charge),
            invocation_count=invocations,
            platform_fee_earned_usdc=Decimal(platform_fee),
            provider_earned_usdc=Decimal(provider_earned),
            consumer_refund_usdc=Decimal(refund),
            provider_withdrawal_usdc=Decimal(withdrawal),
            net_flow_usdc=Decimal(net_flow),
        )
        for (
            bucket_date,
            deposit,
            charge,
            invocations,
            platform_fee,
            provider_earned,
            refund,
            withdrawal,
            net_flow,
        ) in _ACTIVITY_TRENDS
    ]


def build_seed_demo_repository(
    repository_cls: Any,
    dashboard_snapshot_cls: Any,
    finance_snapshot_cls: Any,
    activity_trend_point_cls: Any,
    operations_snapshot_cls: Any,
    reconciliation_runtime_state_cls: Any,
) -> Any:
    return repository_cls(
        snapshot=dashboard_snapshot_cls(2, 1, Decimal("0.50"), "degraded", _utc(2026, 3, 16, 8)),
        finance_snapshot=finance_snapshot_cls(
            Decimal("1280.40"), Decimal("1640.00"), Decimal("42.25"), Decimal("310.50"),
            342, Decimal("196.40"), Decimal("1084.00"), Decimal("8450.10"), Decimal("7320.35"),
            Decimal("3920.45"), Decimal("3510.20"), Decimal("410.25"), Decimal("128.75"),
            Decimal("0.50"), 2, 1, 1, 184, Decimal("186.40"), _utc(2026, 3, 16, 8, 5),
        ),
        activity_trends=_trend_rows(activity_trend_point_cls),
        operations_snapshot=operations_snapshot_cls(
            "degraded", True, _utc(2026, 3, 16, 8, 3), _utc(2026, 3, 16, 8, 4), None,
            30, True, _utc(2026, 3, 16, 7, 58), 19450321, 3, None, 1, 2, 1, True,
            _utc(2026, 3, 16, 8), True, Decimal("0.50"), "vault_delta_detected",
            _utc(2026, 3, 16, 8, 5),
        ),
        reconciliation_runtime_state=reconciliation_runtime_state_cls(
            _utc(2026, 3, 16, 8), Decimal("8449.60"), Decimal("8450.10"), Decimal("0.50"),
            True, _utc(2026, 3, 16, 8),
        ),
    )
