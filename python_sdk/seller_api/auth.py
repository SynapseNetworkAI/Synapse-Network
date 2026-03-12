import base64
import hashlib
import hmac
import json
import time
from typing import Annotated, Any, Dict, Optional

from fastapi import Header, HTTPException
from web3 import Web3
from eth_account.messages import encode_defunct

from .common import normalize_wallet
from .settings import (
    ALLOW_LEGACY_AUTH,
    AUTH_CHALLENGE_TTL_SEC,
    AUTH_SECRET,
    AUTH_TOKEN_TTL_SEC,
    INVALID_ADDRESS_MESSAGE,
)
from .state import auth_challenges


def validate_wallet(address: str, error_code: str, message: str) -> str:
    if not Web3.is_address(address):
        raise HTTPException(status_code=400, detail={"code": error_code, "message": message})
    return normalize_wallet(address)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def unb64url(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def issue_token(subject_wallet: str) -> str:
    payload = {
        "sub": subject_wallet,
        "exp": int(time.time()) + AUTH_TOKEN_TTL_SEC,
    }
    payload_raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_part = b64url(payload_raw)
    sig = hmac.new(AUTH_SECRET.encode("utf-8"), payload_part.encode("utf-8"), hashlib.sha256).digest()
    sig_part = b64url(sig)
    return f"{payload_part}.{sig_part}"


def verify_token(token: str) -> str:
    try:
        payload_part, sig_part = token.split(".", 1)
    except ValueError:
        raise HTTPException(status_code=401, detail={"code": "INVALID_TOKEN", "message": "Malformed token"})

    expected_sig = hmac.new(AUTH_SECRET.encode("utf-8"), payload_part.encode("utf-8"), hashlib.sha256).digest()
    provided_sig = unb64url(sig_part)
    if not hmac.compare_digest(expected_sig, provided_sig):
        raise HTTPException(
            status_code=401,
            detail={"code": "INVALID_TOKEN_SIGNATURE", "message": "Token signature invalid"},
        )

    try:
        payload = json.loads(unb64url(payload_part).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=401, detail={"code": "INVALID_TOKEN_PAYLOAD", "message": "Token payload invalid"})

    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail={"code": "TOKEN_EXPIRED", "message": "Token expired"})

    subject = payload.get("sub")
    if not subject or not Web3.is_address(subject):
        raise HTTPException(status_code=401, detail={"code": "INVALID_TOKEN_SUBJECT", "message": "Token subject invalid"})

    return normalize_wallet(subject)


def parse_bearer_token(authorization: str) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail={"code": "AUTH_REQUIRED", "message": "Missing Bearer token"})
    return authorization[7:].strip()


def require_auth(
    authorization: Annotated[str, Header(alias="Authorization")],
    x_user_address: Annotated[Optional[str], Header(alias="X-User-Address")] = None,
) -> str:
    token = parse_bearer_token(authorization)

    if token == "active" and ALLOW_LEGACY_AUTH:
        if not x_user_address or not Web3.is_address(x_user_address):
            raise HTTPException(
                status_code=401,
                detail={"code": "LEGACY_AUTH_INVALID", "message": "X-User-Address required for legacy auth"},
            )
        return normalize_wallet(x_user_address)

    subject = verify_token(token)

    if not x_user_address or not Web3.is_address(x_user_address):
        raise HTTPException(
            status_code=401,
            detail={"code": "USER_ADDRESS_REQUIRED", "message": "X-User-Address header is required"},
        )

    header_wallet = normalize_wallet(x_user_address)
    if header_wallet != subject:
        raise HTTPException(
            status_code=401,
            detail={"code": "TOKEN_WALLET_MISMATCH", "message": "Token subject does not match X-User-Address"},
        )

    return subject


def enforce_owner(resource_owner: str, subject_wallet: str) -> None:
    if normalize_wallet(resource_owner) != normalize_wallet(subject_wallet):
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "Resource does not belong to current wallet"})


def cleanup_expired_challenges() -> None:
    now = int(time.time())
    expired_keys = [key for key, value in auth_challenges.items() if int(value.get("exp", 0)) < now or value.get("used")]
    for key in expired_keys:
        auth_challenges.pop(key, None)


def build_auth_message(address: str, nonce: str) -> str:
    return (
        f"Synapse Network Login\n\n"
        f"Welcome to Synapse Network!\n"
        f"Sign this message to prove you own this wallet and securely log in. "
        f"This is a free off-chain signature and will not cost any gas or trigger a blockchain transaction.\n\n"
        f"Address: {normalize_wallet(address)}\n"
        f"Nonce: {nonce}"
    )


def create_auth_challenge(address: str) -> Dict[str, Any]:
    normalized = validate_wallet(address, "INVALID_ADDRESS", INVALID_ADDRESS_MESSAGE)
    cleanup_expired_challenges()
    nonce = Web3.keccak(text=f"{normalized}:{time.time_ns()}").hex()
    auth_challenges[nonce] = {
        "address": normalized,
        "exp": int(time.time()) + AUTH_CHALLENGE_TTL_SEC,
        "used": False,
    }
    return {
        "status": "success",
        "nonce": nonce,
        "message": build_auth_message(normalized, nonce),
        "expiresInSec": AUTH_CHALLENGE_TTL_SEC,
    }


def verify_auth_signature(address: str, nonce: str, signature: str) -> Dict[str, Any]:
    normalized = validate_wallet(address, "INVALID_ADDRESS", INVALID_ADDRESS_MESSAGE)
    challenge = auth_challenges.get(nonce)
    if not challenge or challenge.get("used"):
        raise HTTPException(status_code=401, detail={"code": "INVALID_NONCE", "message": "Nonce invalid or used"})
    if int(challenge.get("exp", 0)) < int(time.time()):
        auth_challenges.pop(nonce, None)
        raise HTTPException(status_code=401, detail={"code": "NONCE_EXPIRED", "message": "Nonce expired"})
    if normalize_wallet(challenge.get("address", "")) != normalized:
        raise HTTPException(status_code=401, detail={"code": "NONCE_ADDRESS_MISMATCH", "message": "Nonce and address mismatch"})

    message = build_auth_message(normalized, nonce)
    try:
        recovered = Web3().eth.account.recover_message(encode_defunct(text=message), signature=signature)
    except Exception:
        raise HTTPException(status_code=401, detail={"code": "INVALID_SIGNATURE", "message": "Signature verification failed"})

    if normalize_wallet(recovered) != normalized:
        raise HTTPException(status_code=401, detail={"code": "SIGNER_MISMATCH", "message": "Recovered signer mismatch"})

    auth_challenges[nonce]["used"] = True
    token = issue_token(normalized)
    return {"status": "success", "token": token, "wallet": normalized, "expiresInSec": AUTH_TOKEN_TTL_SEC}
