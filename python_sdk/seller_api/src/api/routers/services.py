from fastapi import APIRouter, Depends, HTTPException, Query, Header
from typing import Optional, Dict, Any, List, Annotated
from src.api.deps import get_registry_service
from src.services.registry_service import RegistryService
from src.services import credential_service
from src.services.manifest_parser_service import parse_manifest_from_curl
from pydantic import BaseModel, Field

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]

class ServicePricing(BaseModel):
    currency: str = "USD"
    amount: str

class HealthCheckSpec(BaseModel):
    path: str = "/health"
    url: Optional[str] = None
    method: str = "GET"
    intervalSec: int = 30
    timeoutMs: int = 3000
    successCodes: List[int] = Field(default_factory=lambda: [200])
    healthyThreshold: int = 2
    unhealthyThreshold: int = 3

class ConstraintsSpec(BaseModel):
    timeoutMs: int = 3000
    maxResponseBytes: int = 2048
    maxRequestBytes: int = 4096
    maxQps: int = 50

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
    url: str
    targets: List[InvokeTarget] = Field(default_factory=list)
    timeoutMs: int = 3000
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
    invoke: Optional[InvokeMethod] = None
    isActive: bool = True


class ParseCurlRequest(BaseModel):
    curlCommand: str
    model: Optional[str] = None
    currentManifest: Optional[Dict[str, Any]] = None

@router.get("/v2/services/discover")
async def discover_services(
    intent: Optional[str] = Query(None, description="Search keyword for service discovery"),
    service: RegistryService = Depends(get_registry_service)
):
    """
    Public endpoint for Buyer AI Agents to discover available services.
    Returns only active services.
    """
    public_services = await service.discover_services(intent)
    return {
        "status": "success", 
        "services": public_services, 
        "count": len(public_services)
    }

@router.get("/v2/services")
async def list_services(
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    rows = await service.list_owner_services(owner)
    return {"status": "success", "services": rows}

@router.post("/v2/services")
async def register_service(
    req: RegisterServiceRequest,
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    new_svc = await service.register_service(req.model_dump(), owner)
    return {"status": "success", "serviceId": new_svc["serviceId"], "service": new_svc}

@router.put("/v2/services/{service_record_id}")
async def update_service(
    service_record_id: str, 
    req: Dict[str, Any], 
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    updated = await service.update_service(service_record_id, req, owner)
    if not updated:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"status": "success", "service": updated}

@router.delete("/v2/services/{service_record_id}")
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

@router.post("/v2/services/{service_record_id}/rotate-key")
async def rotate_service_key(
    service_record_id: str,
    service: RegistryService = Depends(get_registry_service),
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    owner = credential_service.require_owner_wallet(authorization, x_user_address)
    if not await service.has_owner_service(service_record_id, owner):
        raise HTTPException(status_code=404, detail="Service not found")
    return {"status": "success", "message": "Key rotated (mock)"}

@router.post("/v2/services/{service_record_id}/ping")
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

@router.post("/v2/services/parse-curl")
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
