from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from src.domain.enums import AuditExportStatus, AuditResultStatus


@dataclass(slots=True, frozen=True)
class AdminActionAudit:
    action_type: str
    result_status: AuditResultStatus
    audit_id: int | None = None
    operator_id: str | None = None
    operator_email: str | None = None
    operator_role: str | None = None
    session_id: str | None = None
    approval_id: str | None = None
    job_id: str | None = None
    request_id: str | None = None
    trace_id: str | None = None
    resource_type: str | None = None
    resource_id: str | None = None
    error_code: str | None = None
    client_ip: str | None = None
    user_agent: str | None = None
    before: dict[str, Any] = field(default_factory=dict)
    after: dict[str, Any] = field(default_factory=dict)
    detail: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class AdminAuditExport:
    export_id: str
    export_scope: str
    operator_id: str | None = None
    filters: dict[str, Any] = field(default_factory=dict)
    row_count: int = 0
    contains_sensitive_data: bool = False
    status: AuditExportStatus = AuditExportStatus.QUEUED
    file_ref: str | None = None
    created_at: datetime | None = None
    expires_at: datetime | None = None