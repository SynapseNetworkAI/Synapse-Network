from dataclasses import replace
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

from src.domain import AdminActionAudit, AdminApproval, AdminApprovalEvent, AdminApprovalStep, AdminExecutionJob
from src.domain.enums import ApprovalDecision, ApprovalLevel, ApprovalStatus, AuditResultStatus, ExecutionJobStatus, RiskLevel, RoleBindingStatus
from src.services.finance_admin import ProviderWithdrawReviewService
from src.services.auth.service import AdminIdentity
from src.storage.analytics import ProviderWithdrawReviewRepository
from src.storage.base import AdminStore

PROVIDER_WITHDRAW_REVIEW_PREFIX = "PWR-"
PROVIDER_WITHDRAW_REVIEW_TYPE = "provider_withdraw_review"
PROVIDER_WITHDRAW_REVIEW_REQUESTER = "gateway_risk_engine"
ERR_APPROVAL_NOT_FOUND = "approval not found"

class ApprovalService:
    def __init__(
        self,
        store: AdminStore,
        provider_withdraw_review_repository: ProviderWithdrawReviewRepository,
        provider_withdraw_review_service: ProviderWithdrawReviewService,
    ) -> None:
        self._store = store
        self._provider_withdraw_review_repository = provider_withdraw_review_repository
        self._provider_withdraw_review_service = provider_withdraw_review_service

    def list_items(self, status: str | None = None, approval_type: str | None = None, limit: int = 20) -> dict:
        approvals = self._store.approval.list_approvals(status=status, approval_type=approval_type, limit=limit)
        items = [self._to_summary_item(approval) for approval in approvals]

        include_provider_projection = approval_type in {None, "", PROVIDER_WITHDRAW_REVIEW_TYPE}
        if include_provider_projection and status in {None, "", ApprovalStatus.UNDER_REVIEW.value}:
            projected_reviews = self._provider_withdraw_review_repository.list_pending_reviews(limit=limit)
            items.extend(self._to_provider_withdraw_projection(review) for review in projected_reviews)

        items.sort(key=lambda item: item.get("createdAt") or "", reverse=True)
        items = items[:limit]
        return {"items": items, "nextCursor": None}

    def pending_count(self) -> int:
        return self._store.approval.count_pending_approvals() + self._provider_withdraw_review_repository.count_pending_reviews()

    def create_item(self, payload: dict, requester: AdminIdentity) -> dict:
        now = datetime.now(timezone.utc)
        approval_id = f"APR-{now.strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}"
        approval = AdminApproval(
            approval_id=approval_id,
            approval_type=payload["approvalType"],
            approval_level=ApprovalLevel(payload["approvalLevel"]),
            status=ApprovalStatus.SUBMITTED,
            requester_id=requester.admin_id,
            resource_type=payload["resourceType"],
            resource_id=payload["resourceId"],
            owner_address=payload["payload"].get("ownerAddress"),
            tx_hash=payload["payload"].get("txHash"),
            event_key=payload["payload"].get("eventKey"),
            risk_level=RiskLevel.YELLOW if payload["approvalType"] in {"deposit_repair", "refund_approve", "withdrawal_approve"} else RiskLevel.GREEN,
            amount_usdc=Decimal(payload["amountUsdc"]),
            reason=payload["reason"],
            payload=payload["payload"],
            submitted_at=now,
            created_at=now,
            updated_at=now,
        )
        self._store.approval.create_approval(approval)
        self._store.approval.upsert_approval_step(
            AdminApprovalStep(
                step_id=uuid4().hex,
                approval_id=approval.approval_id,
                step_no=1,
                required_permission="approval:decide",
                created_at=now,
            )
        )
        self._store.approval.append_approval_event(
            AdminApprovalEvent(
                approval_id=approval.approval_id,
                event_type="SUBMITTED",
                operator_id=requester.admin_id,
                operator_role=requester.role,
                from_status=ApprovalStatus.DRAFT,
                to_status=ApprovalStatus.SUBMITTED,
                detail=payload["payload"],
                created_at=now,
            )
        )
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="approval.submit",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=requester.admin_id,
                operator_email=requester.email,
                operator_role=requester.role,
                approval_id=approval.approval_id,
                resource_type=approval.resource_type,
                resource_id=approval.resource_id,
                after={"status": approval.status.value, "approvalLevel": approval.approval_level.value},
                detail=approval.payload,
                created_at=now,
            )
        )
        return self._to_summary_item(approval, requester.role) | {
            "resourceType": approval.resource_type,
            "resourceId": approval.resource_id,
            "reason": approval.reason,
            "payload": approval.payload,
        }

    def decide(self, approval_id: str, decision: str, reviewer: AdminIdentity, comment: str = "") -> dict:
        if approval_id.startswith(PROVIDER_WITHDRAW_REVIEW_PREFIX):
            withdrawal_id = approval_id.removeprefix(PROVIDER_WITHDRAW_REVIEW_PREFIX).strip()
            result = self._provider_withdraw_review_service.decide_review(
                withdrawal_id,
                decision=decision,
                reviewer=reviewer,
                note=comment,
            )
            return {"approvalId": approval_id, "status": result["status"]}

        approval = self._store.approval.get_approval(approval_id)
        if approval is None:
            raise ValueError(ERR_APPROVAL_NOT_FOUND)
        normalized = ApprovalDecision(decision.strip().upper())
        now = datetime.now(timezone.utc)
        steps = self._store.approval.list_approval_steps(approval_id)
        current_step = next((step for step in steps if step.decision is None), None)
        if current_step is None:
            current_step = AdminApprovalStep(
                step_id=uuid4().hex,
                approval_id=approval_id,
                step_no=max([step.step_no for step in steps], default=0) + 1,
                required_permission="approval:decide",
                created_at=now,
            )
        decided_step = replace(
            current_step,
            approver_id=reviewer.admin_id,
            decision=normalized,
            decision_comment=comment,
            decided_at=now,
            assigned_at=current_step.assigned_at or now,
        )
        self._store.approval.upsert_approval_step(decided_step)
        next_status = (
            ApprovalStatus.APPROVED_PENDING_EXECUTION
            if normalized == ApprovalDecision.APPROVE
            else ApprovalStatus.REJECTED
        )
        updated_approval = replace(
            approval,
            status=next_status,
            current_approver_id=None,
            approved_at=now if next_status == ApprovalStatus.APPROVED_PENDING_EXECUTION else approval.approved_at,
            rejected_at=now if next_status == ApprovalStatus.REJECTED else approval.rejected_at,
            updated_at=now,
        )
        self._store.approval.update_approval(updated_approval)
        self._store.approval.append_approval_event(
            AdminApprovalEvent(
                approval_id=approval_id,
                event_type="APPROVED" if next_status == ApprovalStatus.APPROVED_PENDING_EXECUTION else "REJECTED",
                operator_id=reviewer.admin_id,
                operator_role=reviewer.role,
                from_status=approval.status,
                to_status=next_status,
                comment=comment,
                created_at=now,
            )
        )
        if next_status == ApprovalStatus.APPROVED_PENDING_EXECUTION:
            self._store.approval.enqueue_execution_job(
                AdminExecutionJob(
                    job_id=uuid4().hex,
                    approval_id=approval_id,
                    execution_type=updated_approval.approval_type,
                    target_system="gateway",
                    idempotency_key=f"approval:{approval_id}",
                    status=ExecutionJobStatus.PENDING,
                    queued_by=reviewer.admin_id,
                    request_payload=updated_approval.payload,
                    created_at=now,
                    updated_at=now,
                )
            )
        self._store.audit.append_action(
            AdminActionAudit(
                action_type="approval.decide",
                result_status=AuditResultStatus.SUCCESS,
                operator_id=reviewer.admin_id,
                operator_email=reviewer.email,
                operator_role=reviewer.role,
                approval_id=approval_id,
                resource_type=approval.resource_type,
                resource_id=approval.resource_id,
                before={"status": approval.status.value},
                after={"status": next_status.value},
                detail={"decision": normalized.value, "comment": comment},
                created_at=now,
            )
        )
        return {"approvalId": approval_id, "status": next_status.value}

    def _to_summary_item(self, approval: AdminApproval, requester_role: str | None = None) -> dict:
        return {
            "approvalId": approval.approval_id,
            "approvalType": approval.approval_type,
            "status": approval.status.value,
            "approvalLevel": approval.approval_level.value,
            "requesterRole": requester_role or self._get_primary_role(approval.requester_id),
            "amountUsdc": f"{approval.amount_usdc:.2f}",
            "createdAt": approval.created_at.isoformat().replace("+00:00", "Z") if approval.created_at else None,
        }

    def _to_provider_withdraw_projection(self, review) -> dict:
        return {
            "approvalId": f"{PROVIDER_WITHDRAW_REVIEW_PREFIX}{review.withdrawal_id}",
            "approvalType": PROVIDER_WITHDRAW_REVIEW_TYPE,
            "status": ApprovalStatus.UNDER_REVIEW.value,
            "approvalLevel": self._project_provider_review_level(review.risk_level),
            "requesterRole": PROVIDER_WITHDRAW_REVIEW_REQUESTER,
            "amountUsdc": f"{review.amount_usdc:.2f}",
            "createdAt": review.created_at,
            "payload": {
                "withdrawalKind": review.withdrawal_kind,
                "reviewType": review.review_type,
                "ownerAddress": review.owner_address,
                "subjectAddress": review.subject_address,
            },
        }

    @staticmethod
    def _project_provider_review_level(risk_level: str | None) -> str:
        if risk_level == RiskLevel.RED.value:
            return ApprovalLevel.L3.value
        return ApprovalLevel.L2.value

    def _get_primary_role(self, admin_id: str) -> str:
        bindings = [
            binding
            for binding in self._store.authorization.list_role_bindings(admin_id)
            if binding.status == RoleBindingStatus.ACTIVE
        ]
        return bindings[0].role_key if bindings else "platform_ops_admin"
