import asyncio

from src.api.routers.auth import get_challenge
from src.core.auth import create_auth_challenge, pending_challenges


def test_auth_challenge_uses_synapse_network_brand() -> None:
    pending_challenges.clear()

    challenge = create_auth_challenge(
        "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
        chain_id=421614,
    )

    assert challenge is not None
    assert challenge.startswith(
        "synapse-network.ai wants you to sign in with your Ethereum account:\n"
    )
    assert "Login to A2A Pay Network" not in challenge
    assert "\n0xabcdefabcdefabcdefabcdefabcdefabcdefabcd\n" in challenge
    assert "This does not authorize a transaction or move funds." in challenge
    assert "\nChain ID: 421614\n" in challenge
    assert "\nNonce: " in challenge
    assert "\nIssued At: " in challenge


def test_auth_challenge_response_uses_synapse_network_domain() -> None:
    pending_challenges.clear()

    response = asyncio.run(get_challenge("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD"))

    assert response.domain == "synapse-network"
    assert response.challenge.startswith(
        "synapse-network.ai wants you to sign in with your Ethereum account:\n"
    )
