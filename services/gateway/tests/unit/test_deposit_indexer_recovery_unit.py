from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

from src.domain.finance import BalanceLedger
from src.domain.ledger import DepositIntentRow
from src.services.platform.tasks.deposit_indexer import backfill
from src.services.platform.tasks.deposit_indexer import chain
from src.services.platform.tasks.deposit_indexer import processing
from src.services.platform.tasks.deposit_indexer.backfill import BackfillScanResult
from src.services.platform.tasks.deposit_indexer.chain import (
    DepositIndexerRpcUnavailable,
    _collect_deposit_event_rows,
    _collect_router_candidate_tx_hashes,
    _confirmed_head_block,
    _ensure_rpc_connected,
    _resolve_token_decimals,
    _tx_hash_to_hex,
)
from src.services.platform.tasks.deposit_indexer.processing import (
    _register_recovery_intent_if_atomic,
)


OWNER = "0x1111111111111111111111111111111111111111"
ROUTER = "0x2222222222222222222222222222222222222222"
TOKEN = "0x3333333333333333333333333333333333333333"
TX_HASH = "0x" + "ab" * 32


class _HexBytesLike:
    def __init__(self, value: str, *, raises: bool = False) -> None:
        self.value = value
        self.raises = raises

    def hex(self) -> str:
        if self.raises:
            raise ValueError("boom")
        return self.value


class _FakeEth:
    def __init__(self) -> None:
        self.block_number = 101
        self.blocks: dict[int, object] = {}
        self.tagged_blocks: dict[str, object] = {}
        self.logs: list[object] = []
        self.last_get_logs_filter: dict[str, object] | None = None
        self.contract_decimals = 6
        self.raise_contract = False

    def get_block(
        self, block_number: int | str, *, full_transactions: bool | None = None
    ) -> object:
        if isinstance(block_number, str):
            block = self.tagged_blocks.get(block_number)
            if isinstance(block, Exception):
                raise block
            return block or {"number": self.block_number}
        assert full_transactions is True
        block = self.blocks.get(block_number)
        if isinstance(block, Exception):
            raise block
        return block or {"transactions": []}

    def get_logs(self, filter_params: dict[str, object]) -> list[object]:
        self.last_get_logs_filter = dict(filter_params)
        return list(self.logs)

    def contract(self, *, address: str, abi: object) -> object:
        assert address
        assert abi
        if self.raise_contract:
            raise RuntimeError("contract unavailable")

        decimals = self.contract_decimals

        class _Functions:
            @staticmethod
            def decimals() -> object:
                class _Call:
                    @staticmethod
                    def call() -> int:
                        return decimals

                return _Call()

        return SimpleNamespace(functions=_Functions())


class _FakeWeb3:
    def __init__(self) -> None:
        self.eth = _FakeEth()
        self.connected = True
        self.legacy_connected = True

    def is_connected(self) -> bool:
        return self.connected

    def isConnected(self) -> bool:  # noqa: N802 - web3.py legacy API name.
        return self.legacy_connected

    @staticmethod
    def to_checksum_address(value: str) -> str:
        return value


class _RegisteringStorage:
    def __init__(self, registered: object) -> None:
        self.registered = registered
        self.commands: list[object] = []

    def register_deposit_intent_atomic(self, command: object) -> object:
        self.commands.append(command)
        return self.registered


def _settings(**overrides: object) -> SimpleNamespace:
    defaults: dict[str, object] = {
        "v2_backfill_enabled": True,
        "v2_backfill_start_block": 0,
        "v2_backfill_block_batch": 10,
        "v2_deposit_confirmations": 1,
        "deposit_event_max_log_block_range": 2000,
        "deposit_event_finality_mode": "confirmations",
        "deposit_event_finality_buffer_blocks": 0,
        "router_address": ROUTER,
        "usdc_token_address": TOKEN,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_backfill_range_uses_configured_start_when_persisted_cursor_is_past_head(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(backfill, "settings", _settings(v2_backfill_start_block=7))

    scan_range = backfill._resolve_backfill_scan_range(
        {"lastScannedBlock": 999}, confirmed_head=20
    )

    assert scan_range == {"startBlock": 7, "endBlock": 16, "lastScannedBlock": 999}


def test_run_backfill_scan_once_returns_typed_disabled_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(backfill, "settings", _settings(v2_backfill_enabled=False))

    result = backfill.run_backfill_scan_once(object())

    assert result == BackfillScanResult(enabled=False)


def test_run_backfill_scan_once_persists_success_and_returns_typed_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved: dict[str, object] = {}
    persisted: list[bool] = []
    monkeypatch.setattr(backfill, "settings", _settings())
    monkeypatch.setattr(backfill, "_now", lambda: 1711111111)
    monkeypatch.setattr(backfill, "_load_backfill_state", lambda _storage: {})
    monkeypatch.setattr(backfill, "_confirmed_head_block", lambda: 5)
    monkeypatch.setattr(
        backfill,
        "_process_backfill_range",
        lambda _storage, _start, _end, _now, mode="event": {
            "itemCount": 2,
            "recovered": 1,
        },
    )
    monkeypatch.setattr(
        backfill,
        "_save_backfill_state",
        lambda _storage, payload: saved.update(payload),
    )
    monkeypatch.setattr(
        backfill,
        "_persist_indexer_runtime_state",
        lambda _storage: persisted.append(True),
    )

    result = backfill.run_backfill_scan_once(object())

    assert result == BackfillScanResult(
        enabled=True, scanned=5, recovered=1, last_scanned_block=5
    )
    assert saved == {"lastScannedBlock": 5, "lastScanAt": 1711111111}
    assert persisted == [True]


def test_process_backfill_event_registers_recovery_intent_before_confirming(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registered_intent = {
        "id": "dep_recovery",
        "ownerAddress": OWNER,
        "consumerAddress": OWNER,
        "txHash": TX_HASH,
        "amountUsdc": "1.000000",
        "creditedAmountUsdc": "0.000000",
        "idempotencyKey": "deposit_backfill_key",
        "status": "PENDING_CONFIRMATION",
    }
    storage = _RegisteringStorage(registered_intent)
    monkeypatch.setattr(backfill, "_resolve_token_decimals", lambda _token: 6)

    seen_intents: list[dict[str, object]] = []

    def _fake_process_single_intent(
        _storage: object,
        intent: dict[str, object],
        _processed_keys: set[str],
        _ledger: BalanceLedger,
        _now: int,
    ) -> dict[str, object]:
        seen_intents.append(dict(intent))
        return {
            "result": "credited",
            "changedIntent": False,
            "changedLedger": True,
            "changedProcessed": True,
        }

    monkeypatch.setattr(backfill, "_process_single_intent", _fake_process_single_intent)

    outcome = backfill._process_backfill_event(
        storage,
        intents=[],
        processed_keys=set(),
        ledger=BalanceLedger(),
        tx_hash=TX_HASH,
        event={
            "eventKey": "event-1",
            "ownerAddress": OWNER,
            "token": TOKEN,
            "amountRaw": 1_000_000,
        },
        now=1711111111,
    )

    assert outcome["result"] == "credited"
    assert outcome["changedIntent"] is True
    assert storage.commands
    assert seen_intents[0]["id"] == "dep_recovery"


def test_process_backfill_tx_counts_only_credited_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        backfill,
        "_get_confirmed_receipt_or_none",
        lambda _tx_hash: {"receipt": {"transactionHash": TX_HASH}},
    )
    monkeypatch.setattr(
        backfill,
        "_decode_deposit_events_from_receipt",
        lambda _receipt: [{"eventKey": "one"}, {"eventKey": "two"}],
    )
    outcomes = iter(
        [
            {"result": "credited", "changedIntent": True},
            {"result": "pending"},
        ]
    )
    monkeypatch.setattr(
        backfill,
        "_process_backfill_event",
        lambda *_args, **_kwargs: next(outcomes),
    )

    result = backfill._process_backfill_tx(
        object(),
        intents=[],
        processed_keys=set(),
        ledger=BalanceLedger(),
        tx_hash=TX_HASH,
        now=1711111111,
    )

    assert result == {
        "changedIntents": True,
        "changedLedger": False,
        "changedProcessed": False,
        "recovered": 1,
    }


def test_process_backfill_tx_skips_unconfirmed_failed_or_missing_receipts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for tx_state in (None, {"failed": True}, {"receipt": None}):
        monkeypatch.setattr(
            backfill, "_get_confirmed_receipt_or_none", lambda _tx_hash, state=tx_state: state
        )

        result = backfill._process_backfill_tx(
            object(),
            intents=[],
            processed_keys=set(),
            ledger=BalanceLedger(),
            tx_hash=TX_HASH,
            now=1711111111,
        )

        assert result["recovered"] == 0


def test_process_backfill_range_persists_once_after_all_candidates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted: list[dict[str, object]] = []
    monkeypatch.setattr(backfill, "_load_deposit_intents", lambda _storage: [])
    monkeypatch.setattr(backfill, "_load_processed_deposit_event_keys", lambda _storage: [])
    monkeypatch.setattr(backfill, "_load_balance_ledger", lambda _storage: BalanceLedger())
    monkeypatch.setattr(
        backfill,
        "_collect_deposit_event_rows",
        lambda _s, _e: [
            {"eventKey": f"{TX_HASH}:1", "ownerAddress": OWNER, "token": TOKEN, "amountRaw": 1_000_000},
            {"eventKey": f"{TX_HASH}:2", "ownerAddress": OWNER, "token": TOKEN, "amountRaw": 2_000_000},
        ],
    )
    monkeypatch.setattr(
        backfill,
        "_process_backfill_event",
        lambda *_args, **_kwargs: {
            "result": "credited",
            "changedIntent": True,
            "changedLedger": False,
            "changedProcessed": True,
        },
    )
    monkeypatch.setattr(
        backfill,
        "_persist_processing_changes",
        lambda _storage, **kwargs: persisted.append(kwargs),
    )

    result = backfill._process_backfill_range(object(), 1, 2, 1711111111)

    assert result == {"itemCount": 2, "recovered": 2}
    assert len(persisted) == 1
    assert persisted[0]["changed_intents"] is True
    assert persisted[0]["changed_processed"] is True


def test_process_backfill_range_repair_mode_uses_receipt_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted: list[dict[str, object]] = []
    monkeypatch.setattr(backfill, "_load_deposit_intents", lambda _storage: [])
    monkeypatch.setattr(backfill, "_load_processed_deposit_event_keys", lambda _storage: [])
    monkeypatch.setattr(backfill, "_load_balance_ledger", lambda _storage: BalanceLedger())
    monkeypatch.setattr(backfill, "_collect_router_candidate_tx_hashes", lambda _s, _e: ["a", "b"])
    monkeypatch.setattr(
        backfill,
        "_process_backfill_tx",
        lambda *_args, **_kwargs: {
            "changedIntents": True,
            "changedLedger": False,
            "changedProcessed": True,
            "recovered": 1,
        },
    )
    monkeypatch.setattr(
        backfill,
        "_persist_processing_changes",
        lambda _storage, **kwargs: persisted.append(kwargs),
    )

    result = backfill._process_backfill_range(
        object(), 1, 2, 1711111111, mode="repair"
    )

    assert result == {"itemCount": 2, "recovered": 2}
    assert len(persisted) == 1


def test_run_backfill_scan_once_chunks_large_ranges_and_persists_per_chunk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    saved: list[dict[str, object]] = []
    processed_ranges: list[tuple[int, int, str]] = []
    monkeypatch.setattr(
        backfill,
        "settings",
        _settings(v2_backfill_block_batch=5000, deposit_event_max_log_block_range=2000),
    )
    monkeypatch.setattr(backfill, "_now", lambda: 1711111111)
    monkeypatch.setattr(backfill, "_load_backfill_state", lambda _storage: {})
    monkeypatch.setattr(backfill, "_confirmed_head_block", lambda: 5000)
    monkeypatch.setattr(
        backfill,
        "_process_backfill_range",
        lambda _storage, _start, _end, _now, mode="event": (
            processed_ranges.append((_start, _end, mode)) or {"itemCount": 0, "recovered": 1}
        ),
    )
    monkeypatch.setattr(
        backfill,
        "_save_backfill_state",
        lambda _storage, payload: saved.append(dict(payload)),
    )
    monkeypatch.setattr(
        backfill,
        "_persist_indexer_runtime_state",
        lambda _storage: None,
    )

    result = backfill.run_backfill_scan_once(object())

    assert processed_ranges == [
        (1, 2000, "event"),
        (2001, 4000, "event"),
        (4001, 5000, "event"),
    ]
    assert [payload["lastScannedBlock"] for payload in saved] == [2000, 4000, 5000]
    assert result == BackfillScanResult(
        enabled=True, scanned=5000, recovered=3, last_scanned_block=5000
    )


def test_tx_hash_to_hex_normalizes_hexbytes_without_prefix() -> None:
    assert _tx_hash_to_hex(_HexBytesLike("AB" * 32)) == TX_HASH
    assert _tx_hash_to_hex(_HexBytesLike(TX_HASH.upper())) == TX_HASH
    assert _tx_hash_to_hex(_HexBytesLike(TX_HASH, raises=True)) == ""


def test_confirmed_head_block_checks_modern_and_legacy_connectivity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_web3 = _FakeWeb3()
    monkeypatch.setattr(
        chain,
        "settings",
        _settings(
            v2_deposit_confirmations=2,
            deposit_event_finality_mode="confirmations",
            deposit_event_finality_buffer_blocks=1,
        ),
    )
    monkeypatch.setattr(chain, "get_web3", lambda: fake_web3)

    assert _confirmed_head_block() == 100

    fake_web3.connected = False
    with pytest.raises(DepositIndexerRpcUnavailable):
        _confirmed_head_block()

    fake_web3.connected = True
    fake_web3.legacy_connected = False
    with pytest.raises(DepositIndexerRpcUnavailable):
        _ensure_rpc_connected(fake_web3)


def test_confirmed_head_block_prefers_safe_then_falls_back_to_buffer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_web3 = _FakeWeb3()
    fake_web3.eth.tagged_blocks["safe"] = {"number": 77}
    monkeypatch.setattr(
        chain,
        "settings",
        _settings(
            deposit_event_finality_mode="safe",
            deposit_event_finality_buffer_blocks=3,
        ),
    )
    monkeypatch.setattr(chain, "get_web3", lambda: fake_web3)

    assert _confirmed_head_block() == 77

    fake_web3.eth.tagged_blocks["safe"] = RuntimeError("safe unavailable")
    assert _confirmed_head_block() == 98


def test_resolve_token_decimals_clamps_and_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_web3 = _FakeWeb3()
    monkeypatch.setattr(chain, "get_web3", lambda: fake_web3)
    chain.TOKEN_DECIMALS_CACHE.clear()

    assert _resolve_token_decimals(TOKEN) == 6

    chain.TOKEN_DECIMALS_CACHE.clear()
    fake_web3.eth.contract_decimals = 99
    assert _resolve_token_decimals(TOKEN) == 6

    chain.TOKEN_DECIMALS_CACHE.clear()
    fake_web3.eth.raise_contract = True
    assert _resolve_token_decimals(TOKEN) == 6


def test_collect_router_candidate_tx_hashes_dedupes_and_skips_bad_blocks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_web3 = _FakeWeb3()
    fake_web3.eth.blocks = {
        1: {
            "transactions": [
                {"to": ROUTER, "hash": _HexBytesLike("ab" * 32)},
                {"to": ROUTER, "hash": TX_HASH},
                {"to": OWNER, "hash": "0x" + "cd" * 32},
            ]
        },
        2: RuntimeError("block unavailable"),
    }
    monkeypatch.setattr(chain, "settings", _settings(router_address=ROUTER))
    monkeypatch.setattr(chain, "get_web3", lambda: fake_web3)

    assert _collect_router_candidate_tx_hashes(1, 2) == [TX_HASH]


def test_collect_deposit_event_rows_decodes_canonical_logs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_web3 = _FakeWeb3()
    fake_web3.eth.logs = [
        {
            "topics": [
                chain._get_deposit_info_topic(),
                "0x" + "0" * 24 + OWNER.removeprefix("0x"),
            ],
            "data": hex(1_500_000),
            "transactionHash": _HexBytesLike("ab" * 32),
            "logIndex": 7,
        }
    ]
    monkeypatch.setattr(chain, "settings", _settings())
    monkeypatch.setattr(chain, "get_web3", lambda: fake_web3)

    events = _collect_deposit_event_rows(10, 20)

    assert events == [
        {
            "eventKey": f"{TX_HASH}:7",
            "ownerAddress": OWNER,
            "amountRaw": 1_500_000,
            "token": TOKEN,
            "logIndex": 7,
        }
    ]
    assert fake_web3.eth.last_get_logs_filter == {
        "address": ROUTER,
        "fromBlock": 10,
        "toBlock": 20,
        "topics": [chain._get_deposit_info_topic()],
    }


def test_register_recovery_intent_atomic_accepts_dict_and_model_results() -> None:
    intent = processing._build_recovery_intent(
        TX_HASH, OWNER, Decimal("1.000000"), "event:1", 1711111111
    )
    dict_storage = _RegisteringStorage({**intent, "status": "REGISTERED"})

    registered = _register_recovery_intent_if_atomic(dict_storage, intent, OWNER, TX_HASH)

    assert registered["status"] == "REGISTERED"
    assert dict_storage.commands[0].owner_wallet == OWNER

    row = DepositIntentRow.model_validate({**intent, "status": "PENDING_CONFIRMATION"})
    model_storage = _RegisteringStorage(row)

    registered_model = _register_recovery_intent_if_atomic(
        model_storage, intent, OWNER, TX_HASH
    )

    assert registered_model["id"] == intent["id"]


def test_register_recovery_intent_atomic_fails_closed_on_unknown_result() -> None:
    intent = processing._build_recovery_intent(
        TX_HASH, OWNER, Decimal("1.000000"), "event:1", 1711111111
    )

    with pytest.raises(RuntimeError, match="DEPOSIT_BACKFILL_REGISTER_RESULT_INVALID"):
        _register_recovery_intent_if_atomic(
            _RegisteringStorage(object()), intent, OWNER, TX_HASH
        )
