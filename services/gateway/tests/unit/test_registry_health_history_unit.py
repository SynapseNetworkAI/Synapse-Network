from __future__ import annotations

import pytest

from src.domain.registry import ServiceTargetHealthHistory
from src.services.provider.registry.health_history import service_health_history
from tests.unit.registry_test_helper import FakeRegistryContext, service_definition


@pytest.mark.asyncio
async def test_service_health_history_limits_and_orders_entries(monkeypatch) -> None:
    now_ms = 10_000_000
    context = FakeRegistryContext(
        [service_definition("svc.history")],
        history_rows=[
            ServiceTargetHealthHistory(
                serviceId="svc.history",
                targetUrl="https://a.test/invoke",
                status="healthy",
                checkedAt=now_ms - 10_000,
                latencyMs=31,
            ),
            ServiceTargetHealthHistory(
                serviceId="svc.history",
                targetUrl="https://a.test/invoke",
                status="degraded",
                checkedAt=now_ms - 20_000,
                latencyMs=45,
            ),
            ServiceTargetHealthHistory(
                serviceId="svc.history",
                targetUrl="https://a.test/invoke",
                status="unhealthy",
                checkedAt=now_ms - 30_000,
                latencyMs=55,
            ),
            ServiceTargetHealthHistory(
                serviceId="svc.history",
                targetUrl="https://b.test/invoke",
                status="healthy",
                checkedAt=now_ms - 15_000,
                latencyMs=28,
            ),
            ServiceTargetHealthHistory(
                serviceId="svc.history",
                targetUrl="https://stale.test/invoke",
                status="healthy",
                checkedAt=now_ms - 7_200_000,
                latencyMs=99,
            ),
        ],
    )

    monkeypatch.setattr(
        "src.services.provider.registry.health_history.time.time",
        lambda: now_ms / 1000,
    )

    payload = await service_health_history(
        context,
        "svc.history",
        "0xprovider",
        limit_per_target=2,
        hours=1,
    )

    assert payload["serviceId"] == "svc.history"
    assert payload["limitPerTarget"] == 2
    assert [target["targetUrl"] for target in payload["targets"]] == [
        "https://a.test/invoke",
        "https://b.test/invoke",
    ]
    assert payload["targets"][0]["latestStatus"] == "healthy"
    assert [entry["checkedAt"] for entry in payload["targets"][0]["history"]] == [
        now_ms - 10_000,
        now_ms - 20_000,
    ]


@pytest.mark.asyncio
async def test_service_health_history_rejects_unknown_or_forbidden_service() -> None:
    context = FakeRegistryContext([service_definition("svc.history")], history_rows=[])

    with pytest.raises(ValueError, match="SERVICE_NOT_FOUND_OR_FORBIDDEN"):
        await service_health_history(
            context,
            "svc.history",
            "0xother",
            limit_per_target=5,
            hours=1,
        )


@pytest.mark.asyncio
async def test_service_health_history_normalizes_limit_and_handles_non_list_history(monkeypatch) -> None:
    context = FakeRegistryContext([service_definition("svc.history")], history_rows=None)

    monkeypatch.setattr(
        "src.services.provider.registry.health_history.time.time",
        lambda: 1000,
    )

    payload = await service_health_history(
        context,
        "svc.history",
        "0xprovider",
        limit_per_target=5000,
        hours=1,
    )

    assert payload["limitPerTarget"] == 2000
    assert payload["targets"] == []