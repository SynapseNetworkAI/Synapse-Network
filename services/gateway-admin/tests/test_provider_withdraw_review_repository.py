from __future__ import annotations

from decimal import Decimal

from src.storage.analytics.provider_withdraw_review import (
    InMemoryProviderWithdrawReviewRepository,
    ProviderWithdrawReviewItem,
)


def test_in_memory_withdraw_review_repository_lists_pending_by_created_desc() -> None:
    repository = InMemoryProviderWithdrawReviewRepository.seed_demo()

    items = repository.list_pending_reviews(limit=10)

    created_values = [item.created_at for item in items if item.created_at]
    assert created_values == sorted(created_values, reverse=True)


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
                created_at="2026-05-08T12:00:00Z",
                updated_at="2026-05-08T12:00:00Z",
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
                created_at="2026-05-08T12:00:00Z",
                updated_at="2026-05-08T12:00:00Z",
            ),
        ]
    )

    items = repository.list_pending_reviews(limit=10)

    assert [item.withdrawal_id for item in items] == ["wd-omega", "wd-alpha"]
