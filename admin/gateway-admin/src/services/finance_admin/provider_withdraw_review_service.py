from datetime import datetime, timezone

from src.core.errors import AppError, BadRequestError, ResourceNotFoundError
from src.domain import AdminActionAudit
from src.domain.enums import AuditResultStatus
from src.services.adapters.provider_withdraw_review import (
    ProviderWithdrawReviewAdapter,
    ProviderWithdrawReviewError,
)
from src.services.auth.service import AdminIdentity
from src.storage.analytics.provider_withdraw_review import ProviderWithdrawReviewRepository
from src.storage.base import AdminStore


class ProviderWithdrawReviewService:
    def __init__(
        self,
        store: AdminStore,
        repository: ProviderWithdrawReviewRepository,
        adapter: ProviderWithdrawReviewAdapter,
    ) -> None:
        self._store = store
        self._repository = repository
        self._adapter = adapter

    def list_pending_items(self, limit: int = 20) -> dict:
        items = self._repository.list_pending_reviews(limit=limit)
        return {
            "items": [
                {
                    "withdrawalId": item.withdrawal_id,
                    "ownerAddress": item.owner_address,
                    "amountUsdc": f"{item.amount_usdc:.2f}",
                    "status": item.status,
                    "requestId": item.request_id,
                    "txHash": item.tx_hash,
                    "riskLevel": item.risk_level,
                    "riskReasonCode": item.risk_reason_code,
                    "evidenceSummary": item.evidence_summary,
                    "message": item.message,
                    "createdAt": item.created_at,
                    "updatedAt": item.updated_at,
                }
                for item in items
            ],
            "nextCursor": None,
        }

    def decide_review(
        self,
        withdrawal_id: str,
        *,
        decision: str,
        reviewer: AdminIdentity,
        note: str,
        request_id: str | None = None,
    ) -> dict:
        normalized_decision = decision.strip().upper()
        if normalized_decision not in {"APPROVE", "REJECT"}:
            raise BadRequestError("decision must be APPROVE or REJECT")

        item = self._repository.get_review_item(withdrawal_id)
        if item is None:
            raise ResourceNotFoundError("Provider withdrawal review item not found")
        if item.status != "PENDING_MANUAL_REVIEW":
            raise BadRequestError(f"Withdrawal status={item.status} is not awaiting manual review")

        try:
            result = self._adapter.review_withdrawal(
                item,
                decision=normalized_decision,
                reviewer=reviewer,
                note=note.strip(),
            )
        except ProviderWithdrawReviewError as exc:
            self._append_audit(
                reviewer,
                request_id=request_id,
                item=item,
                decision=normalized_decision,
                note=note,
                result_status=AuditResultStatus.FAILURE,
                error_code=exc.code,
            )
            raise AppError(code=exc.code, message=exc.message, status_code=exc.status_code) from exc

        self._append_audit(
            reviewer,
            request_id=request_id,
            item=item,
            decision=normalized_decision,
            note=note,
            result_status=AuditResultStatus.SUCCESS,
            after={
                "status": result.get("status"),
                "requestedBy": result.get("requestedBy"),
            },
        )
        return {
            "withdrawalId": str(result.get("withdrawalId") or item.withdrawal_id),
            "ownerAddress": str(result.get("ownerAddress") or item.owner_address),
            "reviewDecision": normalized_decision,
            "status": str(result.get("status") or "unknown"),
            "message": result.get("message"),
            "requestedBy": result.get("requestedBy"),
            "ticket": result.get("ticket") or {},
        }

    def _append_audit(
        self,
        reviewer: AdminIdentity,
        *,
        request_id: str | None,
        item,
        decision: str,
        note: str,
        result_status: AuditResultStatus,
        error_code: str | None = None,
        after: dict | None = None,
    ) -> None:
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="provider_withdraw_review.decide",
                result_status=result_status,
                operator_id=reviewer.admin_id,
                operator_email=reviewer.email,
                operator_role=reviewer.role,
                request_id=request_id,
                resource_type="provider_withdrawal",
                resource_id=item.withdrawal_id,
                error_code=error_code,
                before={
                    "status": item.status,
                    "ownerAddress": item.owner_address,
                    "amountUsdc": f"{item.amount_usdc:.2f}",
                },
                after=after or {},
                detail={
                    "decision": decision,
                    "reviewerNote": note.strip(),
                },
                created_at=datetime.now(timezone.utc),
            )
        )