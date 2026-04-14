from __future__ import annotations

import asyncio
import sys
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


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


DEFAULT_TASK_PATCHES = {
    "run_v2_deposit_indexer": _background_loop_until_stopped,
    "run_service_health_monitor": _background_loop_until_stopped,
    "run_provider_withdraw_expiry_reaper": _background_loop_until_stopped,
    "run_consumer_withdraw_processor": _background_loop_until_stopped,
}


@contextmanager
def _readiness_http_client(
    monkeypatch,
    *,
    settings_overrides: dict[str, object] | None = None,
    task_overrides: dict[str, object] | None = None,
):
    fake_storage = SimpleNamespace()
    monkeypatch.setattr(gateway_app, "create_storage", lambda settings: fake_storage)

    patches = DEFAULT_TASK_PATCHES.copy()
    if task_overrides:
        patches.update(task_overrides)
    for attr, impl in patches.items():
        monkeypatch.setattr(gateway_app, attr, impl)

    if settings_overrides:
        for key, value in settings_overrides.items():
            monkeypatch.setattr(gateway_app.settings, key, value, raising=False)

    app = gateway_app.create_app()
    with TestClient(app, base_url="https://gateway.test") as client:
        yield client


def test_readiness_reports_initialized_monitors(monkeypatch) -> None:
    with _readiness_http_client(monkeypatch) as client:
        response = client.get("/readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    monitors = payload["monitors"]
    assert monitors["deposit_indexer"] == {"enabled": True, "initialized": True}
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
    with _readiness_http_client(monkeypatch, settings_overrides=overrides) as client:
        response = client.get("/readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    monitors = payload["monitors"]
    assert monitors["deposit_indexer"] == {"enabled": True, "initialized": True}
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
    ) as client:
        response = client.get("/readiness")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "degraded"
    monitors = payload["monitors"]
    assert monitors["deposit_indexer"] == {"enabled": True, "initialized": False}
