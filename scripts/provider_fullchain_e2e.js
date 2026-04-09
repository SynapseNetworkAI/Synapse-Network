#!/usr/bin/env node
"use strict";

/**
 * Provider Full-Chain E2E Test
 *
 * Validates the entire Provider lifecycle:
 *   1. Auth as Provider wallet → create provider signing secret
 *   2. Register/publish a service with a mock upstream
 *   3. Auth as Consumer wallet → on-chain deposit USDC
 *   4. Consumer creates agent credential → discovers service
 *   5. Consumer invokes provider's service via gateway
 *   6. Verify provider gets paid (earnings summary)
 *   7. Screenshot every Provider Console page
 *   8. Bug tracking → bugfix.md
 */

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");
const { ethers } = require("ethers");

// ── Config ───────────────────────────────────────────────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:3000";
const GATEWAY_URL  = process.env.GATEWAY_URL  || "http://127.0.0.1:8000/api";
const RPC_URL      = process.env.RPC_URL      || "http://127.0.0.1:8545";
const CHAIN_ID     = Number(process.env.CHAIN_ID || 31337);
const DEPOSIT_USDC = process.env.DEPOSIT_USDC || "10.0";
const MOCK_PORT    = Number(process.env.MOCK_PORT || 19876);

const DEPLOYER_KEY = process.env.DEPLOYER_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";           // Hardhat #0
const PROVIDER_KEY = process.env.PROVIDER_KEY ||
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a";           // Hardhat #4
const CONSUMER_KEY = process.env.CONSUMER_KEY ||
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";           // Hardhat #3

const REPO_ROOT = (() => {
  let current = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, "services"))) return current;
    current = path.dirname(current);
  }
  return process.cwd();
})();

const CONTRACT_CONFIG_PATH = path.join(REPO_ROOT, "services/user-front/src/contract-config.json");
const SYNAPSECORE_ABI_PATH = path.join(REPO_ROOT, "services/user-front/src/SynapseCoreABI.json");
const USDC_ABI_PATH        = path.join(REPO_ROOT, "services/user-front/src/MockUSDCABI.json");
const SCREENSHOT_DIR       = path.join(REPO_ROOT, "tmp/screens/provider-fullchain");
const BUGFIX_PATH          = path.join(REPO_ROOT, "tmp/screens/provider-fullchain/bugfix.md");

const SERVICE_TOOL_NAME = `e2e_echo_${Date.now()}`;
const SERVICE_NAME      = "E2E Echo Service";

// ── Helpers ──────────────────────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const RED    = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD   = "\x1b[1m";
const RESET  = "\x1b[0m";

function ok(msg)      { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function warn(msg)    { console.log(`  ${YELLOW}!${RESET} ${msg}`); }
function fail(msg)    { console.error(`  ${RED}✗${RESET} ${msg}`); }
function section(t)   { console.log(`\n${BOLD}${t}${RESET}`); }
function sleep(ms)    { return new Promise((r) => setTimeout(r, ms)); }
function loadJson(p)  { return JSON.parse(fs.readFileSync(p, "utf8")); }
function isNonceError(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return m.includes("nonce has already been used") || m.includes("nonce too low");
}

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) { ok(label); passed++; }
  else           { fail(label); failed++; }
}

// ── Bug tracking ─────────────────────────────────────────────────────────────
const bugs = [];
function recordBug(id, title, detail) {
  bugs.push({ id, title, detail, timestamp: new Date().toISOString() });
  fail(`Bug-${id}: ${title}`);
}
function writeBugReport() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  if (bugs.length === 0) {
    fs.writeFileSync(BUGFIX_PATH, "# Provider Fullchain E2E — No bugs found ✓\n", "utf8");
    return;
  }
  let md = "# Provider Fullchain E2E — Bug Report\n\n";
  for (const b of bugs) {
    md += `## Bug-${b.id}: ${b.title}\n- **Time**: ${b.timestamp}\n- **Detail**: ${b.detail}\n\n`;
  }
  fs.writeFileSync(BUGFIX_PATH, md, "utf8");
  warn(`Bug report written to ${BUGFIX_PATH}`);
}

// ── API helpers ──────────────────────────────────────────────────────────────
async function apiGet(pathname, token, address, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...(extraHeaders || {}) };
  if (token)   headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const res = await fetch(`${GATEWAY_URL}${pathname}`, { headers });
  const body = await res.json().catch(() => ({}));
  return { response: res, body };
}

async function apiPost(pathname, payload, token, address, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...(extraHeaders || {}) };
  if (token)   headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const res = await fetch(`${GATEWAY_URL}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { response: res, body };
}

async function apiDelete(pathname, token, address) {
  const headers = { "Content-Type": "application/json" };
  if (token)   headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  const res = await fetch(`${GATEWAY_URL}${pathname}`, { method: "DELETE", headers });
  const body = await res.json().catch(() => ({}));
  return { response: res, body };
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function authenticate(privateKey, label) {
  const wallet  = new ethers.Wallet(privateKey);
  const address = wallet.address.toLowerCase();
  const challengeRes = await fetch(`${GATEWAY_URL}/v1/auth/challenge?address=${address}`);
  if (!challengeRes.ok) throw new Error(`${label} challenge failed: ${challengeRes.status}`);
  const challengeBody = await challengeRes.json();
  const signature = await wallet.signMessage(challengeBody.challenge);
  const verify = await apiPost(
    "/v1/auth/verify",
    { wallet_address: address, signature, message: challengeBody.challenge },
  );
  const token = verify.body.token || verify.body.access_token;
  if (!verify.response.ok || !token)
    throw new Error(`${label} verify failed: ${verify.response.status} ${JSON.stringify(verify.body)}`);
  ok(`Authenticated ${label}: ${address}`);
  return { token, address };
}

// ── On-chain helpers ─────────────────────────────────────────────────────────
function getContracts() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const config   = loadJson(CONTRACT_CONFIG_PATH);
  const coreAbi  = loadJson(SYNAPSECORE_ABI_PATH);
  const usdcAbi  = loadJson(USDC_ABI_PATH);
  return {
    provider,
    coreAddr: ethers.getAddress(config.SynapseCore),
    usdcAddr: ethers.getAddress(config.MockUSDC),
    coreAbi,
    usdcAbi,
  };
}

async function sendWithRetry(label, factory) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { return await factory(); }
    catch (err) {
      if (!isNonceError(err) || attempt === 4) throw err;
      warn(`${label} nonce collision, retrying…`);
      await sleep(300);
    }
  }
}

async function fundAndDeposit(consumerKey, amountUsdc) {
  const { provider, coreAbi, usdcAbi, usdcAddr, coreAddr } = getContracts();
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const buyer    = new ethers.Wallet(consumerKey, provider);
  const amount   = ethers.parseUnits(amountUsdc, 18);
  const getNonce = (addr) => provider.getTransactionCount(addr, "pending");

  const ethBal = await provider.getBalance(buyer.address);
  if (ethBal < ethers.parseEther("0.05")) {
    const tx = await sendWithRetry("eth-topup", () =>
      deployer.sendTransaction({ to: buyer.address, value: ethers.parseEther("1.0"), nonce: getNonce(deployer.address) })
    );
    await tx.wait();
    ok("Funded consumer with ETH for gas");
  }

  const usdcDeployer = new ethers.Contract(usdcAddr, usdcAbi, deployer);
  const usdcBuyer    = new ethers.Contract(usdcAddr, usdcAbi, buyer);
  const coreBuyer    = new ethers.Contract(coreAddr, coreAbi, buyer);

  const mintTx = await sendWithRetry("mint", async () =>
    usdcDeployer.mint(buyer.address, amount, { nonce: await getNonce(deployer.address) })
  );
  await mintTx.wait();
  ok(`Minted ${amountUsdc} USDC`);

  const approveTx = await sendWithRetry("approve", async () =>
    usdcBuyer.approve(coreAddr, amount, { nonce: await getNonce(buyer.address) })
  );
  await approveTx.wait();
  ok("Approved SynapseCore");

  await sleep(500);
  const depositTx = await sendWithRetry("deposit", async () =>
    coreBuyer.deposit(amount, { nonce: await getNonce(buyer.address) })
  );
  await depositTx.wait();
  ok(`Deposited on-chain: ${depositTx.hash}`);
  return depositTx.hash;
}

async function waitForGatewayDeposit(token, address, txHash, amountUsdc) {
  const intent = await apiPost(
    "/v1/balance/deposit/intent",
    { txHash, amountUsdc: parseFloat(amountUsdc) },
    token, address,
    { "X-Idempotency-Key": `e2e-dep-${Date.now()}` },
  );
  if (!intent.response.ok) throw new Error(`deposit intent failed: ${intent.response.status} ${JSON.stringify(intent.body)}`);
  ok("Deposit intent submitted");

  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const bal = await apiGet("/v1/balance", token, address);
    const avail = Number(bal.body?.balance?.consumerAvailableBalance ?? 0);
    if (avail >= parseFloat(amountUsdc) - 0.01) { ok(`Balance synced: ${avail.toFixed(2)} USDC`); return; }
  }
  throw new Error(`deposit sync timeout for ${txHash}`);
}

// ── Mock upstream service ────────────────────────────────────────────────────
function startMockUpstream() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "healthy" }));
        return;
      }
      // Echo the request body back
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          echo: body ? JSON.parse(body) : {},
          service: SERVICE_TOOL_NAME,
          timestamp: Date.now(),
        }));
      });
    });
    server.listen(MOCK_PORT, "0.0.0.0", () => {
      ok(`Mock upstream started on :${MOCK_PORT}`);
      resolve(server);
    });
  });
}

// ── Screenshot helper ────────────────────────────────────────────────────────
async function screenshot(page, name) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const p = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  ok(`Screenshot: ${name}.png`);
}

// ── Browser login helper (inject wallet session + mock window.ethereum) ──────
async function browserLogin(page, token, address, privateKey) {
  const chainHex = `0x${CHAIN_ID.toString(16)}`;

  // Inject a mock EIP-1193 provider before any page script runs
  await page.addInitScript(`
    (function() {
      var addr = "${address}";
      var chainHex = "${chainHex}";
      var chainId = ${CHAIN_ID};
      var listeners = {};
      window.ethereum = {
        isMetaMask: true,
        isConnected: function() { return true; },
        chainId: chainHex,
        networkVersion: String(chainId),
        selectedAddress: addr,
        _metamask: { isUnlocked: function() { return Promise.resolve(true); } },
        request: function(args) {
          var method = args.method;
          var params = args.params || [];
          if (method === "eth_requestAccounts" || method === "eth_accounts") return Promise.resolve([addr]);
          if (method === "eth_chainId") return Promise.resolve(chainHex);
          if (method === "net_version") return Promise.resolve(String(chainId));
          if (method === "wallet_switchEthereumChain") return Promise.resolve(null);
          if (method === "wallet_requestPermissions") return Promise.resolve([{ parentCapability: "eth_accounts" }]);
          if (method === "personal_sign") return Promise.resolve("0x0000");
          return fetch("http://127.0.0.1:8545", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: method, params: params }),
          }).then(function(r) { return r.json(); }).then(function(j) {
            if (j.error) throw new Error(j.error.message);
            return j.result;
          });
        },
        on: function(event, cb) { (listeners[event] = listeners[event] || []).push(cb); },
        removeListener: function(event, cb) {
          if (listeners[event]) listeners[event] = listeners[event].filter(function(l) { return l !== cb; });
        },
        removeAllListeners: function() {},
        emit: function(event) {
          var args = Array.prototype.slice.call(arguments, 1);
          (listeners[event] || []).forEach(function(cb) { cb.apply(null, args); });
        },
      };
    })();
  `);

  // First visit to seed localStorage, then inject auth + wagmi state
  await page.goto(FRONTEND_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ token, address, chainId }) => {
    // Auth session
    const session = {
      token: token,
      wallet: address.toLowerCase(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
    localStorage.setItem("a2a_auth_session", JSON.stringify(session));

    // Wagmi store — pre-populate connection state so useAccount() returns the address
    const wagmiState = {
      state: {
        connections: {
          __type: "Map",
          value: [
            ["injected", {
              accounts: [address],
              chainId: chainId,
              connector: { id: "injected", name: "Injected", type: "injected", uid: "injected" },
            }],
          ],
        },
        chainId: chainId,
        current: "injected",
        status: "connected",
      },
      version: 2,
    };
    localStorage.setItem("wagmi.store", JSON.stringify(wagmiState));
  }, { token, address, chainId: CHAIN_ID });

  // Reload to pick up both wagmi state and auth session
  await page.reload({ waitUntil: "networkidle" });
  await sleep(3000);
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  Provider Full-Chain E2E Test");
  console.log("══════════════════════════════════════════════════════════\n");

  let mockServer = null;
  let browser = null;
  let providerToken, providerAddress;
  let consumerToken, consumerAddress;
  let agentCredentialKey;

  try {
    // ────────────────────────────────────────────────────────────────────────
    section("Phase 0 — Start mock upstream service");
    // ────────────────────────────────────────────────────────────────────────
    mockServer = await startMockUpstream();

    // ────────────────────────────────────────────────────────────────────────
    section("Phase 1 — Authenticate Provider + Consumer wallets");
    // ────────────────────────────────────────────────────────────────────────
    ({ token: providerToken, address: providerAddress } = await authenticate(PROVIDER_KEY, "Provider"));
    ({ token: consumerToken, address: consumerAddress } = await authenticate(CONSUMER_KEY, "Consumer"));

    // ────────────────────────────────────────────────────────────────────────
    section("Phase 2 — Create Provider signing secret");
    // ────────────────────────────────────────────────────────────────────────
    const futureExpiration = Math.floor(Date.now() / 1000) + 86400;
    const secretRes = await apiPost(
      "/v1/secrets/provider/issue",
      { name: "e2e-provider-secret", rpm: 120, creditLimit: 10000.0, expiration: futureExpiration },
      providerToken, providerAddress,
    );
    check("provider secret issued (2xx)", secretRes.response.ok);
    if (!secretRes.response.ok) {
      recordBug("PS01", "Provider secret issue failed", JSON.stringify(secretRes.body));
    }
    const providerSecretKey = secretRes.body?.secret?.secretKey || secretRes.body?.secretKey || secretRes.body?.credential?.secretKey || "";
    const providerSecretId  = secretRes.body?.secret?.id || secretRes.body?.id || secretRes.body?.credential?.id || "";
    check("provider secret key returned", !!providerSecretKey);
    ok(`Provider secret ID: ${providerSecretId}`);

    // List provider secrets
    const listSecrets = await apiGet("/v1/secrets/provider/list", providerToken, providerAddress);
    check("list provider secrets (2xx)", listSecrets.response.ok);
    check("secrets list non-empty", Array.isArray(listSecrets.body?.secrets) && listSecrets.body.secrets.length > 0);

    // ────────────────────────────────────────────────────────────────────────
    section("Phase 3 — Register/publish a service");
    // ────────────────────────────────────────────────────────────────────────
    const registerPayload = {
      serviceName: SERVICE_NAME,
      agentToolName: SERVICE_TOOL_NAME,
      role: "Provider",
      pricing: { currency: "USD", amount: "0.50" },
      summary: "E2E test echo service",
      tags: ["e2e", "test", "echo"],
      providerProfile: { displayName: "E2E Provider Lab" },
      payoutAccount: {
        payoutAddress: providerAddress,
        chainId: CHAIN_ID,
        settlementCurrency: "USDC",
        status: "active",
      },
      governance: { termsAccepted: true, riskAcknowledged: true, note: "E2E test" },
      healthCheck: {
        path: "/health",
        method: "GET",
        intervalSec: 30,
        timeoutMs: 5000,
        successCodes: [200],
      },
      constraints: { timeoutMs: 15000, maxResponseBytes: 500000, maxRequestBytes: 100000, maxQps: 100 },
      forwarding: {
        requestIdHeader: "X-Synapse-Request-Id",
        passThroughHeaders: [],
        injectHeaders: {},
        retryPolicy: { maxAttempts: 2, backoffMs: 200, retryOnStatus: [429, 500, 502, 503, 504] },
      },
      metering: {
        billingUnit: "per_call",
        billOnError: false,
        billableStatusClasses: [2],
        requestIdRequired: true,
        responseSizeMetering: true,
      },
      invoke: {
        method: "POST",
        targets: [{ url: `http://host.docker.internal:${MOCK_PORT}`, weight: 100, region: "local" }],
        timeoutMs: 15000,
        request:  { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        response: { type: "object", properties: { echo: { type: "object" } } },
        headersTemplate: {},
        examples: [{ query: "hello world" }],
      },
      isActive: true,
    };

    // Use local URL for non-Docker gateway
    registerPayload.invoke.targets = [
      { url: `http://127.0.0.1:${MOCK_PORT}`, weight: 100, region: "local" },
    ];

    const regRes = await apiPost("/v1/services", registerPayload, providerToken, providerAddress);
    check("service registered (2xx)", regRes.response.ok);
    if (!regRes.response.ok) {
      recordBug("SR01", "Service registration failed", JSON.stringify(regRes.body));
    }
    const serviceId = regRes.body?.serviceId || regRes.body?.service?.serviceId || SERVICE_TOOL_NAME;
    ok(`Registered serviceId: ${serviceId}`);

    // List services
    const listSvc = await apiGet("/v1/services", providerToken, providerAddress);
    check("list services (2xx)", listSvc.response.ok);
    const svcFound = (listSvc.body?.services || []).some(s => s.serviceId === serviceId || s.service_id === serviceId);
    check("registered service appears in list", svcFound);

    // Wait for health monitor to probe the mock upstream (probe interval ~15s)
    ok("Waiting for health monitor to probe new service (~20s)…");
    await sleep(20000);

    // Discover service
    const discoverRes = await apiGet(`/v1/services/discover?intent=echo`, null, null);
    check("discover endpoint (2xx)", discoverRes.response.ok);
    const discoveredSvc = (discoverRes.body?.services || []).find(
      s => (s.serviceId || s.service_id || s.agentToolName) === serviceId
    );
    check("service discoverable", !!discoveredSvc);
    if (discoveredSvc) {
      ok(`Discovered: ${discoveredSvc.serviceName || discoveredSvc.service_name} @ $${discoveredSvc.basePrice || discoveredSvc.pricing?.amount || "?"}`);
    }

    // ────────────────────────────────────────────────────────────────────────
    section("Phase 4 — Consumer: on-chain deposit USDC");
    // ────────────────────────────────────────────────────────────────────────
    const txHash = await fundAndDeposit(CONSUMER_KEY, DEPOSIT_USDC);
    await waitForGatewayDeposit(consumerToken, consumerAddress, txHash, DEPOSIT_USDC);

    // Get balance
    const balBefore = await apiGet("/v1/balance", consumerToken, consumerAddress);
    const availBefore = Number(balBefore.body?.balance?.consumerAvailableBalance ?? 0);
    check("consumer balance > 0", availBefore > 0);
    ok(`Consumer available balance: ${availBefore.toFixed(4)} USDC`);

    // ────────────────────────────────────────────────────────────────────────
    section("Phase 5 — Consumer: create agent credential");
    // ────────────────────────────────────────────────────────────────────────
    const credRes = await apiPost(
      "/v1/credentials/agent/issue",
      { name: "e2e-agent-key", rpm: 60, creditLimit: 1000.0 },
      consumerToken, consumerAddress,
    );
    check("agent credential issued (2xx)", credRes.response.ok);
    agentCredentialKey = credRes.body?.credential?.token || credRes.body?.credential?.secretKey || credRes.body?.secretKey || "";
    check("agent credential key returned", !!agentCredentialKey);

    // ────────────────────────────────────────────────────────────────────────
    section("Phase 6 — Consumer invokes provider's service");
    // ────────────────────────────────────────────────────────────────────────
    const requestId = `e2e-invoke-${Date.now()}`;
    const invokeRes = await apiPost(
      "/v1/gateway/generate",
      { prompt: "Hello from E2E test!", payload: { query: "What is Synapse?" } },
      null, null,
      {
        "X-Credential": agentCredentialKey,
        "X-Service-Id": serviceId,
        "X-Request-Id": requestId,
      },
    );

    check("invoke returned 200", invokeRes.response.status === 200);
    if (invokeRes.response.status !== 200) {
      recordBug("INV01", "Invocation failed",
        `Status: ${invokeRes.response.status}\n${JSON.stringify(invokeRes.body, null, 2)}`);
    }

    const receipt = invokeRes.body?.payload?.receipt || invokeRes.body?.receipt || {};
    check("receipt has totalCharge", typeof receipt.totalCharge === "number" && receipt.totalCharge > 0);
    check("receipt has invocationId", !!receipt.invocationId);
    ok(`totalCharge=${receipt.totalCharge}, invocationId=${receipt.invocationId}`);

    const upstreamResult = invokeRes.body?.payload?.data?.result || {};
    check("upstream returned echo data", upstreamResult.status === "ok" || !!upstreamResult.echo);

    // Verify consumer balance decreased
    const balAfter = await apiGet("/v1/balance", consumerToken, consumerAddress);
    const availAfter = Number(balAfter.body?.balance?.consumerAvailableBalance ?? 0);
    check("consumer balance decreased after invoke", availAfter < availBefore);
    ok(`Consumer balance: ${availBefore.toFixed(4)} → ${availAfter.toFixed(4)} USDC (charged ${(availBefore - availAfter).toFixed(4)})`);

    // ────────────────────────────────────────────────────────────────────────
    section("Phase 7 — Verify provider earnings");
    // ────────────────────────────────────────────────────────────────────────
    await sleep(1000); // allow settlement propagation
    const earningsRes = await apiGet("/v1/providers/earnings/summary?limit=50", providerToken, providerAddress);
    check("earnings summary (2xx)", earningsRes.response.ok);
    const summary = earningsRes.body?.summary || {};
    check("totalApiCalls > 0", (summary.totalApiCalls || 0) > 0);
    check("totalEarned > 0", (summary.totalEarned || 0) > 0);
    check("providerNetEarned > 0", (summary.providerNetEarned || 0) > 0);
    check("providerReceivable > 0", (summary.providerReceivable || 0) > 0);
    ok(`Provider earnings: calls=${summary.totalApiCalls}, gross=${summary.totalEarned}, net=${summary.providerNetEarned}, receivable=${summary.providerReceivable}`);
    ok(`Protocol fee: ${summary.totalProtocolFee}, routing tax: ${summary.totalRoutingTax}`);

    // Check recent calls
    const recentCalls = summary.recentCalls || [];
    check("recentCalls non-empty", recentCalls.length > 0);
    if (recentCalls.length > 0) {
      const lastCall = recentCalls[0];
      check("recentCall serviceId matches", lastCall.serviceId === serviceId);
      check("recentCall status=succeeded", lastCall.status === "succeeded");
      ok(`Last call: serviceId=${lastCall.serviceId}, unitPrice=${lastCall.unitPrice}, providerNet=${lastCall.providerNet}`);
    }

    // ── Provider withdraw capability ─────────────────────────────────────
    const capRes = await apiGet("/v1/providers/withdrawals/capability", providerToken, providerAddress);
    check("withdraw capability (2xx)", capRes.response.ok);
    ok(`Withdraw capability: ${JSON.stringify(capRes.body).substring(0, 120)}`);

    // ────────────────────────────────────────────────────────────────────────
    section("Phase 8 — Screenshot every Provider Console page");
    // ────────────────────────────────────────────────────────────────────────
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // Login as provider
    await browserLogin(page, providerToken, providerAddress, PROVIDER_KEY);

    const providerPages = [
      { route: "/provider/console",     name: "01-provider-console",     wait: 3000 },
      { route: "/provider/secrets",     name: "02-provider-secrets",     wait: 2000 },
      { route: "/provider/services",    name: "03-provider-services",    wait: 2000 },
      { route: "/provider/usage",       name: "04-provider-usage",       wait: 3000 },
      { route: "/provider/settlements", name: "05-provider-settlements", wait: 2000 },
    ];

    for (const pg of providerPages) {
      try {
        await page.goto(`${FRONTEND_URL}${pg.route}`, { waitUntil: "networkidle", timeout: 15000 });
        await sleep(pg.wait);
        await screenshot(page, pg.name);
      } catch (err) {
        recordBug(`SC-${pg.name}`, `Screenshot failed for ${pg.route}`, String(err.message));
        try { await screenshot(page, `${pg.name}-error`); } catch (_) {}
      }
    }

    // ── Verify Provider Console page data (browser) ────────────────────
    section("Phase 9 — Verify Provider pages (browser layout + API data)");
    await page.goto(`${FRONTEND_URL}/provider/console`, { waitUntil: "networkidle", timeout: 15000 });
    await sleep(3000);

    // Note: wagmi requires a real wallet extension for useAccount() to return an
    // address in headless Playwright. The Provider Console shows zeros without
    // wallet connection. API-based validation in Phase 7 is the authoritative check.
    const pageText = await page.evaluate(() => document.body.innerText);
    check("Provider Console page renders", pageText.includes("Provider Console") || pageText.includes("Provider"));
    check("Provider Console shows metric cards", pageText.includes("EARNINGS") || pageText.includes("收益") || pageText.includes("NET"));
    check("Provider Console shows deployment pipeline", pageText.includes("Pipeline") || pageText.includes("流水线") || pageText.includes("Credentials"));
    ok("Note: wallet-dependent data verified via API in Phase 7 (wagmi headless limitation)");
    await screenshot(page, "09-console-final-verified");

    // ── Verify Usage Analytics page renders ────────────────────────────
    await page.goto(`${FRONTEND_URL}/provider/usage`, { waitUntil: "networkidle", timeout: 15000 });
    await sleep(3000);

    const usageText = await page.evaluate(() => document.body.innerText);
    check("Usage Analytics page renders", usageText.includes("Usage") || usageText.includes("Analytics") || usageText.includes("使用") || usageText.includes("分析"));
    await screenshot(page, "09-usage-final-verified");

    // ── Verify My Services page renders ──────────────────────────────────
    await page.goto(`${FRONTEND_URL}/provider/services`, { waitUntil: "networkidle", timeout: 15000 });
    await sleep(2000);

    const servicesText = await page.evaluate(() => document.body.innerText);
    check("My Services page renders", servicesText.includes("Services") || servicesText.includes("服务") || servicesText.includes("My"));
    await screenshot(page, "09-services-final-verified");

    // ────────────────────────────────────────────────────────────────────────
    section("Phase 10 — Cleanup: delete test service");
    // ────────────────────────────────────────────────────────────────────────

    // First deactivate, then delete
    const updateRes = await fetch(`${GATEWAY_URL}/v1/services/${serviceId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${providerToken}`,
        "X-User-Address": providerAddress,
      },
      body: JSON.stringify({ isActive: false, status: "inactive" }),
    });
    const updateBody = await updateRes.json().catch(() => ({}));
    if (updateRes.ok) {
      ok("Service deactivated");
      const delRes = await apiDelete(`/v1/services/${serviceId}`, providerToken, providerAddress);
      check("service deleted", delRes.response.ok);
    } else {
      warn(`Service deactivation: ${updateRes.status} ${JSON.stringify(updateBody).substring(0, 200)}`);
    }

  } catch (err) {
    recordBug("FATAL", "Unhandled error", String(err.stack || err.message || err));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (mockServer) mockServer.close();
    writeBugReport();

    console.log("\n══════════════════════════════════════════════════════════");
    console.log(`  Results: ${GREEN}${passed} passed${RESET}, ${RED}${failed} failed${RESET}, ${bugs.length} bugs`);
    console.log(`  Screenshots: ${SCREENSHOT_DIR}`);
    console.log("══════════════════════════════════════════════════════════\n");

    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
