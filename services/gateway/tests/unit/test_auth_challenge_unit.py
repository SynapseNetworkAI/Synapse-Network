import asyncio

from src.api.routers.auth import get_challenge
from src.core.auth import create_auth_challenge, pending_challenges


def test_auth_challenge_uses_synapse_network_brand() -> None:
    pending_challenges.clear()

    challenge = create_auth_challenge("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD")

    assert challenge is not None
    assert challenge.startswith("Login to SynapseNetwork\n")
    assert "Login to A2A Pay Network" not in challenge
    assert "Wallet: 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" in challenge
    assert "\nNonce: " in challenge
    assert "\nTimestamp: " in challenge


def test_auth_challenge_response_uses_synapse_network_domain() -> None:
    pending_challenges.clear()

    response = asyncio.run(get_challenge("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD"))

    assert response.domain == "synapse-network"
    assert response.challenge.startswith("Login to SynapseNetwork\n")
