from __future__ import annotations

from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace

from fastapi.testclient import TestClient

from src import app as gateway_app
from src.domain.finance import UsageLogRow
from src.services.platform import credential_service


class InMemoryGatewayStateRepo:
    def __init__(self, usage_rows: list[UsageLogRow]) -> None:
        self.usage_rows = list(usage_rows)

    def read_invocation_billing_rows(self):
        return list(self.usage_rows)


class FakeStorage:
    def __init__(self, usage_rows: list[UsageLogRow]) -> None:
        self.data_manager = SimpleNamespace(
            system=SimpleNamespace(
                gateway_state=InMemoryGatewayStateRepo(usage_rows),
            )
        )

    def get_data_manager(self):
        return self.data_manager


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


@contextmanager
def _http_client(storage: FakeStorage):
    gateway_app.app.dependency_overrides = {}
    gateway_app.create_storage = lambda settings: storage
    gateway_app.run_v2_deposit_indexer = _background_loop_until_stopped
    gateway_app.run_service_health_monitor = _background_loop_until_stopped
    gateway_app.settings.service_health_monitor_enabled = False
    original_require_owner_wallet = credential_service.require_owner_wallet
    credential_service.require_owner_wallet = lambda authorization, x_user_address: x_user_address or ""
    try:
        with TestClient(gateway_app.create_app(), base_url="https://gateway.test") as client:
            yield client
    finally:
        credential_service.require_owner_wallet = original_require_owner_wallet


def _usage_row(
    row_id: str,
    *,
    ts: int,
    agent_id: str,
    request_id: str,
    service_id: str,
    consumer_address: str,
    provider_address: str,
    status: str,
    latency_ms: int | None = None,
) -> UsageLogRow:
    return UsageLogRow(
        id=row_id,
        ts=ts,
        agentId=agent_id,
        requestId=request_id,
        serviceId=service_id,
        consumer_address=consumer_address,
        provider_address=provider_address,
        status=status,
        totalCharge=Decimal("0.012345"),
        protocolFee=Decimal("0.001000"),
        routingTax=Decimal("0.000500"),
        latencyMs=latency_ms,
        businessType="charge",
    )


def test_usage_logs_returns_paginated_owner_scoped_rows() -> None:
    storage = FakeStorage(
        [
            _usage_row(
                "inv-1",
                ts=1710000001,
                agent_id="agent-failed",
                request_id="req-1",
                service_id="svc.gamma",
                consumer_address="0xowner",
                provider_address="0xprovider-1",
                status="failed",
                latency_ms=900,
            ),
            _usage_row(
                "inv-2",
                ts=1710000003,
                agent_id="agent-alpha",
                request_id="req-2",
                service_id="svc.alpha",
                consumer_address="0xowner",
                provider_address="0xprovider-2",
                status="succeeded",
                latency_ms=1200,
            ),
            _usage_row(
                "inv-3",
                ts=1710000002,
                agent_id="agent-beta",
                request_id="req-3",
                service_id="svc.beta",
                consumer_address="0xowner",
                provider_address="0xprovider-3",
                status="accepted",
                latency_ms=450,
            ),
            _usage_row(
                "inv-4",
                ts=1710000004,
                agent_id="agent-other",
                request_id="req-4",
                service_id="svc.other",
                consumer_address="0xanother-owner",
                provider_address="0xprovider-4",
                status="succeeded",
            ),
        ]
    )

    with _http_client(storage) as client:
        response = client.get(
            "/api/v1/usage/logs?page=1&pageSize=2",
            headers={"X-User-Address": "0xowner", "Authorization": "Bearer test"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["total"] == 3
    assert payload["count"] == 2
    assert payload["page"] == 1
    assert payload["pageSize"] == 2
    assert payload["hasMore"] is True
    assert [row["id"] for row in payload["logs"]] == ["inv-2", "inv-3"]
    assert payload["logs"][0]["agentId"] == "agent-alpha"
    assert payload["logs"][0]["latencyMs"] == 1200


def test_usage_logs_support_status_and_query_filters() -> None:
    storage = FakeStorage(
        [
            _usage_row(
                "inv-10",
                ts=1710000001,
                agent_id="agent-alpha",
                request_id="req-10",
                service_id="svc.alpha",
                consumer_address="0xowner",
                provider_address="0xprovider-a",
                status="succeeded",
            ),
            _usage_row(
                "inv-11",
                ts=1710000002,
                agent_id="agent-beta",
                request_id="req-11",
                service_id="svc.beta",
                consumer_address="0xowner",
                provider_address="0xprovider-b",
                status="failed",
            ),
        ]
    )

    with _http_client(storage) as client:
        response = client.get(
            "/api/v1/usage/logs?page=1&pageSize=10&status=failed&query=svc.beta",
            headers={"X-User-Address": "0xowner", "Authorization": "Bearer test"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["count"] == 1
    assert payload["logs"][0]["id"] == "inv-11"


def test_usage_logs_limit_mode_stays_backward_compatible() -> None:
    storage = FakeStorage(
        [
            _usage_row(
                "inv-20",
                ts=1710000001,
                agent_id="agent-alpha",
                request_id="req-20",
                service_id="svc.alpha",
                consumer_address="0xowner",
                provider_address="0xprovider-a",
                status="succeeded",
            ),
            _usage_row(
                "inv-21",
                ts=1710000002,
                agent_id="agent-beta",
                request_id="req-21",
                service_id="svc.beta",
                consumer_address="0xowner",
                provider_address="0xprovider-b",
                status="failed",
            ),
        ]
    )

    with _http_client(storage) as client:
        response = client.get(
            "/api/v1/usage/logs?limit=1",
            headers={"X-User-Address": "0xowner", "Authorization": "Bearer test"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["total"] == 2
    assert payload["page"] == 1
    assert payload["pageSize"] == 1
    assert payload["hasMore"] is True
    assert [row["id"] for row in payload["logs"]] == ["inv-21"]
