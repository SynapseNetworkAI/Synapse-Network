from __future__ import annotations

import asyncio
import time
from copy import deepcopy
from types import SimpleNamespace

import pytest

from src.services.platform.tasks.deposit_indexer import runner
from src.services.platform.tasks.deposit_indexer import shared
from src.services.platform import service_health_probe
from src import storage as storage_module
from src.core import config_loaders
from src.storage import postgres_impl


@pytest.fixture(autouse=True)
def _restore_indexer_status():
    original = deepcopy(shared.INDEXER_STATUS)
    original_web3 = shared._WEB3_INSTANCE
    try:
        yield
    finally:
        shared.INDEXER_STATUS.clear()
        shared.INDEXER_STATUS.update(original)
        shared._WEB3_INSTANCE = original_web3


def _configure_fast_indexer(monkeypatch) -> None:
    monkeypatch.setattr(runner.settings, "v2_indexer_startup_delay_sec", 0.0)
    monkeypatch.setattr(runner.settings, "v2_indexer_step_timeout_sec", 0.03)
    monkeypatch.setattr(runner.settings, "v2_indexer_poll_interval_sec", 0.01)
    monkeypatch.setattr(runner.settings, "router_address", "0x0000000000000000000000000000000000000000")
    monkeypatch.setattr(runner, "_hydrate_runtime_status", lambda _storage: None)
    monkeypatch.setattr(runner, "_persist_indexer_runtime_state", lambda _storage: None)


@pytest.mark.asyncio
async def test_deposit_indexer_blocking_step_does_not_block_event_loop(monkeypatch) -> None:
    _configure_fast_indexer(monkeypatch)

    def _blocked_step(_storage, last_reconciliation_at):
        time.sleep(0.2)
        return {"lastReconciliationAt": last_reconciliation_at}

    monkeypatch.setattr(runner, "run_indexer_blocking_step", _blocked_step)

    stop_event = asyncio.Event()
    task = asyncio.create_task(runner.run_v2_deposit_indexer(stop_event, object()))
    started = time.monotonic()
    await asyncio.sleep(0.01)
    elapsed = time.monotonic() - started

    assert elapsed < 0.1
    await asyncio.sleep(0.05)
    assert shared.INDEXER_STATUS["lastError"] in {
        "INDEXER_STEP_TIMEOUT",
        "INDEXER_STEP_STILL_RUNNING",
    }

    stop_event.set()
    await task


@pytest.mark.asyncio
async def test_deposit_indexer_does_not_queue_second_step_when_previous_is_running(
    monkeypatch,
) -> None:
    _configure_fast_indexer(monkeypatch)
    calls = 0

    def _blocked_step(_storage, last_reconciliation_at):
        nonlocal calls
        calls += 1
        time.sleep(0.15)
        return {"lastReconciliationAt": last_reconciliation_at}

    monkeypatch.setattr(runner, "run_indexer_blocking_step", _blocked_step)

    stop_event = asyncio.Event()
    task = asyncio.create_task(runner.run_v2_deposit_indexer(stop_event, object()))
    await asyncio.sleep(0.09)

    assert calls == 1
    assert shared.INDEXER_STATUS["lastError"] == "INDEXER_STEP_STILL_RUNNING"

    stop_event.set()
    await task


def test_web3_provider_uses_explicit_rpc_timeout(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _FakeProvider:
        def __init__(self, url, request_kwargs=None):
            captured["url"] = url
            captured["request_kwargs"] = dict(request_kwargs or {})

    class _FakeWeb3:
        HTTPProvider = _FakeProvider

        def __init__(self, provider):
            self.provider = provider

    monkeypatch.setattr(shared.settings, "rpc_url", "http://rpc.test")
    monkeypatch.setattr(shared.settings, "rpc_request_timeout_sec", 12.0)
    monkeypatch.setattr(shared, "get_web3_class", lambda: _FakeWeb3)
    shared._WEB3_INSTANCE = None

    shared.get_web3()

    assert captured == {
        "url": "http://rpc.test",
        "request_kwargs": {"timeout": 12.0},
    }


def test_postgres_storage_passes_connect_timeout_to_psycopg(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _connect(dsn, **kwargs):
        captured["dsn"] = dsn
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(postgres_impl, "psycopg", SimpleNamespace(connect=_connect))

    storage = postgres_impl.PostgresStorage(
        "postgresql://gateway.test/synapse",
        ensure_schema=False,
        connect_timeout_sec=7,
    )
    storage._connect()

    assert captured == {
        "dsn": "postgresql://gateway.test/synapse",
        "connect_timeout": 7,
    }


def test_postgres_storage_passes_pool_max_to_database_manager(monkeypatch) -> None:
    captured: list[dict[str, object]] = []

    class _FakeDatabaseManager:
        def __init__(self, connect_factory, *, pool_max=5):
            captured.append(
                {"connect_factory": connect_factory, "pool_max": pool_max}
            )

    monkeypatch.setattr(postgres_impl, "DatabaseManager", _FakeDatabaseManager)

    postgres_impl.PostgresStorage(
        "postgresql://gateway.test/synapse",
        ensure_schema=False,
        pool_max=2,
    )

    assert captured[0]["pool_max"] == 2


@pytest.mark.parametrize("pool_max", [0, 11, "not-an-int"])
def test_postgres_storage_rejects_unsafe_pool_max(monkeypatch, pool_max) -> None:
    class _FakeDatabaseManager:
        def __init__(self, connect_factory, *, pool_max=5):
            raise AssertionError("DatabaseManager should not be reached")

    monkeypatch.setattr(postgres_impl, "DatabaseManager", _FakeDatabaseManager)

    with pytest.raises(RuntimeError, match="DB-CONFIG-001"):
        postgres_impl.PostgresStorage(
            "postgresql://gateway.test/synapse",
            ensure_schema=False,
            pool_max=pool_max,
        )


def test_create_storage_passes_default_and_custom_pool_max(monkeypatch) -> None:
    captured: list[dict[str, object]] = []

    class _FakePostgresStorage:
        def __init__(self, **kwargs):
            captured.append(kwargs)

    monkeypatch.setattr(storage_module, "PostgresStorage", _FakePostgresStorage)

    base_settings = {
        "storage_backend": "postgres",
        "postgres_dsn": "postgresql://gateway.test/synapse",
        "postgres_auto_init": False,
        "postgres_connect_timeout_sec": 7,
    }

    storage_module.create_storage(SimpleNamespace(**base_settings))
    storage_module.create_storage(
        SimpleNamespace(**base_settings, postgres_pool_max=2)
    )

    assert captured[0]["pool_max"] == 5
    assert captured[1]["pool_max"] == 2


@pytest.mark.parametrize("pool_max", [0, 11, "not-an-int"])
def test_create_storage_rejects_unsafe_pool_max(monkeypatch, pool_max) -> None:
    class _FakePostgresStorage:
        def __init__(self, **kwargs):
            raise AssertionError("PostgresStorage should not be reached")

    monkeypatch.setattr(storage_module, "PostgresStorage", _FakePostgresStorage)

    with pytest.raises(RuntimeError, match="DB-CONFIG-001"):
        storage_module.create_storage(
            SimpleNamespace(
                storage_backend="postgres",
                postgres_dsn="postgresql://gateway.test/synapse",
                postgres_auto_init=False,
                postgres_connect_timeout_sec=7,
                postgres_pool_max=pool_max,
            )
        )


def test_postgres_pool_env_strict_range(monkeypatch) -> None:
    monkeypatch.delenv("POSTGRES_POOL_MAX", raising=False)
    assert config_loaders._env_int_strict_range(
        "POSTGRES_POOL_MAX",
        5,
        minimum=1,
        maximum=10,
        fatal_code="DB-CONFIG-001",
        guidance="set POSTGRES_POOL_MAX between 1 and 10; staging default is 5.",
    ) == 5

    monkeypatch.setenv("POSTGRES_POOL_MAX", "10")
    assert config_loaders._env_int_strict_range(
        "POSTGRES_POOL_MAX",
        5,
        minimum=1,
        maximum=10,
        fatal_code="DB-CONFIG-001",
        guidance="set POSTGRES_POOL_MAX between 1 and 10; staging default is 5.",
    ) == 10

    for value in ("0", "11", "not-an-int"):
        monkeypatch.setenv("POSTGRES_POOL_MAX", value)
        with pytest.raises(RuntimeError, match="DB-CONFIG-001"):
            config_loaders._env_int_strict_range(
                "POSTGRES_POOL_MAX",
                5,
                minimum=1,
                maximum=10,
                fatal_code="DB-CONFIG-001",
                guidance="set POSTGRES_POOL_MAX between 1 and 10; staging default is 5.",
            )


@pytest.mark.asyncio
async def test_service_health_monitor_tick_does_not_block_event_loop(monkeypatch) -> None:
    calls = 0

    async def _blocked_refresh(_storage):
        nonlocal calls
        calls += 1
        time.sleep(0.15)
        return {"scheduled": 0, "checked": 0, "updated": 0}

    monkeypatch.setattr(
        service_health_probe.settings,
        "service_health_probe_interval_sec",
        0.01,
    )
    monkeypatch.setattr(
        service_health_probe.settings,
        "service_health_monitor_step_timeout_sec",
        0.03,
    )
    monkeypatch.setattr(
        service_health_probe,
        "refresh_all_service_health",
        _blocked_refresh,
    )

    stop_event = asyncio.Event()
    task = asyncio.create_task(
        service_health_probe.run_service_health_monitor(stop_event, object())
    )
    started = time.monotonic()
    await asyncio.sleep(0.01)
    elapsed = time.monotonic() - started
    await asyncio.sleep(0.08)

    assert elapsed < 0.1
    assert calls == 1

    stop_event.set()
    await task
