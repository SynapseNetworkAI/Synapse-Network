from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from src.domain.enums import (
    ApprovalDecision,
    ApprovalLevel,
    ApprovalStatus,
    ExecutionAttemptStatus,
    ExecutionJobStatus,
    RiskLevel,
)


@dataclass(slots=True, frozen=True)
class AdminApproval:
    approval_id: str
    approval_type: str
    approval_level: ApprovalLevel
    status: ApprovalStatus
    requester_id: str
    resource_type: str
    resource_id: str
    reason: str
    current_approver_id: str | None = None
    owner_address: str | None = None
    tx_hash: str | None = None
    event_key: str | None = None
    risk_level: RiskLevel = RiskLevel.GREEN
    amount_usdc: Decimal = Decimal("0")
    payload: dict[str, Any] = field(default_factory=dict)
    request_id: str | None = None
    trace_id: str | None = None
    submitted_at: datetime | None = None
    approved_at: datetime | None = None
    rejected_at: datetime | None = None
    executed_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminApprovalStep:
    step_id: str
    approval_id: str
    step_no: int
    required_role: str | None = None
    required_permission: str | None = None
    approver_id: str | None = None
    decision: ApprovalDecision | None = None
    decision_comment: str | None = None
    assigned_at: datetime | None = None
    decided_at: datetime | None = None
    due_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminApprovalEvent:
    approval_id: str
    event_type: str
    event_id: int | None = None
    operator_id: str | None = None
    operator_role: str | None = None
    from_status: ApprovalStatus | None = None
    to_status: ApprovalStatus | None = None
    comment: str | None = None
    request_id: str | None = None
    trace_id: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminExecutionJob:
    job_id: str
    approval_id: str
    execution_type: str
    target_system: str
    idempotency_key: str
    status: ExecutionJobStatus = ExecutionJobStatus.PENDING
    handler_name: str | None = None
    request_payload: dict[str, Any] = field(default_factory=dict)
    result_payload: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None
    queued_by: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    retry_count: int = 0
    max_retry_count: int = 3
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminExecutionAttempt:
    job_id: str
    attempt_no: int
    status: ExecutionAttemptStatus
    attempt_id: int | None = None
    request_id: str | None = None
    trace_id: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error_code: str | None = None
    error_summary: str | None = None
    response_digest: str | None = None