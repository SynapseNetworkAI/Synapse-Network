from typing import Optional

from pydantic import BaseModel


class InferenceRequest(BaseModel):
    prompt: str
    service_id: Optional[str] = None


class ServiceCreateRequest(BaseModel):
    id: str
    agentId: Optional[str] = None
    name: str
    role: str
    ownerAddress: str
    address: str
    serviceId: str
    pricing: str
    endpoint: str
    isActive: bool = True


class ServiceUpdateRequest(BaseModel):
    id: str
    agentId: Optional[str] = None
    name: str
    role: str
    ownerAddress: str
    address: str
    serviceId: str
    pricing: str
    endpoint: str
    isActive: bool = True


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
