# pyright: reportMissingImports=false

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "seller_api"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src.services import forwarding_service  # noqa: E402
from src.services.registry_service import _normalize_service_payload  # noqa: E402
from src.storage.json_impl import _normalize_service_row  # noqa: E402


def test_normalize_payload_prefers_targets_and_normalizes_health_path():
    payload = {
        "serviceName": "Quote Service",
        "invoke": {
            "method": "POST",
            "targets": [
                {"url": "http://10.0.0.1:8100/api/v1/quotes", "weight": 120, "region": "sg-1"},
                {"url": "http://10.0.0.2:8100/api/v1/quotes", "weight": 80, "region": "sg-2"},
            ],
            "timeoutMs": 3000,
            "request": {"contentType": "application/json", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
        "healthCheck": {"path": "ready", "method": "GET"},
        "constraints": {"timeoutMs": 3000},
    }

    normalized = _normalize_service_payload(payload, "0xabc")

    assert normalized["endpoint"] == "http://10.0.0.1:8100/api/v1/quotes"
    assert normalized["invoke"]["url"] == "http://10.0.0.1:8100/api/v1/quotes"
    assert len(normalized["invoke"]["targets"]) == 2
    assert normalized["healthCheck"]["path"] == "/ready"


def test_normalize_payload_backfills_targets_from_single_url():
    payload = {
        "serviceName": "Single Endpoint Service",
        "invoke": {
            "method": "POST",
            "url": "http://127.0.0.1:8100/infer",
            "timeoutMs": 3000,
            "request": {"contentType": "application/json", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
    }

    normalized = _normalize_service_payload(payload, "0xabc")

    assert normalized["invoke"]["targets"] == [
        {"url": "http://127.0.0.1:8100/infer", "weight": 100, "region": None}
    ]


def test_storage_row_normalization_migrates_health_path_and_targets():
    row = {
        "serviceName": "Legacy Service",
        "endpoint": "http://127.0.0.1:8100/api/v1/legacy",
        "health_check": "healthz",
    }

    normalized = _normalize_service_row(row)

    assert normalized["healthCheck"]["path"] == "/healthz"
    assert normalized["invoke"]["url"] == "http://127.0.0.1:8100/api/v1/legacy"
    assert normalized["invoke"]["targets"] == [
        {"url": "http://127.0.0.1:8100/api/v1/legacy", "weight": 100, "region": None}
    ]


class _FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"quote": "ok"}


class _FakeAsyncClient:
    def __init__(self, recorder):
        self._recorder = recorder

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, params=None, headers=None):
        await asyncio.sleep(0)
        self._recorder.append(("GET", url, params, headers))
        return _FakeResponse()

    async def request(self, method, url, json=None, headers=None):
        await asyncio.sleep(0)
        self._recorder.append((method, url, json, headers))
        return _FakeResponse()


@pytest.mark.asyncio
async def test_call_upstream_uses_targets_selection(monkeypatch):
    calls = []

    def _fake_choices(urls, weights=None, k=1):
        assert urls == [
            "http://10.0.0.1:8100/infer",
            "http://10.0.0.2:8100/infer",
        ]
        assert weights == [100, 20]
        return ["http://10.0.0.2:8100/infer"]

    def _fake_client_factory(timeout=15.0):
        assert abs(timeout - 15.0) < 1e-6
        return _FakeAsyncClient(calls)

    monkeypatch.setattr(forwarding_service.random, "choices", _fake_choices)
    monkeypatch.setattr(forwarding_service.httpx, "AsyncClient", _fake_client_factory)

    service = {
        "invoke": {
            "method": "POST",
            "targets": [
                {"url": "http://10.0.0.1:8100/infer", "weight": 100},
                {"url": "http://10.0.0.2:8100/infer", "weight": 20},
            ],
            "url": "http://fallback:8100/infer",
        }
    }

    quote = await forwarding_service._call_upstream(service, "hello", "req-123")

    assert quote == "ok"
    assert calls[0][0] == "POST"
    assert calls[0][1] == "http://10.0.0.2:8100/infer"


@pytest.mark.asyncio
async def test_call_upstream_falls_back_to_invoke_url(monkeypatch):
    calls = []

    def _fake_client_factory(timeout=15.0):
        assert abs(timeout - 15.0) < 1e-6
        return _FakeAsyncClient(calls)

    monkeypatch.setattr(forwarding_service.httpx, "AsyncClient", _fake_client_factory)

    service = {
        "invoke": {
            "method": "GET",
            "url": "http://fallback:8100/infer",
            "targets": [],
        }
    }

    quote = await forwarding_service._call_upstream(service, "hello", "req-456")

    assert quote == "ok"
    assert calls[0][0] == "GET"
    assert calls[0][1] == "http://fallback:8100/infer"
