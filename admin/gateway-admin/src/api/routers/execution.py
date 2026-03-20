from typing import Annotated

from fastapi import APIRouter, Depends, Query

from src.api.deps import get_execution_service, get_request_id, require_high_risk_permission, require_permission
from src.api.schemas.common import ApiResponse
from src.api.schemas.execution import ExecutionJobItem, ExecutionJobListResponse, ExecutionRetryResult
from src.core.errors import ResourceNotFoundError
from src.services.auth.service import AdminIdentity
from src.services.execution.service import ExecutionService

router = APIRouter(prefix="/api/admin/v1/execution-jobs", tags=["admin-execution"])


@router.get("", response_model=ApiResponse)
def list_execution_jobs(
    admin: Annotated[AdminIdentity, Depends(require_permission("execution:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    execution_service: Annotated[ExecutionService, Depends(get_execution_service)],
    status: str | None = None,
    target_system: Annotated[str | None, Query(alias="targetSystem")] = None,
    approval_id: Annotated[str | None, Query(alias="approvalId")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    _ = admin
    payload = execution_service.list_jobs(
        status=status,
        target_system=target_system,
        approval_id=approval_id,
        limit=limit,
    )
    return ApiResponse(
        data=ExecutionJobListResponse(
            items=[ExecutionJobItem(**item) for item in payload["items"]],
            next_cursor=payload["nextCursor"],
        ),
        request_id=request_id,
    )


@router.post("/{job_id}/retry", response_model=ApiResponse, responses={404: {"description": "Execution job not found"}})
def retry_execution_job(
    job_id: str,
    admin: Annotated[AdminIdentity, Depends(require_high_risk_permission("execution:retry"))],
    request_id: Annotated[str, Depends(get_request_id)],
    execution_service: Annotated[ExecutionService, Depends(get_execution_service)],
):
    try:
        result = execution_service.retry_job(job_id=job_id, operator=admin)
    except ValueError as exc:
        raise ResourceNotFoundError(str(exc)) from exc
    return ApiResponse(data=ExecutionRetryResult(**result), request_id=request_id)