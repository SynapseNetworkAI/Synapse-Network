from datetime import datetime

from src.domain import AdminActionAudit, AdminAuditExport
from src.domain.enums import AuditExportStatus, AuditResultStatus


def _connect(dsn: str):
    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(dsn, row_factory=dict_row)


def _map_action(row: dict) -> AdminActionAudit:
    return AdminActionAudit(
        audit_id=row["audit_id"],
        action_type=row["action_type"],
        result_status=AuditResultStatus(row["result_status"]),
        operator_id=row["operator_id"],
        operator_email=row["operator_email"],
        operator_role=row["operator_role"],
        session_id=row["session_id"],
        approval_id=row["approval_id"],
        job_id=row["job_id"],
        request_id=row["request_id"],
        trace_id=row["trace_id"],
        resource_type=row["resource_type"],
        resource_id=row["resource_id"],
        error_code=row["error_code"],
        client_ip=row["client_ip"],
        user_agent=row["user_agent"],
        before=row["before_json"],
        after=row["after_json"],
        detail=row["detail_json"],
        created_at=row["created_at"],
    )


def _map_export(row: dict) -> AdminAuditExport:
    return AdminAuditExport(
        export_id=row["export_id"],
        export_scope=row["export_scope"],
        operator_id=row["operator_id"],
        filters=row["filters_json"],
        row_count=row["row_count"],
        contains_sensitive_data=row["contains_sensitive_data"],
        status=AuditExportStatus(row["status"]),
        file_ref=row["file_ref"],
        created_at=row["created_at"],
        expires_at=row["expires_at"],
    )


class PostgresAdminAuditRepository:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    @property
    def dsn(self) -> str:
        return self._dsn

    def append_action(self, audit: AdminActionAudit) -> AdminActionAudit:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_action_audit (
                    action_type, operator_id, operator_email, operator_role,
                    session_id, approval_id, job_id, request_id, trace_id,
                    resource_type, resource_id, result_status, error_code,
                    client_ip, user_agent, before_json, after_json, detail_json, created_at
                )
                VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, COALESCE(%s, NOW())
                )
                RETURNING *
                """,
                (
                    audit.action_type,
                    audit.operator_id,
                    audit.operator_email,
                    audit.operator_role,
                    audit.session_id,
                    audit.approval_id,
                    audit.job_id,
                    audit.request_id,
                    audit.trace_id,
                    audit.resource_type,
                    audit.resource_id,
                    audit.result_status.value,
                    audit.error_code,
                    audit.client_ip,
                    audit.user_agent,
                    audit.before,
                    audit.after,
                    audit.detail,
                    audit.created_at,
                ),
            )
            row = cur.fetchone()
        return _map_action(row)

    def list_actions(
        self,
        action_type: str | None = None,
        result_status: str | None = None,
        operator_id: str | None = None,
        approval_id: str | None = None,
        job_id: str | None = None,
        limit: int = 50,
    ) -> list[AdminActionAudit]:
        clauses: list[str] = []
        params: list[object] = []
        if action_type:
            clauses.append("action_type = %s")
            params.append(action_type)
        if result_status:
            clauses.append("result_status = %s")
            params.append(result_status)
        if operator_id:
            clauses.append("operator_id = %s")
            params.append(operator_id)
        if approval_id:
            clauses.append("approval_id = %s")
            params.append(approval_id)
        if job_id:
            clauses.append("job_id = %s")
            params.append(job_id)
        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT * FROM admin_action_audit {where_clause} ORDER BY created_at DESC LIMIT %s",
                params,
            )
            rows = cur.fetchall()
        return [_map_action(row) for row in rows]

    def count_alerts(self) -> int:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS total
                FROM admin_action_audit
                WHERE result_status IN ('failure', 'denied')
                """
            )
            row = cur.fetchone()
        return int(row["total"])

    def latest_activity_at(self) -> datetime | None:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT MAX(created_at) AS latest_created_at FROM admin_action_audit")
            row = cur.fetchone()
        return row["latest_created_at"] if row else None

    def record_export(self, audit_export: AdminAuditExport) -> AdminAuditExport:
        with _connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO admin_audit_exports (
                    export_id, operator_id, export_scope, filters_json,
                    row_count, contains_sensitive_data, status, file_ref, created_at, expires_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()), %s)
                RETURNING *
                """,
                (
                    audit_export.export_id,
                    audit_export.operator_id,
                    audit_export.export_scope,
                    audit_export.filters,
                    audit_export.row_count,
                    audit_export.contains_sensitive_data,
                    audit_export.status.value,
                    audit_export.file_ref,
                    audit_export.created_at,
                    audit_export.expires_at,
                ),
            )
            row = cur.fetchone()
        return _map_export(row)