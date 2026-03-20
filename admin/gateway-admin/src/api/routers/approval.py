from typing import Annotated

from fastapi import APIRouter, Depends, Query

from src.api.deps import get_approval_service, get_request_id, require_high_risk_permission, require_permission
from src.api.schemas.approval import (
    ApprovalDecisionRequest,
    ApprovalDecisionResult,
    ApprovalListResponse,
    ApprovalSummary,
    CreateApprovalRequest,
)
from src.api.schemas.common import ApiResponse
from src.core.errors import ResourceNotFoundError
from src.services.approval.service import ApprovalService
from src.services.auth.service import AdminIdentity

router = APIRouter(prefix="/api/admin/v1/approvals", tags=["admin-approval"])


@router.get("", response_model=ApiResponse)
def list_approvals(
    admin: Annotated[AdminIdentity, Depends(require_permission("approval:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    approval_service: Annotated[ApprovalService, Depends(get_approval_service)],
    status: str | None = None,
    approval_type: Annotated[str | None, Query(alias="approvalType")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    _ = admin
    payload = approval_service.list_items(status=status, approval_type=approval_type, limit=limit)
    return ApiResponse(
        data=ApprovalListResponse(
            items=[ApprovalSummary(**item) for item in payload["items"]],
            next_cursor=payload["nextCursor"],
        ),
        request_id=request_id,
    )


@router.post("", response_model=ApiResponse)
def create_approval(
    payload: CreateApprovalRequest,
    admin: Annotated[AdminIdentity, Depends(require_permission("approval:submit"))],
    request_id: Annotated[str, Depends(get_request_id)],
    approval_service: Annotated[ApprovalService, Depends(get_approval_service)],
):
    created = approval_service.create_item(payload.model_dump(by_alias=True), requester=admin)
    return ApiResponse(data=created, request_id=request_id)


@router.post(
    "/{approval_id}/decision",
    response_model=ApiResponse,
    responses={404: {"description": "Approval not found"}},
)
def decide_approval(
    approval_id: str,
    payload: ApprovalDecisionRequest,
    admin: Annotated[AdminIdentity, Depends(require_high_risk_permission("approval:decide"))],
    request_id: Annotated[str, Depends(get_request_id)],
    approval_service: Annotated[ApprovalService, Depends(get_approval_service)],
):
    _ = admin
    try:
        result = approval_service.decide(
            approval_id=approval_id,
            decision=payload.decision,
            reviewer=admin,
            comment=payload.comment,
        )
    except ValueError as exc:
        raise ResourceNotFoundError(str(exc)) from exc
    return ApiResponse(data=ApprovalDecisionResult(**result), request_id=request_id)
