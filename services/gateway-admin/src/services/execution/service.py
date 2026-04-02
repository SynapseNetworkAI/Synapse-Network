from dataclasses import replace
from datetime import datetime, timezone
from hashlib import sha256
import json

from src.core.errors import BadRequestError
from src.domain import AdminActionAudit, AdminApprovalEvent, AdminExecutionAttempt
from src.domain.enums import AdminUserStatus, ApprovalStatus, AuditResultStatus, ExecutionAttemptStatus, ExecutionJobStatus, RoleBindingStatus
from src.services.adapters import GatewayExecutionAdapter, GatewayExecutionError
from src.services.auth.service import AdminIdentity
from src.storage.base import AdminStore


class ExecutionService:
    def __init__(self, store: AdminStore, gateway_execution: GatewayExecutionAdapter) -> None:
        self._store = store
        self._gateway_execution = gateway_execution

    def list_jobs(
        self,
        status: str | None = None,
        target_system: str | None = None,
        approval_id: str | None = None,
        limit: int = 20,
    ) -> dict:
        jobs = self._store.approval.list_execution_jobs(
            status=status,
            target_system=target_system,
            approval_id=approval_id,
            limit=limit,
        )
        return {
            "items": [
                {
                    "jobId": job.job_id,
                    "approvalId": job.approval_id,
                    "executionType": job.execution_type,
                    "targetSystem": job.target_system,
                    "status": job.status.value,
                    "idempotencyKey": job.idempotency_key,
                    "errorCode": job.error_code,
                    "errorMessage": job.error_message,
                    "retryCount": job.retry_count,
                    "maxRetryCount": job.max_retry_count,
                    "queuedBy": job.queued_by,
                    "updatedAt": job.updated_at.isoformat().replace("+00:00", "Z") if job.updated_at else None,
                    "attempts": [
                        {
                            "attemptNo": attempt.attempt_no,
                            "status": attempt.status.value,
                            "errorCode": attempt.error_code,
                            "errorSummary": attempt.error_summary,
                            "finishedAt": attempt.finished_at.isoformat().replace("+00:00", "Z") if attempt.finished_at else None,
                        }
                        for attempt in self._store.approval.list_execution_attempts(job.job_id)
                    ],
                }
                for job in jobs
            ],
            "nextCursor": None,
        }

    def retry_job(self, job_id: str, operator: AdminIdentity) -> dict:
        job = self._store.approval.get_execution_job(job_id)
        if job is None:
            raise ValueError(f"Execution job {job_id} not found")
        return self._execute_job(job, operator, allowed_statuses={ExecutionJobStatus.FAILED, ExecutionJobStatus.CANCELLED}, audit_action="execution.job.retry", start_event_type="EXECUTION_RETRY_STARTED")

    def execute_pending_jobs_once(self, limit: int = 10) -> dict:
        jobs = self._store.approval.list_execution_jobs(status=ExecutionJobStatus.PENDING.value, limit=limit)
        items: list[dict] = []
        for job in jobs:
            operator = self._resolve_operator_for_job(job.approval_id, job.queued_by)
            result = self._execute_job(
                job,
                operator,
                allowed_statuses={ExecutionJobStatus.PENDING},
                audit_action="execution.job.dispatch",
                start_event_type="EXECUTION_STARTED",
                skip_if_not_claimed=True,
            )
            if result is not None:
                items.append(result)
        return {"processed": len(items), "items": items}

    def _execute_job(
        self,
        job,
        operator: AdminIdentity,
        *,
        allowed_statuses: set[ExecutionJobStatus],
        audit_action: str,
        start_event_type: str,
        skip_if_not_claimed: bool = False,
    ) -> dict | None:
        if job.status not in allowed_statuses:
            raise BadRequestError("Execution job is not in an executable state")
        if job.retry_count >= job.max_retry_count:
            raise BadRequestError("Execution job exceeded max retry count")
        approval = self._store.approval.get_approval(job.approval_id)
        if approval is None:
            raise ValueError(f"Approval {job.approval_id} not found")

        now = datetime.now(timezone.utc)
        execution_payload = self._build_execution_payload(job.request_payload, approval)
        running_job = replace(
            job,
            status=ExecutionJobStatus.RUNNING,
            error_code=None,
            error_message=None,
            queued_by=operator.admin_id,
            request_payload=execution_payload,
            retry_count=job.retry_count + 1,
            started_at=now,
            finished_at=None,
            updated_at=now,
        )
        claimed_job = self._store.approval.claim_execution_job(
            job.job_id,
            [status.value for status in allowed_statuses],
            running_job,
        )
        if claimed_job is None:
            if skip_if_not_claimed:
                return None
            raise BadRequestError("Execution job is not in an executable state")
        running_approval = replace(approval, status=ApprovalStatus.EXECUTING, updated_at=now)
        self._store.approval.update_approval(running_approval)
        attempt = self._store.approval.append_execution_attempt(
            AdminExecutionAttempt(
                job_id=job.job_id,
                attempt_no=claimed_job.retry_count,
                status=ExecutionAttemptStatus.RUNNING,
                started_at=now,
            )
        )
        self._store.approval.append_approval_event(
            AdminApprovalEvent(
                approval_id=claimed_job.approval_id,
                event_type=start_event_type,
                operator_id=operator.admin_id,
                operator_role=operator.role,
                from_status=approval.status,
                to_status=ApprovalStatus.EXECUTING,
                detail={"jobId": job.job_id, "retryCount": claimed_job.retry_count},
                created_at=now,
            )
        )

        try:
            result_payload = self._gateway_execution.execute_job(claimed_job, operator)
        except GatewayExecutionError as exc:
            return self._finalize_failed_retry(
                original_job=job,
                running_job=claimed_job,
                approval=approval,
                attempt=attempt,
                operator=operator,
                error=exc,
                now=datetime.now(timezone.utc),
                audit_action=audit_action,
            )

        return self._finalize_successful_retry(
            original_job=job,
            running_job=claimed_job,
            approval=approval,
            attempt=attempt,
            operator=operator,
            result_payload=result_payload,
            now=datetime.now(timezone.utc),
            audit_action=audit_action,
        )

    def _finalize_successful_retry(
        self,
        *,
        original_job,
        running_job,
        approval,
        attempt,
        operator: AdminIdentity,
        result_payload: dict,
        now: datetime,
        audit_action: str,
    ) -> dict:
        updated_attempt = replace(
            attempt,
            status=ExecutionAttemptStatus.SUCCEEDED,
            finished_at=now,
            response_digest=self._build_response_digest(result_payload),
        )
        self._store.approval.update_execution_attempt(updated_attempt)
        completed_job = replace(
            running_job,
            status=ExecutionJobStatus.SUCCEEDED,
            result_payload=result_payload,
            finished_at=now,
            updated_at=now,
        )
        self._store.approval.update_execution_job(completed_job)
        executed_approval = replace(
            approval,
            status=ApprovalStatus.EXECUTED,
            executed_at=now,
            updated_at=now,
        )
        self._store.approval.update_approval(executed_approval)
        self._store.approval.append_approval_event(
            AdminApprovalEvent(
                approval_id=completed_job.approval_id,
                event_type="EXECUTION_SUCCEEDED",
                operator_id=operator.admin_id,
                operator_role=operator.role,
                from_status=ApprovalStatus.EXECUTING,
                to_status=ApprovalStatus.EXECUTED,
                detail={"jobId": completed_job.job_id, "retryCount": completed_job.retry_count},
                created_at=now,
            )
        )
        self._store.audit.append_action(
            AdminActionAudit(
                action_type=audit_action,
                result_status=AuditResultStatus.SUCCESS,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                approval_id=completed_job.approval_id,
                job_id=completed_job.job_id,
                resource_type="execution_job",
                resource_id=completed_job.job_id,
                before={"status": original_job.status.value, "retryCount": original_job.retry_count},
                after={"status": completed_job.status.value, "retryCount": completed_job.retry_count},
                detail={"result": result_payload},
                created_at=now,
            )
        )
        return {
            "jobId": completed_job.job_id,
            "status": completed_job.status.value,
            "retryCount": completed_job.retry_count,
        }

    def _finalize_failed_retry(
        self,
        *,
        original_job,
        running_job,
        approval,
        attempt,
        operator: AdminIdentity,
        error: GatewayExecutionError,
        now: datetime,
        audit_action: str,
    ) -> dict:
        failed_attempt = replace(
            attempt,
            status=ExecutionAttemptStatus.FAILED,
            finished_at=now,
            error_code=error.code,
            error_summary=error.message,
            response_digest=self._build_response_digest(error.result_payload or {}),
        )
        self._store.approval.update_execution_attempt(failed_attempt)
        failed_job = replace(
            running_job,
            status=ExecutionJobStatus.FAILED,
            result_payload=error.result_payload or {},
            error_code=error.code,
            error_message=error.message,
            finished_at=now,
            updated_at=now,
        )
        self._store.approval.update_execution_job(failed_job)
        failed_approval = replace(
            approval,
            status=ApprovalStatus.FAILED,
            updated_at=now,
        )
        self._store.approval.update_approval(failed_approval)
        self._store.approval.append_approval_event(
            AdminApprovalEvent(
                approval_id=failed_job.approval_id,
                event_type="EXECUTION_FAILED",
                operator_id=operator.admin_id,
                operator_role=operator.role,
                from_status=ApprovalStatus.EXECUTING,
                to_status=ApprovalStatus.FAILED,
                detail={
                    "jobId": failed_job.job_id,
                    "retryCount": failed_job.retry_count,
                    "errorCode": error.code,
                    "retriable": error.retriable,
                },
                created_at=now,
            )
        )
        self._store.audit.append_action(
            AdminActionAudit(
                action_type=audit_action,
                result_status=AuditResultStatus.FAILURE,
                operator_id=operator.admin_id,
                operator_email=operator.email,
                operator_role=operator.role,
                approval_id=failed_job.approval_id,
                job_id=failed_job.job_id,
                resource_type="execution_job",
                resource_id=failed_job.job_id,
                before={"status": original_job.status.value, "retryCount": original_job.retry_count},
                after={"status": failed_job.status.value, "retryCount": failed_job.retry_count},
                detail={
                    "errorCode": error.code,
                    "errorMessage": error.message,
                    "retriable": error.retriable,
                },
                created_at=now,
            )
        )
        return {
            "jobId": failed_job.job_id,
            "status": failed_job.status.value,
            "retryCount": failed_job.retry_count,
        }

    @staticmethod
    def _build_response_digest(payload: dict) -> str | None:
        if not payload:
            return None
        return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    @staticmethod
    def _build_execution_payload(job_payload: dict, approval) -> dict:
        payload = dict(job_payload or {})
        if approval.payload:
            ExecutionService._set_default_if_present(payload, "resourceId", approval.payload.get("resourceId"))
            ExecutionService._set_default_if_present(payload, "txHash", approval.payload.get("txHash"))
            ExecutionService._set_default_if_present(payload, "ownerAddress", approval.payload.get("ownerAddress"))
            ExecutionService._set_default_if_present(payload, "eventKey", approval.payload.get("eventKey"))
            ExecutionService._set_default_if_present(payload, "reviewDecision", approval.payload.get("reviewDecision"))
            ExecutionService._set_default_if_present(payload, "reviewerNote", approval.payload.get("reviewerNote"))
        ExecutionService._set_default_if_present(payload, "resourceId", approval.resource_id)
        ExecutionService._set_default_if_present(payload, "txHash", approval.tx_hash)
        ExecutionService._set_default_if_present(payload, "ownerAddress", approval.owner_address)
        ExecutionService._set_default_if_present(payload, "eventKey", approval.event_key)
        return {key: value for key, value in payload.items() if value is not None}

    @staticmethod
    def _set_default_if_present(payload: dict, key: str, value) -> None:
        if key not in payload and value is not None:
            payload[key] = value

    def _resolve_operator_for_job(self, approval_id: str, queued_by: str | None) -> AdminIdentity:
        candidate_admin_id = queued_by or self._approval_requester_id(approval_id)
        if not candidate_admin_id:
            raise ValueError(f"Execution job for approval {approval_id} has no operator context")
        user = self._store.identity.get_user_by_id(candidate_admin_id)
        if user is None or user.status != AdminUserStatus.ACTIVE:
            raise ValueError(f"Execution operator {candidate_admin_id} is not active")
        bindings = [
            binding
            for binding in self._store.authorization.list_role_bindings(candidate_admin_id)
            if binding.status == RoleBindingStatus.ACTIVE
        ]
        role = bindings[0].role_key if bindings else "platform_ops_admin"
        permissions: set[str] = set()
        for binding in bindings:
            for mapping in self._store.authorization.list_role_permissions(binding.role_key):
                permissions.add(mapping.permission_key)
        return AdminIdentity(
            admin_id=user.admin_id,
            email=user.email,
            display_name=user.display_name,
            role=role,
            permissions=tuple(sorted(permissions)),
        )

    def _approval_requester_id(self, approval_id: str) -> str | None:
        approval = self._store.approval.get_approval(approval_id)
        return approval.requester_id if approval is not None else None