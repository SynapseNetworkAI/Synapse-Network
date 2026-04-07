from __future__ import annotations

import asyncio
import threading
from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace

from fastapi.testclient import TestClient

from src import app as gateway_app
from src.domain.gateway import OwnerSpendLimitRow
from src.domain.finance import UsageLogRow
from src.services.platform import credential_service
from src.services.platform.balance_service import BalanceService
from src.services.platform.tasks.provider_withdraw_expiry_reaper import (
    run_provider_withdraw_expiry_reaper as _real_run_provider_withdraw_expiry_reaper,
)


class InMemoryGatewayStateRepo:
    def __init__(self, usage_rows: list[UsageLogRow]) -> None:
        self.usage_rows = list(usage_rows)
        self.owner_spend_limit_rows: list[OwnerSpendLimitRow] = []

    def read_invocation_billing_rows(self):
        return list(self.usage_rows)

    def read_owner_spend_limit_rows(self):
        return list(self.owner_spend_limit_rows)


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
    gateway_app.run_provider_withdraw_expiry_reaper = _background_loop_until_stopped
    gateway_app.settings.service_health_monitor_enabled = False
    gateway_app.settings.provider_withdraw_expiry_reaper_enabled = False
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


def test_app_lifespan_runs_provider_withdraw_expiry_reaper_tick(monkeypatch) -> None:
    storage = FakeStorage([])
    ticked = threading.Event()
    tick_count = {"value": 0}

    async def fake_expire_stale_provider_withdrawals(self) -> int:
        _ = self
        await asyncio.sleep(0)
        tick_count["value"] += 1
        ticked.set()
        return 0

    monkeypatch.setattr(gateway_app, "create_storage", lambda settings: storage)
    monkeypatch.setattr(gateway_app, "run_v2_deposit_indexer", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_service_health_monitor", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_provider_withdraw_expiry_reaper", _real_run_provider_withdraw_expiry_reaper)
    monkeypatch.setattr(
        gateway_app.settings,
        "service_health_monitor_enabled",
        False,
        raising=False,
    )
    monkeypatch.setattr(
        gateway_app.settings,
        "provider_withdraw_expiry_reaper_enabled",
        True,
        raising=False,
    )
    monkeypatch.setattr(
        BalanceService,
        "expire_stale_provider_withdrawals",
        fake_expire_stale_provider_withdrawals,
    )

    gateway_app.app.dependency_overrides = {}
    app = gateway_app.create_app()

    with TestClient(app, base_url="https://gateway.test"):
        assert ticked.wait(timeout=5.0)
        assert tick_count["value"] >= 1
        assert app.state.provider_withdraw_expiry_reaper_task is not None

    assert app.state.provider_withdraw_expiry_reaper_task.done()


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


def test_get_owner_spending_limit_endpoint_returns_owner_level_payload(monkeypatch) -> None:
    storage = FakeStorage([])

    async def fake_get_owner_spending_limit(self, owner_wallet: str):
        _ = self
        return {
            "ownerAddress": owner_wallet,
            "spendingLimitUsdc": 25.0,
            "allowUnlimited": False,
            "cycleInterval": "monthly",
            "currentCycleSpendUsdc": 7.5,
            "remainingSpendUsdc": 17.5,
            "updatedAt": "2026-04-01 12:00:00",
        }

    monkeypatch.setattr(
        BalanceService, "get_owner_spending_limit", fake_get_owner_spending_limit
    )

    with _http_client(storage) as client:
        response = client.get(
            "/api/v1/balance/spending-limit",
            headers={"X-User-Address": "0xowner", "Authorization": "Bearer test"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["spendingLimit"]["spendingLimitUsdc"] == 25.0
    assert payload["spendingLimit"]["currentCycleSpendUsdc"] == 7.5


def test_set_owner_spending_limit_endpoint_accepts_unlimited_payload(monkeypatch) -> None:
    storage = FakeStorage([])

    async def fake_set_owner_spending_limit(
        self,
        owner_wallet: str,
        *,
        spending_limit_usdc: float | None,
        allow_unlimited: bool,
        request_meta,
    ):
        _ = (self, request_meta)
        return {
            "ownerAddress": owner_wallet,
            "spendingLimitUsdc": spending_limit_usdc,
            "allowUnlimited": allow_unlimited,
            "cycleInterval": "monthly",
            "currentCycleSpendUsdc": 0.0,
            "remainingSpendUsdc": None,
            "updatedAt": "2026-04-01 12:30:00",
        }

    monkeypatch.setattr(
        BalanceService, "set_owner_spending_limit", fake_set_owner_spending_limit
    )

    with _http_client(storage) as client:
        response = client.put(
            "/api/v1/balance/spending-limit",
            json={"allowUnlimited": True},
            headers={"X-User-Address": "0xowner", "Authorization": "Bearer test"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["spendingLimit"]["allowUnlimited"] is True
    assert payload["spendingLimit"]["spendingLimitUsdc"] is None


def test_redeem_voucher_endpoint_returns_redemption_payload(monkeypatch) -> None:
    storage = FakeStorage([])

    async def fake_redeem_credit_voucher(
        self,
        *,
        owner_wallet: str,
        voucher_code: str,
        idempotency_key: str,
        request_meta,
    ):
        _ = self
        assert voucher_code == "ABCD-EFGH-IJKL"
        assert idempotency_key == "voucher-redeem-key-0003"
        assert request_meta["requestId"] == "req-voucher-3"
        return {
            "redemption": {
                "redemptionId": "vrd-1",
                "campaignCode": "APRIL26",
                "grantedAmountUsdc": "15.000000",
            },
            "balance": {
                "ownerBalance": 35.0,
                "providerReceivable": 0.0,
                "platformFeeAccrued": 0.0,
            },
        }

    monkeypatch.setattr(
        BalanceService, "redeem_credit_voucher", fake_redeem_credit_voucher
    )

    with _http_client(storage) as client:
        response = client.post(
            "/api/v1/balance/vouchers/redeem",
            json={"voucherCode": "ABCD-EFGH-IJKL"},
            headers={
                "X-User-Address": "0xowner",
                "Authorization": "Bearer test",
                "X-Idempotency-Key": "voucher-redeem-key-0003",
                "X-Request-Id": "req-voucher-3",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "success"
    assert payload["redemption"]["campaignCode"] == "APRIL26"
    assert payload["balance"]["ownerBalance"] == 35.0
