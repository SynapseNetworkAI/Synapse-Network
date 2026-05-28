from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

from src.api.routers import balance_deposit


class _GatewayState:
    def __init__(self, rows):
        self._rows = list(rows)

    def read_consumer_refund_rows(self, *, owner_wallet: str | None = None):
        _ = owner_wallet
        return list(self._rows)


class _Storage:
    def __init__(self, rows):
        self._gateway_state = _GatewayState(rows)

    def get_data_manager(self):
        return SimpleNamespace(
            system=SimpleNamespace(gateway_state=self._gateway_state)
        )


def _row(*, refund_id: str, refund_type: str, amount_usdc: str = "10.000000"):
    return SimpleNamespace(
        id=refund_id,
        refund_type=refund_type,
        amount_usdc=amount_usdc,
    )


def test_emit_consumer_withdraw_client_complete_log(monkeypatch):
    captured: list[dict[str, object]] = []
    monkeypatch.setattr(
        balance_deposit,
        "log_consumer_withdraw_completed",
        lambda **kwargs: captured.append(kwargs),
    )

    storage = _Storage([
        _row(refund_id="wd_123", refund_type="CONSUMER_BALANCE_WITHDRAW"),
    ])

    balance_deposit._emit_consumer_withdraw_client_complete_log(
        storage,
        owner_wallet="0xabc",
        refund_id="wd_123",
        tx_hash="0x" + "2" * 64,
    )

    assert captured == [
        {
            "withdrawal_id": "wd_123",
            "owner": "0xabc",
            "amount_usdc": Decimal("10.000000"),
            "fee_usdc": Decimal("0.500000"),
            "net_usdc": Decimal("9.500000"),
            "tx_hash": "0x" + "2" * 64,
            "completion_source": "client_complete",
        }
    ]


def test_emit_consumer_withdraw_client_complete_log_skips_non_consumer_rows(monkeypatch):
    captured: list[dict[str, object]] = []
    monkeypatch.setattr(
        balance_deposit,
        "log_consumer_withdraw_completed",
        lambda **kwargs: captured.append(kwargs),
    )

    storage = _Storage([
        _row(refund_id="wd_123", refund_type="REFUND"),
    ])

    balance_deposit._emit_consumer_withdraw_client_complete_log(
        storage,
        owner_wallet="0xabc",
        refund_id="wd_123",
        tx_hash="0x" + "2" * 64,
    )

    assert captured == []
