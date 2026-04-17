from __future__ import annotations

from decimal import Decimal

import pytest

from src.domain.finance import UsageLogRow
from src.domain.service_contract import (
    AgentDiscoveryQueryRecord,
    ServiceHealthTargetRecord,
    ServiceRuntimeHealthRecord,
)
from src.services.provider.registry.discovery import (
    count_agent_discovery_results,
    discover_public_services,
    discover_services,
    health_status,
    list_owner_services,
    search_agent_discovery,
)
from tests.unit.registry_test_helper import FakeRegistryContext, service_definition


@pytest.mark.asyncio
async def test_discover_public_services_filters_and_sorts_by_usage(monkeypatch) -> None:
    services = [
        service_definition(
            "svc.alpha",
            service_name="Alpha Quotes",
            summary="quote lookup service",
            runtime_health=ServiceRuntimeHealthRecord(
                overallStatus="healthy",
                healthyTargets=1,
                totalTargets=1,
                lastCheckedAt=1710000000000,
            ),
        ),
        service_definition(
            "svc.beta",
            service_name="Beta Quotes",
            summary="quote drafting service",
            runtime_health=ServiceRuntimeHealthRecord(
                overallStatus="healthy",
                healthyTargets=1,
                totalTargets=1,
                lastCheckedAt=1710000000000,
            ),
        ),
        service_definition(
            "svc.gamma",
            service_name="Gamma Translate",
            summary="translation service",
            runtime_health=ServiceRuntimeHealthRecord(
                overallStatus="healthy",
                healthyTargets=1,
                totalTargets=1,
                lastCheckedAt=1710000000000,
            ),
        ),
    ]
    usage_rows = [
        UsageLogRow(id="row-1", ts=1, requestId="req-1", serviceId="svc.beta", status="SUCCEEDED"),
        UsageLogRow(id="row-2", ts=2, requestId="req-2", serviceId="svc.beta", status="SUCCEEDED"),
        UsageLogRow(id="row-3", ts=3, requestId="req-3", serviceId="svc.alpha", status="SUCCEEDED"),
    ]
    context = FakeRegistryContext(services, usage_rows)

    monkeypatch.setattr(
        "src.services.provider.registry.discovery.service_health_service.is_service_discoverable",
        lambda service: service.service_id != "svc.gamma",
    )

    rows = await discover_public_services(
        context,
        intent="quote",
        public_gateway_url="https://gateway.test/api/v1/agent/invocations",
        sort_by="invocation_count",
        sort_order="desc",
    )

    assert [row.service_id for row in rows] == ["svc.beta", "svc.alpha"]
    assert rows[0].invoke.targets[0].url == "https://gateway.test/api/v1/agent/invocations"


@pytest.mark.asyncio
async def test_discover_services_appends_invocation_count_and_revenue(monkeypatch) -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.alpha",
                service_name="Alpha Quotes",
                summary="quote lookup service",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            )
        ],
        [
            UsageLogRow(
                id="row-1",
                ts=1,
                requestId="req-1",
                serviceId="svc.alpha",
                status="SUCCEEDED",
                totalCharge=Decimal("0.050"),
            ),
            UsageLogRow(
                id="row-2",
                ts=2,
                requestId="req-2",
                serviceId="svc.alpha",
                status="SUCCEEDED",
                totalCharge=Decimal("0.040"),
            ),
        ],
    )

    monkeypatch.setattr(
        "src.services.provider.registry.discovery.service_health_service.is_service_discoverable",
        lambda service: True,
    )

    rows = await discover_services(context, public_gateway_url="https://gateway.test")

    assert len(rows) == 1
    assert rows[0]["serviceId"] == "svc.alpha"
    assert rows[0]["invocationCount"] == 2
    assert rows[0]["totalRevenueUsdc"] == "0.090"


@pytest.mark.asyncio
async def test_list_owner_services_enriches_lifecycle_status_and_health(monkeypatch) -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.owner-active",
                owner_address="0xprovider",
                service_name="Owner Active",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            ),
            service_definition(
                "svc.other-owner",
                owner_address="0xother",
                service_name="Other Owner",
            ),
        ],
        [],
    )

    monkeypatch.setattr(
        "src.services.provider.registry.discovery.service_health_service.is_service_discoverable",
        lambda service: service.service_id == "svc.owner-active",
    )

    rows = await list_owner_services(context, "0xprovider")

    assert len(rows) == 1
    assert rows[0]["serviceId"] == "svc.owner-active"
    assert rows[0]["pricing"] == {"amount": "0.01", "currency": "USDC"}
    assert rows[0]["status"] == "active"
    assert rows[0]["health"]["probeStatus"] == "healthy"
    assert "overallStatus" in rows[0]["health"]
    assert rows[0]["runtimeAvailable"] is True


@pytest.mark.asyncio
async def test_search_agent_discovery_uses_query_and_tag_union(monkeypatch) -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.echo",
                service_name="Echo Service",
                summary="echo text back",
                tags=["utility"],
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            ),
            service_definition(
                "svc.poem",
                service_name="Poem Writer",
                summary="creative writing service",
                tags=["inspiration"],
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            ),
            service_definition(
                "svc.math",
                service_name="Math Solver",
                summary="solve equations",
                tags=["math"],
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            ),
        ],
        [],
    )

    monkeypatch.setattr(
        "src.services.provider.registry.discovery.service_health_service.is_service_discoverable",
        lambda service: True,
    )

    rows = await search_agent_discovery(
        context,
        AgentDiscoveryQueryRecord(query="svc.echo", tags=["inspiration"], pageSize=10),
    )

    assert [row.service_id for row in rows] == ["svc.echo", "svc.poem"]


@pytest.mark.asyncio
async def test_search_agent_discovery_blank_query_returns_all_healthy_services(monkeypatch) -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.echo",
                service_name="Echo Service",
                summary="echo text back",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            ),
            service_definition(
                "svc.poem",
                service_name="Poem Writer",
                summary="creative writing service",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            ),
        ],
        [],
    )

    monkeypatch.setattr(
        "src.services.provider.registry.discovery.service_health_service.is_service_discoverable",
        lambda service: True,
    )

    rows = await search_agent_discovery(
        context,
        AgentDiscoveryQueryRecord(query="", pageSize=10),
    )

    assert [row.service_id for row in rows] == ["svc.echo", "svc.poem"]


@pytest.mark.asyncio
async def test_search_agent_discovery_supports_pagination(monkeypatch) -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.alpha",
                service_name="Alpha Service",
                summary="alpha",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            ),
            service_definition(
                "svc.beta",
                service_name="Beta Service",
                summary="beta",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            ),
            service_definition(
                "svc.gamma",
                service_name="Gamma Service",
                summary="gamma",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                ),
            ),
        ],
        [],
    )

    monkeypatch.setattr(
        "src.services.provider.registry.discovery.service_health_service.is_service_discoverable",
        lambda service: True,
    )

    query = AgentDiscoveryQueryRecord(query="", page=2, pageSize=1)
    total_count = await count_agent_discovery_results(context, query)
    rows = await search_agent_discovery(context, query)

    assert total_count == 3
    assert len(rows) == 1
    assert rows[0].service_id == "svc.beta"


@pytest.mark.asyncio
async def test_health_status_excludes_inactive_until_requested() -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.active",
                service_name="Active Translate",
                summary="translate text",
            ),
            service_definition(
                "svc.inactive",
                service_name="Inactive Translate",
                summary="translate text",
                status="inactive",
                is_active=False,
            ),
        ],
        [],
    )

    active_only = await health_status(context, intent="translate")
    including_inactive = await health_status(
        context,
        intent="translate",
        include_inactive=True,
    )

    assert [row["serviceId"] for row in active_only] == ["svc.active"]
    assert [row["serviceId"] for row in including_inactive] == ["svc.active", "svc.inactive"]


@pytest.mark.asyncio
async def test_suspended_service_keeps_control_status_but_is_not_discoverable() -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.suspended",
                service_name="Suspended Translate",
                status="suspended",
                is_active=False,
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1710000000000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://svc.suspended.test/invoke",
                            status="healthy",
                            weight=100,
                            lastCheckedAt=1710000000000,
                        )
                    ],
                ),
            )
        ],
        [],
    )

    discoverable = await discover_services(context)
    health_rows = await health_status(context, include_inactive=True)

    assert discoverable == []
    assert health_rows[0]["status"] == "suspended"
    assert health_rows[0]["health"]["overallStatus"] == "suspended"
    assert health_rows[0]["runtimeAvailable"] is False


@pytest.mark.asyncio
async def test_health_status_uses_discovery_effective_runtime_state(monkeypatch) -> None:
    context = FakeRegistryContext(
        [
            service_definition(
                "svc.stale",
                service_name="Stale Quotes",
                runtime_health=ServiceRuntimeHealthRecord(
                    overallStatus="healthy",
                    healthyTargets=1,
                    totalTargets=1,
                    lastCheckedAt=1_000,
                    targets=[
                        ServiceHealthTargetRecord(
                            targetUrl="https://svc.stale.test/invoke",
                            status="healthy",
                            weight=100,
                            lastCheckedAt=1_000,
                        )
                    ],
                ),
            )
        ],
        [],
    )

    monkeypatch.setattr(
        "src.services.platform.service_health_utils._now_ms",
        lambda: 1_000 + 121_000,
    )

    rows = await health_status(context, include_inactive=True)

    assert rows[0]["health"]["probeStatus"] == "healthy"
    assert rows[0]["health"]["overallStatus"] == "stale"
    assert rows[0]["health"]["isStale"] is True
    assert rows[0]["health"]["runtimeAvailable"] is False
    assert rows[0]["runtimeAvailable"] is False
