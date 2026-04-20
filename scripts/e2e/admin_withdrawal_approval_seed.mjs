#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "tmp/admin-withdrawal-approval");
const FIXTURE_PATH = process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE
  ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE)
  : path.join(OUT_DIR, "fixture.json");

const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300").replace(/\/+$/, "");
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const API_BASE = `${GATEWAY_BASE_URL}/api`;
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const RUN_ID = process.env.ADMIN_WITHDRAWAL_APPROVAL_RUN_ID || `awa-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
const MOCK_PORT = Number.parseInt(process.env.ADMIN_WITHDRAWAL_APPROVAL_MOCK_PORT || "19991", 10);
const SERVICE_PRICE_USDC = process.env.ADMIN_WITHDRAWAL_APPROVAL_SERVICE_PRICE_USDC || "3.000000";
const DEPOSIT_USDC = process.env.ADMIN_WITHDRAWAL_APPROVAL_DEPOSIT_USDC || "10.000000";
const WITHDRAW_AMOUNT_USDC = process.env.ADMIN_WITHDRAWAL_APPROVAL_AMOUNT_USDC || "2.000000";
const CONSUMER_ETH_TARGET = process.env.ADMIN_WITHDRAWAL_APPROVAL_CONSUMER_ETH || "2.0";
const PROVIDER_ETH_TARGET = process.env.ADMIN_WITHDRAWAL_APPROVAL_PROVIDER_ETH || "2.0";

const ADMIN_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "super@synapse.network";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qwer@1234";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";

const DEFAULT_KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  consumer: "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07",
  provider: "0x47e179ec197488bf6f785afa0fc15f4dee1a74f3f44fffedce27f84d349a926a",
};

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || DEFAULT_KEYS.deployer;
const CONSUMER_KEY = process.env.CONSUMER_KEY || DEFAULT_KEYS.consumer;
const PROVIDER_KEY = process.env.PROVIDER_KEY || DEFAULT_KEYS.provider;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  console.log(`[admin-withdrawal-seed] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertLocalOnly() {
  const usesDefaultKey = [DEPLOYER_KEY, CONSUMER_KEY, PROVIDER_KEY].some((key) =>
    Object.values(DEFAULT_KEYS).includes(key)
  );
  if (usesDefaultKey && CHAIN_ID !== 31337) {
    fail("Refusing to use default local test keys outside CHAIN_ID=31337.");
  }
  if (usesDefaultKey && (!isLocalUrl(RPC_URL) || !isLocalUrl(GATEWAY_BASE_URL) || !isLocalUrl(ADMIN_GATEWAY_URL))) {
    fail("Refusing to use default local test keys against non-local endpoints.");
  }
  if ((ADMIN_PASSWORD === "qwer@1234" || ADMIN_TOTP_SECRET === "JBSWY3DPEHPK3PXP") && !isLocalUrl(ADMIN_GATEWAY_URL)) {
    fail("Refusing to use default admin credentials against a non-local admin gateway.");
  }
}

async function assertReachable(name, url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= (options.attempts || 4); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        signal: controller.signal,
        body: options.body,
        headers: options.headers,
      });
      if (!response.ok && !options.allowNonOk) {
        fail(`${name} not ready: ${response.status} ${response.statusText} at ${url}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < (options.attempts || 4)) {
        log(`${name} reachability retry ${attempt}: ${error.message}`);
        await sleep(1000);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  fail(`${name} not reachable at ${url}. ${lastError?.message || "unknown error"}`);
}

async function api(pathname, { method = "GET", token, address, body, headers = {}, expectOk = true } = {}) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;

  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (expectOk && !response.ok) {
    fail(`${method} ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }
  return { response, payload };
}

async function authenticate(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const challengeResponse = await api(`/v1/auth/challenge?address=${encodeURIComponent(address)}`);
  const message = challengeResponse.payload.challenge || challengeResponse.payload.message;
  if (!message) fail(`${label} auth challenge missing message`);
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: address, message, signature },
  });
  const token = verified.payload.access_token || verified.payload.token || verified.payload.accessToken;
  if (!token) fail(`${label} auth verification did not return a token`);
  log(`${label} authenticated as ${address}`);
  return { address, token, privateKey, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== CHAIN_ID) fail(`RPC chainId mismatch. Expected ${CHAIN_ID}, got ${chainId}.`);
  const contractConfig = readJson("services/user-front/src/contract-config.json");
  return {
    provider,
    chainId,
    coreAddress: ethers.getAddress(contractConfig.SynapseCore),
    usdcAddress: ethers.getAddress(contractConfig.MockUSDC),
    coreAbi: readJson("services/user-front/src/SynapseCoreABI.json"),
    usdcAbi: readJson("services/user-front/src/MockUSDCABI.json"),
  };
}

async function sendWithRetry(label, makeTx, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await makeTx();
    } catch (error) {
      lastError = error;
      if (!/nonce|replacement|underpriced|already known|transaction underpriced/i.test(error.message || "")) {
        throw error;
      }
      log(`${label} retry ${i + 1}/${attempts}: ${error.message}`);
      await sleep(750);
    }
  }
  throw lastError;
}

function decimalToAtomic(value, decimals = 6) {
  const normalized = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals));
}

function atomicToDecimal(value, decimals = 6) {
  const atomic = BigInt(value || 0);
  const scale = 10n ** BigInt(decimals);
  const sign = atomic < 0n ? "-" : "";
  const abs = atomic < 0n ? -atomic : atomic;
  return `${sign}${abs / scale}.${String(abs % scale).padStart(decimals, "0")}`;
}

function moneyFromObject(object, keys, fallback = "0") {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) return String(object[key]);
  }
  return fallback;
}

async function topUpEthIfNeeded({ targetAddress, targetEth, deployer, provider, label }) {
  const current = await provider.getBalance(targetAddress);
  const target = ethers.parseEther(targetEth);
  if (current >= target) return null;
  const tx = await sendWithRetry(`${label}-eth-topup`, async () =>
    deployer.sendTransaction({ to: targetAddress, value: target - current })
  );
  await tx.wait();
  log(`${label} ETH top-up confirmed to ${targetEth} ETH`);
  return tx.hash;
}

async function fundAndDeposit({ consumerAddress, providerAddress }) {
  const { provider, coreAbi, usdcAbi, usdcAddress, coreAddress } = await getChainContext();
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const consumer = new ethers.Wallet(CONSUMER_KEY, provider);
  const usdcDeployer = new ethers.Contract(usdcAddress, usdcAbi, deployer);
  const usdcConsumer = new ethers.Contract(usdcAddress, usdcAbi, consumer);
  const coreConsumer = new ethers.Contract(coreAddress, coreAbi, consumer);
  const decimals = Number(await usdcDeployer.decimals());
  const amountAtomic = ethers.parseUnits(DEPOSIT_USDC, decimals);

  const consumerEthTopupTx = await topUpEthIfNeeded({ targetAddress: consumerAddress, targetEth: CONSUMER_ETH_TARGET, deployer, provider, label: "consumer" });
  const providerEthTopupTx = await topUpEthIfNeeded({ targetAddress: providerAddress, targetEth: PROVIDER_ETH_TARGET, deployer, provider, label: "provider" });

  const mintTx = await sendWithRetry("mint-usdc", async () => usdcDeployer.mint(consumerAddress, amountAtomic));
  await mintTx.wait();
  log(`${DEPOSIT_USDC} MockUSDC minted for consumer`);

  const approveTx = await sendWithRetry("approve-usdc", async () => usdcConsumer.approve(coreAddress, amountAtomic));
  await approveTx.wait();
  log("SynapseCore approval confirmed");

  const depositTx = await sendWithRetry("deposit", async () => coreConsumer.deposit(amountAtomic));
  const receipt = await depositTx.wait();
  if (receipt?.status !== 1) fail(`deposit transaction failed: ${depositTx.hash}`);
  log(`chain deposit confirmed: ${depositTx.hash}`);
  return {
    txHash: depositTx.hash,
    amountUsdc: DEPOSIT_USDC,
    decimals,
    coreAddress,
    usdcAddress,
    consumerEthTopupTx,
    providerEthTopupTx,
  };
}

async function registerDepositIntent({ token, address, txHash, amountUsdc }) {
  const result = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token,
    address,
    headers: { "X-Idempotency-Key": `awa-deposit-${txHash.replace(/^0x/, "").slice(0, 80)}` },
    body: { txHash, amountUsdc },
  });
  log(`deposit intent registered: ${result.payload.intent?.id || result.payload.id || txHash}`);
  return result.payload;
}

async function confirmLocalDepositIntent({ token, address, depositIntent, txHash }) {
  const depositIntentId = depositIntent.intent?.id || depositIntent.id;
  if (!depositIntentId) fail(`deposit intent response missing id: ${JSON.stringify(depositIntent).slice(0, 600)}`);
  const confirmed = await api(`/v1/balance/deposit/intents/${encodeURIComponent(depositIntentId)}/confirm`, {
    method: "POST",
    token,
    address,
    body: {
      eventKey: `admin-withdrawal-approval:${String(txHash).toLowerCase()}`,
      confirmations: 1,
    },
  });
  log(`deposit intent confirmed locally: ${depositIntentId}`);
  return confirmed.payload;
}

async function waitForBalanceAtLeast({ token, address, expectedUsdc, txHash }) {
  const expected = decimalToAtomic(expectedUsdc);
  let lastBalance = "0";
  for (let i = 0; i < 40; i += 1) {
    await api(`/v1/balance/deposit/sync?txHash=${encodeURIComponent(String(txHash).toLowerCase())}`, {
      token,
      address,
      expectOk: false,
    }).catch(() => null);
    const payload = (await api("/v1/balance", { token, address })).payload;
    const balance = payload.balance || {};
    lastBalance = String(balance.consumerAvailableBalance ?? balance.ownerBalance ?? "0");
    if (decimalToAtomic(lastBalance) >= expected) {
      log(`consumer gateway balance synced: ${lastBalance} USDC`);
      return payload;
    }
    await sleep(1500);
  }
  fail(`consumer balance did not reach ${expectedUsdc} USDC; last=${lastBalance}`);
}

async function ensureMockUpstream() {
  const healthUrl = `http://127.0.0.1:${MOCK_PORT}/health`;
  const existing = await fetch(healthUrl).then((res) => res.ok).catch(() => false);
  if (existing) {
    log(`mock upstream already running on ${healthUrl}`);
    return { url: `http://127.0.0.1:${MOCK_PORT}`, pid: null, reused: true };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const logPath = path.join(OUT_DIR, "mock-upstream.log");
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--mock-upstream"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", fs.openSync(logPath, "a"), fs.openSync(logPath, "a")],
  });
  child.unref();

  for (let i = 0; i < 30; i += 1) {
    if (await fetch(healthUrl).then((res) => res.ok).catch(() => false)) {
      log(`mock upstream started on ${healthUrl} (pid ${child.pid})`);
      return { url: `http://127.0.0.1:${MOCK_PORT}`, pid: child.pid, reused: false };
    }
    await sleep(500);
  }
  fail(`mock upstream did not start; see ${logPath}`);
}

function startMockUpstream() {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", runId: RUN_ID }));
      return;
    }
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = { raw };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        runId: RUN_ID,
        service: "admin-withdrawal-approval-provider",
        echo: parsed,
        receivedAt: new Date().toISOString(),
      }));
    });
  });
  server.listen(MOCK_PORT, "127.0.0.1", () => {
    console.log(`[admin-withdrawal-mock] listening on http://127.0.0.1:${MOCK_PORT}`);
  });
}

async function issueProviderSecret({ token, address }) {
  const payload = (await api("/v1/secrets/provider/issue", {
    method: "POST",
    token,
    address,
    body: {
      name: `awa-provider-secret-${RUN_ID}`,
      rpm: 60,
      creditLimit: "1000",
      expiration: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
  })).payload;
  const secret = payload.secret || payload.credential || payload;
  return {
    id: secret.id || secret.credentialId || "",
    tokenPrefix: secret.tokenPrefix || secret.secretPrefix || "",
  };
}

function serviceId() {
  return `awa_provider_withdraw_${RUN_ID.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

async function registerService({ token, address, mockUrl }) {
  const id = serviceId();
  const payload = {
    serviceName: `Admin Withdrawal Approval Provider ${RUN_ID}`,
    agentToolName: id,
    role: "Provider",
    pricing: { currency: "USDC", amount: SERVICE_PRICE_USDC },
    summary: "Provider service used to generate real receivable for admin withdrawal approval dogfood.",
    tags: ["admin-withdrawal-approval", "verification"],
    providerProfile: { displayName: "Admin Withdrawal Approval Provider" },
    payoutAccount: {
      payoutAddress: address,
      chainId: CHAIN_ID,
      settlementCurrency: "USDC",
      status: "active",
    },
    governance: { termsAccepted: true, riskAcknowledged: true, note: RUN_ID },
    healthCheck: {
      path: "/health",
      method: "GET",
      intervalSec: 15,
      timeoutMs: 5000,
      successCodes: [200],
      healthyThreshold: 1,
      unhealthyThreshold: 1,
    },
    constraints: { timeoutMs: 15000, maxResponseBytes: 500000, maxRequestBytes: 100000, maxQps: 50, maxConcurrency: 4 },
    forwarding: {
      requestIdHeader: "X-Synapse-Request-Id",
      passThroughHeaders: [],
      injectHeaders: {},
      retryPolicy: { maxAttempts: 1, backoffMs: 200, retryOnStatus: [429, 500, 502, 503, 504] },
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
      targets: [{ url: mockUrl, weight: 100, region: "local" }],
      timeoutMs: 15000,
      request: {
        contentType: "application/json",
        schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
      response: { schema: { type: "object", properties: { status: { type: "string" }, echo: { type: "object" } } } },
      headersTemplate: {},
      examples: [{ query: "approval verification" }],
    },
    isActive: true,
    status: "active",
  };
  const response = (await api("/v1/services", { method: "POST", token, address, body: payload })).payload;
  const service = response.service || response;
  const createdServiceId = service.serviceId || response.serviceId || id;
  log(`service registered: ${createdServiceId} (${SERVICE_PRICE_USDC} USDC)`);
  return { id: createdServiceId, name: service.serviceName || payload.serviceName, priceUsdc: SERVICE_PRICE_USDC, mockUrl };
}

async function waitForServiceDiscoverable(id) {
  for (let i = 0; i < 30; i += 1) {
    const payload = (await api(`/v1/services/discover?q=${encodeURIComponent(id)}`)).payload;
    const services = Array.isArray(payload.services) ? payload.services : [];
    const found = services.find((service) => [service.serviceId, service.service_id, service.agentToolName].includes(id));
    if (found && found.isActive !== false && found.runtimeAvailable !== false) {
      log(`service discoverable and callable: ${id}`);
      return found;
    }
    await sleep(3000);
  }
  fail(`service was not discoverable/callable after health probes: ${id}`);
}

async function issueAgentCredential({ token, address }) {
  const payload = (await api("/v1/credentials/agent/issue", {
    method: "POST",
    token,
    address,
    body: {
      name: `awa-agent-${RUN_ID}`,
      rpm: 60,
      maxCalls: 10,
      creditLimit: "10",
      resetInterval: "daily",
    },
  })).payload;
  const credential = payload.credential || payload;
  const credentialToken = credential.token || credential.secretKey || credential.agentToken;
  if (!credential?.id || !credentialToken) fail("agent credential issue response missing id or token");
  log(`agent credential issued: ${credential.id}`);
  return { id: credential.id, token: credentialToken, tokenPrefix: credential.tokenPrefix || credential.secretPrefix || "" };
}

async function invokeService({ credentialToken, service }) {
  const requestId = `awa-invoke-${RUN_ID}`;
  let response = null;
  let lastFailure = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await api("/v1/gateway/generate", {
      method: "POST",
      headers: {
        "X-Credential": credentialToken,
        "X-Service-Id": service.id,
        "X-Request-Id": requestId,
      },
      body: {
        prompt: "Admin withdrawal approval verification invoke",
        payload: { query: `verify ${RUN_ID}` },
      },
      expectOk: false,
    });
    if (result.response.ok) {
      response = result.payload;
      break;
    }
    const code = result.payload?.detail?.code || result.payload?.code || "";
    lastFailure = `${result.response.status} ${JSON.stringify(result.payload).slice(0, 400)}`;
    if (!["SERVICE_UNAVAILABLE", "SERVICE_BUSY", "SERVICE_CIRCUIT_OPEN"].includes(code)) {
      fail(`POST /v1/gateway/generate failed: ${lastFailure}`);
    }
    log(`invoke retry ${attempt}/12: ${lastFailure}`);
    await sleep(2500);
  }
  if (!response) {
    fail(`POST /v1/gateway/generate failed after retries: ${lastFailure}`);
  }
  const receipt = response.payload?.receipt || response.receipt || {};
  if (!receipt.invocationId) fail(`invoke response missing invocationId: ${JSON.stringify(response).slice(0, 800)}`);
  log(`paid invoke completed: ${receipt.invocationId}`);
  return {
    requestId,
    invocationId: receipt.invocationId,
    totalChargeUsdc: moneyFromObject(receipt, ["totalCharge", "totalChargeUsdc", "chargedUsdc"], service.priceUsdc),
    serviceUnitPrice: moneyFromObject(receipt, ["serviceUnitPrice", "unitPrice"], service.priceUsdc),
    providerNetUsdc: moneyFromObject(receipt, ["providerNetUsdc", "providerNet"], "0"),
    platformFeeUsdc: moneyFromObject(receipt, ["platformFeeUsdc", "platformFee"], "0"),
  };
}

async function readProviderCapability(auth) {
  return (await api("/v1/providers/withdrawals/capability", auth)).payload;
}

async function readProviderWithdrawals(auth) {
  return (await api("/v1/providers/withdrawals?limit=50", auth)).payload.withdrawals || [];
}

async function createWithdrawal(auth, { amountUsdc, idempotencyKey, expectOk = true }) {
  return api("/v1/providers/withdrawals/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: { "X-Idempotency-Key": idempotencyKey },
    body: { amountUsdc },
    expectOk,
  });
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of String(secret).replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`Invalid base32 character in ADMIN_TOTP_SECRET: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpCode(secret, nowMs = Date.now()) {
  const counter = Math.floor(nowMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32ToBuffer(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function parseSessionCookie(setCookieHeader) {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join(",") : String(setCookieHeader || "");
  const match = header.split(/,(?=\s*[^;,]+=)/).map((item) => item.trim()).find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`));
  return match ? match.split(";")[0].slice(ADMIN_COOKIE_NAME.length + 1) : "";
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return { sessionToken: process.env.ADMIN_SESSION_TOKEN, csrfToken: process.env.ADMIN_CSRF_TOKEN || "", admin: null };
  }
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      otpCode: process.env.ADMIN_OTP_CODE || generateTotpCode(ADMIN_TOTP_SECRET),
    }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !body.success || !sessionToken) {
    fail(`Admin login failed: ${response.status} ${JSON.stringify(body).slice(0, 800)}`);
  }
  return { sessionToken, csrfToken: body.data?.csrfToken || "", admin: body.data?.admin || null };
}

async function adminApi(pathname, auth) {
  const response = await fetch(`${ADMIN_GATEWAY_URL}${pathname}`, {
    headers: { Accept: "application/json", Cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    fail(`Admin API failed ${pathname}: ${response.status} ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body.data;
}

async function invalidInternalTokenReview({ withdrawalId, ownerAddress }) {
  const response = await fetch(`${API_BASE}/v1/admin/providers/withdrawals/${encodeURIComponent(withdrawalId)}/review`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer invalid-admin-withdrawal-approval-token",
      "X-Request-Id": `awa-invalid-internal-token-${RUN_ID}`,
    },
    body: JSON.stringify({
      ownerAddress,
      reviewDecision: "APPROVE",
      reviewerAddress: ownerAddress,
      reviewerNote: "This must fail before touching balances.",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok) fail("Invalid internal token unexpectedly reviewed withdrawal.");
  const code = payload.error?.code || payload.detail?.code || payload.code;
  if (code !== "INTERNAL_TOKEN_INVALID" && response.status !== 401 && response.status !== 403) {
    fail(`Invalid internal token returned unexpected response: ${response.status} ${JSON.stringify(payload).slice(0, 500)}`);
  }
  log(`invalid internal token rejected: status=${response.status} code=${code || "n/a"}`);
  return { status: response.status, code: code || null, payload };
}

async function readChainBalances(address) {
  const { provider, coreAddress, usdcAddress, usdcAbi } = await getChainContext();
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);
  const decimals = Number(await usdc.decimals());
  const providerAtomic = await usdc.balanceOf(address);
  const vaultAtomic = await usdc.balanceOf(coreAddress);
  return {
    decimals,
    providerUsdcAtomic: providerAtomic.toString(),
    providerUsdc: ethers.formatUnits(providerAtomic, decimals),
    vaultUsdcAtomic: vaultAtomic.toString(),
    vaultUsdc: ethers.formatUnits(vaultAtomic, decimals),
  };
}

async function main() {
  if (process.argv.includes("--mock-upstream")) {
    startMockUpstream();
    return;
  }

  assertLocalOnly();
  await assertReachable("gateway health", `${GATEWAY_BASE_URL}/health`);
  await assertReachable("gateway-admin health", `${ADMIN_GATEWAY_URL}/health`);
  await assertReachable("rpc", RPC_URL, { method: "POST", allowNonOk: true });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const mock = await ensureMockUpstream();
  const providerAuth = await authenticate(PROVIDER_KEY, "provider");
  const consumerAuth = await authenticate(CONSUMER_KEY, "consumer");
  const adminAuth = await loginAdmin();
  const chain = await getChainContext();
  const providerSecret = await issueProviderSecret(providerAuth);
  const service = await registerService({ ...providerAuth, mockUrl: mock.url });
  await waitForServiceDiscoverable(service.id);

  const deposit = await fundAndDeposit({ consumerAddress: consumerAuth.address, providerAddress: providerAuth.address });
  const depositIntent = await registerDepositIntent({ ...consumerAuth, txHash: deposit.txHash, amountUsdc: deposit.amountUsdc });
  const confirmedDeposit = await confirmLocalDepositIntent({ ...consumerAuth, depositIntent, txHash: deposit.txHash });
  const balanceBeforeInvoke = await waitForBalanceAtLeast({ ...consumerAuth, expectedUsdc: deposit.amountUsdc, txHash: deposit.txHash });
  const credential = await issueAgentCredential(consumerAuth);
  const invocation = await invokeService({ credentialToken: credential.token, service });

  const capabilityBeforeWithdraw = await readProviderCapability(providerAuth);
  const chainBeforeWithdraw = await readChainBalances(providerAuth.address);
  const primaryKey = `admin-withdrawal-approval:${RUN_ID}:primary`;
  const withdrawalResult = await createWithdrawal(providerAuth, { amountUsdc: WITHDRAW_AMOUNT_USDC, idempotencyKey: primaryKey });
  const withdrawal = withdrawalResult.payload;
  if (withdrawal.status !== "PENDING_MANUAL_REVIEW") {
    fail(`Expected withdrawal to enter PENDING_MANUAL_REVIEW. Got ${withdrawal.status}. Start gateway with WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC=1.000000.`);
  }
  if (withdrawal.ticket && Object.keys(withdrawal.ticket).length > 0) {
    fail("Manual review withdrawal returned a ticket before approval.");
  }

  const capabilityAfterRequest = await readProviderCapability(providerAuth);
  const withdrawalsAfterRequest = await readProviderWithdrawals(providerAuth);
  const duplicateSameKey = await createWithdrawal(providerAuth, { amountUsdc: WITHDRAW_AMOUNT_USDC, idempotencyKey: primaryKey });
  if (duplicateSameKey.payload.withdrawalId !== withdrawal.withdrawalId) {
    fail(`Same idempotency key returned different withdrawalId: ${duplicateSameKey.payload.withdrawalId}`);
  }

  const duplicateActiveSameAmount = await createWithdrawal(providerAuth, {
    amountUsdc: WITHDRAW_AMOUNT_USDC,
    idempotencyKey: `admin-withdrawal-approval:${RUN_ID}:active-same-amount`,
  });
  if (duplicateActiveSameAmount.payload.withdrawalId !== withdrawal.withdrawalId) {
    fail(`Active same-amount withdrawal returned different withdrawalId: ${duplicateActiveSameAmount.payload.withdrawalId}`);
  }

  const duplicateActiveDifferentAmount = await createWithdrawal(providerAuth, {
    amountUsdc: "2.500000",
    idempotencyKey: `admin-withdrawal-approval:${RUN_ID}:active-different-amount`,
    expectOk: false,
  });
  if (duplicateActiveDifferentAmount.response.ok) {
    fail("Active different-amount withdrawal unexpectedly succeeded.");
  }

  const invalidInternalToken = await invalidInternalTokenReview({
    withdrawalId: withdrawal.withdrawalId,
    ownerAddress: providerAuth.address,
  });
  const adminQueue = await adminApi(`/api/admin/v1/withdrawal-reviews?limit=20`, adminAuth);
  const projected = (adminQueue.items || []).find((item) => item.withdrawalId === withdrawal.withdrawalId);
  if (!projected) {
    fail(`gateway-admin did not project withdrawal ${withdrawal.withdrawalId} into /withdrawal-reviews.`);
  }

  const fixture = {
    version: 1,
    mode: "admin-withdrawal-approval-provider",
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    baseUrls: {
      gateway: GATEWAY_BASE_URL,
      adminGateway: ADMIN_GATEWAY_URL,
      rpc: RPC_URL,
      mockUpstream: { url: mock.url, pid: mock.pid, reused: mock.reused },
    },
    chain: {
      chainId: chain.chainId,
      synapseCore: chain.coreAddress,
      mockUSDC: chain.usdcAddress,
    },
    auth: adminAuth,
    consumer: consumerAuth,
    provider: providerAuth,
    providerSecret,
    service,
    credential,
    deposit: {
      txHash: deposit.txHash,
      amountUsdc: deposit.amountUsdc,
      intentId: depositIntent.intent?.id || depositIntent.id || null,
      confirmedIntentId: confirmedDeposit.intent?.id || confirmedDeposit.id || null,
    },
    invocation,
    withdrawal: {
      withdrawalId: withdrawal.withdrawalId,
      amountUsdc: WITHDRAW_AMOUNT_USDC,
      idempotencyKey: primaryKey,
      expectedAmountAtomic: String(decimalToAtomic(WITHDRAW_AMOUNT_USDC, 18)),
      initialStatus: withdrawal.status,
      message: withdrawal.message || "",
    },
    expected: {
      manualReviewStatus: "PENDING_MANUAL_REVIEW",
      approvedStatus: "APPROVED_AUTO",
      completedStatus: "COMPLETED",
      amountUsdc: WITHDRAW_AMOUNT_USDC,
      amountAtomic: String(decimalToAtomic(WITHDRAW_AMOUNT_USDC, 18)),
    },
    snapshots: {
      balanceBeforeInvoke: balanceBeforeInvoke.balance || balanceBeforeInvoke,
      capabilityBeforeWithdraw,
      capabilityAfterRequest,
      chainBeforeWithdraw,
      withdrawalsAfterRequest,
      adminProjectedReview: projected,
    },
    securityChecks: {
      duplicateSameKey: {
        status: duplicateSameKey.response.status,
        withdrawalId: duplicateSameKey.payload.withdrawalId,
      },
      duplicateActiveSameAmount: {
        status: duplicateActiveSameAmount.response.status,
        withdrawalId: duplicateActiveSameAmount.payload.withdrawalId,
      },
      duplicateActiveDifferentAmount: {
        status: duplicateActiveDifferentAmount.response.status,
        payload: duplicateActiveDifferentAmount.payload,
      },
      invalidInternalToken,
    },
  };

  fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  log(`fixture written: ${FIXTURE_PATH}`);
  log(`withdrawal ready for admin approval: ${withdrawal.withdrawalId}`);
}

main().catch((error) => {
  console.error(`[admin-withdrawal-seed] fatal: ${error.stack || error.message || String(error)}`);
  process.exit(1);
});
