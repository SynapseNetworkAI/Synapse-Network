from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from src.api.deps import (
    get_provider_withdraw_review_service,
    get_request_id,
    require_high_risk_permission,
    require_permission,
)
from src.api.schemas.common import ApiResponse
from src.api.schemas.provider_withdraw_review import (
    ProviderWithdrawReviewDecisionRequest,
    ProviderWithdrawReviewListResponse,
    ProviderWithdrawReviewSummary,
)
from src.services.auth.service import AdminIdentity
from src.services.finance_admin import ProviderWithdrawReviewService, WithdrawReviewHistoryQuery

router = APIRouter(prefix="/api/admin/v1/withdrawal-reviews", tags=["admin-provider-withdraw-reviews"])


def _history_query_from_request(request: Request, limit: int) -> WithdrawReviewHistoryQuery:
    params = request.query_params
    return WithdrawReviewHistoryQuery(
        limit=limit,
        query=params.get("query"),
        reviewer=params.get("reviewer"),
        current_status=params.get("currentStatus"),
        review_decision=params.get("reviewDecision"),
        reviewed_from=params.get("reviewedFrom"),
        reviewed_to=params.get("reviewedTo"),
        cursor=params.get("cursor"),
    )


@router.get("", response_model=ApiResponse)
def list_provider_withdraw_reviews(
    admin: Annotated[AdminIdentity, Depends(require_permission("approval:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    review_service: Annotated[ProviderWithdrawReviewService, Depends(get_provider_withdraw_review_service)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    _ = admin
    payload = review_service.list_pending_items(limit=limit)
    return ApiResponse(
        data=ProviderWithdrawReviewListResponse(
            items=[ProviderWithdrawReviewSummary(**item) for item in payload["items"]],
            next_cursor=payload["nextCursor"],
        ),
        request_id=request_id,
    )


@router.get("/history", response_model=ApiResponse)
def list_provider_withdraw_review_history(
    admin: Annotated[AdminIdentity, Depends(require_permission("approval:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    review_service: Annotated[ProviderWithdrawReviewService, Depends(get_provider_withdraw_review_service)],
    request: Request,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    _ = admin
    payload = review_service.list_history_items(_history_query_from_request(request, limit))
    return ApiResponse(data=payload, request_id=request_id)


@router.post("/{withdrawal_id}/decision", response_model=ApiResponse)
def decide_provider_withdraw_review(
    withdrawal_id: str,
    payload: ProviderWithdrawReviewDecisionRequest,
    admin: Annotated[AdminIdentity, Depends(require_high_risk_permission("approval:decide"))],
    request_id: Annotated[str, Depends(get_request_id)],
    review_service: Annotated[ProviderWithdrawReviewService, Depends(get_provider_withdraw_review_service)],
):
    result = review_service.decide_review(
        withdrawal_id,
        decision=payload.decision,
        reviewer=admin,
        note=payload.note,
        request_id=request_id,
    )
    return ApiResponse(data=result, request_id=request_id)
