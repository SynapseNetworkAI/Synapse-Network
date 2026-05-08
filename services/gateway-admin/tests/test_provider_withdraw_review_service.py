from datetime import datetime, timezone

from src.core.errors import BadRequestError
from src.domain import AdminActionAudit
from src.domain.enums import AuditResultStatus
from src.services.auth.service import AdminIdentity
from src.services.finance_admin import ProviderWithdrawReviewService
from src.services.finance_admin.provider_withdraw_review_service import WithdrawReviewHistoryQuery
from src.storage import InMemoryAdminStore
from src.storage.analytics import InMemoryProviderWithdrawReviewRepository
from src.services.adapters import InMemoryProviderWithdrawReviewAdapter


def _reviewer() -> AdminIdentity:
    return AdminIdentity(
        admin_id="admin-1",
        email="finance-review@synapse-network.ai",
        display_name="Finance Review",
        role="finance_reviewer",
        permissions=("approval:decide",),
    )


def test_withdraw_review_decision_rejects_duplicate_successful_decision() -> None:
    store = InMemoryAdminStore.seed_demo()
    repository = InMemoryProviderWithdrawReviewRepository.seed_demo()
    service = ProviderWithdrawReviewService(
        store,
        repository,
        InMemoryProviderWithdrawReviewAdapter(repository),
    )
    withdrawal_id = "wd-demo-review-001"

    result = service.decide_review(
        withdrawal_id,
        decision="APPROVE",
        reviewer=_reviewer(),
        note="Looks consistent.",
        request_id="req-first-review",
    )
    assert result.status == "APPROVED_AUTO"

    try:
        service.decide_review(
            withdrawal_id,
            decision="REJECT",
            reviewer=_reviewer(),
            note="Duplicate click.",
            request_id="req-duplicate-review",
        )
    except BadRequestError as exc:
        assert "已提交处理" in str(exc)
    else:
        raise AssertionError("duplicate withdrawal review decision should fail")

    successful_audits = [
        action
        for action in store.audit.list_actions(
            action_type="withdrawal_review.decide",
            result_status="success",
            limit=20,
        )
        if action.resource_id == withdrawal_id
    ]
    assert len(successful_audits) == 1


def test_withdraw_review_history_falls_back_to_audit_when_projection_is_missing() -> None:
    store = InMemoryAdminStore.seed_demo()
    repository = InMemoryProviderWithdrawReviewRepository.seed_demo()
    service = ProviderWithdrawReviewService(
        store,
        repository,
        InMemoryProviderWithdrawReviewAdapter(repository),
    )
    withdrawal_id = "wd-orphan-audit-001"
    store.audit.append_action(
        AdminActionAudit(
            action_type="withdrawal_review.decide",
            result_status=AuditResultStatus.SUCCESS,
            operator_id="admin-1",
            operator_email="finance-review@synapse-network.ai",
            operator_role="finance_reviewer",
            resource_type="provider_withdrawal",
            resource_id=withdrawal_id,
            before={
                "status": "PENDING_MANUAL_REVIEW",
                "withdrawalKind": "provider_withdrawal",
                "reviewType": "provider_withdraw_review",
                "ownerAddress": "0x1111111111111111111111111111111111111111",
                "subjectAddress": "0x2222222222222222222222222222222222222222",
                "amountUsdc": "12.60",
            },
            after={"status": "APPROVED_AUTO"},
            detail={"decision": "APPROVE", "reviewerNote": "Reviewed in admin console."},
            created_at=datetime(2026, 5, 6, 12, 0, tzinfo=timezone.utc),
        )
    )

    result = service.list_history_items(WithdrawReviewHistoryQuery(query=withdrawal_id))

    assert result.total_count == 1
    history_item = result.items[0]
    assert history_item.withdrawal_id == withdrawal_id
    assert history_item.amount_usdc == "12.60"
    assert history_item.current_status == "APPROVED_AUTO"
    assert history_item.reviewer_note == "Reviewed in admin console."
