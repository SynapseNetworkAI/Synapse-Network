from pydantic import BaseModel, Field, validator
from typing import Dict, Any, List, Optional
import time

class BaseResponse(BaseModel):
    success: bool = True
    error: Optional[str] = None
    
class ChallengeRequest(BaseModel):
    wallet_address: str = Field(..., description="Wallet address of the buyer")

class ChallengeResponse(BaseResponse):
    challenge: str
    domain: str

class VerifyAuthRequest(BaseModel):
    wallet_address: str
    signature: str
    message: str

class TokenResponse(BaseResponse):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class CredentialIssueRequest(BaseModel):
    name: Optional[str] = None
    expiresInSec: Optional[int] = None
    maxCalls: Optional[int] = None
    rpm: Optional[int] = None
    creditLimit: Optional[float] = None
    resetInterval: Optional[str] = None
    expiration: Optional[int] = None


class CredentialQuotaUpdateRequest(BaseModel):
    maxCalls: Optional[int] = None
    rpm: Optional[int] = None
    expiresAt: Optional[int] = None
    creditLimit: Optional[float] = None
    resetInterval: Optional[str] = None
    expiration: Optional[int] = None


class InferenceRequest(BaseModel):
    prompt: str
    serviceId: Optional[str] = None


# Backward-compatible aliases.
AgentCredentialIssueRequest = CredentialIssueRequest
AgentCredentialQuotaUpdateRequest = CredentialQuotaUpdateRequest
