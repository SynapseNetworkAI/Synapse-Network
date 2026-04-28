from __future__ import annotations

# ruff: noqa: B008, B904, TRY003

from fastapi import APIRouter, Depends, HTTPException, Query, Header, Request
from typing import Optional, Any, List, Annotated, Union
from src.api.deps import get_registry_service
from src.api.schemas.pydantic_models import AgentDiscoverySearchRequest
from src.services.provider.registry_service import (
    RegistryService,
    SERVICE_ALREADY_DELETED,
    SERVICE_DELETE_ACTIVE_CONFLICT,
)
from src.services.platform import credential_service
from src.services.provider.manifest_parser_service import parse_manifest_from_curl
from src.core.config import settings
from src.services.platform.internal_auth import (
    InternalServicePrincipal,
    require_internal_scope,
)
from src.domain.service_contract import AgentDiscoveryQueryRecord
from pydantic import BaseModel, Field, model_validator
from src.utils.logging_utils import workflow_logger, resolve_request_id

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]

REGISTRATION_GUIDE_FIELDS: List[dict[str, Any]] = [
    {
        "key": "serviceName",
        "required": True,
        "title": "Service Name",
        "description": "Human-readable service title shown in marketplace and provider console.",
        "howToConfigure": "Use a concise product-grade name, 4-80 chars.",
        "platformUse": "Display, search ranking, and trust cues.",
        "example": "DeepSeek Market Analysis",
    },
    {
        "key": "agentToolName",
        "required": True,
        "title": "Agent Tool Name",
        "description": "Machine-facing stable key for AI callers.",
        "howToConfigure": "Use [a-z0-9_-], 3-64 chars.",
        "platformUse": "Routing identity and request tracing.",
        "example": "get_market_analysis",
    },
    {
        "key": "invoke.targets",
        "required": True,
        "title": "Cluster Targets",
        "description": "Active-active upstream endpoint list.",
        "howToConfigure": "Provide one full URL per node; first target is primary.",
        "platformUse": "Weighted traffic routing and failover candidates.",
    },
    {
        "key": "healthCheck.path",
        "required": True,
        "title": "Health Check Path",
        "description": "Shared probe path for every target origin.",
        "howToConfigure": "Use path only and always start with '/'.",
        "platformUse": "Gateway computes probe URL as origin + path.",
        "example": "/health",
    },
    {
        "key": "constraints",
        "required": False,
        "title": "Limits & SLA",
        "description": "Timeout, size and QPS guardrails.",
        "howToConfigure": "Set values from load test and production capacity.",
        "platformUse": "Admission control, circuit safety and scheduler hints.",
    },
]


class ServicePricing(BaseModel):
    currency: str = "USD"
    amount: str


class HealthCheckSpec(BaseModel):
    path: str = "/health"
    method: str = "GET"
    intervalSec: int = 30
    timeoutMs: int = 3000
    successCodes: List[int] = Field(default_factory=lambda: [200])
    healthyThreshold: int = 2
    unhealthyThreshold: int = 3


class ConstraintsSpec(BaseModel):
    timeoutMs: int = Field(
        default=settings.gateway_default_timeout_ms,
        ge=settings.gateway_min_timeout_ms,
        le=settings.gateway_llm_max_timeout_ms,
    )
    maxResponseBytes: int = Field(
        default=settings.gateway_default_response_bytes,
        ge=settings.gateway_min_response_bytes,
        le=settings.gateway_max_response_bytes,
    )
    maxRequestBytes: int = Field(
        default=settings.gateway_default_request_bytes,
        ge=settings.gateway_min_request_bytes,
        le=settings.gateway_max_request_bytes,
    )
    maxQps: int = Field(
        default=settings.gateway_default_service_qps,
        ge=settings.gateway_min_service_qps,
        le=settings.gateway_max_service_qps,
    )
    maxConcurrency: Optional[int] = Field(
        default=None,
        ge=1,
        le=settings.downstream_adaptive_max_concurrency,
    )


class RetryPolicySpec(BaseModel):
    maxAttempts: int = 2
    backoffMs: int = 200
    retryOnStatus: List[int] = Field(default_factory=lambda: [429, 500, 502, 503, 504])


class ForwardingSpec(BaseModel):
    requestIdHeader: str = "X-Synapse-Request-Id"
    passThroughHeaders: List[str] = Field(default_factory=list)
    injectHeaders: dict[str, str] = Field(default_factory=dict)
    retryPolicy: RetryPolicySpec = Field(default_factory=RetryPolicySpec)


class MeteringSpec(BaseModel):
    billingUnit: str = "per_call"
    billOnError: bool = False
    billableStatusClasses: List[int] = Field(default_factory=lambda: [2])
    requestIdRequired: bool = True
    responseSizeMetering: bool = True


class InvokeMethod(BaseModel):
    class InvokeTarget(BaseModel):
        url: str
        weight: int = 100
        region: Optional[str] = None

    method: str
    targets: List[InvokeTarget] = Field(min_length=1)
    timeoutMs: int = settings.gateway_default_timeout_ms
    request: dict
    response: dict
    headersTemplate: dict[str, str] = Field(default_factory=dict)
    examples: List[dict[str, Any]] = Field(default_factory=list)


class ProviderProfileSpec(BaseModel):
    displayName: str = Field(..., min_length=1, max_length=80)


class PayoutAccountSpec(BaseModel):
    payoutAddress: str = Field(..., min_length=1, max_length=128)
    chainId: int = Field(..., ge=1)
    settlementCurrency: str = Field(default="USDC", min_length=1, max_length=16)
    status: str = Field(default="active")


class GovernanceSpec(BaseModel):
    termsAccepted: bool = False
    riskAcknowledged: bool = False
    note: Optional[str] = Field(default=None, max_length=500)


class RegisterServiceRequest(BaseModel):
    serviceId: Optional[str] = None
    agentToolName: Optional[str] = None
    serviceName: str
    role: str = "Provider"
    address: Optional[str] = None
    pricing: Union[ServicePricing, str]
    summary: str = ""
    tags: List[str] = Field(default_factory=list)
    status: str = "active"
    auth: dict[str, Any] = Field(default_factory=dict)
    providerProfile: Optional[ProviderProfileSpec] = None
    payoutAccount: Optional[PayoutAccountSpec] = None
    governance: Optional[GovernanceSpec] = None
    healthCheck: HealthCheckSpec = Field(default_factory=HealthCheckSpec)
    constraints: ConstraintsSpec = Field(default_factory=ConstraintsSpec)
    forwarding: ForwardingSpec = Field(default_factory=ForwardingSpec)
    metering: MeteringSpec = Field(default_factory=MeteringSpec)
    invoke: InvokeMethod
    isActive: bool = True

    @model_validator(mode="before")
    @classmethod
    def bind_service_id_and_timeout_defaults(cls, raw: Any) -> Any:
        if not isinstance(raw, dict):
            return raw

        payload = dict(raw)
        service_id = str(payload.get("serviceId") or "").strip()
        agent_tool_name = str(payload.get("agentToolName") or "").strip()
        if not service_id and agent_tool_name:
            payload["serviceId"] = agent_tool_name
        elif service_id and agent_tool_name and service_id != agent_tool_name:
            raise ValueError("serviceId must match agentToolName when both are provided")
        pricing = payload.get("pricing")
        pricing_model = (
            str(pricing.get("priceModel") or "").strip().lower()
            if isinstance(pricing, dict)
            else ""
        )
        price_model = str(payload.get("priceModel") or pricing_model or "fixed").strip().lower()
        service_kind = str(payload.get("serviceKind") or "api").strip().lower()
        if service_kind == "llm" or price_model == "token_metered":
            constraints = (
                dict(payload.get("constraints"))
                if isinstance(payload.get("constraints"), dict)
                else {}
            )
            if "timeoutMs" not in constraints and "timeout_ms" not in constraints:
                constraints["timeoutMs"] = settings.gateway_llm_default_timeout_ms
            payload["constraints"] = constraints
            invoke = dict(payload.get("invoke")) if isinstance(payload.get("invoke"), dict) else None
            if invoke is not None and "timeoutMs" not in invoke and "timeout_ms" not in invoke:
                invoke["timeoutMs"] = constraints["timeoutMs"]
                payload["invoke"] = invoke
        return payload


class ParseCurlRequest(BaseModel):
    curlCommand: str
    model: Optional[str] = None
    currentManifest: Optional[dict[str, Any]] = None


class AdminProviderServiceLifecycleRequest(BaseModel):
    action: str = Field(..., min_length=1, max_length=32)
    note: Optional[str] = Field(default=None, max_length=500)


class AdminProviderServiceDeleteRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


@router.get("/v1/services/discover")
async def discover_services(
    request: Request,
    intent: Optional[str] = Query(
        None, description="Search keyword for service discovery"
    ),
    sort_by: str = Query(
        "best_match", alias="sortBy", description="Sort field for console discovery list"
    ),
    sort_order: str = Query(
        "desc", alias="sortOrder", description="Sort order for console discovery list"
    ),
    service: RegistryService = Depends(get_registry_service),
):
    """
    Public endpoint for owner-scoped AI agents to discover available services.
    Returns only active services.
    """
    request_id = resolve_request_id(request.headers.get("X-Request-Id"), "disc")
    log = workflow_logger(
        "discovery",
        request_id=request_id,
        path="/api/v1/services/discover",
        intent=intent or "",
        sort_by=sort_by,
        sort_order=sort_order,
    )
    log.info("discovery.start")
    gateway_url = f"{str(request.base_url).rstrip('/')}/api/v1/gateway/generate"
    try:
        public_services = await service.discover_services(
            intent,
            public_gateway_url=gateway_url,
            sort_by=sort_by,
            sort_order=sort_order,
        )
    except Exception:
        log.exception("discovery.failed")
        raise
    log.info("discovery.complete", result_count=len(public_services))
    return {
        "status": "success",
        "services": public_services,
        "count": len(public_services),
    }


@router.get("/v1/services/network-stats")
async def public_network_stats(
    service: Annotated[RegistryService, Depends(get_registry_service)],
):
    stats = await service.public_network_stats()
    return {
        "status": "success",
        **stats,
    }


@router.post("/v1/agent/discovery/search")
async def search_agent_discovery(
    payload: AgentDiscoverySearchRequest,
    request: Request,
    service: RegistryService = Depends(get_registry_service),
):
    gateway_url = f"{str(request.base_url).rstrip('/')}/api/v1/gateway/generate"
    query = AgentDiscoveryQueryRecord.model_validate(payload.model_dump(by_alias=True))
    request_id = resolve_request_id(request.headers.get("X-Request-Id"), "disc")
    log = workflow_logger(
        "discovery",
        request_id=request_id,
        path="/api/v1/agent/discovery/search",
        intent=query.normalized_query,
    )
    log.info(
        "discovery.start",
        page=query.effective_page,
        page_size=query.effective_page_size,
    )
    try:
        total_count = await service.count_agent_discovery_results(query)
        results = await service.search_agent_discovery(
            query, public_gateway_url=gateway_url
        )
    except Exception:
        log.exception("discovery.failed")
        raise
    page = query.effective_page
    page_size = query.effective_page_size
    log.info(
        "discovery.complete",
        result_count=len(results),
        total_count=total_count,
        page=page,
        page_size=page_size,
    )
    return {
        "requestId": request_id,
        "results": [
            row.model_dump(by_alias=True, exclude_none=True) for row in results
        ],
        "count": len(results),
        "page": page,
        "pageSize": page_size,
        "totalCount": total_count,
        "hasMore": (page * page_size) < total_count,
    }


@router.get("/v1/services/health/status")
async def discover_health_status(
    intent: Optional[str] = Query(
        None, description="Search keyword for service health status"
    ),
    include_inactive: bool = Query(
        False, alias="includeInactive", description="Include inactive services"
    ),
    service: RegistryService = Depends(get_registry_service),
):
    rows = await service.health_status(intent=intent, include_inactive=include_inactive)
    return {"status": "success", "services": rows, "count": len(rows)}


@router.get("/v1/services/{service_record_id}/health/history")
async def service_health_history(
    service_record_id: str,
    service: RegistryService = Depends(get_registry_service),
    limit_per_target: int = Query(
        50,
        alias="limitPerTarget",
        ge=1,
        le=2000,
        description="Recent probe records per target",
    ),
    hours: Optional[int] = Query(
        None, ge=1, le=168, description="History window in hours (capped by retention)"
    ),
    days: Optional[int] = Query(
        None, ge=1, le=365, description="History window in days (capped by retention)"
    ),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    try:
        payload = await service.service_health_history(
            service_record_id=service_record_id,
            owner_wallet=owner,
            limit_per_target=limit_per_target,
            hours=hours,
            days=days,
        )
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail={"code": "SERVICE_NOT_FOUND", "message": "Service not found"},
        )
    return {"status": "success", **payload}


@router.get("/v1/services")
async def list_services(
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    rows = await service.list_owner_services(owner)
    return {"status": "success", "services": rows}


@router.get("/v1/services/registration-guide")
async def registration_guide(
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    credential_service.require_owner_wallet(authorization, x_user_address)
    return {
        "status": "success",
        "designStyle": "Google AWS Apple inspired: progressive disclosure + inline guidance",
        "principles": [
            "Keep form fields minimal and grouped by intent",
            "Show validation next to each field instead of top-level dump",
            "Provide contextual explainers for every critical field",
        ],
        "fields": REGISTRATION_GUIDE_FIELDS,
    }


@router.post("/v1/services")
async def register_service(
    req: RegisterServiceRequest,
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    try:
        new_svc = await service.register_service(req.model_dump(), owner)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "SERVICE_REGISTRATION_INVALID",
                "message": str(exc),
            },
        )
    return {"status": "success", "serviceId": new_svc["serviceId"], "service": new_svc}


@router.put("/v1/services/{service_record_id}")
async def update_service(
    service_record_id: str,
    req: dict[str, Any],
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    try:
        updated = await service.update_service(service_record_id, req, owner)
    except ValueError as exc:
        if str(exc) == SERVICE_ALREADY_DELETED:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": SERVICE_ALREADY_DELETED,
                    "message": "Deleted services cannot be edited.",
                },
            )
        raise HTTPException(
            status_code=422,
            detail={
                "code": "SERVICE_REGISTRATION_INVALID",
                "message": str(exc),
            },
        )
    if not updated:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"status": "success", "service": updated}


@router.delete("/v1/services/{service_record_id}")
async def delete_service(
    service_record_id: str,
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    try:
        success = await service.delete_service(service_record_id, owner)
    except ValueError as exc:
        if str(exc) == SERVICE_DELETE_ACTIVE_CONFLICT:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": SERVICE_DELETE_ACTIVE_CONFLICT,
                    "message": "Active services must be set to inactive before deletion.",
                },
            )
        raise
    if not success:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"status": "success", "message": "Service deleted"}


@router.get("/v1/admin/provider-services")
async def admin_list_provider_services(
    principal: Annotated[
        InternalServicePrincipal,
        Depends(require_internal_scope("provider_services.read")),
    ],
    service: Annotated[RegistryService, Depends(get_registry_service)],
    query: Optional[str] = Query(None, min_length=1, max_length=128),
    status: Optional[str] = Query(None, max_length=32),
    runtime_status: Optional[str] = Query(None, alias="runtimeStatus", max_length=32),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, alias="pageSize", ge=1, le=100),
):
    _ = principal
    payload = await service.list_admin_provider_services(
        query=query,
        status=status,
        runtime_status=runtime_status,
        page=page,
        page_size=page_size,
    )
    return {"status": "success", **payload}


@router.get("/v1/admin/provider-services/{service_record_id}")
async def admin_get_provider_service(
    service_record_id: str,
    principal: Annotated[
        InternalServicePrincipal,
        Depends(require_internal_scope("provider_services.read")),
    ],
    service: Annotated[RegistryService, Depends(get_registry_service)],
):
    _ = principal
    payload = await service.get_admin_provider_service(service_record_id)
    if payload is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "SERVICE_NOT_FOUND", "message": "Service not found"},
        )
    return {"status": "success", "service": payload}


@router.post("/v1/admin/provider-services/{service_record_id}/force-probe")
async def admin_force_probe_provider_service(
    service_record_id: str,
    principal: Annotated[
        InternalServicePrincipal,
        Depends(require_internal_scope("provider_services.write")),
    ],
    service: Annotated[RegistryService, Depends(get_registry_service)],
):
    payload = await service.force_probe_admin_provider_service(
        service_id=service_record_id,
        actor_wallet=principal.admin_wallet,
        actor_admin_id=principal.actor_admin_id,
    )
    if payload is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "SERVICE_NOT_FOUND", "message": "Service not found"},
        )
    return {"status": "success", "service": payload}


@router.post("/v1/admin/provider-services/{service_record_id}/lifecycle")
async def admin_update_provider_service_lifecycle(
    service_record_id: str,
    payload: AdminProviderServiceLifecycleRequest,
    principal: Annotated[
        InternalServicePrincipal,
        Depends(require_internal_scope("provider_services.write")),
    ],
    service: Annotated[RegistryService, Depends(get_registry_service)],
):
    try:
        updated = await service.update_admin_provider_service_lifecycle(
            service_id=service_record_id,
            action=payload.action,
            actor_wallet=principal.admin_wallet,
            actor_admin_id=principal.actor_admin_id,
            note=payload.note,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": str(exc), "message": "Invalid provider service lifecycle action"},
        )
    if updated is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "SERVICE_NOT_FOUND", "message": "Service not found"},
        )
    return {"status": "success", "service": updated}


@router.delete("/v1/admin/provider-services/{service_record_id}")
async def admin_delete_provider_service(
    service_record_id: str,
    payload: AdminProviderServiceDeleteRequest,
    principal: Annotated[
        InternalServicePrincipal,
        Depends(require_internal_scope("provider_services.write")),
    ],
    service: Annotated[RegistryService, Depends(get_registry_service)],
):
    try:
        success = await service.delete_admin_provider_service(
            service_id=service_record_id,
            actor_wallet=principal.admin_wallet,
            actor_admin_id=principal.actor_admin_id,
            note=payload.note,
        )
    except ValueError as exc:
        if str(exc) == SERVICE_DELETE_ACTIVE_CONFLICT:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": SERVICE_DELETE_ACTIVE_CONFLICT,
                    "message": "Active services must be paused before deletion.",
                },
            )
        raise
    if not success:
        raise HTTPException(
            status_code=404,
            detail={"code": "SERVICE_NOT_FOUND", "message": "Service not found"},
        )
    return {"status": "success", "message": "Service deleted"}


@router.post("/v1/services/{service_record_id}/ping")
async def ping_service(
    service_record_id: str,
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    payload = await service.force_probe_owner_service(service_record_id, owner)
    if payload is None:
        raise HTTPException(status_code=404, detail="Service not found")
    return {
        "status": "success",
        "message": "Service health probe completed",
        "service": payload,
        "runtimeAvailable": payload.get("runtimeAvailable"),
        "probeStatus": payload.get("probeStatus"),
        "lastCheckedAt": payload.get("lastCheckedAt"),
        "probeError": payload.get("probeError"),
    }


@router.post("/v1/services/parse-curl")
async def parse_curl_endpoint(
    req: ParseCurlRequest,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    credential_service.require_owner_wallet(authorization, x_user_address)
    parsed = await parse_manifest_from_curl(
        curl_command=req.curlCommand,
        current_manifest=req.currentManifest,
        model_override=req.model,
    )
    return {
        "status": "success",
        "data": parsed.get("manifest", {}),
        "fallback": bool(parsed.get("fallback", False)),
        "reason": parsed.get("reason"),
        "raw": parsed.get("raw"),
    }
