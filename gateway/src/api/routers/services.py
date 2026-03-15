from fastapi import APIRouter, Depends, HTTPException, Query, Header, Request
from typing import Optional, Dict, Any, List, Annotated
from src.api.deps import get_registry_service
from src.services.seller.registry_service import RegistryService
from src.services.platform import credential_service
from src.services.seller.manifest_parser_service import parse_manifest_from_curl
from src.core.config import settings
from pydantic import BaseModel, Field

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]

REGISTRATION_GUIDE_FIELDS: List[Dict[str, Any]] = [
    {
        "key": "serviceName",
        "required": True,
        "title": "Service Name",
        "description": "Human-readable service title shown in marketplace and seller console.",
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
        le=settings.gateway_max_timeout_ms,
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


class RetryPolicySpec(BaseModel):
    maxAttempts: int = 2
    backoffMs: int = 200
    retryOnStatus: List[int] = Field(default_factory=lambda: [429, 500, 502, 503, 504])


class ForwardingSpec(BaseModel):
    requestIdHeader: str = "X-Synapse-Request-Id"
    passThroughHeaders: List[str] = Field(default_factory=list)
    injectHeaders: Dict[str, str] = Field(default_factory=dict)
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
    headersTemplate: Dict[str, str] = Field(default_factory=dict)
    examples: List[Dict[str, Any]] = Field(default_factory=list)


class RegisterServiceRequest(BaseModel):
    serviceName: str
    role: str = "Provider / Seller"
    address: Optional[str] = None
    pricing: ServicePricing | str
    summary: str = ""
    tags: List[str] = Field(default_factory=list)
    status: str = "active"
    auth: Dict[str, Any] = Field(default_factory=dict)
    healthCheck: HealthCheckSpec = Field(default_factory=HealthCheckSpec)
    constraints: ConstraintsSpec = Field(default_factory=ConstraintsSpec)
    forwarding: ForwardingSpec = Field(default_factory=ForwardingSpec)
    metering: MeteringSpec = Field(default_factory=MeteringSpec)
    invoke: InvokeMethod
    isActive: bool = True


class ParseCurlRequest(BaseModel):
    curlCommand: str
    model: Optional[str] = None
    currentManifest: Optional[Dict[str, Any]] = None


@router.get("/v1/services/discover")
async def discover_services(
    intent: Optional[str] = Query(
        None, description="Search keyword for service discovery"
    ),
    request: Request = None,
    service: RegistryService = Depends(get_registry_service),
):
    """
    Public endpoint for Buyer AI Agents to discover available services.
    Returns only active services.
    """
    gateway_url = None
    if request is not None:
        gateway_url = f"{str(request.base_url).rstrip('/')}/api/v1/gateway/generate"
    public_services = await service.discover_services(
        intent, public_gateway_url=gateway_url
    )
    return {
        "status": "success",
        "services": public_services,
        "count": len(public_services),
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
    req: Dict[str, Any],
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    try:
        updated = await service.update_service(service_record_id, req, owner)
    except ValueError as exc:
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
    success = await service.delete_service(service_record_id, owner)
    if not success:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"status": "success", "message": "Service deleted"}


@router.post("/v1/services/{service_record_id}/ping")
async def ping_service(
    service_record_id: str,
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    if not await service.has_owner_service(service_record_id, owner):
        raise HTTPException(status_code=404, detail="Service not found")
    return {"status": "success", "message": "Pong"}


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
