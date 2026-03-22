from __future__ import annotations

from copy import deepcopy

from src.services.platform.tasks.deposit_indexer.persistence import _persist_indexer_runtime_state
from src.services.platform.tasks.deposit_indexer.shared import INDEXER_STATUS, _set_status


class _FakeGatewayStateRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def write_runtime_state(self, state_key: str, payload: dict[str, object]) -> None:
        self.calls.append((state_key, payload))


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