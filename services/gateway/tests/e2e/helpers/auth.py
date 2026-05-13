"""Auth helper: challenge → sign → verify → JWT."""
from __future__ import annotations

import time

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

    last_error: Exception | None = None
    # Staging Cloud Run occasionally returns a transient 401 on verify even though
    # the immediately retried challenge/verify pair succeeds. Keep the helper
    # deterministic by retrying the whole auth exchange a few times.
    for attempt in range(3):
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
        if r2.status_code == 200:
            token_data = r2.json()
            assert token_data.get("success"), f"Verify failed: {token_data}"
            return token_data["access_token"], address
        last_error = httpx.HTTPStatusError(
            f"Client error '{r2.status_code}' for url '{r2.request.url}'",
            request=r2.request,
            response=r2,
        )
        if attempt < 2 and r2.status_code in (400, 401):
            time.sleep(0.25 * (attempt + 1))
            continue
        r2.raise_for_status()
    assert last_error is not None
    raise last_error
