import secrets
import time
from eth_account.messages import encode_defunct
from typing import Optional
from cachetools import TTLCache

from .common import normalize_wallet
from .config import settings
from loguru import logger
import jwt


def _web3_class():
    from web3 import Web3

    return Web3

# Cache for pending auth challenges - simple in-memory cache
# Format: {wallet_address: challenge_string}
pending_challenges = TTLCache(
    maxsize=1000,
    ttl=max(30, int(settings.auth_challenge_ttl_sec)),
)


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
