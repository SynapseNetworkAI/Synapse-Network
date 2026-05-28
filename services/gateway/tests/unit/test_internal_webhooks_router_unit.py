from __future__ import annotations

import hashlib
import hmac
import json

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
    monkeypatch.setattr(gateway_app.settings, "alchemy_deposit_webhook_enabled", True, raising=False)
    monkeypatch.setattr(gateway_app.settings, "alchemy_deposit_webhook_signing_key", "alchemy-unit", raising=False)
    return TestClient(gateway_app.create_app(), base_url="https://gateway.test")


def _signature(body: bytes) -> str:
    digest = hmac.new(
        b"alchemy-unit",
        msg=body,
        digestmod=hashlib.sha256,
    )
    return digest.hexdigest()


def test_alchemy_webhook_requires_valid_signature(monkeypatch) -> None:
    with _build_client(monkeypatch) as client:
        response = client.post(
            "/internal/webhooks/alchemy/deposits",
            json={"event": {}},
        )
    assert response.status_code == 401


def test_alchemy_webhook_triggers_bounded_sweep(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.api.routers.internal_webhooks.run_locked_bounded_pending_confirmation_sweep",
        lambda _storage: type(
            "_Result",
            (),
            {
                "status": "ok",
                "attempts": 2,
                "credited": 1,
                "failed": 0,
                "pending": 0,
                "reason": "",
            },
        )(),
    )
    payload = {
        "event": {
            "data": {
                "block": {
                    "logs": [
                        {
                            "transaction": {
                                "hash": "0xabc",
                            }
                        }
                    ]
                }
            }
        }
    }
    body = json.dumps(payload).encode("utf-8")
    with _build_client(monkeypatch) as client:
        response = client.post(
            "/internal/webhooks/alchemy/deposits",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Alchemy-Signature": _signature(body),
            },
        )
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "source": "alchemy_custom_webhook",
        "attempts": 2,
        "txHashes": ["0xabc"],
        "result": {"credited": 1, "failed": 0, "pending": 0},
    }


def test_alchemy_address_activity_webhook_triggers_bounded_sweep(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.api.routers.internal_webhooks.run_locked_bounded_pending_confirmation_sweep",
        lambda _storage: type(
            "_Result",
            (),
            {
                "status": "ok",
                "attempts": 1,
                "credited": 0,
                "failed": 0,
                "pending": 0,
                "reason": "",
            },
        )(),
    )
    payload = {
        "type": "ADDRESS_ACTIVITY",
        "event": {
            "network": "ARB_SEPOLIA",
            "activity": [
                {
                    "hash": "0xdef",
                    "transactionHash": "0xdef",
                }
            ],
        },
    }
    body = json.dumps(payload).encode("utf-8")
    with _build_client(monkeypatch) as client:
        response = client.post(
            "/internal/webhooks/alchemy/deposits",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Alchemy-Signature": _signature(body),
            },
        )
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "source": "alchemy_address_activity",
        "attempts": 1,
        "txHashes": ["0xdef"],
        "result": {"credited": 0, "failed": 0, "pending": 0},
    }
