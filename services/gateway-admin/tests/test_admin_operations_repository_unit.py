from datetime import datetime, timezone
from decimal import Decimal
import json

from src.storage.analytics import admin_operations_repository as repo_mod
from src.storage.analytics.admin_operations_repository import PostgresAdminOperationsRepository
from src.storage.analytics.admin_operations_row_mapping import (
    deposit_filters,
    deposit_record,
    owner_filters,
    owner_record,
    withdrawal_filters,
    withdrawal_record,
)


class FakeCursor:
    def __init__(self, results):
        self._results = list(results)
        self._current = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        _ = query, params
        self._current = self._results.pop(0)

    def fetchone(self):
        if isinstance(self._current, dict):
            return self._current
        return self._current[0] if self._current else None

    def fetchall(self):
        return list(self._current)


class FakeConnection:
    def __init__(self, results):
        self._results = results

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return FakeCursor(self._results)


NOW = datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc)


def _owner_row(**overrides):
    row = {
        "owner_id": "own_demo",
        "owner_wallet": "0xabc",
        "display_name": "Demo owner",
        "email": "owner@example.com",
        "email_verified": True,
        "pending_email": "new@example.com",
        "status": "active",
        "created_at": NOW,
        "updated_at": NOW,
        "is_provider": True,
        "agent_count": 2,
        "service_count": 3,
        "support_case_count": 1,
        "last_active_at": NOW,
    }
    return {**row, **overrides}


def _deposit_row(**overrides):
    row = {
        "deposit_id": "dep_demo",
        "owner_id": "own_demo",
        "owner_wallet": "0xabc",
        "owner_address": "0xabc",
        "owner_email": "owner@example.com",
        "tx_hash": "0xdeposit",
        "amount_usdc": Decimal("25.000000"),
        "status": "CONFIRMED",
        "created_at": NOW,
        "updated_at": NOW,
        "meta_payload": json.dumps({"network": "Arbitrum Sepolia", "confirmations": 12}),
    }
    return {**row, **overrides}


def _withdrawal_row(**overrides):
    row = {
        "withdrawal_id": "wd_demo",
        "provider_id": "prov_demo",
        "provider_name": "Demo provider",
        "owner_id": "own_demo",
        "owner_wallet": "0xabc",
        "owner_email": "owner@example.com",
        "amount_usdc": Decimal("10.000000"),
        "status": "COMPLETED",
        "tx_hash": "0xwithdraw",
        "ticket_id": "ticket_demo",
        "request_id": "req_demo",
        "created_at": NOW,
        "updated_at": NOW,
        "meta_payload": json.dumps({"platformFeeUsdc": "1.000000", "reviewDecision": "APPROVE"}),
    }
    return {**row, **overrides}


def _install_results(monkeypatch, results):
    monkeypatch.setattr(repo_mod, "_connect", lambda dsn: FakeConnection(results))
    return PostgresAdminOperationsRepository("postgresql://test")


def test_admin_operations_row_mapping_and_filters_cover_optional_fields() -> None:
    filters, params = owner_filters(q="demo", wallet="0x", email="owner", status="active")
    assert len(filters) == 4
    assert len(params) == 6

    deposit_where, deposit_params = deposit_filters("0x", "0xdep", "CONFIRMED", "2026-01-01", "2026-05-01")
    withdrawal_where, withdrawal_params = withdrawal_filters("0x", "0xwd", "COMPLETED", "2026-01-01", "2026-05-01")
    assert len(deposit_where) == 5
    assert len(deposit_params) == 5
    assert len(withdrawal_where) == 5
    assert len(withdrawal_params) == 5

    owner = owner_record(_owner_row(email=None, pending_email=None, is_provider=False))
    assert owner.roles == ("consumer",)
    assert owner.email is None

    pending = deposit_record(_deposit_row(status="PENDING_CONFIRMATION", meta_payload=b"{}"))
    assert pending.credited_at is None
    assert pending.network is None

    returned = withdrawal_record(_withdrawal_row(status="FAILED_EXPIRED", meta_payload=memoryview(b"{}")))
    assert returned.funds_state == "returned"
    assert returned.fee_usdc is None


def test_admin_operations_repository_lists_owner_accounts(monkeypatch) -> None:
    repository = _install_results(monkeypatch, [[{"total": 1}], [_owner_row()]])

    result = repository.list_owner_accounts(
        q="demo",
        wallet="0x",
        email="owner",
        status="active",
        page=1,
        page_size=50,
        sort="created_asc",
    )

    assert result.pagination.total == 1
    assert result.items[0].owner_id == "own_demo"
    assert result.items[0].roles == ("consumer", "provider")


def test_admin_operations_repository_get_owner_account(monkeypatch) -> None:
    repository = _install_results(
        monkeypatch,
        [
            _owner_row(),
            {
                "consumer_available": Decimal("1"),
                "consumer_frozen": Decimal("2"),
                "provider_available": Decimal("3"),
                "provider_frozen": Decimal("4"),
            },
            [_deposit_row()],
            [_withdrawal_row()],
            [{"invocation_id": "inv_demo", "status": "SUCCEEDED"}],
            [{"feedback_id": "fb_demo", "category": "billing_support"}],
        ],
    )

    result = repository.get_owner_account("own_demo")

    assert result is not None
    assert result.balances.provider_available_usdc == Decimal("3")
    assert result.recent_deposits[0].deposit_id == "dep_demo"
    assert result.recent_provider_withdrawals[0].withdrawal_id == "wd_demo"
    assert result.recent_invocations[0]["invocation_id"] == "inv_demo"
    assert result.support_cases[0]["feedback_id"] == "fb_demo"


def test_admin_operations_repository_lists_and_details_deposits(monkeypatch) -> None:
    repository = _install_results(monkeypatch, [[{"total": 1}], [_deposit_row()]])
    page = repository.list_consumer_deposits(
        wallet="0x",
        tx_hash="0xdeposit",
        status="CONFIRMED",
        date_from="2026-01-01",
        date_to="2026-05-01",
        page=1,
        page_size=50,
        sort="amount_desc",
    )
    assert page.items[0].confirmations == 12

    repository = _install_results(
        monkeypatch,
        [
            _deposit_row(),
            [{"entry_id": "ledger_demo"}],
            [{"event_id": "audit_demo"}],
            [{"notification_id": "notif_demo"}],
        ],
    )
    detail = repository.get_consumer_deposit("dep_demo")
    assert detail is not None
    assert detail.ledger_entries[0]["entry_id"] == "ledger_demo"
    assert detail.audit_events[0]["event_id"] == "audit_demo"
    assert detail.notification_events[0]["notification_id"] == "notif_demo"


def test_admin_operations_repository_lists_and_details_provider_withdrawals(monkeypatch) -> None:
    repository = _install_results(monkeypatch, [[{"total": 1}], [_withdrawal_row()]])
    page = repository.list_provider_withdrawals(
        wallet="0x",
        tx_hash="0xwithdraw",
        status="COMPLETED",
        date_from="2026-01-01",
        date_to="2026-05-01",
        page=1,
        page_size=50,
        sort="amount_asc",
    )
    assert page.items[0].funds_state == "claimed"

    repository = _install_results(
        monkeypatch,
        [
            _withdrawal_row(),
            [{"entry_id": "ledger_demo"}],
            [{"event_id": "audit_demo"}],
            [{"notification_id": "notif_demo"}],
            [{"event_id": "review_demo"}],
        ],
    )
    detail = repository.get_provider_withdrawal("wd_demo")
    assert detail is not None
    assert detail.withdrawal.review_decision == "APPROVE"
    assert detail.review_history[0]["event_id"] == "review_demo"
