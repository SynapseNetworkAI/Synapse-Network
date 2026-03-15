# pyright: reportMissingImports=false

import asyncio
import os
import time

import pytest

from src.services.buyer import forwarding_service


class _FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {"quote": "ok"}


class _FakeAsyncClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, params=None, headers=None):
        await asyncio.sleep(0)
        return _FakeResponse()

    async def request(self, method, url, json=None, headers=None):
        _ = method
        await asyncio.sleep(0.000001)
        return _FakeResponse()


@pytest.mark.performance
@pytest.mark.asyncio
async def test_call_upstream_pressure_smoke(monkeypatch):
    if os.getenv("RUN_PERF_TESTS", "0") != "1":
        pytest.skip("Set RUN_PERF_TESTS=1 to run performance tests")

    monkeypatch.setattr(forwarding_service.httpx, "AsyncClient", lambda timeout=15.0: _FakeAsyncClient())

    service = {
        "invoke": {
            "method": "POST",
            "targets": [
                {"url": "http://10.0.0.1:8100/infer", "weight": 100},
                {"url": "http://10.0.0.2:8100/infer", "weight": 50},
            ],
        }
    }

    calls = 1000
    started = time.perf_counter()
    results = await asyncio.gather(
        *[
            forwarding_service._call_upstream(service, f"prompt-{idx}", f"req-{idx}")
            for idx in range(calls)
        ]
    )
    elapsed = time.perf_counter() - started

    assert len(results) == calls
    assert all(item == "ok" for item in results)

    # Smoke threshold for local mocked run; catches severe regressions.
    assert elapsed < 3.0
