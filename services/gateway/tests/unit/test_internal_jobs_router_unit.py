from __future__ import annotations

from fastapi.testclient import TestClient

from src import app as gateway_app


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


class _FakeStorage:
    def close(self) -> None:
        return None


def _build_client(monkeypatch):
    monkeypatch.setattr(gateway_app, "create_storage", lambda settings: _FakeStorage())
    monkeypatch.setattr(gateway_app, "run_v2_deposit_indexer", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_service_health_monitor", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_provider_withdraw_expiry_reaper", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_consumer_withdraw_processor", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_service_health_event_cleanup", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app.settings, "provider_withdraw_expiry_reaper_enabled", False, raising=False)
    monkeypatch.setattr(gateway_app.settings, "consumer_withdraw_processor_enabled", False, raising=False)
    monkeypatch.setattr(gateway_app.settings, "notification_outbox_trigger_enabled", True, raising=False)
    monkeypatch.setattr(gateway_app.settings, "internal_trigger_secret", "unit-secret", raising=False)
    return TestClient(gateway_app.create_app(), base_url="https://gateway.test")


def test_internal_notification_trigger_requires_shared_secret(monkeypatch) -> None:
    with _build_client(monkeypatch) as client:
        response = client.post("/internal/jobs/notification-outbox/trigger", json={"source": "unit"})
    assert response.status_code == 401


def test_internal_notification_trigger_runs_once(monkeypatch) -> None:
    async def fake_drain(_storage):
        return {"claimed": 1, "sent": 1, "failed": 0, "quotaDeferred": 0}

    class _NoopLock:
        def __enter__(self):
            return True

        def __exit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(
        "src.api.routers.internal_jobs.drain_notification_outbox_once",
        fake_drain,
    )
    monkeypatch.setattr(
        "src.api.routers.internal_jobs.postgres_advisory_job_lock",
        lambda storage, job_name: _NoopLock(),
    )
    with _build_client(monkeypatch) as client:
        response = client.post(
            "/internal/jobs/notification-outbox/trigger",
            headers={"X-Synapse-Internal-Token": "unit-secret"},
            json={"source": "unit"},
        )
    assert response.status_code == 200
    assert response.json()["jobName"] == "notification-outbox-drain"
