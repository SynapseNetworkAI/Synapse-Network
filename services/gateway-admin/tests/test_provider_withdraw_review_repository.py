from __future__ import annotations

from datetime import datetime, timedelta, timezone

from src.storage.analytics.provider_withdraw_review import (
    InMemoryProviderWithdrawReviewRepository,
    ProviderWithdrawReviewItem,
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
