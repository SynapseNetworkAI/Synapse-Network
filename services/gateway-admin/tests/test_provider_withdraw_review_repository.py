from __future__ import annotations

from src.storage.analytics.provider_withdraw_review import (
    InMemoryProviderWithdrawReviewRepository,
)


def test_in_memory_withdraw_review_repository_lists_pending_by_created_desc() -> None:
    repository = InMemoryProviderWithdrawReviewRepository.seed_demo()

    items = repository.list_pending_reviews(limit=10)

    created_values = [item.created_at for item in items if item.created_at]
    assert created_values == sorted(created_values, reverse=True)
