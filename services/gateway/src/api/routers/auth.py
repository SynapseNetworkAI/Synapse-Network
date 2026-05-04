# ruff: noqa: TRY301, TRY400, B904, S106
import logging
import time
from datetime import datetime, timezone
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
    EmailVerificationCodeRequest,
    EmailVerificationResendRequest,
)
from src.core.auth import (
    create_auth_challenge,
    create_owner_profile_update_challenge,
    get_auth_challenge_domain_and_uri,
    verify_auth_signature,
    verify_owner_profile_update_signature,
)
from src.core.common import normalize_wallet
from src.core.config import settings
from src.domain.runtime_state import AuthSessionState
from src.storage import get_storage, BaseStorage
from src.services.platform import credential_service
from src.services.notifications.email_verification import hash_email_verification_code
from src.services.notifications.sanitizer import mask_email
from src.services.notifications.transactional import enqueue_account_email_notice
from src.api.routers.auth_email_verification import (
    email_verification_error,
    email_verification_sends_remaining,
    email_verification_status,
    send_owner_email_verification_code,
)
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
        pendingEmail=getattr(row, "pending_email", None),
        emailVerificationStatus=email_verification_status(row),
        emailVerificationExpiresAt=getattr(row, "email_verification_expires_at", None),
        emailVerificationSendsRemaining=email_verification_sends_remaining(row),
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


def _enqueue_account_email_notice(
    storage: BaseStorage,
    *,
    owner: str,
    recipient_email: Optional[str],
    template_key: str,
    event_type: str,
    message: str,
) -> None:
    if not recipient_email:
        return
    enqueue_account_email_notice(
        storage,
        owner_wallet=owner,
        recipient_email=recipient_email,
        template_key=template_key,
        event_type=event_type,
        payload={
            "requestId": f"{template_key}:{owner}",
            "status": "COMPLETED",
            "wallet": owner,
            "emailMasked": mask_email(recipient_email),
            "previousEmailMasked": mask_email(recipient_email),
            "message": message,
            "actionUrl": f"{settings.public_app_base_url.rstrip('/')}/dashboard/account/settings"
            if settings.public_app_base_url
            else "/dashboard/account/settings",
        },
    )


@router.get(
    "/v1/auth/challenge",
    response_model=ChallengeResponse,
    responses={
        400: {"description": "Failed to create challenge"},
        500: {"description": "Internal server error"},
    },
)
async def get_challenge(address: str, chainId: Optional[int] = None):
    """Get an authentication challenge for a wallet"""
    try:
        challenge = create_auth_challenge(address, chain_id=chainId)
        if not challenge:
            raise HTTPException(status_code=400, detail="Failed to create challenge")

        domain, _ = get_auth_challenge_domain_and_uri()
        return ChallengeResponse(success=True, challenge=challenge, domain=domain)
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

        pending_email = str(getattr(profile, "pending_email", "") or "").strip().lower()
        previous_pending = str(getattr(previous_profile, "pending_email", "") or "").strip().lower()
        if pending_email and pending_email != previous_pending:
            profile = send_owner_email_verification_code(
                storage,
                owner=owner,
                email=pending_email,
            )

        previous_email = str(getattr(previous_profile, "email", "") or "").strip().lower()
        current_email = str(getattr(profile, "email", "") or "").strip().lower()
        if previous_email and request.email is None and not current_email:
            _enqueue_account_email_notice(
                storage,
                owner=owner,
                recipient_email=previous_email,
                template_key="email_removed_notice",
                event_type="security.email_removed",
                message="Your Synapse account email was removed. You will not receive transaction receipts or support replies by email until a new address is verified.",
            )

        credential_service.append_audit_log(
            storage,
            "OWNER_PROFILE_UPDATED",
            owner,
            {
                "displayNameSet": bool(profile.display_name),
                "emailMasked": _mask_email(profile.email),
                "pendingEmailMasked": _mask_email(getattr(profile, "pending_email", None)),
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


@router.post(
    "/v1/auth/email/verify-code",
    response_model=OwnerProfileResponse,
    responses={
        400: {"description": "Invalid or expired verification code"},
        401: {"description": "Missing wallet session"},
        409: {"description": "Email already in use"},
        429: {"description": "Too many invalid attempts"},
        500: {"description": "Email verification failed"},
    },
)
async def verify_email_code(
    request: EmailVerificationCodeRequest,
    storage: Annotated[BaseStorage, Depends(get_storage)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    try:
        owner = credential_service.require_owner_wallet(authorization, x_user_address)
        code_hash = hash_email_verification_code(
            owner_wallet=owner,
            email=request.email,
            code=request.code,
        )
        previous_profile = storage.get_data_manager().system.credential_auth.read_owner_profile(
            owner,
            ensure_exists=False,
        )
        try:
            profile = storage.get_data_manager().system.credential_auth.verify_owner_email_code(
                owner,
                request.email,
                code_hash=code_hash,
                now=datetime.now(timezone.utc),
            )
        except ValueError as exc:
            code = str(exc)
            if code == "EMAIL_ALREADY_IN_USE":
                raise email_verification_error(
                    409,
                    code,
                    "Email address is already linked to another wallet.",
                ) from exc
            if code == "EMAIL_VERIFICATION_ATTEMPTS_EXCEEDED":
                raise email_verification_error(
                    429,
                    code,
                    "Too many incorrect codes. Please request a new verification email.",
                ) from exc
            if code == "EMAIL_VERIFICATION_EXPIRED":
                raise email_verification_error(
                    400,
                    code,
                    "Email verification code expired. Please request a new code.",
                ) from exc
            raise email_verification_error(
                400,
                code,
                "Email verification code is invalid.",
            ) from exc
        credential_service.append_audit_log(
            storage,
            "OWNER_EMAIL_VERIFIED",
            profile.owner_wallet,
            {"emailMasked": _mask_email(profile.email)},
        )
        previous_email = str(getattr(previous_profile, "email", "") or "").strip().lower()
        current_email = str(getattr(profile, "email", "") or "").strip().lower()
        _enqueue_account_email_notice(
            storage,
            owner=owner,
            recipient_email=current_email,
            template_key="email_bound_success",
            event_type="security.email_bound_success",
            message="This email is now verified and linked to your Synapse wallet.",
        )
        if previous_email and previous_email != current_email:
            _enqueue_account_email_notice(
                storage,
                owner=owner,
                recipient_email=previous_email,
                template_key="email_changed_notice",
                event_type="security.email_changed_notice",
                message="Your Synapse account email was changed. Future receipts and support replies will go to the newly verified address.",
            )
        return OwnerProfileResponse(success=True, profile=_owner_profile_view(profile))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Email verification failed: {e}")
        raise HTTPException(status_code=500, detail="Email verification failed")


@router.post(
    "/v1/auth/email/resend-code",
    response_model=OwnerProfileResponse,
    responses={
        401: {"description": "Missing wallet session"},
        429: {"description": "Daily verification email limit reached"},
        500: {"description": "Email verification resend failed"},
    },
)
async def resend_email_code(
    request: EmailVerificationResendRequest,
    storage: Annotated[BaseStorage, Depends(get_storage)],
    authorization: AuthorizationHeader = None,
    x_user_address: UserAddressHeader = None,
):
    try:
        owner = credential_service.require_owner_wallet(authorization, x_user_address)
        current_profile = storage.get_data_manager().system.credential_auth.read_owner_profile(
            owner,
            ensure_exists=True,
        )
        if str(getattr(current_profile, "pending_email", "") or "").lower() != request.email:
            raise email_verification_error(
                400,
                "EMAIL_VERIFICATION_NOT_PENDING",
                "No pending email verification exists for this address.",
            )
        profile = send_owner_email_verification_code(
            storage,
            owner=owner,
            email=request.email,
        )
        credential_service.append_audit_log(
            storage,
            "OWNER_EMAIL_VERIFICATION_RESENT",
            profile.owner_wallet,
            {"emailMasked": _mask_email(request.email)},
        )
        return OwnerProfileResponse(success=True, profile=_owner_profile_view(profile))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Email verification resend failed: {e}")
        raise HTTPException(status_code=500, detail="Email verification resend failed")
