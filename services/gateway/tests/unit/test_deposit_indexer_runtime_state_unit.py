from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

from src.services.platform.tasks.deposit_indexer.chain import DepositIndexerRpcUnavailable
from src.services.platform.tasks.deposit_indexer.runner import _run_backfill_if_enabled
from src.services.platform.tasks.deposit_indexer.runner import _hydrate_runtime_status
from src.services.platform.tasks.deposit_indexer.persistence import _persist_indexer_runtime_state
from src.services.platform.tasks.deposit_indexer.shared import (
    INDEXER_STATUS,
    _BACKFILL_RPC_UNAVAILABLE_CODE,
    _set_status,
)


class _FakeGatewayStateRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.runtime_state: dict[str, dict[str, object]] = {}

    def write_runtime_state(self, state_key: str, payload: dict[str, object]) -> None:
        self.calls.append((state_key, payload))
        self.runtime_state[state_key] = dict(payload)

    def read_runtime_state(self, state_key: str) -> dict[str, object]:
        return dict(self.runtime_state.get(state_key) or {})


class _FakeDataManager:
    def __init__(self, gateway_state_repo: _FakeGatewayStateRepository) -> None:
        self.system = type("_System", (), {"gateway_state": gateway_state_repo})()


class _FakeStorage:
    def __init__(self, gateway_state_repo: _FakeGatewayStateRepository) -> None:
        self._data_manager = _FakeDataManager(gateway_state_repo)

    def get_data_manager(self) -> _FakeDataManager:
        return self._data_manager


def test_persist_indexer_runtime_state_writes_unified_task_snapshot() -> None:
    original_status = deepcopy(INDEXER_STATUS)
    gateway_state_repo = _FakeGatewayStateRepository()
    storage = _FakeStorage(gateway_state_repo)

    try:
        _set_status(
            running=True,
            lastProcessedAt=1711111111,
            heartbeatAt=1711111122,
            lastError=None,
            backfill={
                "enabled": True,
                "lastScannedBlock": 19450321,
                "lastScanAt": 1711111100,
                "lastRecovered": 2,
                "lastError": None,
            },
            reconciliation={
                "enabled": True,
                "lastCheckAt": 1711111090,
                "chainVaultUsdc": 10.5,
                "ledgerObligationUsdc": 10.0,
                "deltaUsdc": 0.5,
                "alert": True,
                "lastError": "INDEXER_RECONCILIATION_FAILED",
            },
        )

        _persist_indexer_runtime_state(storage)

        assert gateway_state_repo.calls
        state_key, payload = gateway_state_repo.calls[-1]
        assert state_key == "deposit_indexer_runtime_state"
        assert payload["running"] is True
        assert payload["lastProcessedAt"] == 1711111111
        assert payload["heartbeatAt"] == 1711111122
        assert payload["backfill"]["lastScannedBlock"] == 19450321
        assert payload["backfill"]["lastRecovered"] == 2
        assert payload["reconciliation"]["lastCheckAt"] == 1711111090
        assert payload["reconciliation"]["alert"] is True
        assert payload["reconciliation"]["lastError"] == "INDEXER_RECONCILIATION_FAILED"
    finally:
        INDEXER_STATUS.clear()
        INDEXER_STATUS.update(original_status)


def test_run_backfill_if_enabled_marks_rpc_unavailable_without_raising(monkeypatch) -> None:
    original_status = deepcopy(INDEXER_STATUS)
    gateway_state_repo = _FakeGatewayStateRepository()
    storage = _FakeStorage(gateway_state_repo)

    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.runner.run_backfill_scan_once",
        lambda _storage, mode="event": (_ for _ in ()).throw(
            DepositIndexerRpcUnavailable("RPC_UNAVAILABLE")
        ),
    )
    monkeypatch.setattr(
        "src.services.platform.tasks.deposit_indexer.runner.settings",
        SimpleNamespace(v2_backfill_enabled=True, rpc_url="http://127.0.0.1:8545"),
    )

    try:
        _set_status(
            backfill={
                "enabled": True,
                "lastScannedBlock": 19450321,
                "lastScanAt": 1711111100,
                "lastRecovered": 2,
                "lastError": None,
            }
        )

        _run_backfill_if_enabled(storage)

        assert gateway_state_repo.calls
        _, payload = gateway_state_repo.calls[-1]
        assert payload["backfill"]["lastScannedBlock"] == 19450321
        assert payload["backfill"]["lastRecovered"] == 2
        assert payload["backfill"]["lastError"] == _BACKFILL_RPC_UNAVAILABLE_CODE
    finally:
        INDEXER_STATUS.clear()
        INDEXER_STATUS.update(original_status)


def test_hydrate_runtime_status_accepts_legacy_json_number_money() -> None:
    original_status = deepcopy(INDEXER_STATUS)
    gateway_state_repo = _FakeGatewayStateRepository()
    gateway_state_repo.runtime_state["deposit_reconciliation_state"] = {
        "lastCheckAt": 1711111090,
        "chainVaultUsdc": 10.5,
        "ledgerObligationUsdc": 10.0,
        "deltaUsdc": 0.5,
        "alert": True,
    }
    storage = _FakeStorage(gateway_state_repo)

    try:
        _hydrate_runtime_status(storage)

        reconciliation = INDEXER_STATUS["reconciliation"]
        assert reconciliation["chainVaultUsdc"] == "10.500000"
        assert reconciliation["ledgerObligationUsdc"] == "10.000000"
        assert reconciliation["deltaUsdc"] == "0.500000"
    finally:
        INDEXER_STATUS.clear()
        INDEXER_STATUS.update(original_status)
