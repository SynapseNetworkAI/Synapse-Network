import hashlib
import json
import logging
import secrets
import time
from eth_account.messages import encode_defunct
from typing import Any, Optional
try:
    from cachetools import TTLCache
except Exception:  # pragma: no cover - optional dependency fallback
    class TTLCache(dict):
        def __init__(self, maxsize, ttl):
            super().__init__()
            self.maxsize = max(1, int(maxsize))
            self.ttl = max(1, int(ttl))
            self._expires: dict[str, float] = {}

        def _now(self) -> float:
            return time.time()

        def _purge(self) -> None:
            now = self._now()
            expired_keys = [
                key for key, expires in self._expires.items() if expires <= now
            ]
            for key in expired_keys:
                self._expires.pop(key, None)
                super().pop(key, None)

        def __setitem__(self, key, value):
            self._purge()
            if len(self) >= self.maxsize:
                oldest_key = next(iter(self._expires)) if self._expires else None
                if oldest_key is not None:
                    self._expires.pop(oldest_key, None)
                    super().pop(oldest_key, None)
            self._expires[key] = self._now() + self.ttl
            super().__setitem__(key, value)

        def __getitem__(self, key):
            self._purge()
            if key not in self._expires:
                raise KeyError(key)
            return super().__getitem__(key)

        def get(self, key, default=None):
            self._purge()
            if key not in self._expires:
                return default
            return super().get(key, default)

        def __delitem__(self, key):
            self._expires.pop(key, None)
            super().__delitem__(key)

from .common import normalize_wallet
from .config import settings
import jwt

logger = logging.getLogger(__name__)


def _web3_class():
    from web3 import Web3

    return Web3

# Cache for pending auth challenges - simple in-memory cache
# Format: {wallet_address: challenge_string}
pending_challenges = TTLCache(
    maxsize=1000,
    ttl=max(30, int(settings.auth_challenge_ttl_sec)),
)
pending_owner_profile_update_challenges = TTLCache(
    maxsize=1000,
    ttl=max(30, int(settings.auth_challenge_ttl_sec)),
)


def _owner_profile_payload_hash(wallet_address: str, payload: dict[str, Any]) -> str:
    normalized_payload = {
        "walletAddress": normalize_wallet(wallet_address),
        "displayName": str(payload.get("displayName") or "").strip() or None,
        "email": str(payload.get("email") or "").strip().lower() or None,
        "notifyMarketing": bool(payload.get("notifyMarketing", True)),
        "notifyAlerts": bool(payload.get("notifyAlerts", True)),
    }
    encoded = json.dumps(normalized_payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def create_auth_challenge(wallet_address: str) -> Optional[str]:
    """Generate a challenge string for wallet authentication"""
    try:
        wallet = normalize_wallet(wallet_address)

        # Generate random challenge
        nonce = secrets.token_hex(16)
        timestamp = int(time.time())
        challenge = f"Login to A2A Pay Network\nWallet: {wallet}\nNonce: {nonce}\nTimestamp: {timestamp}"

        # Store challenge
        pending_challenges[wallet] = challenge
        logger.info(f"Created auth challenge for wallet {wallet}")

        return challenge
    except Exception as e:
        logger.error(f"Challenge generation failed: {e}")
        return None


def create_owner_profile_update_challenge(
    wallet_address: str, payload: dict[str, Any]
) -> Optional[str]:
    try:
        wallet = normalize_wallet(wallet_address)
        payload_hash = _owner_profile_payload_hash(wallet, payload)
        nonce = secrets.token_hex(16)
        timestamp = int(time.time())
        challenge = (
            "Update Synapse account profile\n"
            f"Wallet: {wallet}\n"
            f"Payload Hash: {payload_hash}\n"
            f"Nonce: {nonce}\n"
            f"Timestamp: {timestamp}"
        )
        pending_owner_profile_update_challenges[wallet] = {
            "challenge": challenge,
            "payload_hash": payload_hash,
        }
        logger.info(f"Created owner profile update challenge for wallet {wallet}")
        return challenge
    except Exception as e:
        logger.error(f"Owner profile challenge generation failed: {e}")
        return None


def verify_auth_signature(
    wallet_address: str, signature: str, message: str
) -> Optional[str]:
    """Verify EIP-191 signature and issue JWT"""
    try:
        wallet = normalize_wallet(wallet_address)

        # 1. Verify message matches pending challenge
        pending_message = pending_challenges.get(wallet)
        if not pending_message:
            logger.warning(f"No pending challenge for {wallet}")
            return None

        if message != pending_message:
            logger.warning(f"Message mismatch for {wallet}")
            return None

        # 2. Add EIP-191 prefix and hash
        signable_message = encode_defunct(text=message)

        # 3. Recover signer address
        web3_class = _web3_class()
        w3 = web3_class()
        recovered_address = w3.eth.account.recover_message(
            signable_message, signature=signature
        )

        # 4. Compare addresses
        if normalize_wallet(recovered_address) != wallet:
            logger.warning(
                f"Signature recovery mismatch. Expected {wallet}, got {recovered_address}"
            )
            return None

        # 5. Success - Issue JWT
        del pending_challenges[wallet]

        token_data = {
            "sub": wallet,
            "role": "agent",
            "iat": int(time.time()),
            "exp": int(time.time()) + max(60, int(settings.auth_token_ttl_sec)),
        }

        token = jwt.encode(token_data, settings.jwt_secret, algorithm="HS256")
        logger.info(f"Successfully authenticated wallet {wallet}")

        return token

    except Exception as e:
        logger.error(f"Signature verification failed: {e}")
        return None


def verify_owner_profile_update_signature(
    wallet_address: str, payload: dict[str, Any], signature: str, message: str
) -> bool:
    try:
        wallet = normalize_wallet(wallet_address)
        pending_entry = pending_owner_profile_update_challenges.get(wallet)
        if not pending_entry:
            logger.warning(f"No pending owner profile update challenge for {wallet}")
            return False

        if message != pending_entry.get("challenge"):
            logger.warning(f"Owner profile challenge mismatch for {wallet}")
            return False

        payload_hash = _owner_profile_payload_hash(wallet, payload)
        if payload_hash != pending_entry.get("payload_hash"):
            logger.warning(f"Owner profile payload hash mismatch for {wallet}")
            return False

        signable_message = encode_defunct(text=message)
        web3_class = _web3_class()
        w3 = web3_class()
        recovered_address = w3.eth.account.recover_message(
            signable_message, signature=signature
        )

        if normalize_wallet(recovered_address) != wallet:
            logger.warning(
                "Owner profile signature recovery mismatch. "
                f"Expected {wallet}, got {recovered_address}"
            )
            return False

        del pending_owner_profile_update_challenges[wallet]
        return True
    except Exception as e:
        logger.error(f"Owner profile signature verification failed: {e}")
        return False
