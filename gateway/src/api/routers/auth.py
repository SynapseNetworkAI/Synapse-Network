import time
from typing import Dict, List, Optional, Annotated
from fastapi import APIRouter, HTTPException, Depends, Header
from loguru import logger
import aiohttp

from src.api.schemas.pydantic_models import (
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
from src.services.platform import credential_service

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]

@router.get(
    "/v1/auth/challenge",
    response_model=ChallengeResponse,
    responses={400: {"description": "Failed to create challenge"}, 500: {"description": "Internal server error"}},
)
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

@router.post(
    "/v1/auth/verify",
    response_model=TokenResponse,
    responses={401: {"description": "Invalid signature"}, 500: {"description": "Verification failed"}},
)
async def verify_signature(
    request: VerifyAuthRequest,
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    """Verify signature and issue JWT"""
    try:
        token = verify_auth_signature(
            request.wallet_address,
            request.signature,
            request.message
        )
        
        if not token:
            raise HTTPException(
                status_code=401,
                detail=(
                    f"Invalid signature or expired challenge. "
                    f"Please request a new challenge and sign within {settings.auth_challenge_ttl_sec}s."
                ),
            )
            
        wallet = normalize_wallet(request.wallet_address)

        now = int(time.time())
        storage.get_data_manager().system.credential_auth.upsert_auth_session(
            wallet=wallet,
            registered_at=now,
            last_login=now,
            status="active",
        )
            
        return TokenResponse(
            success=True,
            access_token=token,
            token_type="bearer",
            expires_in=max(60, int(settings.auth_token_ttl_sec)),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Signature verification failed: {e}")
        raise HTTPException(status_code=500, detail="Verification failed")


@router.post(
    "/v1/auth/logout",
    response_model=BaseResponse,
    responses={401: {"description": "Unauthorized"}, 500: {"description": "Logout failed"}},
)
async def logout(
    storage: Annotated[BaseStorage, Depends(get_storage)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    """Invalidate current wallet auth session status in gateway state."""
    try:
        owner = credential_service.require_owner_wallet(authorization, x_user_address)
        now = int(time.time())
        storage.get_data_manager().system.credential_auth.upsert_auth_session(
            wallet=owner,
            registered_at=now,
            last_login=now,
            status="inactive",
        )
        return BaseResponse(success=True)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Logout failed: {e}")
        raise HTTPException(status_code=500, detail="Logout failed")
