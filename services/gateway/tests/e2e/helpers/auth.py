"""Auth helper: challenge → sign → verify → JWT."""
from __future__ import annotations

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct


def authenticate_wallet(gateway_base: str, private_key: str) -> tuple[str, str]:
    """
    Full Challenge-Verify flow.
    Returns (jwt_token, wallet_address_lower).
    """
    account = Account.from_key(private_key)
    address = account.address.lower()

    # 1. Get challenge
    r = httpx.get(
        f"{gateway_base}/api/v1/auth/challenge",
        params={"address": address},
        timeout=20,
    )
    r.raise_for_status()
    data = r.json()
    assert data.get("success"), f"Challenge failed: {data}"
    message = data["challenge"]

    # 2. Sign
    signed = Account.sign_message(encode_defunct(text=message), private_key=private_key)

    # 3. Verify
    r2 = httpx.post(
        f"{gateway_base}/api/v1/auth/verify",
        headers={"Content-Type": "application/json"},
        json={
            "wallet_address": address,
            "signature": signed.signature.hex(),
            "message": message,
        },
        timeout=20,
    )
    r2.raise_for_status()
    token_data = r2.json()
    assert token_data.get("success"), f"Verify failed: {token_data}"
    return token_data["access_token"], address
