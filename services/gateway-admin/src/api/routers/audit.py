from typing import Annotated

from fastapi import APIRouter, Depends, Query

from src.api.deps import get_audit_service, get_request_id, require_permission
from src.api.schemas.audit import AuditActionItem, AuditActionListResponse
from src.api.schemas.common import ApiResponse
from src.services.audit.service import AuditService
from src.services.auth.service import AdminIdentity

router = APIRouter(prefix="/api/admin/v1/audit", tags=["admin-audit"])


@router.get("/actions", response_model=ApiResponse)
def list_audit_actions(
    admin: Annotated[AdminIdentity, Depends(require_permission("audit:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    audit_service: Annotated[AuditService, Depends(get_audit_service)],
    action_type: Annotated[str | None, Query(alias="actionType")] = None,
    result_status: Annotated[str | None, Query(alias="resultStatus")] = None,
    operator_id: Annotated[str | None, Query(alias="operatorId")] = None,
    approval_id: Annotated[str | None, Query(alias="approvalId")] = None,
    job_id: Annotated[str | None, Query(alias="jobId")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    _ = admin
    payload = audit_service.list_actions(
        action_type=action_type,
        result_status=result_status,
        operator_id=operator_id,
        approval_id=approval_id,
        job_id=job_id,
        limit=limit,
    )
    return ApiResponse(
        data=AuditActionListResponse(
            items=[AuditActionItem(**item) for item in payload["items"]],
            next_cursor=payload["nextCursor"],
        ),
        request_id=request_id,
    )