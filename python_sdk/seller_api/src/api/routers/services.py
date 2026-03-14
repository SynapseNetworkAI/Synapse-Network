from fastapi import APIRouter, Depends, HTTPException, Query, Header
from typing import Optional, Dict, Any, List, Annotated
from src.api.deps import get_registry_service
from src.services.registry_service import RegistryService
from src.services import credential_service
from pydantic import BaseModel

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]

class ServicePricing(BaseModel):
    currency: str = "USD"
    amount: str

class InvokeMethod(BaseModel):
    method: str
    request: dict
    response: dict

class RegisterServiceRequest(BaseModel):
    serviceName: str
    pricing: ServicePricing
    summary: str
    tags: List[str] = []
    invoke: Optional[InvokeMethod] = None
    isActive: bool = True

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
    req: dict,
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    credential_service.require_owner_wallet(authorization, x_user_address)
    return {"status": "success", "parsed": "mock"}
