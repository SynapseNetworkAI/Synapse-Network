"""Step 2: 钱包 Auth — Challenge → Sign → Verify → JWT"""
import httpx
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from tests.e2e.conftest import GATEWAY_BASE, OWNER_KEY, PROVIDER_KEY
from tests.e2e.helpers.auth import authenticate_wallet


def test_owner_auth_full_flow():
    token, address = authenticate_wallet(GATEWAY_BASE, OWNER_KEY)
    assert token and len(token) > 20, "JWT token too short or empty"
    assert address.startswith("0x"), "address should start with 0x"


def test_provider_auth_full_flow():
    token, address = authenticate_wallet(GATEWAY_BASE, PROVIDER_KEY)
    assert token and len(token) > 20


def test_challenge_returns_valid_message():
    account = Account.from_key(OWNER_KEY)
    address = account.address.lower()
    r = httpx.get(
        f"{GATEWAY_BASE}/api/v1/auth/challenge",
        params={"address": address},
        timeout=15,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert "challenge" in data
    assert len(data["challenge"]) > 10


def test_fake_signature_rejected():
    account = Account.from_key(OWNER_KEY)
    address = account.address.lower()

    # get legitimate challenge
    r = httpx.get(
        f"{GATEWAY_BASE}/api/v1/auth/challenge",
        params={"address": address},
        timeout=15,
    )
    r.raise_for_status()
    message = r.json()["challenge"]

    # submit a garbage signature
    r2 = httpx.post(
        f"{GATEWAY_BASE}/api/v1/auth/verify",
        headers={"Content-Type": "application/json"},
        json={
            "wallet_address": address,
            "signature": "0x" + "ab" * 65,
            "message": message,
        },
        timeout=15,
    )
    assert r2.status_code in (401, 400, 422), (
        f"Expected 4xx for fake signature, got {r2.status_code}: {r2.text}"
    )


def test_owner_jwt_stored_in_session(owner_jwt):
    """Fixture-based auth; token must be non-empty string."""
    assert isinstance(owner_jwt, str) and len(owner_jwt) > 20
