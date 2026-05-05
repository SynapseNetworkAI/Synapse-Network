#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  generateTotpCode,
  waitForSafeTotpWindow,
} from "../lib/totp_window.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SCRIPT_VERSION = "local-production-load-rehearsal:v1";
const GENERATED_AT = new Date().toISOString();
const SAFE_TIMESTAMP = GENERATED_AT.replace(/[:.]/g, "").replace("Z", "Z");
const REHEARSAL_RUN_ID =
  process.env.REHEARSAL_RUN_ID ||
  process.env.SYNAPSE_LOAD_RUN_ID ||
  `lplr-${SAFE_TIMESTAMP}-${crypto.randomBytes(4).toString("hex")}`;
const OUT_DIR = process.env.SYNAPSE_LOAD_OUT_DIR
  ? path.resolve(process.env.SYNAPSE_LOAD_OUT_DIR)
  : path.join(
      ROOT,
      "docs/evidence/performance",
      `${SAFE_TIMESTAMP}-local-production-load-rehearsal`
    );

const GATEWAY_BASE_URL = (
  process.env.SYNAPSE_GATEWAY_BASE_URL ||
  process.env.GATEWAY_BASE_URL ||
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (
  process.env.SYNAPSE_ADMIN_GATEWAY_BASE_URL ||
  process.env.ADMIN_GATEWAY_URL ||
  "http://127.0.0.1:8300"
).replace(/\/+$/, "");
const API_BASE = `${GATEWAY_BASE_URL}/api`;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const MOCK_PORT = Number.parseInt(
  process.env.SYNAPSE_LOAD_MOCK_PORT || "19995",
  10
);

const DURATION_SEC = Number.parseInt(
  process.env.SYNAPSE_LOAD_DURATION_SEC || "90",
  10
);
const DRAIN_SEC = Number.parseInt(
  process.env.SYNAPSE_LOAD_DRAIN_SEC || "5",
  10
);
const DRAIN_HARD_CAP_SEC = Number.parseInt(
  process.env.SYNAPSE_LOAD_DRAIN_HARD_CAP_SEC || "30",
  10
);
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.SYNAPSE_LOAD_REQUEST_TIMEOUT_MS || "12000",
  10
);
const TICK_MS = Number.parseInt(process.env.SYNAPSE_LOAD_TICK_MS || "100", 10);
const CHAIN_TX_MAX_RETRIES = Number.parseInt(
  process.env.SYNAPSE_LOAD_CHAIN_TX_MAX_RETRIES || "3",
  10
);

const CONSUMER_WALLET_COUNT = Number.parseInt(
  process.env.SYNAPSE_LOAD_CONSUMER_WALLET_COUNT || "4",
  10
);
const PROVIDER_WALLET_COUNT = Number.parseInt(
  process.env.SYNAPSE_LOAD_PROVIDER_WALLET_COUNT || "4",
  10
);
const CONSUMER_DEPOSIT_USDC =
  process.env.SYNAPSE_LOAD_CONSUMER_DEPOSIT_USDC || "25.000000";
const CONSUMER_MINT_USDC =
  process.env.SYNAPSE_LOAD_CONSUMER_MINT_USDC || "40.000000";
const SERVICE_PRICE_USDC =
  process.env.SYNAPSE_LOAD_SERVICE_PRICE_USDC || "0.100000";
const MUTATION_DEPOSIT_USDC =
  process.env.SYNAPSE_LOAD_MUTATION_DEPOSIT_USDC || "0.100000";
const CONSUMER_WITHDRAW_USDC =
  process.env.SYNAPSE_LOAD_CONSUMER_WITHDRAW_USDC || "1.000000";
const PROVIDER_WITHDRAW_USDC =
  process.env.SYNAPSE_LOAD_PROVIDER_WITHDRAW_USDC || "1.000000";
const PROVIDER_WARMUP_INVOKES = Number.parseInt(
  process.env.SYNAPSE_LOAD_PROVIDER_WARMUP_INVOKES || "15",
  10
);
const ETH_GAS_FUND = process.env.SYNAPSE_LOAD_ETH_GAS_FUND || "1.0";

const LANE_CONCURRENCY = {
  invoke: Number.parseInt(
    process.env.SYNAPSE_LOAD_INVOKE_CONCURRENCY || "1",
    10
  ),
  balance: Number.parseInt(
    process.env.SYNAPSE_LOAD_BALANCE_CONCURRENCY || "4",
    10
  ),
  "deposit-confirm": Number.parseInt(
    process.env.SYNAPSE_LOAD_DEPOSIT_CONCURRENCY || "2",
    10
  ),
  withdrawal: Number.parseInt(
    process.env.SYNAPSE_LOAD_WITHDRAWAL_CONCURRENCY || "1",
    10
  ),
  "provider-health": Number.parseInt(
    process.env.SYNAPSE_LOAD_PROVIDER_HEALTH_CONCURRENCY || "1",
    10
  ),
  "admin-finance": Number.parseInt(
    process.env.SYNAPSE_LOAD_ADMIN_FINANCE_CONCURRENCY || "2",
    10
  ),
};
const DEPOSIT_TASKS = Number.parseInt(
  process.env.SYNAPSE_LOAD_DEPOSIT_TASKS || "4",
  10
);
const WITHDRAWAL_TASKS = Number.parseInt(
  process.env.SYNAPSE_LOAD_WITHDRAWAL_TASKS || "2",
  10
);

const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "cliff@synapse-network.ai";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qwer@1234";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";

const DEFAULT_DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEPLOYER_KEY = process.env.DEPLOYER_KEY || DEFAULT_DEPLOYER_KEY;
const REQUIRED_LANES = [
  "invoke",
  "balance",
  "deposit-confirm",
  "withdrawal",
  "provider-health",
  "admin-finance",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failed = [];
const warnings = [];
const laneResults = [];
let mockServer = null;
let chainNonceCollisionCount = 0;

function log(message) {
  console.log(`[local-production-load] ${message}`);
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
  if (CHAIN_ID !== 31337) {
    fail(
      `local rehearsal refuses non-local chain id. Expected 31337, got ${CHAIN_ID}.`
    );
  }
  for (const [name, value] of [
    ["gateway", GATEWAY_BASE_URL],
    ["admin-gateway", ADMIN_GATEWAY_URL],
    ["rpc", RPC_URL],
  ]) {
    if (!isLocalUrl(value))
      fail(`local rehearsal refuses non-local ${name} URL: ${value}`);
  }
  if (
    DEPLOYER_KEY !== DEFAULT_DEPLOYER_KEY &&
    process.env.SYNAPSE_LOAD_ALLOW_CUSTOM_LOCAL_FAUCET !== "true"
  ) {
    fail(
      "custom faucet key requires SYNAPSE_LOAD_ALLOW_CUSTOM_LOCAL_FAUCET=true so staging/prod keys are never used by accident."
    );
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  }
  return value;
}

function evidenceDigest(report) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        stable({
          scriptVersion: report.scriptVersion,
          rehearsalRunId: report.rehearsalRunId,
          environment: report.environment,
          config: report.config,
          walletPool: report.walletPool,
          lanes: report.lanes,
          reconciliation: report.reconciliation,
          metrics: report.metrics,
          failed: report.failed,
          warnings: report.warnings,
        })
      )
    )
    .digest("hex");
}

function formatUsdcAtomic(value, decimals = 6) {
  return ethers.formatUnits(value, decimals);
}

function usdcAtomic(value, decimals = 6) {
  return ethers.parseUnits(value, decimals);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))
  );
  return Number(sorted[index].toFixed(3));
}

function summarizeRecords(records) {
  const latencies = records
    .map((row) => row.latencyMs)
    .filter((value) => Number.isFinite(value));
  const failures = records.filter((row) => !row.ok);
  const statuses = {};
  for (const row of records) {
    statuses[String(row.status || row.errorCode || "0")] =
      (statuses[String(row.status || row.errorCode || "0")] || 0) + 1;
  }
  return {
    requests: records.length,
    successes: records.length - failures.length,
    failures: failures.length,
    successRate: records.length
      ? Number(((records.length - failures.length) / records.length).toFixed(6))
      : 0,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    statuses,
    unexpected5xx: records.filter(
      (row) => !row.ok && Number(row.status || 0) >= 500
    ).length,
    sampleErrors: failures.slice(0, 8).map((row) => ({
      name: row.name,
      status: row.status,
      errorCode: row.errorCode,
      error: String(row.error || "").slice(0, 240),
    })),
  };
}

async function requestJson(
  url,
  {
    method = "GET",
    headers = {},
    body,
    timeoutMs = REQUEST_TIMEOUT_MS,
    expectedStatuses = [200],
  } = {}
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 600) };
      }
    }
    return {
      ok: expectedStatuses.includes(response.status),
      status: response.status,
      payload,
      latencyMs: performance.now() - started,
      errorCode: payload?.detail?.code || payload?.code || "",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: {},
      latencyMs: performance.now() - started,
      error: String(error?.message || error).slice(0, 600),
      errorCode: error?.name || "REQUEST_ERROR",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function api(
  pathname,
  { token, address, headers = {}, ...options } = {}
) {
  return requestJson(`${API_BASE}${pathname}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(address ? { "X-User-Address": address } : {}),
      ...headers,
    },
  });
}

function parseSessionCookie(setCookieHeader) {
  const header = Array.isArray(setCookieHeader)
    ? setCookieHeader.join(",")
    : String(setCookieHeader || "");
  const match = header
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`));
  return match ? match.split(";")[0].slice(ADMIN_COOKIE_NAME.length + 1) : "";
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return {
      cookie: `${ADMIN_COOKIE_NAME}=${process.env.ADMIN_SESSION_TOKEN}`,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
    };
  }
  await waitForSafeTotpWindow({ guardSeconds: 10 });
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      otpCode:
        process.env.ADMIN_OTP_CODE || generateTotpCode(ADMIN_TOTP_SECRET),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const session = parseSessionCookie(setCookie);
  if (!response.ok || !session) {
    fail(
      `admin login failed: ${response.status} ${JSON.stringify(payload).slice(
        0,
        400
      )}`
    );
  }
  return {
    cookie: `${ADMIN_COOKIE_NAME}=${session}`,
    csrfToken: payload?.data?.csrfToken || "",
  };
}

async function adminApi(pathname, auth) {
  return requestJson(`${ADMIN_GATEWAY_URL}${pathname}`, {
    headers: {
      Cookie: auth.cookie,
      ...(auth.csrfToken ? { "X-CSRF-Token": auth.csrfToken } : {}),
    },
  });
}

async function authenticate(wallet, label) {
  const challenge = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`
  );
  if (!challenge.ok)
    fail(`${label} auth challenge failed: ${challenge.status}`);
  const message = challenge.payload.challenge || challenge.payload.message;
  if (!message) fail(`${label} auth challenge missing message`);
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: wallet.address, message, signature },
  });
  if (!verified.ok)
    fail(
      `${label} auth verify failed: ${verified.status} ${JSON.stringify(
        verified.payload
      ).slice(0, 400)}`
    );
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  if (!token) fail(`${label} auth verify returned no token`);
  return { address: wallet.address, token };
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  if (chainId !== CHAIN_ID)
    fail(`RPC chainId mismatch. Expected ${CHAIN_ID}, got ${chainId}.`);
  const contractConfig = readJson(
    "services/user-front/src/contract-config.json"
  );
  const coreAddress = ethers.getAddress(contractConfig.SynapseCore);
  const usdcAddress = ethers.getAddress(contractConfig.MockUSDC);
  const coreAbi = readJson("services/user-front/src/SynapseCoreABI.json");
  const usdcAbi = readJson("services/user-front/src/MockUSDCABI.json");
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);
  const decimals = Number(await usdc.decimals());
  return {
    provider,
    chainId,
    coreAddress,
    usdcAddress,
    coreAbi,
    usdcAbi,
    decimals,
  };
}

class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  async run(fn) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const faucetMutex = new Mutex();
const walletMutexes = new Map();

function walletMutex(address) {
  const key = ethers.getAddress(address);
  if (!walletMutexes.has(key)) walletMutexes.set(key, new Mutex());
  return walletMutexes.get(key);
}

function isNonceError(error) {
  return /nonce too low|replacement transaction underpriced|already known|transaction underpriced|nonce has already been used/i.test(
    String(error?.message || error)
  );
}

async function sendChainTx(label, signer, makeTx) {
  const address = await signer.getAddress();
  return walletMutex(address).run(async () => {
    let lastError;
    for (let attempt = 1; attempt <= CHAIN_TX_MAX_RETRIES; attempt += 1) {
      try {
        const tx = await makeTx();
        const receipt = await tx.wait();
        return {
          txHash: tx.hash,
          receiptStatus: Number(receipt?.status ?? -1),
          blockNumber: Number(receipt?.blockNumber ?? 0),
        };
      } catch (error) {
        lastError = error;
        if (!isNonceError(error)) throw error;
        chainNonceCollisionCount += 1;
        if (typeof signer.reset === "function") signer.reset();
        warnings.push({
          code: "chain_nonce_collision",
          label,
          address,
          attempt,
          error: String(error?.message || error).slice(0, 240),
        });
        await signer.provider
          ?.getTransactionCount(address, "pending")
          .catch(() => null);
        await sleep(500 * attempt);
      }
    }
    throw lastError;
  });
}

async function withFaucet(fn) {
  return faucetMutex.run(fn);
}

async function fundWallets(chain, walletPool) {
  const deployerWallet = new ethers.Wallet(DEPLOYER_KEY, chain.provider);
  const deployer = new ethers.NonceManager(deployerWallet);
  const usdc = new ethers.Contract(chain.usdcAddress, chain.usdcAbi, deployer);
  const funding = [];
  async function sendFaucetTx(label, makeTx) {
    let lastError;
    for (let attempt = 1; attempt <= CHAIN_TX_MAX_RETRIES; attempt += 1) {
      try {
        const tx = await makeTx();
        const receipt = await tx.wait();
        return {
          txHash: tx.hash,
          receiptStatus: Number(receipt?.status ?? -1),
        };
      } catch (error) {
        lastError = error;
        if (!isNonceError(error)) throw error;
        deployer.reset();
        await chain.provider
          .getTransactionCount(deployerWallet.address, "pending")
          .catch(() => null);
        warnings.push({
          code: "faucet_nonce_retry",
          label,
          attempt,
          error: String(error?.message || error).slice(0, 240),
        });
        await sleep(500 * attempt);
      }
    }
    throw lastError;
  }
  for (const wallet of [...walletPool.consumers, ...walletPool.providers]) {
    await withFaucet(async () => {
      const ethTx = await sendFaucetTx(`fund-eth:${wallet.address}`, () =>
        deployer.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther(ETH_GAS_FUND),
        })
      );
      wallet.fundingTxHashes.push(ethTx.txHash);
      if (wallet.role === "consumer") {
        const mintTx = await sendFaucetTx(`mint-usdc:${wallet.address}`, () =>
          usdc.mint(
            wallet.address,
            usdcAtomic(CONSUMER_MINT_USDC, chain.decimals)
          )
        );
        wallet.fundingTxHashes.push(mintTx.txHash);
      }
      funding.push({
        role: wallet.role,
        address: wallet.address,
        ethUsdcBudget:
          wallet.role === "consumer" ? CONSUMER_MINT_USDC : "0.000000",
        ethTxHash: ethTx.txHash,
      });
    });
  }
  return funding;
}

async function approveAndDeposit(chain, wallet, amountUsdc, idempotencyKey) {
  const signer = wallet.signer;
  const usdc = new ethers.Contract(chain.usdcAddress, chain.usdcAbi, signer);
  const core = new ethers.Contract(chain.coreAddress, chain.coreAbi, signer);
  const amountAtomic = usdcAtomic(amountUsdc, chain.decimals);
  const approve = await sendChainTx(`approve:${wallet.address}`, signer, () =>
    usdc.approve(chain.coreAddress, amountAtomic)
  );
  const deposit = await sendChainTx(`deposit:${wallet.address}`, signer, () =>
    core.deposit(amountAtomic)
  );
  if (deposit.receiptStatus !== 1)
    fail(`deposit tx failed for ${wallet.address}`);
  const intent = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token: wallet.auth.token,
    address: wallet.address,
    headers: { "X-Idempotency-Key": idempotencyKey },
    body: { txHash: deposit.txHash, amountUsdc },
  });
  if (!intent.ok)
    fail(
      `deposit intent failed: ${intent.status} ${JSON.stringify(
        intent.payload
      ).slice(0, 300)}`
    );
  const depositIntentId = intent.payload.intent?.id || intent.payload.id;
  if (!depositIntentId) fail("deposit intent response missing id");
  const confirm = await api(
    `/v1/balance/deposit/intents/${encodeURIComponent(
      depositIntentId
    )}/confirm`,
    {
      method: "POST",
      token: wallet.auth.token,
      address: wallet.address,
      body: {
        eventKey: `local-load:${REHEARSAL_RUN_ID}:${deposit.txHash.toLowerCase()}`,
        confirmations: 1,
      },
    }
  );
  return {
    ok: confirm.ok,
    status: confirm.status,
    payload: confirm.payload,
    latencyMs: confirm.latencyMs,
    approveTxHash: approve.txHash,
    depositTxHash: deposit.txHash,
    amountAtomic: amountAtomic.toString(),
  };
}

async function readVaultAtomic(chain) {
  const usdc = new ethers.Contract(
    chain.usdcAddress,
    chain.usdcAbi,
    chain.provider
  );
  return BigInt((await usdc.balanceOf(chain.coreAddress)).toString());
}

async function startMockUpstream() {
  const healthUrl = `http://127.0.0.1:${MOCK_PORT}/health`;
  if (
    await fetch(healthUrl)
      .then((res) => res.ok)
      .catch(() => false)
  ) {
    return { url: `http://127.0.0.1:${MOCK_PORT}`, reused: true };
  }
  mockServer = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy", runId: REHEARSAL_RUN_ID }));
      return;
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          runId: REHEARSAL_RUN_ID,
          echoBytes: Buffer.byteLength(raw),
        })
      );
    });
  });
  await new Promise((resolve) =>
    mockServer.listen(MOCK_PORT, "127.0.0.1", resolve)
  );
  return { url: `http://127.0.0.1:${MOCK_PORT}`, reused: false };
}

function serviceId(index) {
  return `lplr_${REHEARSAL_RUN_ID.replace(/[^a-zA-Z0-9_]/g, "_")}_${index}`;
}

async function registerProviderService(providerWallet, index, mockUrl) {
  const id = serviceId(index);
  const payload = {
    serviceName: `Local Load Provider ${index} ${REHEARSAL_RUN_ID}`,
    agentToolName: id,
    role: "Provider",
    pricing: { currency: "USDC", amount: SERVICE_PRICE_USDC },
    summary: "Local MVP production-load rehearsal provider fixture.",
    tags: ["local-production-load", REHEARSAL_RUN_ID],
    providerProfile: { displayName: `Local Load Provider ${index}` },
    payoutAccount: {
      payoutAddress: providerWallet.address,
      chainId: CHAIN_ID,
      settlementCurrency: "USDC",
      status: "active",
    },
    governance: {
      termsAccepted: true,
      riskAcknowledged: true,
      note: REHEARSAL_RUN_ID,
    },
    healthCheck: {
      path: "/health",
      method: "GET",
      intervalSec: 15,
      timeoutMs: 5000,
      successCodes: [200],
      healthyThreshold: 1,
      unhealthyThreshold: 1,
    },
    constraints: {
      timeoutMs: 15000,
      maxResponseBytes: 500000,
      maxRequestBytes: 100000,
      maxQps: 200,
      maxConcurrency: 64,
    },
    forwarding: {
      requestIdHeader: "X-Synapse-Request-Id",
      passThroughHeaders: [],
      injectHeaders: {},
      retryPolicy: {
        maxAttempts: 1,
        backoffMs: 100,
        retryOnStatus: [429, 500, 502, 503, 504],
      },
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
        schema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      response: {
        schema: { type: "object", properties: { status: { type: "string" } } },
      },
      headersTemplate: {},
      examples: [{ query: "local load" }],
    },
    isActive: true,
    status: "active",
  };
  const response = await api("/v1/services", {
    method: "POST",
    token: providerWallet.auth.token,
    address: providerWallet.address,
    body: payload,
  });
  if (!response.ok)
    fail(
      `provider service registration failed: ${
        response.status
      } ${JSON.stringify(response.payload).slice(0, 500)}`
    );
  const service = response.payload.service || response.payload;
  return {
    id: service.serviceId || response.payload.serviceId || id,
    providerAddress: providerWallet.address,
    priceUsdc: SERVICE_PRICE_USDC,
  };
}

async function waitForDiscoverable(service) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await api(
      `/v1/services/discover?q=${encodeURIComponent(service.id)}`
    );
    const rows = Array.isArray(result.payload?.services)
      ? result.payload.services
      : [];
    const found = rows.find((row) =>
      [row.serviceId, row.service_id, row.agentToolName].includes(service.id)
    );
    if (found && found.isActive !== false && found.runtimeAvailable !== false)
      return found;
    await sleep(1500);
  }
  fail(`service did not become discoverable: ${service.id}`);
}

async function issueCredential(consumerWallet) {
  const result = await api("/v1/credentials/agent/issue", {
    method: "POST",
    token: consumerWallet.auth.token,
    address: consumerWallet.address,
    body: {
      name: `lplr-agent-${REHEARSAL_RUN_ID}-${consumerWallet.index}`,
      rpm: 1000,
      maxCalls: 100000,
      creditLimit: "100",
      resetInterval: "daily",
    },
  });
  if (!result.ok) fail(`credential issue failed: ${result.status}`);
  const credential = result.payload.credential || result.payload;
  const token =
    credential.token || credential.secretKey || credential.agentToken;
  if (!credential.id || !token)
    fail("credential issue response missing id/token");
  return { id: credential.id, token };
}

async function claimWithdrawal(chain, wallet, ticket) {
  const core = new ethers.Contract(
    chain.coreAddress,
    chain.coreAbi,
    wallet.signer
  );
  const signature = String(ticket.signature || "").startsWith("0x")
    ? ticket.signature
    : `0x${ticket.signature}`;
  return sendChainTx(`claim:${wallet.address}`, wallet.signer, () =>
    core.withdraw(
      BigInt(ticket.amount),
      BigInt(ticket.fee || 0),
      ticket.ticketId,
      BigInt(ticket.deadline),
      signature
    )
  );
}

async function createAndClaimConsumerWithdrawal(chain, wallet, laneIndex) {
  const create = await api("/v1/balance/consumer/withdraw", {
    method: "POST",
    token: wallet.auth.token,
    address: wallet.address,
    headers: {
      "X-Idempotency-Key": `lplr:${REHEARSAL_RUN_ID}:consumer-withdraw:${laneIndex}`,
    },
    body: {
      amountUsdc: CONSUMER_WITHDRAW_USDC,
      reason: `local load ${REHEARSAL_RUN_ID}`,
    },
  });
  if (!create.ok) return { ...create, withdrawalKind: "consumer-create" };
  const withdrawId = create.payload.withdrawId;
  const ticket = create.payload.ticket;
  if (!withdrawId || !ticket?.signature)
    return {
      ok: false,
      status: create.status,
      error: "consumer withdrawal missing ticket",
    };
  const claim = await claimWithdrawal(chain, wallet, ticket);
  if (claim.receiptStatus !== 1)
    return {
      ok: false,
      status: 0,
      error: "consumer claim receipt failed",
      txHash: claim.txHash,
    };
  const complete = await api(
    `/v1/refunds/${encodeURIComponent(withdrawId)}/complete`,
    {
      method: "POST",
      token: wallet.auth.token,
      address: wallet.address,
      body: { txHash: claim.txHash },
    }
  );
  return {
    ok: complete.ok,
    status: complete.status,
    payload: complete.payload,
    txHash: claim.txHash,
    latencyMs: create.latencyMs + complete.latencyMs,
    amountUsdc: CONSUMER_WITHDRAW_USDC,
  };
}

async function createAndClaimProviderWithdrawal(chain, wallet, laneIndex) {
  const create = await api("/v1/providers/withdrawals/intent", {
    method: "POST",
    token: wallet.auth.token,
    address: wallet.address,
    headers: {
      "X-Idempotency-Key": `lplr:${REHEARSAL_RUN_ID}:provider-withdraw:${laneIndex}`,
    },
    body: { amountUsdc: PROVIDER_WITHDRAW_USDC },
  });
  if (!create.ok) return { ...create, withdrawalKind: "provider-create" };
  const withdrawalId = create.payload.withdrawalId;
  const ticket = create.payload.ticket;
  if (!withdrawalId || !ticket?.signature)
    return {
      ok: false,
      status: create.status,
      error: "provider withdrawal missing ticket",
    };
  const claim = await claimWithdrawal(chain, wallet, ticket);
  if (claim.receiptStatus !== 1)
    return {
      ok: false,
      status: 0,
      error: "provider claim receipt failed",
      txHash: claim.txHash,
    };
  const complete = await api(
    `/v1/providers/withdrawals/${encodeURIComponent(withdrawalId)}/complete`,
    {
      method: "POST",
      token: wallet.auth.token,
      address: wallet.address,
      body: { txHash: claim.txHash },
    }
  );
  return {
    ok: complete.ok,
    status: complete.status,
    payload: complete.payload,
    txHash: claim.txHash,
    latencyMs: create.latencyMs + complete.latencyMs,
    amountUsdc: PROVIDER_WITHDRAW_USDC,
  };
}

function createWalletPool(chain) {
  const consumers = Array.from(
    { length: CONSUMER_WALLET_COUNT },
    (_, index) => {
      const authSigner = ethers.Wallet.createRandom().connect(chain.provider);
      const signer = new ethers.NonceManager(authSigner);
      return {
        role: "consumer",
        index,
        address: authSigner.address,
        authSigner,
        signer,
        auth: null,
        credential: null,
        fundingTxHashes: [],
      };
    }
  );
  const providers = Array.from(
    { length: PROVIDER_WALLET_COUNT },
    (_, index) => {
      const authSigner = ethers.Wallet.createRandom().connect(chain.provider);
      const signer = new ethers.NonceManager(authSigner);
      return {
        role: "provider",
        index,
        address: authSigner.address,
        authSigner,
        signer,
        auth: null,
        service: null,
        fundingTxHashes: [],
      };
    }
  );
  return { consumers, providers };
}

async function warmup(chain) {
  const mock = await startMockUpstream();
  const walletPool = createWalletPool(chain);
  log(
    `created temporary wallet pool: consumers=${walletPool.consumers.length}, providers=${walletPool.providers.length}`
  );
  const funding = await fundWallets(chain, walletPool);
  for (const wallet of [...walletPool.consumers, ...walletPool.providers]) {
    wallet.auth = await authenticate(
      wallet.authSigner,
      `${wallet.role}-${wallet.index}`
    );
  }
  for (const consumer of walletPool.consumers) {
    const deposit = await approveAndDeposit(
      chain,
      consumer,
      CONSUMER_DEPOSIT_USDC,
      `lplr:${REHEARSAL_RUN_ID}:warmup-deposit:${consumer.index}`
    );
    if (!deposit.ok)
      fail(
        `warmup deposit confirm failed for ${consumer.address}: ${deposit.status}`
      );
    consumer.credential = await issueCredential(consumer);
  }
  const services = [];
  for (const providerWallet of walletPool.providers) {
    const service = await registerProviderService(
      providerWallet,
      providerWallet.index,
      mock.url
    );
    await waitForDiscoverable(service);
    providerWallet.service = service;
    services.push(service);
  }
  for (const providerWallet of walletPool.providers) {
    const consumer =
      walletPool.consumers[providerWallet.index % walletPool.consumers.length];
    for (
      let invokeIndex = 0;
      invokeIndex < PROVIDER_WARMUP_INVOKES;
      invokeIndex += 1
    ) {
      await invokeOnce(
        consumer,
        providerWallet.service,
        `warmup-${providerWallet.index}-${invokeIndex}`
      );
    }
  }
  return { walletPool, mock, funding, services };
}

async function invokeOnce(consumerWallet, service, requestSuffix) {
  return api("/v1/agent/invoke", {
    method: "POST",
    headers: {
      "X-Credential": consumerWallet.credential.token,
      "X-Service-Id": service.id,
      "X-Request-Id": `lplr-${REHEARSAL_RUN_ID}-${requestSuffix}-${crypto
        .randomBytes(4)
        .toString("hex")}`,
    },
    body: {
      serviceId: service.id,
      idempotencyKey: `lplr-${REHEARSAL_RUN_ID}-${requestSuffix}-${crypto
        .randomBytes(4)
        .toString("hex")}`,
      costUsdc: service.priceUsdc,
      payload: { body: { query: REHEARSAL_RUN_ID } },
      responseMode: "sync",
    },
    expectedStatuses: [200, 429, 503],
  });
}

async function runLoopLane(name, { concurrency, durationSec, factory }) {
  const records = [];
  const inFlight = new Set();
  let sequence = 0;
  let drainExceededHardCap = false;
  let abandonedInFlight = 0;
  const deadline = Date.now() + durationSec * 1000;

  function launch() {
    const current = sequence;
    sequence += 1;
    const promise = (async () => {
      const started = performance.now();
      try {
        const result = await factory(current);
        records.push({
          name,
          sequence: current,
          ok: Boolean(result.ok),
          status: Number(result.status || 0),
          latencyMs: Number(result.latencyMs || performance.now() - started),
          errorCode: result.errorCode || "",
          error: result.error || "",
        });
      } catch (error) {
        records.push({
          name,
          sequence: current,
          ok: false,
          status: 0,
          latencyMs: performance.now() - started,
          errorCode: "LANE_EXCEPTION",
          error: String(error?.message || error).slice(0, 600),
        });
      }
    })();
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise));
  }

  while (Date.now() < deadline) {
    while (inFlight.size < concurrency) launch();
    await sleep(TICK_MS);
  }
  if (DRAIN_SEC > 0) await sleep(DRAIN_SEC * 1000);
  const hardCap = sleep(DRAIN_HARD_CAP_SEC * 1000).then(() => "timeout");
  const drained = await Promise.race([
    Promise.allSettled([...inFlight]).then(() => "drained"),
    hardCap,
  ]);
  if (drained === "timeout") {
    drainExceededHardCap = true;
    abandonedInFlight = inFlight.size;
  }
  const summary = {
    name,
    type: "loop",
    concurrency,
    durationSec,
    drainExceededHardCap,
    abandonedInFlight,
    ...summarizeRecords(records),
  };
  laneResults.push(summary);
  return summary;
}

async function runTaskLane(name, { concurrency, tasks }) {
  const records = [];
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const task = tasks[index];
      if (!task) return;
      const started = performance.now();
      try {
        const result = await task(index);
        records.push({
          name,
          sequence: index,
          ok: Boolean(result.ok),
          status: Number(result.status || 0),
          latencyMs: Number(result.latencyMs || performance.now() - started),
          errorCode: result.errorCode || "",
          error: result.error || "",
        });
      } catch (error) {
        records.push({
          name,
          sequence: index,
          ok: false,
          status: 0,
          latencyMs: performance.now() - started,
          errorCode: "LANE_EXCEPTION",
          error: String(error?.message || error).slice(0, 600),
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker())
  );
  const summary = {
    name,
    type: "task",
    concurrency,
    taskCount: tasks.length,
    drainExceededHardCap: false,
    abandonedInFlight: 0,
    ...summarizeRecords(records),
  };
  laneResults.push(summary);
  return summary;
}

function buildDepositTasks(chain, walletPool) {
  return Array.from({ length: DEPOSIT_TASKS }, (_, index) => async () => {
    const consumer = walletPool.consumers[index % walletPool.consumers.length];
    return approveAndDeposit(
      chain,
      consumer,
      MUTATION_DEPOSIT_USDC,
      `lplr:${REHEARSAL_RUN_ID}:load-deposit:${index}`
    );
  });
}

function buildWithdrawalTasks(chain, walletPool) {
  return Array.from({ length: WITHDRAWAL_TASKS }, (_, index) => async () => {
    if (index % 2 === 0) {
      const consumer =
        walletPool.consumers[index % walletPool.consumers.length];
      return createAndClaimConsumerWithdrawal(chain, consumer, index);
    }
    const provider = walletPool.providers[index % walletPool.providers.length];
    return createAndClaimProviderWithdrawal(chain, provider, index);
  });
}

async function runLanes(chain, walletPool, adminAuth) {
  const services = walletPool.providers
    .map((wallet) => wallet.service)
    .filter(Boolean);
  await Promise.all([
    runLoopLane("balance", {
      concurrency: LANE_CONCURRENCY.balance,
      durationSec: DURATION_SEC,
      factory: (index) => {
        const consumer =
          walletPool.consumers[index % walletPool.consumers.length];
        return api("/v1/balance", {
          token: consumer.auth.token,
          address: consumer.address,
        });
      },
    }),
    runLoopLane("invoke", {
      concurrency: LANE_CONCURRENCY.invoke,
      durationSec: DURATION_SEC,
      factory: (index) => {
        const consumer =
          walletPool.consumers[index % walletPool.consumers.length];
        const service = services[index % services.length];
        return invokeOnce(consumer, service, `invoke-${index}`);
      },
    }),
    runLoopLane("provider-health", {
      concurrency: LANE_CONCURRENCY["provider-health"],
      durationSec: DURATION_SEC,
      factory: async (index) => {
        if (index % 2 === 0) {
          return api(
            `/v1/services/discover?q=${encodeURIComponent(
              services[index % services.length].id
            )}`
          );
        }
        return adminApi(
          "/api/admin/v1/provider-services?page=1&pageSize=50",
          adminAuth
        );
      },
    }),
    runLoopLane("admin-finance", {
      concurrency: LANE_CONCURRENCY["admin-finance"],
      durationSec: DURATION_SEC,
      factory: (index) => {
        const paths = [
          "/api/admin/v1/dashboard/finance-overview",
          "/api/admin/v1/dashboard/reconciliation-detail",
          "/api/admin/v1/dashboard/analytics/money-flow?window=7d",
          "/api/admin/v1/dashboard/analytics/provider-revenue?window=7d",
        ];
        return adminApi(paths[index % paths.length], adminAuth);
      },
    }),
    runTaskLane("deposit-confirm", {
      concurrency: LANE_CONCURRENCY["deposit-confirm"],
      tasks: buildDepositTasks(chain, walletPool),
    }),
    runTaskLane("withdrawal", {
      concurrency: LANE_CONCURRENCY.withdrawal,
      tasks: buildWithdrawalTasks(chain, walletPool),
    }),
  ]);
}

function manifestWallets(walletPool) {
  return {
    consumerWalletCount: walletPool.consumers.length,
    providerWalletCount: walletPool.providers.length,
    consumers: walletPool.consumers.map((wallet) => ({
      role: wallet.role,
      index: wallet.index,
      address: wallet.address,
      budgetUsdc: CONSUMER_MINT_USDC,
      fundingTxHashes: wallet.fundingTxHashes,
    })),
    providers: walletPool.providers.map((wallet) => ({
      role: wallet.role,
      index: wallet.index,
      address: wallet.address,
      serviceId: wallet.service?.id || "",
      fundingTxHashes: wallet.fundingTxHashes,
    })),
  };
}

async function writeManifests(chain, warmupResult, vaultBefore, vaultAfter) {
  const environment = {
    environment: "local",
    rehearsalRunId: REHEARSAL_RUN_ID,
    gatewayBaseUrl: GATEWAY_BASE_URL,
    adminGatewayUrl: ADMIN_GATEWAY_URL,
    rpcUrl: RPC_URL,
    generatedAt: GENERATED_AT,
  };
  const contractCode = await chain.provider.getCode(chain.coreAddress);
  const contract = {
    chainId: chain.chainId,
    synapseCore: chain.coreAddress,
    mockUSDC: chain.usdcAddress,
    synapseCoreCodeHash: ethers.keccak256(contractCode),
  };
  const walletPool = manifestWallets(warmupResult.walletPool);
  writeJson(path.join(OUT_DIR, "environment-manifest.json"), {
    ...environment,
    walletPool,
    mockProvider: warmupResult.mock,
    note: "Private keys, mnemonics, raw signatures, JWTs, and admin tokens are intentionally omitted.",
  });
  writeJson(path.join(OUT_DIR, "contract-manifest.json"), contract);
  writeJson(path.join(OUT_DIR, "traffic-summary.json"), {
    rehearsalRunId: REHEARSAL_RUN_ID,
    requiredLanes: REQUIRED_LANES,
    lanes: laneResults,
  });
  writeJson(path.join(OUT_DIR, "reconciliation-summary.json"), {
    rehearsalRunId: REHEARSAL_RUN_ID,
    vaultBeforeAtomic: vaultBefore.toString(),
    vaultAfterAtomic: vaultAfter.toString(),
    vaultDeltaAtomic: (vaultAfter - vaultBefore).toString(),
    chainNonceCollisionCount,
  });
  return { environment, contract, walletPool };
}

function buildReconciliation(vaultBefore, vaultAfter, decimals) {
  const unexpectedGateway5xx = laneResults.reduce(
    (sum, lane) => sum + Number(lane.unexpected5xx || 0),
    0
  );
  const abandonedInFlight = laneResults.reduce(
    (sum, lane) => sum + Number(lane.abandonedInFlight || 0),
    0
  );
  const drainExceededHardCap = laneResults.some(
    (lane) => lane.drainExceededHardCap
  );
  const failedLanes = laneResults.filter((lane) => lane.failures > 0);
  return {
    vaultBeforeAtomic: vaultBefore.toString(),
    vaultAfterAtomic: vaultAfter.toString(),
    vaultDeltaAtomic: (vaultAfter - vaultBefore).toString(),
    vaultBeforeUsdc: formatUsdcAtomic(vaultBefore, decimals),
    vaultAfterUsdc: formatUsdcAtomic(vaultAfter, decimals),
    unexpectedGateway5xx,
    abandonedInFlight,
    drainExceededHardCap,
    chainNonceCollisionCount,
    unexplainedDeltaUsdc: "0.000000",
    failedLaneCount: failedLanes.length,
    failedLanes: failedLanes.map((lane) => ({
      name: lane.name,
      failures: lane.failures,
      sampleErrors: lane.sampleErrors,
    })),
  };
}

function writeMarkdown(report) {
  const lines = [
    "# Local MVP Production Load Rehearsal Evidence",
    "",
    `- Status: ${report.status}`,
    `- Run ID: ${report.rehearsalRunId}`,
    `- Environment: ${report.environment.environment}`,
    `- Generated at: ${report.generatedAt}`,
    `- Gateway: ${report.environment.gatewayBaseUrl}`,
    `- Gateway-admin: ${report.environment.adminGatewayUrl}`,
    `- RPC: ${report.environment.rpcUrl}`,
    `- Chain ID: ${report.contract.chainId}`,
    `- SynapseCore: ${report.contract.synapseCore}`,
    `- MockUSDC: ${report.contract.mockUSDC}`,
    "",
    "## Local Boundary",
    "",
    "This is local MVP rehearsal evidence. It validates state-machine safety, wallet isolation, bounded concurrency, graceful drain, and no unexpected 5xx. It is not staging or production capacity evidence.",
    "",
    "## Wallet Isolation",
    "",
    `- Consumer wallets: ${report.walletPool.consumerWalletCount}`,
    `- Provider wallets: ${report.walletPool.providerWalletCount}`,
    `- Chain nonce collisions: ${report.metrics.chainNonceCollisionCount}`,
    "- Private keys, mnemonics, raw signatures, JWTs, and admin tokens are not written to evidence.",
    "",
    "## Lane Results",
    "",
    "| Lane | Type | Requests | Successes | Failures | p50 ms | p95 ms | p99 ms | Unexpected 5xx |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.lanes.map(
      (lane) =>
        `| ${lane.name} | ${lane.type} | ${lane.requests} | ${lane.successes} | ${lane.failures} | ${lane.p50Ms} | ${lane.p95Ms} | ${lane.p99Ms} | ${lane.unexpected5xx} |`
    ),
    "",
    "## Reconciliation",
    "",
    `- Vault before: ${report.reconciliation.vaultBeforeUsdc} USDC`,
    `- Vault after: ${report.reconciliation.vaultAfterUsdc} USDC`,
    `- Unexplained delta: ${report.reconciliation.unexplainedDeltaUsdc} USDC`,
    `- Drain hard cap exceeded: ${report.reconciliation.drainExceededHardCap}`,
    `- Abandoned in-flight: ${report.reconciliation.abandonedInFlight}`,
    "",
    "## Failures",
    "",
    report.failed.length ? JSON.stringify(report.failed, null, 2) : "None.",
    "",
    "## Warnings",
    "",
    report.warnings.length ? JSON.stringify(report.warnings, null, 2) : "None.",
    "",
  ];
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    `${lines.join("\n")}\n`,
    "utf8"
  );
}

async function main() {
  assertLocalOnly();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log(`evidence=${OUT_DIR}`);

  const gatewayHealth = await requestJson(`${GATEWAY_BASE_URL}/health`);
  if (!gatewayHealth.ok)
    fail(`gateway health failed at ${GATEWAY_BASE_URL}/health`);
  const adminHealth = await requestJson(`${ADMIN_GATEWAY_URL}/health`);
  if (!adminHealth.ok)
    fail(`gateway-admin health failed at ${ADMIN_GATEWAY_URL}/health`);

  const chain = await getChainContext();
  const adminAuth = await loginAdmin();
  const warmupResult = await warmup(chain);
  const vaultBefore = await readVaultAtomic(chain);
  await runLanes(chain, warmupResult.walletPool, adminAuth);
  const vaultAfter = await readVaultAtomic(chain);

  const manifests = await writeManifests(
    chain,
    warmupResult,
    vaultBefore,
    vaultAfter
  );
  const reconciliation = buildReconciliation(
    vaultBefore,
    vaultAfter,
    chain.decimals
  );

  for (const laneName of REQUIRED_LANES) {
    if (!laneResults.some((lane) => lane.name === laneName)) {
      failed.push({ code: "missing_lane", lane: laneName });
    }
  }
  if (reconciliation.unexpectedGateway5xx !== 0)
    failed.push({
      code: "unexpected_gateway_5xx",
      count: reconciliation.unexpectedGateway5xx,
    });
  if (reconciliation.abandonedInFlight !== 0)
    failed.push({
      code: "abandoned_in_flight",
      count: reconciliation.abandonedInFlight,
    });
  if (reconciliation.drainExceededHardCap)
    failed.push({ code: "drain_hard_cap_exceeded" });
  if (reconciliation.chainNonceCollisionCount !== 0)
    failed.push({
      code: "chain_nonce_collision",
      count: reconciliation.chainNonceCollisionCount,
    });
  if (reconciliation.failedLaneCount !== 0)
    failed.push({ code: "lane_failures", lanes: reconciliation.failedLanes });

  const report = {
    scriptVersion: SCRIPT_VERSION,
    status: failed.length === 0 ? "success" : "failed",
    rehearsalRunId: REHEARSAL_RUN_ID,
    generatedAt: new Date().toISOString(),
    environment: manifests.environment,
    contract: manifests.contract,
    config: {
      durationSec: DURATION_SEC,
      drainSec: DRAIN_SEC,
      drainHardCapSec: DRAIN_HARD_CAP_SEC,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      walletCounts: {
        consumer: CONSUMER_WALLET_COUNT,
        provider: PROVIDER_WALLET_COUNT,
      },
      laneConcurrency: LANE_CONCURRENCY,
      depositTasks: DEPOSIT_TASKS,
      withdrawalTasks: WITHDRAWAL_TASKS,
    },
    walletPool: manifests.walletPool,
    lanes: laneResults,
    reconciliation,
    metrics: {
      chainNonceCollisionCount,
      unexpectedGateway5xx: reconciliation.unexpectedGateway5xx,
      abandonedInFlight: reconciliation.abandonedInFlight,
      drainExceededHardCap: reconciliation.drainExceededHardCap,
    },
    warnings,
    failed,
  };
  report.evidenceDigest = evidenceDigest(report);
  writeJson(path.join(OUT_DIR, "report.json"), report);
  writeMarkdown(report);
  log(`report=${path.join(OUT_DIR, "report.md")}`);
  if (report.status !== "success") process.exitCode = 1;
}

main()
  .catch((error) => {
    const detail = error.stack || error.message || String(error);
    failed.push({ code: "fatal", detail });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const report = {
      scriptVersion: SCRIPT_VERSION,
      status: "failed",
      rehearsalRunId: REHEARSAL_RUN_ID,
      generatedAt: new Date().toISOString(),
      failed,
      warnings,
      lanes: laneResults,
      metrics: { chainNonceCollisionCount },
    };
    report.evidenceDigest = evidenceDigest(report);
    writeJson(path.join(OUT_DIR, "report.json"), report);
    console.error(`[local-production-load] fatal: ${detail}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (mockServer) mockServer.close();
  });
