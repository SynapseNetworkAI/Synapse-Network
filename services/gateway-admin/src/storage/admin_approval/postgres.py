from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal

from psycopg.types.json import Jsonb

from src.domain import (
    AdminApproval,
    AdminApprovalEvent,
    AdminApprovalStep,
    AdminExecutionAttempt,
    AdminExecutionJob,
)
from src.domain.enums import ApprovalDecision, ApprovalLevel, ApprovalStatus, ExecutionAttemptStatus, ExecutionJobStatus, RiskLevel

APPROVAL_TYPE_FILTER = "approval_type = %s"


def _connect(dsn: str):
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(dsn, row_factory=dict_row)


def _map_approval(row: dict) -> AdminApproval:
    return AdminApproval(
        approval_id=row["approval_id"],
        approval_type=row["approval_type"],
        approval_level=ApprovalLevel(row["approval_level"]),
        status=ApprovalStatus(row["status"]),
        requester_id=row["requester_id"],
        current_approver_id=row["current_approver_id"],
        resource_type=row["resource_type"],
        resource_id=row["resource_id"],
        owner_address=row["owner_address"],
        tx_hash=row["tx_hash"],
        event_key=row["event_key"],
        risk_level=RiskLevel(row["risk_level"]),
        amount_usdc=row["amount_usdc"],
        reason=row["reason"],
        payload=row["payload_json"],
        request_id=row["request_id"],
        trace_id=row["trace_id"],
        submitted_at=row["submitted_at"],
        approved_at=row["approved_at"],
        rejected_at=row["rejected_at"],
        executed_at=row["executed_at"],
        expires_at=row["expires_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _map_step(row: dict) -> AdminApprovalStep:
    return AdminApprovalStep(
        step_id=row["step_id"],
        approval_id=row["approval_id"],
        step_no=row["step_no"],
        required_role=row["required_role"],
        required_permission=row["required_permission"],
        approver_id=row["approver_id"],
        decision=ApprovalDecision(row["decision"]) if row["decision"] else None,
        decision_comment=row["decision_comment"],
        assigned_at=row["assigned_at"],
        decided_at=row["decided_at"],
        due_at=row["due_at"],
        metadata=row["metadata_json"],
        created_at=row["created_at"],
    )


def _map_event(row: dict) -> AdminApprovalEvent:
    return AdminApprovalEvent(
        event_id=row["event_id"],
        approval_id=row["approval_id"],
        event_type=row["event_type"],
        operator_id=row["operator_id"],
        operator_role=row["operator_role"],
        from_status=ApprovalStatus(row["from_status"]) if row["from_status"] else None,
        to_status=ApprovalStatus(row["to_status"]) if row["to_status"] else None,
        comment=row["comment"],
        request_id=row["request_id"],
        trace_id=row["trace_id"],
        detail=row["detail_json"],
        created_at=row["created_at"],
    )


def _map_job(row: dict) -> AdminExecutionJob:
    return AdminExecutionJob(
        job_id=row["job_id"],
        approval_id=row["approval_id"],
        execution_type=row["execution_type"],
        target_system=row["target_system"],
        idempotency_key=row["idempotency_key"],
        status=ExecutionJobStatus(row["status"]),
        handler_name=row["handler_name"],
        request_payload=row["request_payload_json"],
        result_payload=row["result_payload_json"],
        error_code=row["error_code"],
        error_message=row["error_message"],
        queued_by=row["queued_by"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        retry_count=row["retry_count"],
        max_retry_count=row["max_retry_count"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _map_attempt(row: dict) -> AdminExecutionAttempt:
    return AdminExecutionAttempt(
        attempt_id=row["attempt_id"],
        job_id=row["job_id"],
        attempt_no=row["attempt_no"],
        status=ExecutionAttemptStatus(row["status"]),
        request_id=row["request_id"],
        trace_id=row["trace_id"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        error_code=row["error_code"],
        error_summary=row["error_summary"],
        response_digest=row["response_digest"],
    )


class PostgresAdminApprovalRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    def list_approvals(
        self,
        status: str | None = None,
        approval_type: str | None = None,
        limit: int = 20,
    ) -> Sequence[AdminApproval]:
        clauses: list[str] = []
        params: list[object] = []
        if status:
            clauses.append("status = %s")
            params.append(status)
        if approval_type:
            clauses.append(APPROVAL_TYPE_FILTER)
            params.append(approval_type)
        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT * FROM admin_approvals {where_clause} ORDER BY created_at DESC LIMIT %s"
        params.append(limit)
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return [_map_approval(row) for row in rows]

    def count_pending_approvals(self) -> int:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) AS total FROM admin_approvals WHERE status <> 'EXECUTED'")
            row = cur.fetchone()
        return int(row["total"])

    def count_approvals(
        self,
        statuses: Sequence[str] | None = None,
        approval_type: str | None = None,
    ) -> int:
        clauses: list[str] = []
        params: list[object] = []
        if statuses:
            clauses.append("status = ANY(%s)")
            params.append(list(statuses))
        if approval_type:
            clauses.append(APPROVAL_TYPE_FILTER)
            params.append(approval_type)
        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM admin_approvals {where_clause}", params)
            row = cur.fetchone()
        return int(row["total"])

    def sum_approval_amount(
        self,
        statuses: Sequence[str] | None = None,
        approval_type: str | None = None,
    ) -> Decimal:
        clauses: list[str] = []
        params: list[object] = []
        if statuses:
            clauses.append("status = ANY(%s)")
            params.append(list(statuses))
        if approval_type:
            clauses.append(APPROVAL_TYPE_FILTER)
            params.append(approval_type)
        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT COALESCE(SUM(amount_usdc), 0) AS total_amount FROM admin_approvals {where_clause}",
                params,
            )
            row = cur.fetchone()
        return row["total_amount"] if row else Decimal("0")

    def get_approval(self, approval_id: str) -> AdminApproval | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_approvals WHERE approval_id = %s", (approval_id,))
            row = cur.fetchone()
        return _map_approval(row) if row else None

    def list_approval_steps(self, approval_id: str) -> Sequence[AdminApprovalStep]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_approval_steps WHERE approval_id = %s ORDER BY step_no ASC",
                (approval_id,),
            )
            rows = cur.fetchall()
        return [_map_step(row) for row in rows]

    def create_approval(self, approval: AdminApproval) -> AdminApproval:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_approvals (
                    approval_id, approval_type, approval_level, status, requester_id,
                    current_approver_id, resource_type, resource_id, owner_address,
                    tx_hash, event_key, risk_level, amount_usdc, reason, payload_json,
                    request_id, trace_id, submitted_at, approved_at, rejected_at,
                    executed_at, expires_at, created_at, updated_at
                )
                VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW())
                )
                """,
                (
                    approval.approval_id,
                    approval.approval_type,
                    approval.approval_level.value,
                    approval.status.value,
                    approval.requester_id,
                    approval.current_approver_id,
                    approval.resource_type,
                    approval.resource_id,
                    approval.owner_address,
                    approval.tx_hash,
                    approval.event_key,
                    approval.risk_level.value,
                    approval.amount_usdc,
                    approval.reason,
                    Jsonb(approval.payload),
                    approval.request_id,
                    approval.trace_id,
                    approval.submitted_at,
                    approval.approved_at,
                    approval.rejected_at,
                    approval.executed_at,
                    approval.expires_at,
                    approval.created_at,
                    approval.updated_at,
                ),
            )
        return approval

    def update_approval(self, approval: AdminApproval) -> AdminApproval:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_approvals
                SET status = %s,
                    current_approver_id = %s,
                    approved_at = %s,
                    rejected_at = %s,
                    executed_at = %s,
                    expires_at = %s,
                    updated_at = COALESCE(%s, NOW())
                WHERE approval_id = %s
                """,
                (
                    approval.status.value,
                    approval.current_approver_id,
                    approval.approved_at,
                    approval.rejected_at,
                    approval.executed_at,
                    approval.expires_at,
                    approval.updated_at,
                    approval.approval_id,
                ),
            )
        return approval

    def upsert_approval_step(self, step: AdminApprovalStep) -> AdminApprovalStep:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_approval_steps (
                    step_id, approval_id, step_no, required_role, required_permission,
                    approver_id, decision, decision_comment, assigned_at, decided_at,
                    due_at, metadata_json, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()))
                ON CONFLICT (approval_id, step_no) DO UPDATE
                SET step_id = EXCLUDED.step_id,
                    required_role = EXCLUDED.required_role,
                    required_permission = EXCLUDED.required_permission,
                    approver_id = EXCLUDED.approver_id,
                    decision = EXCLUDED.decision,
                    decision_comment = EXCLUDED.decision_comment,
                    assigned_at = EXCLUDED.assigned_at,
                    decided_at = EXCLUDED.decided_at,
                    due_at = EXCLUDED.due_at,
                    metadata_json = EXCLUDED.metadata_json
                """,
                (
                    step.step_id,
                    step.approval_id,
                    step.step_no,
                    step.required_role,
                    step.required_permission,
                    step.approver_id,
                    step.decision.value if step.decision else None,
                    step.decision_comment,
                    step.assigned_at,
                    step.decided_at,
                    step.due_at,
                    Jsonb(step.metadata),
                    step.created_at,
                ),
            )
        return step

    def append_approval_event(self, event: AdminApprovalEvent) -> AdminApprovalEvent:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_approval_events (
                    approval_id, event_type, operator_id, operator_role,
                    from_status, to_status, comment, request_id, trace_id,
                    detail_json, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()))
                RETURNING *
                """,
                (
                    event.approval_id,
                    event.event_type,
                    event.operator_id,
                    event.operator_role,
                    event.from_status.value if event.from_status else None,
                    event.to_status.value if event.to_status else None,
                    event.comment,
                    event.request_id,
                    event.trace_id,
                    Jsonb(event.detail),
                    event.created_at,
                ),
            )
            row = cur.fetchone()
        return _map_event(row)

    def enqueue_execution_job(self, job: AdminExecutionJob) -> AdminExecutionJob:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_execution_jobs (
                    job_id, approval_id, execution_type, target_system, status,
                    idempotency_key, handler_name, request_payload_json, result_payload_json,
                    error_code, error_message, queued_by, started_at, finished_at,
                    retry_count, max_retry_count, created_at, updated_at
                )
                VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, COALESCE(%s, NOW()), COALESCE(%s, NOW())
                )
                RETURNING *
                """,
                (
                    job.job_id,
                    job.approval_id,
                    job.execution_type,
                    job.target_system,
                    job.status.value,
                    job.idempotency_key,
                    job.handler_name,
                    Jsonb(job.request_payload),
                    Jsonb(job.result_payload),
                    job.error_code,
                    job.error_message,
                    job.queued_by,
                    job.started_at,
                    job.finished_at,
                    job.retry_count,
                    job.max_retry_count,
                    job.created_at,
                    job.updated_at,
                ),
            )
            row = cur.fetchone()
        return _map_job(row)

    def list_execution_jobs(
        self,
        status: str | None = None,
        target_system: str | None = None,
        approval_id: str | None = None,
        limit: int = 20,
    ) -> Sequence[AdminExecutionJob]:
        clauses: list[str] = []
        params: list[object] = []
        if status:
            clauses.append("status = %s")
            params.append(status)
        if target_system:
            clauses.append("target_system = %s")
            params.append(target_system)
        if approval_id:
            clauses.append("approval_id = %s")
            params.append(approval_id)
        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT * FROM admin_execution_jobs {where_clause} ORDER BY created_at DESC LIMIT %s",
                params,
            )
            rows = cur.fetchall()
        return [_map_job(row) for row in rows]

    def get_execution_job(self, job_id: str) -> AdminExecutionJob | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT * FROM admin_execution_jobs WHERE job_id = %s", (job_id,))
            row = cur.fetchone()
        return _map_job(row) if row else None

    def claim_execution_job(
        self,
        job_id: str,
        from_statuses: Sequence[str],
        claimed_job: AdminExecutionJob,
    ) -> AdminExecutionJob | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_execution_jobs
                SET status = %s,
                    handler_name = %s,
                    request_payload_json = %s,
                    result_payload_json = %s,
                    error_code = %s,
                    error_message = %s,
                    queued_by = %s,
                    started_at = %s,
                    finished_at = %s,
                    retry_count = %s,
                    max_retry_count = %s,
                    updated_at = COALESCE(%s, NOW())
                WHERE job_id = %s
                  AND status = ANY(%s)
                RETURNING *
                """,
                (
                    claimed_job.status.value,
                    claimed_job.handler_name,
                    Jsonb(claimed_job.request_payload),
                    Jsonb(claimed_job.result_payload),
                    claimed_job.error_code,
                    claimed_job.error_message,
                    claimed_job.queued_by,
                    claimed_job.started_at,
                    claimed_job.finished_at,
                    claimed_job.retry_count,
                    claimed_job.max_retry_count,
                    claimed_job.updated_at,
                    job_id,
                    list(from_statuses),
                ),
            )
            row = cur.fetchone()
        return _map_job(row) if row else None

    def update_execution_job(self, job: AdminExecutionJob) -> AdminExecutionJob:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_execution_jobs
                SET status = %s,
                    handler_name = %s,
                    request_payload_json = %s,
                    result_payload_json = %s,
                    error_code = %s,
                    error_message = %s,
                    queued_by = %s,
                    started_at = %s,
                    finished_at = %s,
                    retry_count = %s,
                    max_retry_count = %s,
                    updated_at = COALESCE(%s, NOW())
                WHERE job_id = %s
                RETURNING *
                """,
                (
                    job.status.value,
                    job.handler_name,
                    Jsonb(job.request_payload),
                    Jsonb(job.result_payload),
                    job.error_code,
                    job.error_message,
                    job.queued_by,
                    job.started_at,
                    job.finished_at,
                    job.retry_count,
                    job.max_retry_count,
                    job.updated_at,
                    job.job_id,
                ),
            )
            row = cur.fetchone()
        return _map_job(row)

    def list_execution_attempts(self, job_id: str) -> Sequence[AdminExecutionAttempt]:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM admin_execution_attempts WHERE job_id = %s ORDER BY attempt_no DESC",
                (job_id,),
            )
            rows = cur.fetchall()
        return [_map_attempt(row) for row in rows]

    def append_execution_attempt(self, attempt: AdminExecutionAttempt) -> AdminExecutionAttempt:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_execution_attempts (
                    job_id, attempt_no, status, request_id, trace_id,
                    started_at, finished_at, error_code, error_summary, response_digest
                )
                VALUES (%s, %s, %s, %s, %s, COALESCE(%s, NOW()), %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    attempt.job_id,
                    attempt.attempt_no,
                    attempt.status.value,
                    attempt.request_id,
                    attempt.trace_id,
                    attempt.started_at,
                    attempt.finished_at,
                    attempt.error_code,
                    attempt.error_summary,
                    attempt.response_digest,
                ),
            )
            row = cur.fetchone()
        return _map_attempt(row)

    def update_execution_attempt(self, attempt: AdminExecutionAttempt) -> AdminExecutionAttempt:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE admin_execution_attempts
                SET status = %s,
                    request_id = %s,
                    trace_id = %s,
                    started_at = %s,
                    finished_at = %s,
                    error_code = %s,
                    error_summary = %s,
                    response_digest = %s
                WHERE job_id = %s AND attempt_no = %s
                RETURNING *
                """,
                (
                    attempt.status.value,
                    attempt.request_id,
                    attempt.trace_id,
                    attempt.started_at,
                    attempt.finished_at,
                    attempt.error_code,
                    attempt.error_summary,
                    attempt.response_digest,
                    attempt.job_id,
                    attempt.attempt_no,
                ),
            )
            row = cur.fetchone()
        return _map_attempt(row)

    def latest_activity_at(self) -> datetime | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT GREATEST(
                    COALESCE((SELECT MAX(updated_at) FROM admin_approvals), TIMESTAMPTZ 'epoch'),
                    COALESCE((SELECT MAX(updated_at) FROM admin_execution_jobs), TIMESTAMPTZ 'epoch')
                ) AS latest_activity_at
                """
            )
            row = cur.fetchone()
        return row["latest_activity_at"] if row else None