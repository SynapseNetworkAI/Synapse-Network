# pyright: reportMissingImports=false

from math import isclose

from src.domain.finance import BalanceLedger, DepositIntentRow, PlatformFees
from src.services.platform import v2_indexer


class _FakeBalanceRepo:
    def __init__(self, ledger: BalanceLedger):
        self._ledger = ledger

    def read_balance_ledger(self) -> BalanceLedger:
        return self._ledger


class _FakeGatewayStateRepo:
    def __init__(self, runtime_states=None):
        self._runtime_states = dict(runtime_states or {})

    def read_deposit_intents(self):
        return []

    def read_processed_deposit_event_keys(self):
        return []

    def write_processed_deposit_event_keys(self, keys, updated_at):
        return None

    def read_runtime_state(self, key):
        return self._runtime_states.get(key)


class _FakeAuditRepo:
    def append_audit_row(self, entry):
        return None


class _FakeDataManager:
    def __init__(self, ledger: BalanceLedger, runtime_states=None):
        self.finance = type("FinanceDomain", (), {"balance": _FakeBalanceRepo(ledger)})()
        self.system = type(
            "SystemDomain",
            (),
            {"gateway_state": _FakeGatewayStateRepo(runtime_states)},
        )()
        self.audit = type("AuditDomain", (), {"logs": _FakeAuditRepo()})()


class _FakeStorage:
    def __init__(
        self,
        ledger: BalanceLedger,
        confirmed_row: DepositIntentRow,
        runtime_states=None,
    ):
        self._data_manager = _FakeDataManager(ledger, runtime_states)
        self._confirmed_row = confirmed_row
        self.confirm_calls = 0

    def get_data_manager(self):
        return self._data_manager

    def confirm_deposit_intent_atomic(
        self, owner_wallet: str, deposit_intent_id: str, event_key: str, confirmations: int
    ) -> DepositIntentRow:
        self.confirm_calls += 1
        return self._confirmed_row


def test_atomic_confirm_does_not_mark_stale_ledger_for_save() -> None:
    owner = "0xd856907d7e35a8f9bd225859a59e58577147a092"
    storage = _FakeStorage(
        BalanceLedger(
            buyers={owner: 10.0},
            buyersLocked={owner: 0.0},
            buyersFrozen={owner: 0.0},
            sellers={},
            sellersLocked={},
            sellersFrozen={},
            platform=PlatformFees(feeAccrued=0.0),
            updatedAt="2026-03-16 00:03:29",
        ),
        DepositIntentRow(
            id="dep-1",
            ownerAddress=owner,
            buyerAddress=owner,
            txHash="0xf20f0e69bae4b64e8898654e0193b6b4ec0234352b475366af8c79a2caa0becc",
            amountUsdc="10.000000",
            status="CONFIRMED",
            createdAt="2026-03-16 00:03:28",
            updatedAt="2026-03-16 00:03:29",
        ),
    )
    intent = {
        "id": "dep-1",
        "ownerAddress": owner,
        "buyerAddress": owner,
        "txHash": "0xf20f0e69bae4b64e8898654e0193b6b4ec0234352b475366af8c79a2caa0becc",
        "amountUsdc": 10.0,
        "status": "PENDING_CONFIRMATION",
    }
    buyers_snapshot = {owner: 0.0}

    result = v2_indexer._apply_confirmed_balance_to_ledger(
        storage=storage,
        intent=intent,
        owner_wallet=owner,
        event_key="0xf20f0e69bae4b64e8898654e0193b6b4ec0234352b475366af8c79a2caa0becc:0",
        confirmations=1,
        buyers=buyers_snapshot,
        amount_usdc=10.0,
        now=1742054609,
    )

    assert result["result"] == "ok"
    assert result["changedLedger"] is False
    assert isclose(float(result["next_balance"]), 10.0)
    assert isclose(float(buyers_snapshot[owner]), 0.0)
    assert storage.confirm_calls == 1


def test_confirmed_intent_still_runs_atomic_repair_path() -> None:
    owner = "0xd856907d7e35a8f9bd225859a59e58577147a092"
    storage = _FakeStorage(
        BalanceLedger(
            buyers={owner: 10.0},
            buyersLocked={owner: 0.0},
            buyersFrozen={owner: 0.0},
            sellers={},
            sellersLocked={},
            sellersFrozen={},
            platform=PlatformFees(feeAccrued=0.0),
            updatedAt="2026-03-16 00:03:29",
        ),
        DepositIntentRow(
            id="dep-1",
            ownerAddress=owner,
            buyerAddress=owner,
            txHash="0xf20f0e69bae4b64e8898654e0193b6b4ec0234352b475366af8c79a2caa0becc",
            amountUsdc="10.000000",
            status="CONFIRMED",
            createdAt="2026-03-16 00:03:28",
            updatedAt="2026-03-16 00:03:29",
        ),
    )
    intent = {
        "id": "dep-1",
        "ownerAddress": owner,
        "buyerAddress": owner,
        "txHash": "0xf20f0e69bae4b64e8898654e0193b6b4ec0234352b475366af8c79a2caa0becc",
        "amountUsdc": 10.0,
        "status": "CONFIRMED",
    }

    result = v2_indexer._process_single_intent(
        storage=storage,
        intent=intent,
        processed_keys=set(),
        buyers={owner: 0.0},
        now=1742054609,
    )

    assert result == {"result": "skip"}
    assert intent["status"] == "CONFIRMED"
    assert storage.confirm_calls == 1


def test_resolve_backfill_scan_range_prefers_persisted_cursor() -> None:
    original_start = v2_indexer.settings.v2_backfill_start_block
    original_batch = v2_indexer.settings.v2_backfill_block_batch
    try:
        v2_indexer.settings.v2_backfill_start_block = 123
        v2_indexer.settings.v2_backfill_block_batch = 50

        scan_range = v2_indexer._resolve_backfill_scan_range(
            {"lastScannedBlock": 300}, confirmed_head=500
        )

        assert scan_range == {
            "startBlock": 301,
            "endBlock": 350,
            "lastScannedBlock": 300,
        }
    finally:
        v2_indexer.settings.v2_backfill_start_block = original_start
        v2_indexer.settings.v2_backfill_block_batch = original_batch


def test_resolve_backfill_scan_range_uses_configured_start_for_first_run() -> None:
    original_start = v2_indexer.settings.v2_backfill_start_block
    original_batch = v2_indexer.settings.v2_backfill_block_batch
    try:
        v2_indexer.settings.v2_backfill_start_block = 120
        v2_indexer.settings.v2_backfill_block_batch = 20

        scan_range = v2_indexer._resolve_backfill_scan_range({}, confirmed_head=500)

        assert scan_range == {
            "startBlock": 120,
            "endBlock": 139,
            "lastScannedBlock": 0,
        }
    finally:
        v2_indexer.settings.v2_backfill_start_block = original_start
        v2_indexer.settings.v2_backfill_block_batch = original_batch


def test_resolve_backfill_scan_range_falls_back_to_recent_confirmed_window() -> None:
    original_start = v2_indexer.settings.v2_backfill_start_block
    original_batch = v2_indexer.settings.v2_backfill_block_batch
    try:
        v2_indexer.settings.v2_backfill_start_block = 0
        v2_indexer.settings.v2_backfill_block_batch = 20

        scan_range = v2_indexer._resolve_backfill_scan_range({}, confirmed_head=500)

        assert scan_range == {
            "startBlock": 481,
            "endBlock": 500,
            "lastScannedBlock": 0,
        }
    finally:
        v2_indexer.settings.v2_backfill_start_block = original_start
        v2_indexer.settings.v2_backfill_block_batch = original_batch


def test_hydrate_runtime_status_reads_persisted_scan_checkpoint() -> None:
    owner = "0xd856907d7e35a8f9bd225859a59e58577147a092"
    storage = _FakeStorage(
        BalanceLedger(
            buyers={owner: 0.0},
            buyersLocked={owner: 0.0},
            buyersFrozen={owner: 0.0},
            sellers={},
            sellersLocked={},
            sellersFrozen={},
            platform=PlatformFees(feeAccrued=0.0),
            updatedAt="2026-03-16 00:03:29",
        ),
        DepositIntentRow(
            id="dep-1",
            ownerAddress=owner,
            buyerAddress=owner,
            txHash="0xf20f0e69bae4b64e8898654e0193b6b4ec0234352b475366af8c79a2caa0becc",
            amountUsdc="10.000000",
            status="CONFIRMED",
            createdAt="2026-03-16 00:03:28",
            updatedAt="2026-03-16 00:03:29",
        ),
        runtime_states={
            "deposit_backfill_state": {
                "lastScannedBlock": 456,
                "lastScanAt": 1742054609,
            },
            "deposit_reconciliation_state": {
                "lastCheckAt": 1742054610,
                "chainVaultUsdc": 100.0,
                "ledgerObligationUsdc": 99.0,
                "deltaUsdc": 1.0,
                "alert": True,
            },
        },
    )

    v2_indexer._hydrate_runtime_status(storage)
    status = v2_indexer.get_indexer_status()

    assert status["backfill"]["lastScannedBlock"] == 456
    assert status["backfill"]["lastScanAt"] == 1742054609
    assert status["reconciliation"]["lastCheckAt"] == 1742054610
    assert isclose(float(status["reconciliation"]["deltaUsdc"]), 1.0)
    assert status["reconciliation"]["alert"] is True