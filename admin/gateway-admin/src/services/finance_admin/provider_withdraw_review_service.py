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

    def list_history_items(self, *, limit: int = 50, current_status: str | None = None) -> dict:
        normalized_status = (current_status or "").strip().upper() or None
        audit_rows = self._list_history_audits(limit)

        items: list[dict] = []
        seen_withdrawal_ids: set[str] = set()

        for audit in audit_rows:
            history_item = self._build_history_item(audit)
            if history_item is None:
                continue

            withdrawal_id = str(history_item["withdrawalId"])
            if withdrawal_id in seen_withdrawal_ids:
                continue
            if normalized_status and history_item["currentStatus"] != normalized_status:
                continue

            seen_withdrawal_ids.add(withdrawal_id)
            items.append(history_item)
            if len(items) >= limit:
                break

        return {"items": items, "nextCursor": None}

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

    @staticmethod
    def _serialize_timestamp(value: datetime | None) -> str | None:
        return value.isoformat().replace("+00:00", "Z") if value else None

    @staticmethod
    def _resolve_amount_usdc(item, before: dict) -> str | None:
        if item is not None:
            return f"{item.amount_usdc:.2f}"
        amount = before.get("amountUsdc")
        if amount is None:
            return None
        return str(amount)

    def _list_history_audits(self, limit: int) -> list[AdminActionAudit]:
        return list(
            self._store.audit.list_actions(
                action_type="provider_withdraw_review.decide",
                result_status=AuditResultStatus.SUCCESS.value,
                limit=max(limit * 4, limit),
            )
        )

    def _build_history_item(self, audit: AdminActionAudit) -> dict | None:
        withdrawal_id = str(audit.resource_id or "").strip()
        if not withdrawal_id:
            return None

        review_item = self._repository.get_review_item(withdrawal_id)
        return {
            "withdrawalId": withdrawal_id,
            "ownerAddress": review_item.owner_address if review_item else audit.before.get("ownerAddress"),
            "amountUsdc": self._resolve_amount_usdc(review_item, audit.before),
            "requestId": review_item.request_id if review_item else None,
            "txHash": review_item.tx_hash if review_item else None,
            "riskLevel": review_item.risk_level if review_item else None,
            "riskReasonCode": review_item.risk_reason_code if review_item else None,
            "evidenceSummary": review_item.evidence_summary if review_item else None,
            "reviewDecision": str(audit.detail.get("decision") or "UNKNOWN").strip().upper(),
            "currentStatus": self._resolve_history_status(review_item, audit),
            "reviewerEmail": audit.operator_email,
            "reviewerRole": audit.operator_role,
            "reviewerNote": str(audit.detail.get("reviewerNote") or "").strip() or None,
            "message": review_item.message if review_item else None,
            "createdAt": review_item.created_at if review_item else None,
            "updatedAt": review_item.updated_at if review_item else None,
            "reviewedAt": self._serialize_timestamp(audit.created_at),
        }

    @staticmethod
    def _resolve_history_status(item, audit: AdminActionAudit) -> str:
        return str(
            (item.status if item else None)
            or audit.after.get("status")
            or audit.before.get("status")
            or "UNKNOWN"
        ).strip().upper()