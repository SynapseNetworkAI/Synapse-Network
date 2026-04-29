# ruff: noqa: TRY301, TRY400, B904, S106
import logging
import time
from typing import Optional, Annotated
from fastapi import APIRouter, HTTPException, Depends, Header

from src.api.schemas.pydantic_models import (
    ChallengeResponse,
    VerifyAuthRequest,
    TokenResponse,
    BaseResponse,
    OwnerProfileChallengeRequest,
    OwnerProfileChallengeResponse,
    OwnerProfileResponse,
    OwnerProfileUpdateRequest,
    OwnerProfileView,
)
from src.core.auth import (
    create_auth_challenge,
    create_owner_profile_update_challenge,
    verify_auth_signature,
    verify_owner_profile_update_signature,
)
from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.runtime_state import AuthSessionState
from src.storage import get_storage, BaseStorage
from src.services.platform import credential_service
from src.services.notifications.email_verification import (
    build_email_verification_url,
    verify_email_verification_token,
)
from src.services.notifications.transactional import schedule_transaction_notifications
from src.utils.datetime_utils import now_dt_str

logger = logging.getLogger(__name__)

router = APIRouter()

AuthorizationHeader = Annotated[Optional[str], Header(alias="Authorization")]
UserAddressHeader = Annotated[Optional[str], Header(alias="X-User-Address")]


def _owner_profile_view(row) -> OwnerProfileView:
    return OwnerProfileView(
        ownerAddress=row.owner_wallet,
        displayName=row.display_name,
        email=row.email,
        emailVerified=row.email_verified,
        notifyMarketing=row.notify_marketing,
        notifyAlerts=row.notify_alerts,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


def _mask_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    local, _, domain = email.partition("@")
    if not local or not domain:
        return None
    return f"{local[:1]}***@{domain}"


@router.get(
    "/v1/auth/challenge",
    response_model=ChallengeResponse,
    responses={
        400: {"description": "Failed to create challenge"},
        500: {"description": "Internal server error"},
    },
)
async def get_challenge(address: str):
    """Get an authentication challenge for a wallet"""
    try:
        challenge = create_auth_challenge(address)
        if not challenge:
            raise HTTPException(status_code=400, detail="Failed to create challenge")

        return ChallengeResponse(
            success=True, challenge=challenge, domain="synapse-network"
        )
    except Exception as e:
        logger.error(f"Challenge generation failed: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post(
    "/v1/auth/verify",
    response_model=TokenResponse,
    responses={
        401: {"description": "Invalid signature"},
        500: {"description": "Verification failed"},
    },
)
async def verify_signature(
    request: VerifyAuthRequest,
    storage: Annotated[BaseStorage, Depends(get_storage)],
):
    """Verify signature and issue JWT"""
    try:
        token = verify_auth_signature(
            request.wallet_address, request.signature, request.message
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
        storage.get_data_manager().system.credential_auth.save_auth_session(
            AuthSessionState(
                walletAddress=wallet,
                registeredAt=now,
                lastLogin=now,
                status="active",
                updatedAt=now_dt_str(),
            )
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
    responses={
        401: {"description": "Unauthorized"},
        500: {"description": "Logout failed"},
    },
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
        storage.get_data_manager().system.credential_auth.save_auth_session(
            AuthSessionState(
                walletAddress=owner,
                registeredAt=now,
                lastLogin=now,
                status="inactive",
                updatedAt=now_dt_str(),
            )
        )
        return BaseResponse(success=True)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Logout failed: {e}")
        raise HTTPException(status_code=500, detail="Logout failed")


@router.get(
    "/v1/auth/me",
    response_model=OwnerProfileResponse,
    responses={
        401: {"description": "Unauthorized"},
        500: {"description": "Profile lookup failed"},
    },
)
async def get_me(
    storage: Annotated[BaseStorage, Depends(get_storage)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    try:
        owner = credential_service.require_owner_wallet(authorization, x_user_address)
        profile = storage.get_data_manager().system.credential_auth.read_owner_profile(
            owner, ensure_exists=True
        )
        if profile is None:
            raise HTTPException(status_code=404, detail="Owner profile not found")
        return OwnerProfileResponse(success=True, profile=_owner_profile_view(profile))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Owner profile lookup failed: {e}")
        raise HTTPException(status_code=500, detail="Profile lookup failed")


@router.post(
    "/v1/auth/me/profile/challenge",
    response_model=OwnerProfileChallengeResponse,
    responses={
        401: {"description": "Unauthorized"},
        400: {"description": "Failed to create profile update challenge"},
        500: {"description": "Challenge generation failed"},
    },
)
async def get_profile_update_challenge(
    request: OwnerProfileChallengeRequest,
    storage: Annotated[BaseStorage, Depends(get_storage)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    _ = storage
    try:
        owner = credential_service.require_owner_wallet(authorization, x_user_address)
        challenge = create_owner_profile_update_challenge(
            owner, request.model_dump(by_alias=True)
        )
        if not challenge:
            raise HTTPException(
                status_code=400, detail="Failed to create profile update challenge"
            )
        return OwnerProfileChallengeResponse(
            success=True,
            challenge=challenge,
            expiresInSec=max(30, int(settings.auth_challenge_ttl_sec)),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Owner profile challenge generation failed: {e}")
        raise HTTPException(status_code=500, detail="Challenge generation failed")


@router.put(
    "/v1/auth/me/profile",
    response_model=OwnerProfileResponse,
    responses={
        401: {"description": "Invalid signature"},
        409: {"description": "Email already in use"},
        500: {"description": "Profile update failed"},
    },
)
async def update_me_profile(
    request: OwnerProfileUpdateRequest,
    storage: Annotated[BaseStorage, Depends(get_storage)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    try:
        owner = credential_service.require_owner_wallet(authorization, x_user_address)
        payload = request.model_dump(
            by_alias=True, exclude={"message", "signature"}
        )
        verified = verify_owner_profile_update_signature(
            owner, payload, request.signature, request.message
        )
        if not verified:
            raise HTTPException(
                status_code=401,
                detail=(
                    "Invalid signature or expired challenge. Please request a new "
                    f"profile challenge and sign within {settings.auth_challenge_ttl_sec}s."
                ),
            )

        previous_profile = storage.get_data_manager().system.credential_auth.read_owner_profile(
            owner,
            ensure_exists=True,
        )
        try:
            profile = storage.get_data_manager().system.credential_auth.update_owner_profile(
                owner,
                display_name=request.displayName,
                email=request.email,
                notify_marketing=request.notifyMarketing,
                notify_alerts=request.notifyAlerts,
            )
        except ValueError as exc:
            if str(exc) == "EMAIL_ALREADY_IN_USE":
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "EMAIL_ALREADY_IN_USE",
                        "message": "Email address is already linked to another wallet.",
                    },
                ) from exc
            raise

        email_changed = (
            bool(profile.email)
            and str(getattr(previous_profile, "email", "") or "").strip().lower()
            != str(profile.email or "").strip().lower()
        )
        if email_changed and profile.email:
            verification_url = build_email_verification_url(
                owner_wallet=owner,
                email=profile.email,
            )
            schedule_transaction_notifications(
                storage,
                owner_wallet=owner,
                template_key="email_verification",
                event_type="security.email_verification_requested",
                payload={
                    "requestId": f"email-verification:{owner}",
                    "status": "PENDING_VERIFICATION",
                    "actionUrl": verification_url,
                    "emailMasked": _mask_email(profile.email),
                },
                require_verified_email=False,
                send_lark=False,
            )

        credential_service.append_audit_log(
            storage,
            "OWNER_PROFILE_UPDATED",
            owner,
            {
                "displayNameSet": bool(profile.display_name),
                "emailMasked": _mask_email(profile.email),
                "notifyMarketing": profile.notify_marketing,
                "notifyAlerts": profile.notify_alerts,
            },
        )
        return OwnerProfileResponse(success=True, profile=_owner_profile_view(profile))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Owner profile update failed: {e}")
        raise HTTPException(status_code=500, detail="Profile update failed")


@router.get(
    "/v1/auth/email/verify",
    response_model=OwnerProfileResponse,
    responses={
        400: {"description": "Invalid or expired verification token"},
        404: {"description": "Email profile not found"},
        500: {"description": "Email verification failed"},
    },
)
async def verify_email(
    storage: Annotated[BaseStorage, Depends(get_storage)],
    token: str | None = None,
    v: str | None = None,
):
    try:
        verified = verify_email_verification_token(token or v or "")
        if not verified:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "EMAIL_VERIFICATION_INVALID",
                    "message": "Email verification link is invalid or expired.",
                },
            )
        profile = storage.get_data_manager().system.credential_auth.verify_owner_email(
            verified["owner"],
            verified["email"],
        )
        if profile is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "EMAIL_VERIFICATION_PROFILE_NOT_FOUND",
                    "message": "Email address is no longer linked to this wallet.",
                },
            )
        credential_service.append_audit_log(
            storage,
            "OWNER_EMAIL_VERIFIED",
            profile.owner_wallet,
            {"emailMasked": _mask_email(profile.email)},
        )
        return OwnerProfileResponse(success=True, profile=_owner_profile_view(profile))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Email verification failed: {e}")
        raise HTTPException(status_code=500, detail="Email verification failed")
