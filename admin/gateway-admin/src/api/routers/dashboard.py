from typing import Annotated

from fastapi import APIRouter, Depends

from src.api.deps import get_dashboard_service, get_request_id, require_permission
from src.api.schemas.common import ApiResponse
from src.api.schemas.dashboard import DashboardOverview, HighlightCard, OverviewMetrics, SystemStatus
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
