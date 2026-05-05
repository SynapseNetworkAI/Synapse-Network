from __future__ import annotations

import asyncio
import logging
import sys
import time
from contextlib import contextmanager
from types import SimpleNamespace

from fastapi.testclient import TestClient

class _TTLCache(dict):
    def __init__(self, maxsize, ttl):
        super().__init__()
        self.maxsize = maxsize
        self.ttl = ttl


sys.modules.setdefault("cachetools", SimpleNamespace(TTLCache=_TTLCache))

from src import app as gateway_app
from src.core.metrics import MetricsRegistry


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


DEFAULT_TASK_PATCHES = {
    "run_v2_deposit_indexer": _background_loop_until_stopped,
    "run_service_health_monitor": _background_loop_until_stopped,
    "run_provider_withdraw_expiry_reaper": _background_loop_until_stopped,
    "run_consumer_withdraw_processor": _background_loop_until_stopped,
    "run_service_health_event_cleanup": _background_loop_until_stopped,
}


@contextmanager
def _readiness_http_client(
    monkeypatch,
    *,
    settings_overrides: dict[str, object] | None = None,
    task_overrides: dict[str, object] | None = None,
    indexer_status_overrides: dict[str, object] | None = None,
):
    fake_db = SimpleNamespace(
        stats=lambda: {
            "poolMax": 5,
            "poolAvailable": 1,
            "poolSize": 1,
            "requestsWaiting": 0,
            "closed": False,
        }
    )
    fake_storage = SimpleNamespace(
        closed=False,
        close=lambda: setattr(fake_storage, "closed", True),
        get_database_manager=lambda: fake_db,
    )
    monkeypatch.setattr(gateway_app, "create_storage", lambda settings: fake_storage)

    patches = DEFAULT_TASK_PATCHES.copy()
    if task_overrides:
        patches.update(task_overrides)
    for attr, impl in patches.items():
        monkeypatch.setattr(gateway_app, attr, impl)

    now = int(time.time())
    indexer_status = {
        "running": True,
        "initialized": True,
        "heartbeatAt": now,
        "lastStepStartedAt": now - 1,
        "lastStepFinishedAt": now,
        "lastStepDurationMs": 10,
        "stepRunning": False,
        "lastError": None,
        "consecutiveFailures": 0,
        "stepTimeoutSec": 20.0,
        "staleAfterSec": 60,
    }
    if indexer_status_overrides:
        indexer_status.update(indexer_status_overrides)
    monkeypatch.setattr(
        gateway_app, "get_indexer_status", lambda: dict(indexer_status)
    )

    if settings_overrides:
        for key, value in settings_overrides.items():
            monkeypatch.setattr(gateway_app.settings, key, value, raising=False)

    app = gateway_app.create_app()
    with TestClient(app, base_url="https://gateway.test") as client:
        yield client, fake_storage


def test_readiness_reports_initialized_monitors(monkeypatch) -> None:
    with _readiness_http_client(monkeypatch) as (client, storage):
        response = client.get("/readiness")

    assert storage.closed is True
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["postgresPool"] == {
        "poolMax": 5,
        "poolAvailable": 1,
        "poolSize": 1,
        "requestsWaiting": 0,
        "closed": False,
    }
    monitors = payload["monitors"]
    assert monitors["deposit_indexer"]["enabled"] is True
    assert monitors["deposit_indexer"]["initialized"] is True
    assert monitors["deposit_indexer"]["healthy"] is True
    assert monitors["deposit_indexer"]["degradedReasons"] == []
    assert monitors["service_health_monitor"] == {"enabled": True, "initialized": True}
    assert monitors["provider_withdraw_expiry_reaper"] == {
        "enabled": True,
        "initialized": True,
    }
    assert monitors["consumer_withdraw_processor"] == {
        "enabled": True,
        "initialized": True,
    }


def test_readiness_marks_disabled_monitors(monkeypatch) -> None:
    overrides = {
        "service_health_monitor_enabled": False,
        "provider_withdraw_expiry_reaper_enabled": False,
        "consumer_withdraw_processor_enabled": False,
    }
    with _readiness_http_client(monkeypatch, settings_overrides=overrides) as (client, _storage):
        response = client.get("/readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    monitors = payload["monitors"]
    assert monitors["deposit_indexer"]["enabled"] is True
    assert monitors["deposit_indexer"]["initialized"] is True
    assert monitors["deposit_indexer"]["healthy"] is True
    assert monitors["service_health_monitor"] == {
        "enabled": False,
        "initialized": False,
    }
    assert monitors["provider_withdraw_expiry_reaper"] == {
        "enabled": False,
        "initialized": False,
    }
    assert monitors["consumer_withdraw_processor"] == {
        "enabled": False,
        "initialized": False,
    }


def test_readiness_flags_degraded_when_enabled_task_missing(monkeypatch) -> None:
    async def _completed_immediately(stop_event, storage):
        _ = stop_event, storage
        await asyncio.sleep(0)

    with _readiness_http_client(
        monkeypatch,
        task_overrides={"run_v2_deposit_indexer": _completed_immediately},
    ) as (client, _storage):
        response = client.get("/readiness")

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "degraded"
    monitors = payload["monitors"]
    assert monitors["deposit_indexer"]["enabled"] is True
    assert monitors["deposit_indexer"]["initialized"] is False
    assert "task_not_running" in monitors["deposit_indexer"]["degradedReasons"]


def test_readiness_flags_stale_deposit_indexer_heartbeat(monkeypatch) -> None:
    with _readiness_http_client(
        monkeypatch,
        indexer_status_overrides={
            "heartbeatAt": int(time.time()) - 120,
            "staleAfterSec": 60,
        },
    ) as (client, _storage):
        response = client.get("/readiness")

    assert response.status_code == 503
    payload = response.json()
    assert payload["status"] == "degraded"
    monitor = payload["monitors"]["deposit_indexer"]
    assert monitor["healthy"] is False
    assert "stale_heartbeat" in monitor["degradedReasons"]


def test_readiness_flags_timed_out_deposit_indexer_step(monkeypatch) -> None:
    with _readiness_http_client(
        monkeypatch,
        indexer_status_overrides={
            "stepRunning": True,
            "lastStepStartedAt": int(time.time()) - 25,
            "stepTimeoutSec": 20.0,
            "lastError": "INDEXER_STEP_TIMEOUT",
            "consecutiveFailures": 1,
        },
    ) as (client, _storage):
        response = client.get("/readiness")

    assert response.status_code == 503
    payload = response.json()
    monitor = payload["monitors"]["deposit_indexer"]
    assert "step_timeout" in monitor["degradedReasons"]
    assert "indexer_step_timeout" in monitor["degradedReasons"]


def test_metrics_requires_configured_token(monkeypatch) -> None:
    with _readiness_http_client(
        monkeypatch,
        settings_overrides={
            "metrics_bearer_token": "",
            "metrics_basic_username": "",
            "metrics_basic_password": "",
        },
    ) as (client, _storage):
        response = client.get("/metrics")

    assert response.status_code == 503
    assert "metrics_not_configured" in response.text


def test_metrics_requires_internal_authorization(monkeypatch) -> None:
    with _readiness_http_client(
        monkeypatch,
        settings_overrides={
            "metrics_bearer_token": "test-metrics-token",
            "metrics_basic_username": "",
            "metrics_basic_password": "",
        },
    ) as (client, _storage):
        forbidden = client.get("/metrics")
        allowed = client.get(
            "/metrics",
            headers={"Authorization": "Bearer test-metrics-token"},
        )

    assert forbidden.status_code == 403
    assert allowed.status_code == 200
    assert allowed.headers["content-type"].startswith("text/plain")
    assert "synapse_http_requests_total" in allowed.text


def test_metrics_runtime_guard_drops_sensitive_or_long_labels(caplog) -> None:
    registry = MetricsRegistry(service="gateway")

    with caplog.at_level(logging.ERROR):
        registry.set_gauge(
            "synapse_test_guard_value",
            1,
            {"wallet": "0x" + "a" * 40},
        )
        registry.set_gauge(
            "synapse_test_guard_long_value",
            1,
            {"owner": "x" * 41},
        )

    rendered = registry.render()
    assert "synapse_test_guard_value" not in rendered
    assert "synapse_test_guard_long_value" not in rendered
    assert "synapse_metric_label_rejected_total" in rendered
    assert "METRIC_LABEL_REJECTED" in caplog.text
