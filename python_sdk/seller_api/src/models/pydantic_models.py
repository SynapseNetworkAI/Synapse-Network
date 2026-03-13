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
