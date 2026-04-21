from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace

import pytest

from src.services.owner import forwarding_billing


class _FakeDeadlock(Exception):
    pass


class _FakeStorage:
    def __init__(self) -> None:
        self.charge_calls = 0

    def charge_consumer_and_record_usage_atomic(self, command):
        self.charge_calls += 1
        return {"consumerAvailableBalanceAfter": Decimal("9.000000")}


def _credential(calls_used: int = 0):
    return SimpleNamespace(
        credential=SimpleNamespace(credential_id="cred-1"),
        metadata=SimpleNamespace(calls_used=calls_used),
    )


@pytest.mark.asyncio
async def test_atomic_charge_retries_deadlocked_credential_usage_without_double_charge(
    monkeypatch,
) -> None:
    storage = _FakeStorage()
    rows = [_credential()]
    save_attempts = {"count": 0}

    monkeypatch.setattr(
        forwarding_billing,
        "_assert_not_risk_restricted_for_charge",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(forwarding_billing, "DeadlockDetected", _FakeDeadlock)
    monkeypatch.setattr(
        forwarding_billing.credential_service,
        "load_credential_rows",
        lambda _storage: rows,
    )
    monkeypatch.setattr(
        forwarding_billing.credential_service,
        "clone_runtime_credential",
        lambda row, patch: _credential(patch.calls_used),
    )

    def _save_rows(_storage, new_rows):
        save_attempts["count"] += 1
        if save_attempts["count"] == 1:
            raise _FakeDeadlock("deadlock detected")
        rows[:] = list(new_rows)

    monkeypatch.setattr(
        forwarding_billing.credential_service,
        "save_credential_rows",
        _save_rows,
    )
    monkeypatch.setattr(
        forwarding_billing,
        "_CREDENTIAL_USAGE_DEADLOCK_BACKOFF_SEC",
        0,
    )

    consumer_after, updated = await forwarding_billing.charge_and_mark_usage(
        storage=storage,
        owner_wallet="0xconsumer",
        provider_wallet="0xprovider",
        total_charge=Decimal("1.000000"),
        platform_fee_total=Decimal("0.100000"),
        provider_net=Decimal("0.900000"),
        credential_id="cred-1",
        unit_price=Decimal("1.000000"),
    )

    assert consumer_after == Decimal("9.000000")
    assert updated is not None
    assert updated.metadata.calls_used == 1
    assert save_attempts["count"] == 2
    assert storage.charge_calls == 1


@pytest.mark.asyncio
async def test_rollback_charge_retries_deadlocked_ledger_write(monkeypatch) -> None:
    attempts = {"count": 0}

    monkeypatch.setattr(forwarding_billing, "DeadlockDetected", _FakeDeadlock)
    monkeypatch.setattr(forwarding_billing, "_ROLLBACK_DEADLOCK_BACKOFF_SEC", 0)

    def _rollback_once(**_kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise _FakeDeadlock("deadlock detected")

    monkeypatch.setattr(forwarding_billing, "_rollback_charge_once", _rollback_once)

    await forwarding_billing.rollback_charge(
        storage=_FakeStorage(),
        owner_wallet="0xconsumer",
        provider_wallet="0xprovider",
        total_charge=Decimal("1.000000"),
        platform_fee_total=Decimal("0.100000"),
        provider_net=Decimal("0.900000"),
        updated_credential=None,
    )

    assert attempts["count"] == 2
