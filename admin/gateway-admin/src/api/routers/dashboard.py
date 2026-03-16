from typing import Annotated

from fastapi import APIRouter, Depends

from src.api.deps import get_dashboard_service, get_request_id, require_permission
from src.api.schemas.common import ApiResponse
from src.api.schemas.dashboard import (
    ActivityTrendPoint,
    ActivityTrendSeries,
    DashboardOverview,
    FinanceOverview,
    HighlightCard,
    OperationsOverview,
    OverviewMetrics,
    SystemStatus,
)
from src.services.auth.service import AdminIdentity
from src.services.dashboard.service import DashboardService

router = APIRouter(prefix="/api/admin/v1/dashboard", tags=["admin-dashboard"])


@router.get("/overview", response_model=ApiResponse)
def get_overview(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
):
    _ = admin
    payload = dashboard_service.get_overview()
    return ApiResponse(
        data=DashboardOverview(
            metrics=OverviewMetrics(**payload["metrics"]),
            highlights=[HighlightCard(**item) for item in payload["highlights"]],
        ),
        request_id=request_id,
    )


@router.get("/system-status", response_model=ApiResponse)
def get_system_status(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
):
    _ = admin
    payload = dashboard_service.get_system_status()
    return ApiResponse(data=SystemStatus(**payload), request_id=request_id)


@router.get("/finance-overview", response_model=ApiResponse)
def get_finance_overview(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
):
    _ = admin
    payload = dashboard_service.get_finance_overview()
    return ApiResponse(data=FinanceOverview(**payload), request_id=request_id)


@router.get("/activity-trends", response_model=ApiResponse)
def get_activity_trends(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
):
    _ = admin
    payload = dashboard_service.get_activity_trends()
    return ApiResponse(
        data=ActivityTrendSeries(
            points=[ActivityTrendPoint(**item) for item in payload["points"]],
        ),
        request_id=request_id,
    )


@router.get("/operations-overview", response_model=ApiResponse)
def get_operations_overview(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
):
    _ = admin
    payload = dashboard_service.get_operations_overview()
    return ApiResponse(data=OperationsOverview(**payload), request_id=request_id)
