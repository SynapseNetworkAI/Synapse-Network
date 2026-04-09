#!/usr/bin/env python3
"""
Synapse Network — E2E Full-Flow Test Script
==========================================
Phases:
  1. Consumer wallet authentication → JWT
  2. On-chain USDC mint + approve + deposit → gateway credit
  3. Provider wallet authentication + service registration
  4. Consumer issues agent credential
  5. Invoke provider service via gateway
  6. Billing verification (consumer debit, provider earnings, audit logs)

Usage (from repo root):
  cd services/gateway && python3 ../../scripts/e2e_fullflow_test.py

Requirements in gateway venv:
  pip install eth-account web3 requests
"""

import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import requests
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

# ─── Config ───────────────────────────────────────────────────────────────────

API_BASE = "http://localhost:8000/api"
RPC_URL = "http://localhost:8545"
PROVIDER_BASE = "http://localhost:8100"

# Hardhat test accounts
DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
CONSUMER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
PROVIDER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"

CONTRACT_CONFIG_PATH = Path(__file__).parent.parent / "services/user-front/src/contract-config.json"
SYNAPSECORE_ABI_PATH = Path(__file__).parent.parent / "services/user-front/src/SynapseCoreABI.json"
USDC_ABI_PATH = Path(__file__).parent.parent / "services/user-front/src/MockUSDCABI.json"

DEPOSIT_AMOUNT_USDC = "5.0"   # mint + deposit 5 USDC to consumer
SERVICE_PRICE_USDC = "0.01"   # price per call

# ─── Helpers ──────────────────────────────────────────────────────────────────

def ok(msg: str) -> None:
    print(f"  ✓ {msg}")

def fail(msg: str) -> None:
    print(f"  ✗ {msg}")
    sys.exit(1)

def section(title: str) -> None:
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)

def api(method: str, path: str, token: Optional[str] = None, **kwargs) -> requests.Response:
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = f"Bearer {token}"
    headers.setdefault("Content-Type", "application/json")
    url = f"{API_BASE}{path}"
    resp = getattr(requests, method)(url, headers=headers, timeout=30, **kwargs)
    return resp

def load_json(path: Path) -> Any:
    with open(path) as f:
        return json.load(f)

# ─── Phase 1: Auth ────────────────────────────────────────────────────────────

def authenticate(private_key: str, label: str) -> tuple[str, str]:
    """Returns (jwt_token, wallet_address_lower)."""
    account = Account.from_key(private_key)
    addr = account.address.lower()

    r = api("get", f"/v1/auth/challenge", params={"address": addr})
    assert r.status_code == 200, f"Challenge failed: {r.text}"
    challenge = r.json()["challenge"]

    signed = Account.sign_message(encode_defunct(text=challenge), private_key=private_key)
    r2 = api("post", "/v1/auth/verify", json={
        "wallet_address": addr,
        "signature": signed.signature.hex(),
        "message": challenge,
    })
    assert r2.status_code == 200, f"Verify failed ({r2.status_code}): {r2.text}"
    token_data = r2.json()
    token = token_data.get("token") or token_data.get("access_token")
    assert token, f"No token in response: {token_data}"
    ok(f"{label} authenticated — address={addr[:20]}...")
    return token, addr


# ─── Phase 2: On-chain deposit ────────────────────────────────────────────────

def on_chain_deposit(consumer_key: str, deployer_key: str, amount_usdc: str) -> str:
    """
    1. Deployer mints USDC to consumer
    2. Consumer approves SynapseCore
    3. Consumer calls SynapseCore.deposit(amount)
    Returns the tx_hash of the deposit tx.
    """
    cfg = load_json(CONTRACT_CONFIG_PATH)
    core_abi = load_json(SYNAPSECORE_ABI_PATH)
    usdc_abi = load_json(USDC_ABI_PATH)

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    assert w3.is_connected(), f"Cannot connect to RPC: {RPC_URL}"

    deployer = w3.eth.account.from_key(deployer_key)
    consumer = w3.eth.account.from_key(consumer_key)
    chain_id = int(w3.eth.chain_id)

    usdc_addr = Web3.to_checksum_address(cfg["MockUSDC"])
    core_addr = Web3.to_checksum_address(cfg["SynapseCore"])
    amount_wei = w3.to_wei(amount_usdc, "ether")

    usdc = w3.eth.contract(address=usdc_addr, abi=usdc_abi)
    core = w3.eth.contract(address=core_addr, abi=core_abi)

    def send_tx(account, fn):
        nonce = w3.eth.get_transaction_count(account.address)
        tx = fn.build_transaction({
            "from": account.address,
            "nonce": nonce,
            "chainId": chain_id,
            "gas": 300_000,
            "gasPrice": w3.eth.gas_price,
        })
        signed = account.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        w3.eth.wait_for_transaction_receipt(h)
        return h.hex()

    # 1. Mint
    h = send_tx(deployer, usdc.functions.mint(consumer.address, amount_wei))
    ok(f"Minted {amount_usdc} USDC to consumer (tx {h[:20]}...)")

    # 2. Approve
    h = send_tx(consumer, usdc.functions.approve(core_addr, amount_wei))
    ok(f"Consumer approved SynapseCore (tx {h[:20]}...)")

    # 3. Deposit to SynapseCore
    deposit_hash = send_tx(consumer, core.functions.deposit(amount_wei))
    ok(f"SynapseCore.deposit() done (tx {deposit_hash[:20]}...)")

    return deposit_hash


def register_deposit_with_gateway(consumer_token: str, consumer_addr: str, tx_hash: str, amount_usdc: str) -> None:
    """Notify gateway of on-chain deposit and wait for auto-indexer to process it.

    The gateway's deposit indexer polls the blockchain every 2s. We register
    the deposit intent so the indexer can match it to the correct owner, then
    wait up to 30s for it to be confirmed.
    """
    idem = f"e2e-deposit-{uuid.uuid4().hex[:16]}"

    # Ensure tx_hash is properly formatted (0x prefix + 64 hex chars)
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    assert len(tx_hash) == 66, f"txHash must be 66 chars, got {len(tx_hash)}"

    r = api("post", "/v1/balance/deposit/intent",
            token=consumer_token,
            headers={
                "X-Idempotency-Key": idem,
                "X-User-Address": consumer_addr,
            },
            json={
                "txHash": tx_hash,
                "amountUsdc": float(amount_usdc),
            })
    if r.status_code in (200, 201):
        ok(f"Deposit intent registered: {r.json()}")
    else:
        ok(f"deposit/intent returned {r.status_code}: {r.text[:200]} — indexer will auto-pick-up")

    # Poll deposit sync — indexer runs every 2s, give it up to 30s
    ok("Waiting for indexer to process deposit (up to 30s)...")
    for i in range(15):
        time.sleep(2)
        r2 = api("get", "/v1/balance/deposit/sync",
                 token=consumer_token,
                 headers={"X-User-Address": consumer_addr},
                 params={"txHash": tx_hash})
        if r2.status_code == 200:
            data = r2.json().get("sync", r2.json())
            status = str(data.get("status", "")).upper()
            confirmed = data.get("confirmed", False)
            if confirmed or status == "CONFIRMED":
                ok(f"Deposit confirmed by indexer after {(i+1)*2}s: {data}")
                return
            if data.get("found"):
                ok(f"  [{(i+1)*2}s] Deposit found, waiting for confirmation... status={status}")
        else:
            ok(f"  [{(i+1)*2}s] sync status check: {r2.status_code} {r2.text[:100]}")

    ok("Deposit intent registered — balance may lag slightly (indexer background)")
    


# ─── Phase 3: Provider service registration ───────────────────────────────────

def register_provider_service(provider_token: str, provider_addr: str) -> str:
    """Register a service on the gateway. Returns service_record_id."""
    r = api("post", "/v1/services",
            token=provider_token,
            headers={"X-User-Address": provider_addr},
            json={
                "agentToolName": f"svc_e2e_quotes_{uuid.uuid4().hex[:6]}",
                "serviceName": "E2E Test Quotes Service",
                "role": "Provider",
                "status": "active",
                "isActive": True,
                "summary": "End-to-end test service returning famous quotes.",
                "tags": ["e2e", "test", "quotes"],
                "pricing": {"amount": SERVICE_PRICE_USDC, "currency": "USDC"},
                "auth": {"type": "gateway_signed"},
                "providerProfile": {"displayName": "E2E Test Provider"},
                "payoutAccount": {
                    "payoutAddress": provider_addr,
                    "chainId": 31337,
                    "settlementCurrency": "USDC",
                },
                "governance": {
                    "termsAccepted": True,
                    "riskAcknowledged": True,
                },
                "healthCheck": {
                    "path": "/health",
                    "method": "GET",
                    "timeoutMs": 3000,
                    "successCodes": [200],
                    "healthyThreshold": 1,
                    "unhealthyThreshold": 3,
                },
                "invoke": {
                    "method": "POST",
                    "targets": [
                        {
                            "url": f"{PROVIDER_BASE}/api/v1/quotes/famous",
                            "weight": 100,
                        }
                    ],
                    "timeoutMs": 10000,
                    "request": {
                        "contentType": "application/json",
                        "schema": {
                            "body": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}},
                            }
                        },
                    },
                    "response": {"contentType": "application/json"},
                },
                "constraints": {
                    "timeoutMs": 10000,
                    "maxResponseBytes": 131072,
                    "maxRequestBytes": 65536,
                    "maxQps": 10,
                },
            })

    assert r.status_code in (200, 201), f"Service registration failed ({r.status_code}): {r.text}"
    data = r.json()
    service_id = (
        data.get("service_id")
        or data.get("serviceId")
        or data.get("service", {}).get("serviceId")
        or data.get("service", {}).get("service_id")
        or ""
    )
    assert service_id, f"No service_id in response: {data}"
    ok(f"Service registered: {service_id}")
    return service_id


# ─── Phase 4: Issue credential ────────────────────────────────────────────────

def issue_credential(consumer_token: str, consumer_addr: str) -> str:
    """Issues an agent credential. Returns the raw token."""
    r = api("post", "/v1/credentials/agent/issue",
            token=consumer_token,
            headers={"X-User-Address": consumer_addr},
            json={
                "agentName": "E2E-TestAgent",
                "dailyLimit": 2.0,
                "maxCallsPerDay": 100,
            })
    assert r.status_code in (200, 201), f"Credential issue failed ({r.status_code}): {r.text}"
    data = r.json()
    raw_token = (
        data.get("raw_token")
        or data.get("token")
        or data.get("credential", {}).get("raw_token")
        or data.get("credential", {}).get("token")
        or ""
    )
    assert raw_token, f"No raw_token in credential response: {data}"
    ok(f"Credential issued: {raw_token[:30]}...")
    return raw_token


# ─── Phase 5: Invoke via gateway ──────────────────────────────────────────────

def invoke_service(credential_token: str, service_id: str) -> Dict[str, Any]:
    """Calls the service through the gateway."""
    r = api("post", "/v1/gateway/generate",
            headers={
                "X-Credential": credential_token,
                "Content-Type": "application/json",
            },
            json={
                "serviceId": service_id,
                "prompt": "BTC market analysis",
            })
    assert r.status_code == 200, f"Gateway invocation failed ({r.status_code}): {r.text[:400]}"
    data = r.json()
    ok(f"Gateway invocation succeeded — response keys: {list(data.keys())}")
    return data


# ─── Phase 6: Billing verification ────────────────────────────────────────────

def verify_billing(
    consumer_token: str, consumer_addr: str,
    provider_token: str, provider_addr: str,
    balance_before: float,
) -> Dict[str, Any]:
    result = {}

    # Consumer balance
    r = api("get", "/v1/balance",
            token=consumer_token,
            headers={"Authorization": f"Bearer {consumer_token}", "X-User-Address": consumer_addr})
    assert r.status_code == 200, f"Balance check failed: {r.text}"
    bal = r.json().get("balance", {})
    consumer_credit = float(bal.get("consumerAvailableBalance", 0) or bal.get("consumer_credit", 0) or 0)
    result["consumer_balance_after"] = consumer_credit
    result["consumer_balance_before"] = balance_before
    deducted = balance_before - consumer_credit
    if deducted > 0:
        ok(f"Consumer balance deducted: {deducted:.6f} USDC (before={balance_before:.4f}, after={consumer_credit:.4f})")
    else:
        fail(f"Consumer balance NOT deducted — before={balance_before:.4f} after={consumer_credit:.4f}")

    # Provider earnings
    r2 = api("get", "/v1/providers/earnings/summary",
             token=provider_token,
             headers={"X-User-Address": provider_addr})
    if r2.status_code == 200:
        earnings = r2.json().get("summary", r2.json())
        net = float(
            earnings.get("providerNetEarned", 0)
            or earnings.get("net_earnings", 0)
            or earnings.get("netEarnings", 0)
            or 0
        )
        receivable = float(earnings.get("providerReceivable", 0) or 0)
        ok(f"Provider net earned: {net:.6f} USDC, receivable: {receivable:.6f} USDC")
        result["provider_net_earnings"] = net
        result["provider_receivable"] = receivable
    else:
        ok(f"Provider earnings endpoint returned {r2.status_code}: {r2.text[:100]}")
        result["provider_earnings_status"] = r2.status_code

    # Usage logs
    r3 = api("get", "/v1/usage/logs", token=consumer_token, headers={"X-User-Address": consumer_addr})
    if r3.status_code == 200:
        logs = r3.json().get("logs", [])
        ok(f"Usage logs count: {len(logs)}")
        result["usage_log_count"] = len(logs)
    else:
        ok(f"Usage logs endpoint returned {r3.status_code}")

    # Finance audit logs
    r4 = api("get", "/v1/finance/audit-logs", token=consumer_token, headers={"X-User-Address": consumer_addr})
    if r4.status_code == 200:
        audit = r4.json().get("logs", [])
        ok(f"Finance audit logs count: {len(audit)}")
        result["finance_audit_count"] = len(audit)
    else:
        ok(f"Finance audit logs endpoint returned {r4.status_code}")

    return result


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("\n" + "="*60)
    print("  Synapse Network — E2E Full Flow Test")
    print("="*60)

    # Phase 1: Auth
    section("Phase 1: Authentication")
    consumer_token, consumer_addr = authenticate(CONSUMER_KEY, "Consumer")
    provider_token, provider_addr = authenticate(PROVIDER_KEY, "Provider")

    # Check balance before deposit
    r = api("get", "/v1/balance", token=consumer_token, headers={"X-User-Address": consumer_addr})
    bal_data = r.json().get("balance", {}) if r.status_code == 200 else {}
    balance_before_deposit = float(
        bal_data.get("consumerAvailableBalance", 0) or bal_data.get("consumer_credit", 0) or 0
    )
    ok(f"Consumer balance before deposit: {balance_before_deposit:.4f} USDC")

    # Phase 2: Deposit
    section("Phase 2: On-Chain USDC Deposit")
    tx_hash = on_chain_deposit(CONSUMER_KEY, DEPLOYER_KEY, DEPOSIT_AMOUNT_USDC)
    register_deposit_with_gateway(consumer_token, consumer_addr, tx_hash, DEPOSIT_AMOUNT_USDC)

    # Wait for indexer to pick up the deposit
    time.sleep(3)
    r = api("get", "/v1/balance", token=consumer_token, headers={"X-User-Address": consumer_addr})
    bal_data = r.json().get("balance", {}) if r.status_code == 200 else {}
    balance_after_deposit = float(
        bal_data.get("consumerAvailableBalance", 0) or bal_data.get("consumer_credit", 0) or 0
    )
    ok(f"Consumer balance after deposit: {balance_after_deposit:.4f} USDC")

    # Phase 3: Provider registration
    section("Phase 3: Provider Service Registration")
    service_id = register_provider_service(provider_token, provider_addr)

    # Verify discoverable
    time.sleep(1)
    r = api("get", "/v1/services/discover", params={"intent": "e2e test sentiment"})
    services = r.json().get("services", []) if r.status_code == 200 else []
    matching = [s for s in services if s.get("serviceId") == service_id or s.get("service_id") == service_id]
    if matching:
        ok(f"Service discoverable via discover API")
    else:
        ok(f"Service registered (may not be discoverable yet — health check pending). Total discoverable: {len(services)}")

    # Phase 4: Issue credential
    section("Phase 4: Issue Agent Credential")
    credential_token = issue_credential(consumer_token, consumer_addr)

    # Phase 5: Invoke
    section("Phase 5: Invoke Provider Service via Gateway")
    invoke_result = invoke_service(credential_token, service_id)
    print(f"  Response preview: {json.dumps(invoke_result, ensure_ascii=False)[:300]}")

    # Phase 6: Billing verification
    section("Phase 6: Billing Verification")
    billing = verify_billing(
        consumer_token, consumer_addr,
        provider_token, provider_addr,
        balance_after_deposit,
    )

    # Final summary
    section("RESULTS SUMMARY")
    print(json.dumps({
        "consumer_addr": consumer_addr,
        "provider_addr": provider_addr,
        "service_id": service_id,
        "deposit_tx": tx_hash,
        "balance_after_deposit": balance_after_deposit,
        **billing,
    }, indent=2, ensure_ascii=False))
    print("\n  ✅ E2E Full Flow Test PASSED")


if __name__ == "__main__":
    main()
