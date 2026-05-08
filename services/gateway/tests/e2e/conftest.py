"""Run from services/gateway/ directory:
    pytest tests/e2e/ -v --tb=short

Services must be running before test execution:
    scripts/local/setup_local_env.sh   (deploy contracts, start Hardhat/Anvil)
    scripts/local/restart_gateway.sh   (start Gateway on :8000)
"""

from __future__ import annotations

import json
import os
import uuid
from decimal import Decimal
from pathlib import Path

import pytest
import httpx
from web3 import Web3

from tests.e2e.helpers.service_fixtures import is_test_service_id

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
RELEASE_E2E = os.getenv("GATEWAY_RELEASE_E2E", "").lower() == "true"

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
    "0xa9bc3f60a86d4a18c83113631aed4e39c9a83d76c95b9e229385e5e0c60b2a71",
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


@pytest.fixture(scope="session", autouse=True)
def guard_local_service_registry_bloat(require_live_gateway) -> None:
    """Fail early when stale local E2E services would pollute discovery.

    This is read-only and local-only. Staging SQL evidence uses separate
    runbook credentials and should not inherit the local cleanup guard.
    """
    if not GATEWAY_BASE.startswith(("http://127.0.0.1", "http://localhost")):
        return
    limit_raw = os.getenv(
        "GATEWAY_E2E_TEST_ACTIVE_LIMIT",
        os.getenv("LOCAL_SERVICE_REGISTRY_TEST_ACTIVE_LIMIT", "50"),
    )
    try:
        limit = int(limit_raw)
    except ValueError:
        limit = 50
    if limit <= 0:
        return
    try:
        import psycopg
        from tests.e2e.helpers.db import DB_DSN

        with psycopg.connect(DB_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT service_id
                    FROM synapse_service_manifests
                    WHERE status = 'active'
                    """
                )
                rows = [row[0] for row in cur.fetchall()]
    except Exception:
        return
    active_test_count = sum(1 for service_id in rows if is_test_service_id(service_id))
    if active_test_count > limit:
        pytest.fail(
            f"local registry has {active_test_count} active E2E/test services; "
            f"limit is {limit}. Run "
            "`LOCAL_DEV_CLEANUP_CONFIRM=I_UNDERSTAND_THIS_MUTATES_LOCAL_DB "
            "bash scripts/local/cleanup_service_registry_dev.sh` before E2E."
        )


@pytest.fixture(scope="session", autouse=True)
def archive_new_local_test_services(require_live_gateway):
    """Archive test services created during a local E2E session.

    Provider registration/onboarding flows may still exercise the write path,
    but they must not leave active manifests or health runtime rows behind.
    """
    if not GATEWAY_BASE.startswith(("http://127.0.0.1", "http://localhost")):
        yield
        return

    try:
        from tests.e2e.helpers.db import active_test_service_ids, archive_test_service

        before = active_test_service_ids()
    except Exception:
        yield
        return

    yield

    try:
        after = active_test_service_ids()
        for service_id in sorted(after - before):
            archive_test_service(service_id)
    except Exception:
        return


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


# Shared mutable state for cross-test data
_session_state: dict = {}
_E2E_CREDENTIAL_NAME_PREFIXES = (
    "e2e-agent-",
    "api-ref-test-",
    "inv-test-",
    "provider-gpp-e2e-local-",
)


def revoke_stale_e2e_agent_credentials(headers: dict) -> int:
    """Revoke old local E2E credentials so max-agent limits stay deterministic."""
    response = httpx.get(
        f"{GATEWAY_BASE}/api/v1/credentials/agent/list",
        headers=headers,
        params={"active_only": "true"},
        timeout=15,
    )
    if response.status_code != 200:
        return 0
    revoked = 0
    for credential in response.json().get("credentials", []):
        name = str(credential.get("name") or "").strip()
        if not name.startswith(_E2E_CREDENTIAL_NAME_PREFIXES):
            continue
        credential_id = (
            credential.get("credentialId")
            or credential.get("credential_id")
            or credential.get("id")
        )
        if not credential_id:
            continue
        revoke_response = httpx.post(
            f"{GATEWAY_BASE}/api/v1/credentials/agent/{credential_id}/revoke",
            headers=headers,
            timeout=15,
        )
        if revoke_response.status_code in (200, 204, 404):
            revoked += 1
    return revoked


@pytest.fixture(scope="session")
def session_state() -> dict:
    """Mutable dict shared across all e2e tests in a session."""
    return _session_state
