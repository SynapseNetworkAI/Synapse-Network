import time
from typing import Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends
from loguru import logger
import aiohttp

from src.models.pydantic_models import (
    ChallengeRequest, 
    ChallengeResponse, 
    VerifyAuthRequest,
    TokenResponse,
    BaseResponse
)
from src.core.auth import create_auth_challenge, verify_auth_signature
from src.core.common import normalize_wallet
from src.core.config import settings
from src.storage import get_storage, BaseStorage

router = APIRouter()

@router.get("/v1/auth/challenge", response_model=ChallengeResponse)
async def get_challenge(address: str):
    """Get an authentication challenge for a wallet"""
    try:
        challenge = create_auth_challenge(address)
        if not challenge:
            raise HTTPException(status_code=400, detail="Failed to create challenge")
            
        return ChallengeResponse(
            success=True,
            challenge=challenge,
            domain="a2a-pay-network"
        )
    except Exception as e:
        logger.error(f"Challenge generation failed: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/v1/auth/verify", response_model=TokenResponse)
async def verify_signature(
    request: VerifyAuthRequest,
    storage: BaseStorage = Depends(get_storage)
):
    """Verify signature and issue JWT"""
    try:
        token = verify_auth_signature(
            request.wallet_address,
            request.signature,
            request.message
        )
        
        if not token:
            raise HTTPException(status_code=401, detail="Invalid signature")
            
        wallet = normalize_wallet(request.wallet_address)
        
        sessions = storage.get_collection('auth_sessions')
        if not isinstance(sessions, dict):
            sessions = {}

        sessions[wallet] = {
            "registered_at": int(time.time()),
            "last_login": int(time.time()),
            "status": "active"
        }

        storage.save_collection('auth_sessions', sessions)
            
        return TokenResponse(
            success=True,
            access_token=token,
            token_type="bearer",
            expires_in=86400  # 24 hours
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signature verification failed: {e}")
        raise HTTPException(status_code=500, detail="Verification failed")
