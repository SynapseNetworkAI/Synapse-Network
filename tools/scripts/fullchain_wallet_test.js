#!/usr/bin/env node
/**
 * Synapse Network — Full-Chain Browser E2E Test
 * ==============================================
 * Phase 1 (Backend): fund buyer wallet, create 3 agents, invoke services 5×, verify billing
 * Phase 2 (Browser): Playwright screenshots of all dashboard pages with wallet injected
 *
 * New Buyer Wallet: Hardhat account #3
 *   address : 0x90F79bf6EB2c4f870365E785982E1f101E93b906
 *   key     : 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6
 *
 * Usage:
 *   cd Synapse-Network && node scripts/fullchain_wallet_test.js
 *   node scripts/fullchain_wallet_test.js --screenshot-only  (skip backend, just screenshots)
 *
 * Prerequisites: gateway:8000, anvil:8545, frontend:3000 all running
 */

"use strict";

const { chromium } = require("playwright");
const { ethers }   = require("ethers");
const path         = require("path");
const fs           = require("fs");

// ─── Config ────────────────────────────────────────────────────────────────────
const FRONTEND_URL  = "http://localhost:3001";
const GATEWAY_URL   = "http://localhost:8000/api";
const RPC_URL       = "http://localhost:8545";
const CHAIN_ID      = 31337;

// Hardhat derivation accounts
const DEPLOYER_KEY  = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BUYER_KEY     = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const BUYER_ADDR    = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const PROVIDER_KEY  = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

// Deposit: 10 USDC
const DEPOSIT_USDC  = "10.0";

// Repo root — handle scripts/ being a symlink to tools/scripts/
const REPO_ROOT = (() => {
  // Walk up from __dirname until we find package.json at Synapse-Network root
  let d = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(d, "package.json")) &&
        fs.existsSync(path.join(d, "services"))) return d;
    d = path.dirname(d);
  }
  return process.cwd();
})();

// Contracts
const CONTRACT_CONFIG = path.join(REPO_ROOT, "services/user-front/src/contract-config.json");
const SYNAPSECORE_ABI = path.join(REPO_ROOT, "services/user-front/src/SynapseCoreABI.json");
const USDC_ABI_PATH   = path.join(REPO_ROOT, "services/user-front/src/MockUSDCABI.json");

// Agents to create
const AGENT_NAMES = ["ResearchBot", "TradingAgent", "AnalysisBot"];

// Screenshot output dir
const SCREENSHOT_DIR = path.join(REPO_ROOT, "docs/reference/test/gateway/screenshots/wallet-connected");

// Checklist results dir
const CHECKLIST_DIR  = path.join(REPO_ROOT, "docs/reference/test/gateway");

// ─── Logging helpers ───────────────────────────────────────────────────────────
const BOLD  = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED   = "\x1b[31m";
const YLW   = "\x1b[33m";
const RESET = "\x1b[0m";
const ok    = (m) => console.log(`  ${GREEN}✓${RESET} ${m}`);
const fail  = (m) => { console.log(`  ${RED}✗${RESET} ${m}`); };
const warn  = (m) => console.log(`  ${YLW}⚠${RESET} ${m}`);
const section = (t) => console.log(`\n${BOLD}${"─".repeat(60)}${RESET}\n  ${BOLD}${t}${RESET}\n${"─".repeat(60)}`);

// ─── API helpers ───────────────────────────────────────────────────────────────
async function apiGet(path_, token, address) {
  const headers = { "Content-Type": "application/json" };
  if (token)   headers["Authorization"] = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const r = await fetch(`${GATEWAY_URL}${path_}`, { headers });
  if (!r.ok && r.status !== 404) warn(`GET ${path_} → ${r.status}`);
  return r.json().catch(() => ({}));
}

async function apiPost(path_, body, token, address, idempotencyKey) {
  const headers = { "Content-Type": "application/json" };
  if (token)          headers["Authorization"]    = `Bearer ${token}`;
  if (address)        headers["X-User-Address"]   = address;
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const r = await fetch(`${GATEWAY_URL}${path_}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Auth ──────────────────────────────────────────────────────────────────────
async function authenticate(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const addr   = wallet.address.toLowerCase();
  const r      = await fetch(`${GATEWAY_URL}/v1/auth/challenge?address=${addr}`);
  const { challenge } = await r.json();
  const sig    = await wallet.signMessage(challenge);
  const r2     = await apiPost("/v1/auth/verify", {
    wallet_address: addr, signature: sig, message: challenge,
  });
  const token  = r2.token || r2.access_token;
  if (!token) throw new Error(`Auth failed for ${addr}: ${JSON.stringify(r2)}`);
  ok(`Authenticated ${addr.slice(0, 20)}…`);
  return { token, addr };
}

// ─── On-chain funding ──────────────────────────────────────────────────────────
async function fundOnChain(buyerKey, deployerKey, amountUsdc) {
  const provider  = new ethers.JsonRpcProvider(RPC_URL);
  const deployer  = new ethers.Wallet(deployerKey, provider);
  const buyer     = new ethers.Wallet(buyerKey,    provider);

  const config    = JSON.parse(fs.readFileSync(CONTRACT_CONFIG, "utf8"));
  const coreAbi   = JSON.parse(fs.readFileSync(SYNAPSECORE_ABI, "utf8"));
  const usdcAbi   = JSON.parse(fs.readFileSync(USDC_ABI_PATH,   "utf8"));

  const usdcAddr  = ethers.getAddress(config.MockUSDC);
  const coreAddr  = ethers.getAddress(config.SynapseCore);
  const amount    = ethers.parseUnits(amountUsdc, 18);  // USDC uses 18 decimals locally

  const usdc = new ethers.Contract(usdcAddr, usdcAbi, deployer);
  // Build buyer core signer fresh each time to avoid stale nonce cache
  const buyerCore = new ethers.Wallet(buyerKey, provider);
  const buyerUsdc = new ethers.Wallet(buyerKey, provider);

  // 1. Mint USDC to buyer  
  const tx1 = await usdc.mint(buyer.address, amount);
  await tx1.wait();
  ok(`Minted ${amountUsdc} USDC to buyer (${tx1.hash.slice(0, 20)}…)`);

  // Helper: get latest confirmed nonce directly from RPC
  async function getLatestNonce(addr) {
    const n = await provider.getTransactionCount(addr, "latest");
    return n;
  }

  // 2. Approve SynapseCore
  const n2 = await getLatestNonce(buyer.address);
  const usdcContract = new ethers.Contract(usdcAddr, usdcAbi, buyerUsdc);
  const tx2 = await usdcContract.approve(coreAddr, amount, { nonce: n2 });
  await tx2.wait();
  ok(`Buyer approved SynapseCore (${tx2.hash.slice(0, 20)}…)`);

  // Small delay to let node state settle
  await new Promise(r => setTimeout(r, 500));

  // 3. Deposit — fresh nonce after approve is mined
  const n3 = await getLatestNonce(buyer.address);
  const coreContract = new ethers.Contract(coreAddr, coreAbi, buyerCore);
  const tx3 = await coreContract.deposit(amount, { nonce: n3 });
  await tx3.wait();
  ok(`SynapseCore.deposit() done (${tx3.hash.slice(0, 20)}…)`);

  return tx3.hash;
}

// ─── Register deposit with gateway ────────────────────────────────────────────
async function registerDeposit(token, addr, txHash, amountUsdc) {
  const idem = `e2e-buyer-${Date.now()}`;
  const r = await apiPost("/v1/balance/deposit/intent", { txHash, amountUsdc: parseFloat(amountUsdc) },
    token, addr, idem);
  ok(`Deposit intent: ${JSON.stringify(r).slice(0, 100)}`);

  // Wait for indexer (up to 40s)
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const sync = await apiGet(`/v1/balance/deposit/sync?txHash=${txHash}`, token, addr);
    const confirmed = sync.confirmed || sync.status === "CONFIRMED" ||
      String(sync.status || "").toUpperCase() === "CONFIRMED";
    if (confirmed) {
      ok(`Deposit confirmed after ${(i + 1) * 2}s`);
      return true;
    }
    if (i % 5 === 4) process.stdout.write(`  ⏳ waiting indexer (${(i + 1) * 2}s)…\n`);
  }
  // Check balance as final fallback
  const bal = await apiGet("/v1/balance", token, addr);
  const avail = bal?.balance?.consumerAvailableBalance ?? 0;
  if (avail > 0) { ok(`Balance updated: ${avail} USDC`); return true; }
  warn("Deposit not confirmed after 40s — continuing anyway");
  return false;
}

// ─── Create agent credentials ─────────────────────────────────────────────────
async function createAgents(token, addr, names) {
  const created = [];
  for (const name of names) {
    const r = await apiPost("/v1/credentials/agent/issue",
      { name, maxCalls: 500, rpm: 60, resetInterval: "daily" },
      token, addr);
    const cred = r.credential || r;
    const credId = cred.id || cred.credential_id;
    const rawToken = cred.token || cred.raw_token;
    if (credId) {
      ok(`Agent "${name}" created — id=${credId}, token=${rawToken ? rawToken.slice(0, 20) + '…' : 'N/A'}`);
      created.push({ name, id: credId, token: rawToken });
    } else {
      warn(`Agent "${name}" creation response: ${JSON.stringify(r).slice(0, 200)}`);
    }
  }
  return created;
}

// ─── Invoke services ──────────────────────────────────────────────────────────
async function invokeServices(token, addr, agents, count = 5) {
  // Get first available service
  const disc = await apiGet("/v1/services/discover", null, null);
  const svcs = disc?.services || disc || [];
  if (!svcs.length) { warn("No services found for invocation"); return 0; }
  const svcId    = svcs[0].serviceId;
  const svcName  = svcs[0].serviceName;
  ok(`Using service: ${svcId} (${svcName})`);

  let successCount = 0;
  for (let i = 0; i < count; i++) {
    const agent = agents[i % agents.length];

    // Use agent raw token in X-Credential header, call gateway/generate
    const r = await fetch(`${GATEWAY_URL}/v1/gateway/generate`, {
      method: "POST",
      headers: {
        "X-Credential": agent.token || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serviceId: svcId,
        prompt: `E2E test call #${i + 1} from ${agent.name}`,
      }),
    });
    const resp = await r.json().catch(() => ({}));

    if (r.status === 200 || r.status === 201) {
      ok(`Invocation #${i + 1} via "${agent.name}" → ${r.status}`);
      successCount++;
    } else {
      warn(`Invocation #${i + 1} failed (${r.status}): ${JSON.stringify(resp).slice(0, 200)}`);
    }
    await sleep(400);
  }
  return successCount;
}

// ─── Checklist validation ──────────────────────────────────────────────────────
async function runChecklist(token, addr) {
  section("API Checklist Validation");
  const results = [];
  const check = (label, pass, detail = "") => {
    results.push({ label, pass, detail });
    pass ? ok(label + (detail ? ` — ${detail}` : "")) : fail(label + (detail ? ` — ${detail}` : ""));
  };

  // 1. Auth
  const me = await apiGet("/v1/auth/me", token, addr);
  const meAddr = me?.profile?.ownerAddress || me?.wallet || me?.address || "";
  check("Auth /me returns wallet address", meAddr.toLowerCase() === addr.toLowerCase(), meAddr);

  // 2. Balance
  const bal = await apiGet("/v1/balance", token, addr);
  const avail = bal?.balance?.consumerAvailableBalance ?? 0;
  check("Balance endpoint responds", !!bal?.balance);
  check("Consumer balance > 0", avail > 0, `${avail} USDC`);

  // 3. Agents (credentials)
  const credResp = await apiGet("/v1/credentials/agent/list", token, addr);
  const creds = credResp?.credentials || (Array.isArray(credResp) ? credResp : []);
  check("Credentials list returns array", Array.isArray(creds));
  check(`Buyer has ≥ ${AGENT_NAMES.length} agents`, creds.length >= AGENT_NAMES.length, `${creds.length} agents`);
  check("Each agent has name and status", creds.every(c => c.name && c.status));
  check("Agents have active status", creds.filter(c => c.status === "active").length > 0);

  // 4. Invocations / usage logs
  const logsResp = await apiGet("/v1/usage/logs", token, addr);
  const logs = logsResp?.logs || (Array.isArray(logsResp) ? logsResp : []);
  check("Usage logs endpoint responds", !!logsResp);
  check("Usage logs has invocation records", logs.length > 0, `${logs.length} records`);
  if (logs.length > 0) {
    check("Log has status field", logs.every(l => l.status));
    check("Log has totalCharge field", logs.some(l => l.totalCharge));
    check("Invocations show succeeded status", logs.some(l => l.status === "succeeded"));
  }

  // 5. Deposit / billing
  const depositResp = await apiGet("/v1/balance/deposit/intents", token, addr);
  const deposits = depositResp?.intents || depositResp?.deposits || (Array.isArray(depositResp) ? depositResp : []);
  check("Deposit intents endpoint responds", !!depositResp);
  check("Deposit records exist", deposits.length > 0, `${deposits.length} records`);

  // 6. Services discovery
  const svcResp = await apiGet("/v1/services/discover", null, null);
  const svcs = svcResp?.services || [];
  check("Service discovery endpoint responds", svcs.length > 0, `${svcs.length} services`);
  check("Services have status field", svcs.every(s => s.status || s.health));

  // 7. Audit logs
  const auditResp = await apiGet("/v1/finance/audit-logs", token, addr);
  const auditLogs = auditResp?.logs || (Array.isArray(auditResp) ? auditResp : []);
  check("Audit logs endpoint responds", !!auditResp);
  check("Audit logs has entries", auditLogs.length > 0, `${auditLogs.length} entries`);

  // 8. Spending limit
  const limitResp = await apiGet("/v1/balance/spending-limit", token, addr);
  check("Spending limit endpoint responds", !!limitResp && !limitResp.detail);

  // 9. Network stats
  const statsResp = await apiGet("/v1/services/network-stats", null, null);
  check("Network stats endpoint responds", !!statsResp && !statsResp.detail);

  // 10. Agent credential audit logs
  const credAudit = await apiGet("/v1/credentials/agent/audit-logs", token, addr);
  check("Credential audit logs respond", !!credAudit && !credAudit.detail);

  const passed = results.filter(r => r.pass).length;
  const total  = results.length;
  console.log(`\n  ${passed === total ? GREEN : YLW}Checklist: ${passed}/${total} passed${RESET}`);

  return results;
}

// ─── Browser screenshots ───────────────────────────────────────────────────────
async function takeScreenshots(token, addr) {
  section("Browser Screenshots (Playwright)");
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const buyerWallet = new ethers.Wallet(BUYER_KEY);
  const authSession = JSON.stringify({
    token,
    wallet: addr,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });

  // Wallet injection script — injected BEFORE each page's scripts
  // personal_sign delegates to Node.js via exposeFunction
  const INIT_SCRIPT = `
(function() {
  // ── 1. Inject auth session (A2A gateway auth) ─────────────────────────────
  try {
    localStorage.setItem("a2a_auth_session", ${JSON.stringify(authSession)});
    localStorage.setItem("a2a_selected_role", "consumer");
    localStorage.setItem("a2a_role_${addr}", "consumer");
  } catch(e) {}

  // ── 2. Inject wagmi connection state (wallet connected) ───────────────────
  // wagmi v2 injected connector auto-reconnect requires:
  //   - wagmi.injected.connected = "true"   (isAuthorized() check)
  //   - wagmi.injected.disconnected NOT set  (shimDisconnect check)
  // Values are JSON-serialized: serialize(true) → "true"
  try {
    localStorage.setItem("wagmi.injected.connected", "true");
    localStorage.removeItem("wagmi.injected.disconnected");
    localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("injected"));
  } catch(e) {}

  // ── 3. Inject fake window.ethereum (MetaMask-compatible) ──────────────────
  const ADDRESS  = "${addr}";
  const CHAIN_ID = ${CHAIN_ID};
  const _listeners = {};

  const provider = {
    isMetaMask: true,
    selectedAddress: ADDRESS,
    chainId: "0x" + CHAIN_ID.toString(16),
    networkVersion: String(CHAIN_ID),

    on(e, fn) {
      (_listeners[e] = _listeners[e] || []).push(fn);
    },
    removeListener(e, fn) {
      if (_listeners[e]) _listeners[e] = _listeners[e].filter(f => f !== fn);
    },
    removeAllListeners(e) { if (e) _listeners[e] = []; else Object.keys(_listeners).forEach(k => delete _listeners[k]); },
    emit(e, ...args) { (_listeners[e] || []).forEach(fn => fn(...args)); },
    isConnected: () => true,

    request: async function({ method, params = [] }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ADDRESS];
      if (method === "eth_chainId")    return "0x" + CHAIN_ID.toString(16);
      if (method === "net_version")    return String(CHAIN_ID);
      if (method === "eth_blockNumber") return "0x1388";
      if (method === "eth_getBalance")  return "0x8AC7230489E80000"; // 10 ETH
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "wallet_addEthereumChain")    return null;
      if (method === "personal_sign" || method === "eth_sign") {
        const msg = params[0];
        // Delegate to Node.js signing function exposed via exposeFunction
        if (window.__walletSign__) return await window.__walletSign__(msg);
        return "0x" + "0".repeat(130);
      }
      if (method === "eth_signTypedData_v4") {
        const msg = params[1];
        if (window.__walletSign__) return await window.__walletSign__(msg);
        return "0x" + "0".repeat(130);
      }
      console.warn("[InjectedWallet] unhandled method:", method);
      return null;
    },

    send: async function(method, params = []) {
      if (typeof method === "object") {
        const result = await this.request(method);
        return { jsonrpc: "2.0", id: method.id, result };
      }
      return this.request({ method, params });
    },

    sendAsync(payload, cb) {
      this.request(payload)
        .then(result => cb(null, { jsonrpc: "2.0", id: payload.id, result }))
        .catch(cb);
    },

    enable: async function() { return [ADDRESS]; },
  };

  try {
    Object.defineProperty(window, "ethereum", { value: provider, writable: true, configurable: true });
  } catch(e) {
    window.ethereum = provider;
  }
  window.dispatchEvent(new Event("ethereum#initialized"));
  console.log("[InjectedWallet] ready:", ADDRESS);
})();
`;

  console.log("\n  Launching Chrome…");
  const browser = await chromium.launch({
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-web-security", "--allow-running-insecure-content"],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  // Inject init script on every new page
  await context.addInitScript(INIT_SCRIPT);

  // Expose signing function from Node.js into the browser
  await context.exposeFunction("__walletSign__", async (msg) => {
    try {
      const wallet = new ethers.Wallet(BUYER_KEY);
      // Detect if msg is raw hex bytes (personal_sign param)
      if (typeof msg === "string" && msg.startsWith("0x")) {
        const decoded = ethers.toUtf8String(msg);
        return await wallet.signMessage(decoded);
      }
      return await wallet.signMessage(msg);
    } catch (e) {
      console.error("[sign] error:", e.message);
      return "0x" + "0".repeat(130);
    }
  });

  let idx = 0;
  async function shot(page, name) {
    idx++;
    const fname = `${String(idx).padStart(2, "0")}-${name}.png`;
    const fpath = path.join(SCREENSHOT_DIR, fname);
    await page.screenshot({ path: fpath, fullPage: false });
    ok(`Screenshot: ${fname}`);
    return fname;
  }

  async function nav(page, url, name, waitMs = 2500) {
    console.log(`\n  → ${url}`);
    await page.goto(FRONTEND_URL + url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs);
    return shot(page, name);
  }

  const page = await context.newPage();

  // ── Step 1: Navigate to dashboard — wagmi auto-reconnects via injected.connected flag ──
  // The addInitScript already set wagmi.injected.connected=true and window.ethereum.
  // wagmi's reconnect action reads this flag, calls eth_accounts on our fake provider,
  // and sets isConnected=true. WalletAuthGuard then auto-authorizes via a2a_auth_session.
  console.log("\n  Navigating to dashboard — waiting for wagmi auto-reconnect…");
  await page.goto(FRONTEND_URL + "/dashboard/billing/credits", { waitUntil: "domcontentloaded" });

  // ── Step 2: Wait for wagmi isConnected + data to load ──────────────────────
  // Poll wagmi.store until status = connected (max 12 s)
  const connected = await page.waitForFunction(
    () => {
      try {
        const s = JSON.parse(localStorage.getItem("wagmi.store") || "{}");
        return s?.state?.status === "connected";
      } catch { return false; }
    },
    { timeout: 12000 }
  ).catch(() => null);

  if (!connected) {
    // Alternative check: see if address shows up in sidebar (wallet badge)
    const addressEl = await page.$('text=/0x[a-fA-F0-9]{4}/').catch(() => null);
    if (addressEl) {
      console.log("  Wallet connected (address visible in UI)");
    } else {
      console.log("  Warning: wallet may not have connected — screenshots may still show placeholder data");
    }
  } else {
    console.log("  Wallet connected (wagmi.store status=connected)");
  }

  // Allow data hooks time to fetch after connection
  await page.waitForTimeout(4000);

  // Pages to screenshot
  const PAGES = [
    { url: "/",                              name: "00-home",             wait: 2000 },
    { url: "/dashboard/overview",            name: "01-overview",         wait: 4000 },
    { url: "/dashboard/agents",              name: "02-agents",           wait: 4000 },
    { url: "/dashboard/invocations",         name: "03-invocations",      wait: 4000 },
    { url: "/dashboard/billing",             name: "04-billing",          wait: 4000 },
    { url: "/dashboard/billing/credits",     name: "05-billing-credits",  wait: 4000 },
    { url: "/dashboard/discovery",           name: "06-discovery",        wait: 3000 },
    { url: "/dashboard/developer",           name: "07-developer",        wait: 3000 },
    { url: "/dashboard/audit",               name: "08-audit",            wait: 3500 },
    { url: "/dashboard/account/settings",    name: "09-settings",         wait: 3000 },
    { url: "/provider/console",              name: "10-provider-console", wait: 3000 },
    { url: "/provider/services",             name: "11-provider-services",wait: 3000 },
  ];

  const screenshots = [];
  for (const p of PAGES) {
    const fname = await nav(page, p.url, p.name, p.wait);
    screenshots.push({ url: p.url, file: fname });
  }

  await browser.close();
  console.log(`\n  Screenshots saved to: ${SCREENSHOT_DIR}`);
  return screenshots;
}

// ─── Write checklist markdown ──────────────────────────────────────────────────
function writeChecklistMd(results, screenshots, balance, credCount, logCount) {
  const passed = results.filter(r => r.pass).length;
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const rows = results.map(r =>
    `| ${r.pass ? "✅" : "❌"} | ${r.label} | ${r.detail || "—"} |`
  ).join("\n");
  const shots = screenshots.map(s => `| \`${s.file}\` | \`${s.url}\` |`).join("\n");

  const md = `# Full-Chain E2E Test Report

**Date:** ${now}  
**Wallet:** \`${BUYER_ADDR}\` (Hardhat #3)  
**Checklist:** ${passed}/${results.length} passed  

## Summary

| Metric | Value |
|---|---|
| USDC Deposited | ${DEPOSIT_USDC} |
| Agents Created | ${credCount} |
| Invocations Made | ${logCount} |
| Balance (USDC) | ${balance} |
| API Checks | ${passed}/${results.length} |

## API Checklist

| Status | Check | Detail |
|---|---|---|
${rows}

## Screenshots

| File | URL |
|---|---|
${shots}

## Notes

- Browser: Google Chrome (system), headless  
- Wallet injection: fake \`window.ethereum\` provider (no MetaMask)  
- Auth: \`a2a_auth_session\` pre-injected to localStorage  
`;

  const outPath = path.join(CHECKLIST_DIR, "fullchain-e2e-report.md");
  fs.mkdirSync(CHECKLIST_DIR, { recursive: true });
  fs.writeFileSync(outPath, md);
  ok(`Report saved: ${path.relative(process.cwd(), outPath)}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const screenshotOnly = process.argv.includes("--screenshot-only");

  console.log("\n" + "═".repeat(64));
  console.log("  Synapse Network — Full-Chain Browser E2E Test");
  console.log("═".repeat(64));
  console.log(`  Buyer wallet: ${BUYER_ADDR}`);
  console.log(`  Mode: ${screenshotOnly ? "screenshot-only" : "full test (backend + browser)"}`);

  let token, addr, credCount = 0, logCount = 0, balance = 0;

  if (!screenshotOnly) {
    // ── Phase 1: Backend ────────────────────────────────────────────────────
    section("Phase 1: Authenticate Buyer Wallet");
    ({ token, addr } = await authenticate(BUYER_KEY));

    // Check current balance
    const bal0 = await apiGet("/v1/balance", token, addr);
    const avail0 = bal0?.balance?.consumerAvailableBalance ?? 0;
    console.log(`  Current balance: ${avail0} USDC`);

    if (avail0 < 1.0) {
      section("Phase 2: Fund On-Chain (10 USDC)");
      const txHash = await fundOnChain(BUYER_KEY, DEPLOYER_KEY, DEPOSIT_USDC);
      await registerDeposit(token, addr, txHash, DEPOSIT_USDC);
    } else {
      ok(`Balance already ${avail0} USDC — skipping on-chain funding`);
    }

    // Verify balance
    const bal1 = await apiGet("/v1/balance", token, addr);
    balance = bal1?.balance?.consumerAvailableBalance ?? 0;
    ok(`Final balance: ${balance} USDC`);

    // ── Phase 3: Create agents ─────────────────────────────────────────────
    section("Phase 3: Create Agent Credentials");
    const existingCreds = await apiGet("/v1/credentials/agent/list", token, addr);
    const existing = existingCreds?.credentials || [];
    const existingNames = existing.map(c => c.name);
    const toCreate = AGENT_NAMES.filter(n => !existingNames.includes(n));

    if (toCreate.length > 0) {
      await createAgents(token, addr, toCreate);
    } else {
      ok(`All ${AGENT_NAMES.length} agents already exist — skipping creation`);
    }

    const credsAfter = await apiGet("/v1/credentials/agent/list", token, addr);
    credCount = (credsAfter?.credentials || []).length;
    ok(`Total agents: ${credCount}`);

    // ── Phase 4: Invoke services ───────────────────────────────────────────
    section("Phase 4: Invoke Services (5×)");
    // Issue a fresh invoke credential (raw token needed, list endpoint doesn't return it)
    const invokeCred = await apiPost("/v1/credentials/agent/issue",
      { name: `E2E-Invoke-${Date.now()}`, maxCalls: 100, rpm: 60, resetInterval: "daily" },
      token, addr);
    const invokeToken = invokeCred?.credential?.token || invokeCred?.token || "";
    if (!invokeToken) {
      warn(`Could not issue invoke credential: ${JSON.stringify(invokeCred).slice(0, 150)}`);
    } else {
      ok(`Invoke credential issued: ${invokeToken.slice(0, 20)}…`);
      const invokeAgents = [{ name: "E2E-InvokeAgent", id: invokeCred?.credential?.id, token: invokeToken }];
      await invokeServices(token, addr, invokeAgents, 5);
      await sleep(1000);
    }

    const logsAfter = await apiGet("/v1/usage/logs", token, addr);
    logCount = logsAfter?.count || logsAfter?.total || (logsAfter?.logs || []).length;
    ok(`Total invocation logs: ${logCount}`);

    // ── Phase 5: API Checklist ─────────────────────────────────────────────
    const checkResults = await runChecklist(token, addr);

    // ── Phase 6: Browser screenshots ──────────────────────────────────────
    const screenshots = await takeScreenshots(token, addr);

    // ── Phase 7: Write report ─────────────────────────────────────────────
    section("Phase 7: Write Test Report");
    writeChecklistMd(checkResults, screenshots, balance, credCount, logCount);

  } else {
    // Screenshot-only mode: need a token
    section("Screenshot-Only Mode");
    ({ token, addr } = await authenticate(BUYER_KEY));
    const bal = await apiGet("/v1/balance", token, addr);
    balance = bal?.balance?.consumerAvailableBalance ?? 0;
    ok(`Balance: ${balance} USDC`);
    const screenshots = await takeScreenshots(token, addr);
    console.log(`\n  ${screenshots.length} screenshots taken`);
  }

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  ${GREEN}✅ Test complete${RESET}`);
  console.log("═".repeat(64) + "\n");
}

main().catch(e => {
  console.error(`\n${RED}FATAL:${RESET}`, e.message);
  console.error(e.stack);
  process.exit(1);
});
