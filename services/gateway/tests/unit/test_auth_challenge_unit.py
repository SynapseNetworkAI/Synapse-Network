import asyncio

from src.api.routers.auth import get_challenge
from src.core.auth import create_auth_challenge, pending_challenges
from src.core.config import settings


def test_auth_challenge_uses_environment_domain(monkeypatch) -> None:
    pending_challenges.clear()
    monkeypatch.setattr(settings, "public_app_base_url", "http://localhost:3000")

    challenge = create_auth_challenge(
        "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
        chain_id=421614,
    )

    assert challenge is not None
    assert challenge.startswith(
        "localhost:3000 wants you to sign in with your Ethereum account:\n"
    )
    assert "Login to A2A Pay Network" not in challenge
    assert "\n0xabcdefabcdefabcdefabcdefabcdefabcdefabcd\n" in challenge
    assert "This does not authorize a transaction or move funds." in challenge
    assert "\nURI: http://localhost:3000\n" in challenge
    assert "\nChain ID: 421614\n" in challenge
    assert "\nNonce: " in challenge
    assert "\nIssued At: " in challenge
    assert "\nExpiration Time: " in challenge


def test_auth_challenge_response_uses_environment_domain(monkeypatch) -> None:
    pending_challenges.clear()
    monkeypatch.setattr(
        settings, "public_app_base_url", "https://staging.synapse-network.ai"
    )

    response = asyncio.run(get_challenge("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD"))

    assert response.domain == "staging.synapse-network.ai"
    assert response.challenge.startswith(
        "staging.synapse-network.ai wants you to sign in with your Ethereum account:\n"
    )
    assert "\nURI: https://staging.synapse-network.ai\n" in response.challenge
