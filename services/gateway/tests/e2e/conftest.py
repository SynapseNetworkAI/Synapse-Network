"""Run from services/gateway/ directory:
    pytest tests/e2e/ -v --tb=short

Services must be running before test execution:
    scripts/local/setup_local_env.sh   (deploy contracts, start Hardhat/Anvil)
    scripts/local/restart_gateway.sh   (start Gateway on :8000)
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

# ── Directory layout ──────────────────────────────────────────────────────────
ROOT = Path(__file__).parents[4]          # services/gateway/tests/e2e -> repo root
FRONTEND_SRC = ROOT / "services" / "user-front" / "src"
CONTRACT_CONFIG_PATH = Path(
    os.getenv("GATEWAY_E2E_CONTRACT_CONFIG_PATH", str(FRONTEND_SRC / "contract-config.json"))
)
MOCK_USDC_ABI_PATH = FRONTEND_SRC / "MockUSDCABI.json"
SYNAPSE_CORE_ABI_PATH = FRONTEND_SRC / "SynapseCoreABI.json"

# ── Service URLs ───────────────────────────────────────────────────────────────
GATEWAY_BASE = os.getenv("GATEWAY_E2E_GATEWAY_BASE", "http://127.0.0.1:8000")
PROVIDER_BASE = os.getenv("GATEWAY_E2E_PROVIDER_BASE", "http://127.0.0.1:8001")
RPC_URL = os.getenv("GATEWAY_E2E_RPC_URL", "http://127.0.0.1:8545")
MOCK_SERVICE_PORT = int(os.getenv("GATEWAY_E2E_MOCK_SERVICE_PORT", "9099"))
RELEASE_E2E = os.getenv("GATEWAY_RELEASE_E2E", "").lower() == "true"
PROVIDER_INVOKE_URL = os.getenv("GATEWAY_E2E_PROVIDER_INVOKE_URL", "").strip()

# ── Hardhat default private keys (localhost ONLY) ─────────────────────────────
DEPLOYER_KEY = os.getenv(
    "GATEWAY_E2E_DEPLOYER_KEY",
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
)
OWNER_KEY = os.getenv(
    "GATEWAY_E2E_OWNER_KEY",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
)
PROVIDER_KEY = os.getenv(
    "GATEWAY_E2E_PROVIDER_KEY",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594801966b8ea0ecf",
)

# ── Test amounts ───────────────────────────────────────────────────────────────
FUND_USDC    = Decimal("100")
FUND_ETH     = Decimal("1")
DEPOSIT_USDC = Decimal("10")

# Unique suffix per test session to avoid name collisions on re-run
SESSION_ID = uuid.uuid4().hex[:8]


# ── Session-scoped fixtures ────────────────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def require_live_gateway() -> None:
    try:
        response = httpx.get(f"{GATEWAY_BASE}/health", timeout=2.0)
        response.raise_for_status()
    except Exception as exc:
        if RELEASE_E2E:
            pytest.fail(f"gateway release e2e requires live gateway at {GATEWAY_BASE}: {exc}")
        pytest.skip(f"gateway e2e services are not running locally: {exc}")

@pytest.fixture(scope="session")
def contract_config() -> dict:
    assert CONTRACT_CONFIG_PATH.exists(), (
        f"contract-config.json not found at {CONTRACT_CONFIG_PATH}. "
        "Run scripts/local/setup_local_env.sh first."
    )
    with CONTRACT_CONFIG_PATH.open() as f:
        return json.load(f)


@pytest.fixture(scope="session")
def mock_usdc_abi() -> list:
    with MOCK_USDC_ABI_PATH.open() as f:
        return json.load(f)


@pytest.fixture(scope="session")
def synapse_core_abi() -> list:
    with SYNAPSE_CORE_ABI_PATH.open() as f:
        return json.load(f)


@pytest.fixture(scope="session")
def w3() -> Web3:
    instance = Web3(Web3.HTTPProvider(RPC_URL))
    assert instance.is_connected(), f"Cannot connect to RPC at {RPC_URL}"
    return instance


@pytest.fixture(scope="session")
def deployer_account(w3: Web3):
    return w3.eth.account.from_key(DEPLOYER_KEY)


@pytest.fixture(scope="session")
def owner_account(w3: Web3):
    return w3.eth.account.from_key(OWNER_KEY)


@pytest.fixture(scope="session")
def provider_account(w3: Web3):
    return w3.eth.account.from_key(PROVIDER_KEY)


@pytest.fixture(scope="session")
def fresh_provider_account():
    """Ephemeral provider wallet for onboarding e2e.

    This mirrors real-world provider onboarding more closely than reusing a
    pre-seeded hardhat account, because wallet auth itself is off-chain.
    """
    return Account.create(f"provider-onboarding-{SESSION_ID}")


@pytest.fixture(scope="session")
def owner_jwt(owner_account) -> str:
    """Authenticate owner wallet and return JWT token."""
    from tests.e2e.helpers.auth import authenticate_wallet
    token, _ = authenticate_wallet(GATEWAY_BASE, OWNER_KEY)
    return token


@pytest.fixture(scope="session")
def provider_jwt(provider_account) -> str:
    """Authenticate provider wallet and return JWT token."""
    from tests.e2e.helpers.auth import authenticate_wallet
    token, _ = authenticate_wallet(GATEWAY_BASE, PROVIDER_KEY)
    return token


@pytest.fixture(scope="session")
def fresh_provider_jwt(fresh_provider_account) -> str:
    """Authenticate a brand-new provider wallet and return JWT token."""
    from tests.e2e.helpers.auth import authenticate_wallet
    token, _ = authenticate_wallet(
        GATEWAY_BASE, fresh_provider_account.key.hex()
    )
    return token


@pytest.fixture(scope="session")
def owner_headers(owner_jwt: str, owner_account) -> dict:
    return {
        "Authorization": f"Bearer {owner_jwt}",
        "X-User-Address": owner_account.address.lower(),
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="session")
def provider_headers(provider_jwt: str, provider_account) -> dict:
    return {
        "Authorization": f"Bearer {provider_jwt}",
        "X-User-Address": provider_account.address.lower(),
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="session")
def fresh_provider_headers(fresh_provider_jwt: str, fresh_provider_account) -> dict:
    return {
        "Authorization": f"Bearer {fresh_provider_jwt}",
        "X-User-Address": fresh_provider_account.address.lower(),
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="session")
def service_tool_name() -> str:
    return f"svc_e2e_{SESSION_ID}"


# ── Mock provider HTTP server ─────────────────────────────────────────────────

class _MockProviderHandler(BaseHTTPRequestHandler):
    """Minimal HTTP server that satisfies health-check (GET) and invoke (POST)."""

    def log_message(self, format, *args):  # noqa: A002
        pass  # silence request logs in test output

    def do_GET(self):
        body = b'{"status":"healthy"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = b'{"result":"e2e mock provider response"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture(scope="session")
def mock_service_url() -> str:
    """Start an in-process mock HTTP server and yield its base URL."""
    if PROVIDER_INVOKE_URL:
        yield PROVIDER_INVOKE_URL
        return
    server = HTTPServer(("127.0.0.1", MOCK_SERVICE_PORT), _MockProviderHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{MOCK_SERVICE_PORT}"
    server.shutdown()


# Shared mutable state for cross-test data
_session_state: dict = {}


@pytest.fixture(scope="session")
def session_state() -> dict:
    """Mutable dict shared across all e2e tests in a session."""
    return _session_state
