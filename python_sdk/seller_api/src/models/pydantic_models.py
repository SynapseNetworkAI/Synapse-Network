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


class DepositIntentRequest(BaseModel):
    txHash: str = Field(..., min_length=66, max_length=66)
    amountUsdc: float = Field(..., gt=0)

    @validator("txHash")
    def validate_tx_hash(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized.startswith("0x"):
            raise ValueError("txHash must start with 0x")
        hex_part = normalized[2:]
        if len(hex_part) != 64 or any(ch not in "0123456789abcdefABCDEF" for ch in hex_part):
            raise ValueError("txHash must be a valid 32-byte hex string")
        return normalized


class RefundIntentRequest(BaseModel):
    amountUsdc: float = Field(default=10, ge=10)
    reason: Optional[str] = Field(default=None, max_length=256)


class RouterConfigRequest(BaseModel):
    dailyLimitUsdc: float = Field(..., ge=0, le=10_000)


# Backward-compatible aliases.
AgentCredentialIssueRequest = CredentialIssueRequest
AgentCredentialQuotaUpdateRequest = CredentialQuotaUpdateRequest
