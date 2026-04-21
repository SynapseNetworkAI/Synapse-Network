"""Step 1: 基础设施健康检查"""
import httpx
import pytest
from web3 import Web3
from tests.e2e.conftest import GATEWAY_BASE, PROVIDER_BASE, RPC_URL
from tests.e2e.conftest import RELEASE_E2E


def test_gateway_health():
    r = httpx.get(f"{GATEWAY_BASE}/health", timeout=10)
    assert r.status_code == 200, f"Gateway not healthy: {r.text}"
    body = r.json()
    assert body.get("status") in ("ok", "healthy", "running"), f"Unexpected status: {body}"


def test_provider_health():
    try:
        r = httpx.get(f"{PROVIDER_BASE}/health", timeout=10)
        assert r.status_code == 200, f"Provider not healthy: {r.text}"
    except httpx.ConnectError:
        if RELEASE_E2E:
            pytest.fail(f"Gateway release e2e requires provider service at {PROVIDER_BASE}")
        pytest.skip("Provider service not running on :8001 — skipping provider tests")


def test_hardhat_rpc_connected(w3):
    assert w3.is_connected(), f"Cannot connect to RPC: {RPC_URL}"
    block = w3.eth.block_number
    assert isinstance(block, int) and block >= 0, f"Bad block number: {block}"


def test_contract_config_has_required_keys(contract_config):
    assert "SynapseCore" in contract_config, "SynapseCore address missing"
    assert "MockUSDC" in contract_config, "MockUSDC address missing"
    assert contract_config["SynapseCore"].startswith("0x"), "SynapseCore not an address"
    assert contract_config["MockUSDC"].startswith("0x"), "MockUSDC not an address"


def test_synapse_core_deployed(w3, contract_config):
    addr = Web3.to_checksum_address(contract_config["SynapseCore"])
    code = w3.eth.get_code(addr)
    assert code and code != b"\x00", f"No contract code at SynapseCore {addr}"


def test_mock_usdc_deployed(w3, contract_config):
    addr = Web3.to_checksum_address(contract_config["MockUSDC"])
    code = w3.eth.get_code(addr)
    assert code and code != b"\x00", f"No contract code at MockUSDC {addr}"
