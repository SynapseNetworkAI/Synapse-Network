#!/usr/bin/env python3
# ruff: noqa: S105, C901, PLR0915, S110 - legacy standalone browser E2E is tracked by quality-budget baseline
"""
Synapse Network — Full-Chain Test Suite with Browser Screenshots
=================================================================
Steps:
  1. Generate / use Hardhat test wallet (account #3, "new buyer")
  2. Fund wallet: ETH + USDC on-chain
  3. Gateway auth + API: deposit, create agents, service, invoke
  4. Screenshot all pages via Playwright (wallet injected)
  5. Verify data visible on each page
  6. Record any bugs

Usage:
  cd services/gateway
  python3 ../../scripts/fullchain_browser_test.py

Output:
  docs/reference/test/gateway/screenshots/wallet-connected/NN-name.png
"""

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
import sys

import requests
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

# ── Playwright async ──────────────────────────────────────────────────────────
from playwright.async_api import async_playwright

# ─── Config ───────────────────────────────────────────────────────────────────
API_BASE      = "http://localhost:8000/api"
RPC_URL       = "http://localhost:8545"
PROVIDER_BASE = "http://localhost:8100"
FRONTEND_URL  = "http://localhost:3000"
CHAIN_ID      = 31337

# Hardhat account #0 (deployer)
DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
# Hardhat account #2 (provider — already used in previous tests)
PROVIDER_KEY    = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
# Hardhat account #3 — NEW buyer wallet (never used before)
BUYER_KEY     = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
BUYER_ADDR    = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"

DEPOSIT_USDC  = "10.0"   # fund buyer with 10 USDC
SERVICE_PRICE = "0.01"
GATEWAY_E2E_SERVICE_ID = os.getenv(
    "GATEWAY_E2E_SERVICE_ID", "svc_oss_security_healthcheck"
).strip() or "svc_oss_security_healthcheck"
GATEWAY_E2E_ALLOW_SERVICE_CREATION = os.getenv(
    "GATEWAY_E2E_ALLOW_SERVICE_CREATION", ""
).strip().lower() in {"1", "true", "yes", "on"}

FRONT_DIR = Path(__file__).parent.parent / "services" / "user-front" / "src"
CONTRACT_CFG  = FRONT_DIR / "contract-config.json"
CORE_ABI_PATH = FRONT_DIR / "SynapseCoreABI.json"
USDC_ABI_PATH = FRONT_DIR / "MockUSDCABI.json"

SCREENSHOT_DIR = (
    Path(__file__).parent.parent
    / "docs" / "reference" / "test" / "gateway" / "screenshots" / "wallet-connected"
)

# ─── Helpers ──────────────────────────────────────────────────────────────────
PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
WARN = "\033[93m!\033[0m"

def api(method, path, token=None, **kw):
    h = kw.pop("headers", {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    h.setdefault("Content-Type", "application/json")
    return getattr(requests, method)(f"{API_BASE}{path}", headers=h, timeout=30, **kw)

def section(title):
    print(f"\n{'='*64}\n  {title}\n{'='*64}")

def chk(ok, label, detail=""):
    sym = PASS if ok else FAIL
    print(f"  {sym} {label}" + (f"  [{detail}]" if detail else ""))
    return ok

# ─── Backend helpers ──────────────────────────────────────────────────────────
def authenticate(key, label):
    account = Account.from_key(key)
    addr = account.address.lower()
    r = requests.get(f"{API_BASE}/v1/auth/challenge", params={"address": addr}, timeout=30)
    assert r.status_code == 200, f"Challenge failed: {r.text}"
    challenge = r.json()["challenge"]
    signed = Account.sign_message(encode_defunct(text=challenge), private_key=key)
    r2 = requests.post(f"{API_BASE}/v1/auth/verify", json={
        "wallet_address": addr,
        "signature": signed.signature.hex(),
        "message": challenge,
    }, timeout=30)
    assert r2.status_code == 200, f"Verify failed: {r2.text}"
    token = r2.json().get("token") or r2.json().get("access_token")
    print(f"  {PASS} {label} authenticated — {addr}")
    return token, addr

def on_chain_fund(buyer_key, deployer_key, amount_usdc):
    cfg      = json.loads(CONTRACT_CFG.read_text())
    core_abi = json.loads(CORE_ABI_PATH.read_text())
    usdc_abi = json.loads(USDC_ABI_PATH.read_text())
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    deployer = w3.eth.account.from_key(deployer_key)
    buyer    = w3.eth.account.from_key(buyer_key)
    chain_id = int(w3.eth.chain_id)
    usdc = w3.eth.contract(address=Web3.to_checksum_address(cfg["MockUSDC"]), abi=usdc_abi)
    core = w3.eth.contract(address=Web3.to_checksum_address(cfg["SynapseCore"]), abi=core_abi)
    amount_wei = w3.to_wei(amount_usdc, "ether")

    def send_tx(acct, fn):
        nonce = w3.eth.get_transaction_count(acct.address)
        tx = fn.build_transaction({"from": acct.address, "nonce": nonce,
                                   "chainId": chain_id, "gas": 300_000,
                                   "gasPrice": w3.eth.gas_price})
        signed = acct.sign_transaction(tx)
        h = w3.eth.send_raw_transaction(signed.raw_transaction)
        w3.eth.wait_for_transaction_receipt(h)
        return h.hex()

    # Fund ETH for gas
    eth_tx = {
        "from": deployer.address,
        "to": buyer.address,
        "value": w3.to_wei("1", "ether"),
        "nonce": w3.eth.get_transaction_count(deployer.address),
        "chainId": chain_id, "gas": 21000, "gasPrice": w3.eth.gas_price,
    }
    signed_eth = deployer.sign_transaction(eth_tx)
    w3.eth.send_raw_transaction(signed_eth.raw_transaction)
    print(f"  {PASS} Funded buyer with 1 ETH for gas")

    send_tx(deployer, usdc.functions.mint(buyer.address, amount_wei))
    print(f"  {PASS} Minted {amount_usdc} USDC to buyer")

    send_tx(buyer, usdc.functions.approve(Web3.to_checksum_address(cfg["SynapseCore"]), amount_wei))
    print(f"  {PASS} Buyer approved SynapseCore")

    deposit_hash = send_tx(buyer, core.functions.deposit(amount_wei))
    print(f"  {PASS} SynapseCore.deposit() tx: {deposit_hash[:30]}...")
    return deposit_hash

def register_deposit(token, addr, tx_hash, amount):
    if not tx_hash.startswith("0x"):
        tx_hash = "0x" + tx_hash
    idem = f"buyer-deposit-{uuid.uuid4().hex[:12]}"
    api("post", "/v1/balance/deposit/intent",
        token=token, headers={"X-Idempotency-Key": idem, "X-User-Address": addr},
        json={"txHash": tx_hash, "amountUsdc": float(amount)})
    for i in range(15):
        time.sleep(2)
        r = api("get", "/v1/balance/deposit/sync", token=token,
                headers={"X-User-Address": addr}, params={"txHash": tx_hash})
        if r.status_code == 200:
            d = r.json().get("sync", r.json())
            if d.get("confirmed") or str(d.get("status","")).upper() == "CONFIRMED":
                print(f"  {PASS} Deposit confirmed after {(i+1)*2}s")
                return True
    print(f"  {WARN} Deposit indexing in background")
    return False

def create_agent(token, addr, name):
    r = api("post", "/v1/credentials/agent/issue",
            token=token, headers={"X-User-Address": addr},
            json={"agentName": name, "dailyLimit": 5.0, "maxCallsPerDay": 200})
    assert r.status_code in (200,201), f"Agent creation failed: {r.text}"
    d = r.json()
    raw = (d.get("raw_token") or d.get("token") or
           (d.get("credential") or {}).get("raw_token") or
           (d.get("credential") or {}).get("token") or "")
    agent_id = (d.get("agentId") or d.get("agent_id") or
                (d.get("credential") or {}).get("agentId") or "")
    print(f"  {PASS} Agent created: {name} → {agent_id or raw[:20]}...")
    return raw, agent_id

def register_service(token, addr):
    svc_name = f"svc_buyer_{uuid.uuid4().hex[:6]}"
    r = api("post", "/v1/services", token=token,
            headers={"X-User-Address": addr},
            json={
                "agentToolName": svc_name,
                "serviceName": "Buyer Test Quotes Service",
                "role": "Provider", "status": "active", "isActive": True,
                "summary": "Buyer E2E test service.",
                "tags": ["buyer", "e2e"],
                "pricing": {"amount": SERVICE_PRICE, "currency": "USDC"},
                "auth": {"type": "gateway_signed"},
                "providerProfile": {"displayName": "Buyer Test Provider"},
                "payoutAccount": {"payoutAddress": addr, "chainId": CHAIN_ID,
                                  "settlementCurrency": "USDC"},
                "governance": {"termsAccepted": True, "riskAcknowledged": True},
                "healthCheck": {"path": "/health", "method": "GET", "timeoutMs": 3000,
                                "successCodes": [200], "healthyThreshold": 1, "unhealthyThreshold": 3},
                "invoke": {
                    "method": "POST",
                    "targets": [{"url": f"{PROVIDER_BASE}/api/v1/quotes/famous", "weight": 100}],
                    "timeoutMs": 10000,
                    "request": {"contentType": "application/json",
                                "schema": {"body": {"type": "object",
                                           "properties": {"text": {"type": "string"}}}}},
                    "response": {"contentType": "application/json"},
                },
                "constraints": {"timeoutMs": 10000, "maxResponseBytes": 131072,
                                 "maxRequestBytes": 65536, "maxQps": 10},
            })
    assert r.status_code in (200,201), f"Service reg failed: {r.text}"
    d = r.json()
    svc_id = (d.get("service_id") or d.get("serviceId") or
              (d.get("service") or {}).get("serviceId") or
              (d.get("service") or {}).get("service_id") or "")
    print(f"  {PASS} Service registered: {svc_id}")
    return svc_id

def resolve_service(token, addr):
    if GATEWAY_E2E_ALLOW_SERVICE_CREATION:
        return register_service(token, addr)
    print(
        f"  {PASS} Using existing canonical provider service: "
        f"{GATEWAY_E2E_SERVICE_ID}"
    )
    return GATEWAY_E2E_SERVICE_ID

def invoke(credential, svc_id, n=1):
    results = []
    for i in range(n):
        r = api("post", "/v1/gateway/generate",
                headers={"X-Credential": credential, "Content-Type": "application/json"},
                json={"serviceId": svc_id, "prompt": f"market analysis #{i+1}"})
        results.append(r.status_code)
        time.sleep(0.5)
    ok_count = sum(1 for c in results if c == 200)
    print(f"  {PASS if ok_count > 0 else FAIL} Invocations: {ok_count}/{n} succeeded — HTTP codes: {results}")
    return ok_count

# ─── Injected Ethereum Provider (no external deps) ────────────────────────────
def wallet_inject_script(private_key: str, address: str, chain_id: int) -> str:
    """
    JavaScript injected into each page via addInitScript.
    Uses the Ethereum JSON-RPC interface expected by wagmi/rainbowkit.
    Signs messages via a simple secp256k1+keccak impl packed inline.
    """
    # We'll use the exposed function __signMessage__ exposed by Playwright
    return f"""
(function setupWallet() {{
  const CHAIN_ID = {chain_id};
  const ADDRESS  = "{address.lower()}";
  const HEX_ID   = "0x" + CHAIN_ID.toString(16);

  const _listeners = {{}};

  const provider = {{
    isMetaMask: true,
    isCoinbaseWallet: false,
    selectedAddress: ADDRESS,
    chainId: HEX_ID,
    networkVersion: String(CHAIN_ID),

    on(event, fn) {{
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    }},
    removeListener(event, fn) {{
      if (_listeners[event]) _listeners[event] = _listeners[event].filter(f => f !== fn);
    }},
    removeAllListeners(event) {{
      if (event) delete _listeners[event];
      else Object.keys(_listeners).forEach(k => delete _listeners[k]);
    }},
    emit(event, ...args) {{
      (_listeners[event] || []).forEach(fn => fn(...args));
    }},
    isConnected() {{ return true; }},

    request: async function({{ method, params = [] }}) {{
      switch (method) {{
        case "eth_requestAccounts":
        case "eth_accounts":
          // Emit accountsChanged to wake up wagmi
          setTimeout(() => provider.emit("accountsChanged", [ADDRESS]), 50);
          return [ADDRESS];

        case "eth_chainId":
          return HEX_ID;

        case "net_version":
          return String(CHAIN_ID);

        case "eth_blockNumber":
          return "0x1000";

        case "eth_getBalance":
          return "0x8AC7230489E80000"; // 10 ETH

        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;

        case "personal_sign":
        case "eth_sign": {{
          // Delegate to Playwright-exposed function
          const msg = params[0];
          if (typeof window.__signEthMessage__ === "function") {{
            return await window.__signEthMessage__(msg);
          }}
          throw new Error("Signer not available");
        }}

        case "eth_signTypedData":
        case "eth_signTypedData_v4": {{
          const typedData = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
          if (typeof window.__signTypedData__ === "function") {{
            return await window.__signTypedData__(JSON.stringify(typedData));
          }}
          throw new Error("TypedData signer not available");
        }}

        case "eth_getTransactionReceipt":
          return null;
        case "eth_call":
          return "0x";
        case "eth_estimateGas":
          return "0x5208";
        case "eth_gasPrice":
          return "0x1";

        default:
          console.debug("[InjectedWallet] unhandled:", method, params);
          return null;
      }}
    }},

    send(method, params = []) {{
      if (typeof method === "object") {{
        return this.request(method).then(result => ({{
          jsonrpc: "2.0", id: method.id, result
        }}));
      }}
      return this.request({{ method, params }});
    }},

    sendAsync(payload, cb) {{
      this.request(payload)
        .then(result => cb(null, {{ jsonrpc: "2.0", id: payload.id, result }}))
        .catch(err  => cb(err));
    }},

    enable: async function() {{
      return this.request({{ method: "eth_requestAccounts" }});
    }},
  }};

  // Override window.ethereum
  Object.defineProperty(window, "ethereum", {{
    value: provider, writable: true, configurable: true,
  }});

  // Announce EIP-6963 style
  window.dispatchEvent(new Event("ethereum#initialized"));

  console.log("[InjectedWallet] ready:", ADDRESS, "chainId:", HEX_ID);
}})();
"""

# ─── Playwright screenshots ───────────────────────────────────────────────────
async def take_screenshots(buyer_key: str, buyer_addr: str, token: str):
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

    results = {}

    async with async_playwright() as p:
        print("\n  Launching Chrome...")
        browser = await p.chromium.launch(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            headless=False,
            slow_mo=150,
            args=["--no-sandbox", "--disable-web-security",
                  "--allow-insecure-localhost", "--disable-blink-features=AutomationControlled"],
        )

        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
        )

        # Inject wallet before every page
        inject_js = wallet_inject_script(buyer_key, buyer_addr, CHAIN_ID)
        await context.add_init_script(inject_js)

        page = await context.new_page()

        # Expose signing function to JS
        async def sign_eth_message(hex_msg: str) -> str:
            """Called from injected JS to sign messages."""
            try:
                # hex_msg is UTF-8 hex from MetaMask personal_sign or raw text
                if hex_msg.startswith("0x"):
                    msg = bytes.fromhex(hex_msg[2:]).decode("utf-8", errors="replace")
                else:
                    msg = hex_msg
                signed = Account.sign_message(encode_defunct(text=msg), private_key=buyer_key)
                return signed.signature.hex()
            except Exception as e:
                print(f"    Sign error: {e}, msg={hex_msg[:60]}")
                raise

        await page.expose_function("__signEthMessage__", sign_eth_message)

        shot_idx = [0]
        async def shot(name, wait_ms=1500):
            shot_idx[0] += 1
            fname = f"{shot_idx[0]:02d}-{name}.png"
            fpath = SCREENSHOT_DIR / fname
            await page.wait_for_timeout(wait_ms)
            await page.screenshot(path=str(fpath))
            print(f"    📸  {fname}")
            results[name] = str(fpath)
            return fpath

        async def connect_and_wait(page):
            """Try to click all visible Connect Wallet buttons."""
            for _ in range(3):
                btns = await page.query_selector_all('button')
                for btn in btns:
                    text = (await btn.inner_text()).strip().lower()
                    if "connect" in text and "wallet" in text:
                        await btn.click()
                        await page.wait_for_timeout(600)
                        # RainbowKit modal — pick MetaMask/Injected
                        for sel in [
                            'button[data-testid="rk-wallet-option-metaMask"]',
                            'button:has-text("MetaMask")',
                            'button:has-text("Injected")',
                            'div[role="button"]:has-text("MetaMask")',
                        ]:
                            try:
                                el = await page.wait_for_selector(sel, timeout=2000)
                                if el:
                                    await el.click()
                                    await page.wait_for_timeout(800)
                                    break
                            except Exception:
                                pass
                        break
                await page.wait_for_timeout(500)

        print("\n  Navigating pages and capturing screenshots...")

        pages_config = [
            ("/dashboard", "01-dashboard-overview", True),
            ("/dashboard/agents", "02-dashboard-agents", True),
            ("/dashboard/discovery", "03-discovery", True),
            ("/dashboard/invocations", "04-invocations", True),
            ("/dashboard/billing", "05-billing", True),
            ("/dashboard/billing/credits", "06-billing-credits", True),
            ("/dashboard/audit", "07-audit", True),
            ("/dashboard/developer", "08-developer", False),
            ("/dashboard/provider/console", "09-provider-console", False),
            ("/dashboard/provider/services", "10-provider-services", False),
            ("/dashboard/account/settings", "11-account-settings", True),
        ]

        for url_path, name, needs_wallet in pages_config:
            print(f"\n  → {url_path}")
            await page.goto(FRONTEND_URL + url_path)
            await page.wait_for_load_state("domcontentloaded")
            await page.wait_for_timeout(500)

            if needs_wallet:
                await connect_and_wait(page)

            await shot(name, wait_ms=2000)

        # ── Extra: test Discovery search ──────────────────────────────────
        print("\n  → /dashboard/discovery (search test)")
        await page.goto(FRONTEND_URL + "/dashboard/discovery")
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(500)
        await connect_and_wait(page)
        # Type in search box
        search_box = await page.query_selector('input[placeholder*="service"]')
        if not search_box:
            search_box = await page.query_selector('input[type="search"]')
        if not search_box:
            search_box = await page.query_selector('input[placeholder*="Search"]')
        if search_box:
            await search_box.fill("buyer")
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(1000)
        await shot("12-discovery-search-buyer", wait_ms=1000)

        # ── Extra: test Invocations filter ────────────────────────────────
        print("\n  → /dashboard/invocations (filter test)")
        await page.goto(FRONTEND_URL + "/dashboard/invocations")
        await page.wait_for_load_state("domcontentloaded")
        await page.wait_for_timeout(500)
        await connect_and_wait(page)
        await page.wait_for_timeout(1500)
        await shot("13-invocations-with-data", wait_ms=500)

        await browser.close()

    return results

# ─── Test checklist runner ────────────────────────────────────────────────────
def run_api_checklist(token, addr, provider_token, provider_addr):
    """Run 20-item API-level checklist and return results."""
    print("\n  Running API checklist...")
    results = {}

    def chk_api(label, cond, detail=""):
        results[label] = cond
        sym = PASS if cond else FAIL
        print(f"    {sym} {label}" + (f"  [{detail}]" if detail else ""))
        return cond

    # 1. Balance endpoint
    r = api("get", "/v1/balance", token=token, headers={"X-User-Address": addr})
    bal = r.json().get("balance", {}) if r.ok else {}
    consumer_bal = float(bal.get("consumerAvailableBalance", 0) or 0)
    chk_api("Balance endpoint works", r.ok, f"HTTP {r.status_code}")
    chk_api("Buyer has deposited balance (>0)", consumer_bal > 0, f"{consumer_bal:.4f} USDC")

    # 2. Usage logs / invocations
    r2 = api("get", "/v1/usage/logs", token=token, headers={"X-User-Address": addr},
             params={"pageSize": 50})
    logs = r2.json().get("logs", []) if r2.ok else []
    invoc_count = len(logs)
    chk_api("Usage logs endpoint works", r2.ok, f"HTTP {r2.status_code}")
    chk_api("Invocations exist in DB", invoc_count > 0, f"{invoc_count} records")

    # 3. Paginated usage logs
    r3 = api("get", "/v1/usage/logs", token=token, headers={"X-User-Address": addr},
             params={"page": 1, "pageSize": 5})
    d3 = r3.json() if r3.ok else {}
    chk_api("Paginated logs return rows+total", r3.ok and "total" in d3,
            f"total={d3.get('total')}")

    # 4. Discovery
    r4 = api("get", "/v1/services/discover")
    svcs = r4.json().get("services", []) if r4.ok else []
    chk_api("Discovery endpoint works", r4.ok, f"HTTP {r4.status_code}")
    chk_api("At least 1 service discoverable", len(svcs) > 0, f"{len(svcs)} services")

    # 5. Discovery search
    r5 = api("get", "/v1/services/discover", params={"intent": "buyer"})
    buyer_svcs = r5.json().get("services", []) if r5.ok else []
    chk_api("Discovery search by keyword works", r5.ok, f"{len(buyer_svcs)} matches")

    # 6. Agents/credentials list
    r6 = api("get", "/v1/credentials", token=token, headers={"X-User-Address": addr})
    if not r6.ok:
        r6 = api("get", "/v1/credentials/agent", token=token, headers={"X-User-Address": addr})
    creds = r6.json().get("credentials", r6.json().get("agents", [])) if r6.ok else []
    chk_api("Agents/credentials endpoint works", r6.ok, f"HTTP {r6.status_code}")
    chk_api("At least 1 agent credential exists", len(creds) > 0, f"{len(creds)} agents")

    # 7. Provider earnings
    r7 = api("get", "/v1/providers/earnings/summary", token=provider_token,
             headers={"X-User-Address": provider_addr})
    chk_api("Provider earnings endpoint works", r7.ok, f"HTTP {r7.status_code}")

    # 8. Finance audit logs
    r8 = api("get", "/v1/finance/audit-logs", token=token, headers={"X-User-Address": addr})
    audit = r8.json().get("logs", []) if r8.ok else []
    chk_api("Audit logs endpoint works", r8.ok, f"HTTP {r8.status_code}")
    chk_api("Audit logs has deposit event", len(audit) > 0, f"{len(audit)} audit entries")

    # 9. Services list (provider)
    r9 = api("get", "/v1/services", token=provider_token, headers={"X-User-Address": provider_addr})
    p_svcs = r9.json().get("services", []) if r9.ok else []
    chk_api("Provider services list works", r9.ok, f"HTTP {r9.status_code}")
    chk_api("Provider has registered service(s)", len(p_svcs) > 0, f"{len(p_svcs)} services")

    # 10. Status math
    if logs:
        newest = logs[0]
        has_req_id = bool(newest.get("requestId"))
        has_charge  = newest.get("totalCharge") is not None
        has_consumer = bool(newest.get("consumerAddress"))
        chk_api("Newest invocation has requestId", has_req_id)
        chk_api("Newest invocation has totalCharge", has_charge,
                f"{newest.get('totalCharge')}")
        chk_api("Newest invocation has consumerAddress", has_consumer)

    return results

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    print("\n" + "="*64)
    print("  Synapse Network — Full-Chain Browser Test")
    print("  New Buyer Wallet:", BUYER_ADDR)
    print("="*64)
    all_passed = True

    # ── Phase 1: Backend setup ────────────────────────────────────────────────
    section("Phase 1: Authenticate Wallets")
    buyer_token, buyer_addr         = authenticate(BUYER_KEY, "Buyer (new wallet)")
    provider_token, provider_addr   = authenticate(PROVIDER_KEY, "Provider")

    # ── Phase 2: Fund buyer ───────────────────────────────────────────────────
    section("Phase 2: Fund Buyer Wallet On-Chain")
    r = api("get", "/v1/balance", token=buyer_token, headers={"X-User-Address": buyer_addr})
    current_bal = float((r.json().get("balance") or {}).get("consumerAvailableBalance", 0) or 0)
    print(f"  Current buyer balance: {current_bal:.4f} USDC")

    if current_bal < 1.0:
        tx_hash = on_chain_fund(BUYER_KEY, DEPLOYER_KEY, DEPOSIT_USDC)
        register_deposit(buyer_token, buyer_addr, tx_hash, DEPOSIT_USDC)
        time.sleep(3)
        r = api("get", "/v1/balance", token=buyer_token, headers={"X-User-Address": buyer_addr})
        current_bal = float((r.json().get("balance") or {}).get("consumerAvailableBalance", 0) or 0)
        print(f"  {PASS} Buyer balance after deposit: {current_bal:.4f} USDC")
    else:
        print(f"  {PASS} Buyer already has balance ({current_bal:.4f} USDC) — skip deposit")

    # ── Phase 3: Create agents ────────────────────────────────────────────────
    section("Phase 3: Create Multiple Agents for Buyer")
    agent_tokens = []
    for name in ["ResearchBot", "TradingAgent", "AnalysisBot"]:
        raw, _ = create_agent(buyer_token, buyer_addr, name)
        agent_tokens.append(raw)
        time.sleep(0.3)

    # ── Phase 4: Resolve provider service ────────────────────────────────────
    section("Phase 4: Resolve Provider Service Fixture")
    svc_id = resolve_service(provider_token, provider_addr)
    time.sleep(1)

    # ── Phase 5: Multiple invocations ────────────────────────────────────────
    section("Phase 5: Generate Invocations (5 calls)")
    for at in agent_tokens[:3]:
        invoke(at, svc_id, n=2)
        time.sleep(0.3)

    # ── Phase 6: Verify billing ───────────────────────────────────────────────
    section("Phase 6: Verify Billing")
    time.sleep(2)
    r = api("get", "/v1/balance", token=buyer_token, headers={"X-User-Address": buyer_addr})
    b = (r.json().get("balance") or {})
    final_bal = float(b.get("consumerAvailableBalance", 0) or 0)
    platform_fee = float(b.get("platformFeeAccrued", 0) or 0)
    all_passed &= chk(final_bal < current_bal, f"Buyer balance deducted: {current_bal:.4f} → {final_bal:.4f}")
    all_passed &= chk(platform_fee > 0, f"Platform fee accrued: {platform_fee:.6f} USDC")

    # ── Phase 7: API checklist ────────────────────────────────────────────────
    section("Phase 7: API Checklist (20 items)")
    api_results = run_api_checklist(buyer_token, buyer_addr, provider_token, provider_addr)
    failed_checks = [k for k,v in api_results.items() if not v]
    all_passed &= (len(failed_checks) == 0)

    # ── Phase 8: Browser screenshots ─────────────────────────────────────────
    section("Phase 8: Browser Screenshots with Connected Wallet")
    screenshot_results = asyncio.run(
        take_screenshots(BUYER_KEY, buyer_addr, buyer_token)
    )
    print(f"\n  {PASS} {len(screenshot_results)} screenshots captured → {SCREENSHOT_DIR}")

    # ── Summary ───────────────────────────────────────────────────────────────
    section("SUMMARY")
    print(f"""
  Buyer wallet:     {BUYER_ADDR}
  Balance after:    {final_bal:.6f} USDC
  Agents created:   3 (ResearchBot, TradingAgent, AnalysisBot)
  Service:          {svc_id}
  Invocations:      ~6 calls made
  Screensshots:     {len(screenshot_results)} pages captured

  API Checklist:    {len(api_results) - len(failed_checks)}/{len(api_results)} passed
  {"  Failed: " + str(failed_checks) if failed_checks else "  All API checks passed!"}
    """)
    print("  " + ("✅ ALL CHECKS PASSED" if all_passed else "❌ SOME CHECKS FAILED — see above"))

    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
