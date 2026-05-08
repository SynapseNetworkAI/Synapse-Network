from typing import Annotated

from fastapi import APIRouter, Depends, Query

from src.api.deps import get_dashboard_service, get_request_id, require_permission
from src.api.schemas.common import ApiResponse
from src.api.schemas.dashboard import (
    ActivityTrendPoint,
    ActivityTrendSeries,
    AnalyticsConsumerFunnel,
    AnalyticsDataQuality,
    AnalyticsInvocationRevenue,
    AnalyticsMoneyFlow,
    AnalyticsOverview,
    AnalyticsProviderRevenue,
    AnalyticsRiskHealth,
    DashboardOverview,
    FinanceOverview,
    HighlightCard,
    OperationsOverview,
    OverviewMetrics,
    ReconciliationDetail,
    ReconciliationDrilldownResult,
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
    return ApiResponse(data=payload, request_id=request_id)


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


@router.get("/reconciliation-detail", response_model=ApiResponse)
def get_reconciliation_detail(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
):
    _ = admin
    payload = dashboard_service.get_reconciliation_detail()
    return ApiResponse(data=ReconciliationDetail(**payload), request_id=request_id)


@router.get("/reconciliation-drilldown", response_model=ApiResponse)
def get_reconciliation_drilldown(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
    owner_address: Annotated[str | None, Query(alias="ownerAddress")] = None,
    locator_request_id: Annotated[str | None, Query(alias="requestId")] = None,
    tx_hash: Annotated[str | None, Query(alias="txHash")] = None,
):
    _ = admin
    payload = dashboard_service.get_reconciliation_drilldown(
        owner_address=owner_address,
        request_id=locator_request_id,
        tx_hash=tx_hash,
    )
    return ApiResponse(data=ReconciliationDrilldownResult(**payload), request_id=request_id)


@router.get("/diagnostics", response_model=ApiResponse)
def get_diagnostics(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
):
    _ = admin
    payload = dashboard_service.get_diagnostics()
    return ApiResponse(data=payload, request_id=request_id)


@router.get("/analytics/overview", response_model=ApiResponse)
def get_analytics_overview(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
    window: Annotated[str, Query(pattern="^(24h|7d|30d)$")] = "24h",
):
    _ = admin
    return ApiResponse(data=AnalyticsOverview(**dashboard_service.get_analytics_overview(window)), request_id=request_id)


@router.get("/analytics/consumer-funnel", response_model=ApiResponse)
def get_analytics_consumer_funnel(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
    window: Annotated[str, Query(pattern="^(24h|7d|30d)$")] = "24h",
):
    _ = admin
    return ApiResponse(data=AnalyticsConsumerFunnel(**dashboard_service.get_analytics_consumer_funnel(window)), request_id=request_id)


@router.get("/analytics/invocation-revenue", response_model=ApiResponse)
def get_analytics_invocation_revenue(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
    window: Annotated[str, Query(pattern="^(24h|7d|30d)$")] = "24h",
):
    _ = admin
    return ApiResponse(data=AnalyticsInvocationRevenue(**dashboard_service.get_analytics_invocation_revenue(window)), request_id=request_id)


@router.get("/analytics/provider-revenue", response_model=ApiResponse)
def get_analytics_provider_revenue(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
    window: Annotated[str, Query(pattern="^(24h|7d|30d)$")] = "24h",
):
    _ = admin
    return ApiResponse(data=AnalyticsProviderRevenue(**dashboard_service.get_analytics_provider_revenue(window)), request_id=request_id)


@router.get("/analytics/money-flow", response_model=ApiResponse)
def get_analytics_money_flow(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
    window: Annotated[str, Query(pattern="^(24h|7d|30d)$")] = "24h",
):
    _ = admin
    return ApiResponse(data=AnalyticsMoneyFlow(**dashboard_service.get_analytics_money_flow(window)), request_id=request_id)


@router.get("/analytics/risk-health", response_model=ApiResponse)
def get_analytics_risk_health(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
    window: Annotated[str, Query(pattern="^(24h|7d|30d)$")] = "24h",
):
    _ = admin
    return ApiResponse(data=AnalyticsRiskHealth(**dashboard_service.get_analytics_risk_health(window)), request_id=request_id)


@router.get("/analytics/data-quality", response_model=ApiResponse)
def get_analytics_data_quality(
    admin: Annotated[AdminIdentity, Depends(require_permission("dashboard:read"))],
    request_id: Annotated[str, Depends(get_request_id)],
    dashboard_service: Annotated[DashboardService, Depends(get_dashboard_service)],
    window: Annotated[str, Query(pattern="^(1h|24h)$")] = "24h",
):
    _ = admin
    return ApiResponse(data=AnalyticsDataQuality(**dashboard_service.get_analytics_data_quality(window)), request_id=request_id)
