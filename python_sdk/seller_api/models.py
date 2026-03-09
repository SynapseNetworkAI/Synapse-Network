from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class InferenceRequest(BaseModel):
    prompt: str
    service_id: Optional[str] = None


class ServiceAuthConfig(BaseModel):
    type: Optional[str] = None
    headerName: Optional[str] = None


class ServiceInvokeRequest(BaseModel):
    contentType: str = "application/json"
    schema: Dict[str, Any]


class ServiceInvokeResponse(BaseModel):
    schema: Dict[str, Any]


class ServiceInvokeConfig(BaseModel):
    method: str
    url: str
    timeoutMs: int = 30000
    request: ServiceInvokeRequest
    response: ServiceInvokeResponse
    headersTemplate: Optional[Dict[str, str]] = None
    examples: Optional[List[Dict[str, Any]]] = None


class ServiceCreateRequest(BaseModel):
    agentId: str
    serviceName: str
    role: str
    address: str
    pricing: str
    isActive: bool = True
    summary: Optional[str] = None
    tags: Optional[List[str]] = None
    auth: Optional[ServiceAuthConfig] = None
    invoke: ServiceInvokeConfig


class ServiceUpdateRequest(BaseModel):
    serviceName: str
    pricing: str
    isActive: bool = True
    summary: Optional[str] = None
    tags: Optional[List[str]] = None
    auth: Optional[ServiceAuthConfig] = None
    invoke: ServiceInvokeConfig


class AuthVerifyRequest(BaseModel):
    address: str
    nonce: str
    signature: str


class AgentCredentialIssueRequest(BaseModel):
    agentId: str
    serviceId: Optional[str] = None
    expiresInSec: Optional[int] = None
    maxCalls: Optional[int] = None
    rpm: Optional[int] = None


class AgentCredentialQuotaUpdateRequest(BaseModel):
    maxCalls: Optional[int] = None
    rpm: Optional[int] = None
    expiresAt: Optional[int] = None
