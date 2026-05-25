from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import psycopg

from src.storage.analytics import provider_withdraw_review as provider_withdraw_review_module
from src.storage.analytics.provider_withdraw_review import (
    InMemoryProviderWithdrawReviewRepository,
    PostgresProviderWithdrawReviewRepository,
    ProviderWithdrawReviewItem,
    _is_manual_review_expired,
    _review_expires_at_from_created_at,
    _review_expires_at_from_iso_string,
)


def test_in_memory_withdraw_review_repository_lists_pending_by_created_desc() -> None:
    repository = InMemoryProviderWithdrawReviewRepository.seed_demo()

    items = repository.list_pending_reviews(limit=10)

    created_values = [item.created_at for item in items if item.created_at]
    assert created_values == sorted(created_values, reverse=True)
    assert all(item.review_expires_at for item in items)


def test_in_memory_withdraw_review_repository_hides_expired_pending_reviews() -> None:
    repository = InMemoryProviderWithdrawReviewRepository.seed_demo()
    expired_created_at = (
        datetime.now(timezone.utc) - timedelta(days=2)
    ).isoformat().replace("+00:00", "Z")
    repository._items.append(
        ProviderWithdrawReviewItem(
            withdrawal_id="wd-expired-review",
            withdrawal_kind="consumer_refund",
            review_type="consumer_withdraw_review",
            owner_address="0xexpired",
            subject_address="0xexpired",
            amount_usdc=repository._items[0].amount_usdc,
            status="PENDING_MANUAL_REVIEW",
            request_id="expired-request",
            tx_hash=None,
            risk_level="red",
            risk_reason_code="MANUAL_REVIEW_TIMEOUT",
            evidence_summary="Expired review should not remain in the pending queue.",
            message="Expired item",
            created_at=expired_created_at,
            updated_at=expired_created_at,
            review_expires_at=(
                datetime.now(timezone.utc) - timedelta(days=1)
            ).isoformat().replace("+00:00", "Z"),
        )
    )

    items = repository.list_pending_reviews(limit=20)

    assert "wd-expired-review" not in [item.withdrawal_id for item in items]
    assert repository.count_pending_reviews() == len(items)


def test_review_expires_at_helpers_handle_empty_and_invalid_inputs() -> None:
    assert _review_expires_at_from_created_at(None) is None
    assert _review_expires_at_from_iso_string(None) is None
    assert _review_expires_at_from_iso_string("") is None
    assert _review_expires_at_from_iso_string("not-a-timestamp") is None


def test_manual_review_expired_helper_handles_empty_and_invalid_created_at() -> None:
    now = datetime.now(timezone.utc)

    assert _is_manual_review_expired(None, now=now) is False
    assert _is_manual_review_expired("", now=now) is False
    assert _is_manual_review_expired("bad-created-at", now=now) is False


def test_in_memory_withdraw_review_repository_uses_withdrawal_id_desc_as_stable_tiebreaker() -> None:
    repository = InMemoryProviderWithdrawReviewRepository(
        [
            ProviderWithdrawReviewItem(
                withdrawal_id="wd-alpha",
                withdrawal_kind="consumer_refund",
                review_type="consumer_withdraw_review",
                owner_address="0xowner",
                subject_address="0xowner",
                amount_usdc=Decimal("10.000000"),
                status="PENDING_MANUAL_REVIEW",
                request_id="req-alpha",
                tx_hash=None,
                risk_level="yellow",
                risk_reason_code="tie-breaker",
                evidence_summary="alpha",
                message=None,
                created_at="2036-05-08T12:00:00Z",
                updated_at="2036-05-08T12:00:00Z",
            ),
            ProviderWithdrawReviewItem(
                withdrawal_id="wd-omega",
                withdrawal_kind="provider_withdrawal",
                review_type="provider_withdraw_review",
                owner_address="0xprovider",
                subject_address="0xprovider",
                amount_usdc=Decimal("11.000000"),
                status="PENDING_MANUAL_REVIEW",
                request_id="req-omega",
                tx_hash=None,
                risk_level="red",
                risk_reason_code="tie-breaker",
                evidence_summary="omega",
                message=None,
                created_at="2036-05-08T12:00:00Z",
                updated_at="2036-05-08T12:00:00Z",
            ),
        ]
    )

    items = repository.list_pending_reviews(limit=10)

    assert [item.withdrawal_id for item in items] == ["wd-omega", "wd-alpha"]


def test_postgres_withdraw_review_repository_degrades_when_readonly_permissions_are_missing(
    monkeypatch,
) -> None:
    repository = PostgresProviderWithdrawReviewRepository("postgresql://readonly@db/synapse_gateway_prod")

    def _raise_permission_denied(_: str):
        raise psycopg.errors.InsufficientPrivilege("permission denied for table synapse_vault_withdrawals")

    monkeypatch.setattr(provider_withdraw_review_module, "_connect", _raise_permission_denied)

    assert repository.list_pending_reviews(limit=10) == []
    assert repository.count_pending_reviews() == 0
    assert repository.get_review_item("wd-prod") is None


def test_postgres_withdraw_review_repository_degrades_when_tables_are_missing(
    monkeypatch,
) -> None:
    repository = PostgresProviderWithdrawReviewRepository("postgresql://readonly@db/synapse_gateway_prod")

    def _raise_undefined_table(_: str):
        raise psycopg.errors.UndefinedTable("relation synapse_vault_withdrawals does not exist")

    monkeypatch.setattr(provider_withdraw_review_module, "_connect", _raise_undefined_table)

    assert repository.list_pending_reviews(limit=10) == []
    assert repository.count_pending_reviews() == 0
    assert repository.get_review_item("wd-prod") is None


def test_in_memory_withdraw_review_repository_uses_withdrawal_id_desc_as_stable_tiebreaker() -> None:
    repository = InMemoryProviderWithdrawReviewRepository(
        [
            ProviderWithdrawReviewItem(
                withdrawal_id="wd-alpha",
                withdrawal_kind="consumer_refund",
                review_type="consumer_withdraw_review",
                owner_address="0xowner",
                subject_address="0xowner",
                amount_usdc=Decimal("10.000000"),
                status="PENDING_MANUAL_REVIEW",
                request_id="req-alpha",
                tx_hash=None,
                risk_level="yellow",
                risk_reason_code="tie-breaker",
                evidence_summary="alpha",
                message=None,
                created_at="2036-05-08T12:00:00Z",
                updated_at="2036-05-08T12:00:00Z",
            ),
            ProviderWithdrawReviewItem(
                withdrawal_id="wd-omega",
                withdrawal_kind="provider_withdrawal",
                review_type="provider_withdraw_review",
                owner_address="0xprovider",
                subject_address="0xprovider",
                amount_usdc=Decimal("11.000000"),
                status="PENDING_MANUAL_REVIEW",
                request_id="req-omega",
                tx_hash=None,
                risk_level="red",
                risk_reason_code="tie-breaker",
                evidence_summary="omega",
                message=None,
                created_at="2036-05-08T12:00:00Z",
                updated_at="2036-05-08T12:00:00Z",
            ),
        ]
    )

    items = repository.list_pending_reviews(limit=10)

    assert [item.withdrawal_id for item in items] == ["wd-omega", "wd-alpha"]
