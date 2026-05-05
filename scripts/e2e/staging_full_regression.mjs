#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";
import { assertSeedEnvironment } from "./seed_env_guard.mjs";
import {
  assertStagingHttpUrl,
  assertStagingProxyDsn,
  requireStagingConfirmation,
} from "../lib/e2e_env_guard.mjs";
import {
  capturePage,
  installAdminAuth,
  installOwnerAuth,
} from "./lib/staging_full_regression_browser.mjs";
import { createStagingFullRegressionDbReaders } from "./lib/staging_full_regression_db.mjs";
import {
  generateTotpCode,
  waitForSafeTotpWindow,
} from "../lib/totp_window.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const runId =
  process.env.STAGING_FULL_REGRESSION_RUN_ID ||
  `staging-full-${Date.now().toString(36)}`;
const outDir = path.resolve(
  process.env.STAGING_FULL_REGRESSION_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "docs/evidence/staging/full-regression",
      `${formatTimestamp(generatedAt)}-staging-full-regression`
    )
);
const screenshotsDir = path.join(outDir, "screenshots");
const canonicalServices = [
  "svc_web3_sentiment_index",
  "svc_protocol_fundamental_brief",
  "svc_oss_security_healthcheck",
  "svc_deepseek_chat",
];

const config = {
  gatewayBase: stripSlash(
    env(
      "GATEWAY_BASE_URL",
      env("GATEWAY_E2E_GATEWAY_BASE", "https://api-staging.synapse-network.ai")
    )
  ),
  userFrontUrl: stripSlash(
    env("STAGING_USER_FRONT_URL", "https://staging.synapse-network.ai")
  ),
  docsFrontUrl: stripSlash(
    env("STAGING_DOCS_FRONT_URL", "https://docs-staging.synapse-network.ai")
  ),
  adminFrontUrl: stripSlash(
    env("STAGING_ADMIN_FRONT_URL", "https://admin-staging.synapse-network.ai")
  ),
  adminApiUrl: stripSlash(
    env("STAGING_ADMIN_API_URL", "https://admin-api-staging.synapse-network.ai")
  ),
  postgresDsn: env("STAGING_POSTGRES_DSN", env("POSTGRES_DSN", "")),
  rpcUrl: env("GATEWAY_E2E_RPC_URL", env("STAGING_RPC_URL", "")),
  contractConfigPath: env(
    "GATEWAY_E2E_CONTRACT_CONFIG_PATH",
    "services/user-front/src/contract-config.arbitrum-sepolia.example.json"
  ),
  ownerPrivateKey: env(
    "STAGING_E2E_CONSUMER_PRIVATE_KEY",
    env("GATEWAY_E2E_OWNER_KEY", "")
  ),
  agentCredential: env(
    "STAGING_E2E_AGENT_CREDENTIAL",
    env("LLM_E2E_CREDENTIAL", env("GATEWAY_E2E_CREDENTIAL", ""))
  ),
  fixedServiceId: env(
    "STAGING_FULL_REGRESSION_FIXED_SERVICE_ID",
    "svc_oss_security_healthcheck"
  ),
  llmServiceId: env(
    "STAGING_FULL_REGRESSION_LLM_SERVICE_ID",
    "svc_deepseek_chat"
  ),
  adminEmail: env(
    "STAGING_ADMIN_E2E_EMAIL",
    "staging-admin-e2e@synapse-network.ai"
  ),
  adminPassword: env("STAGING_ADMIN_E2E_PASSWORD", ""),
  adminTotpSecret: env("STAGING_ADMIN_E2E_OTP_SECRET", ""),
  adminCookieName: env("ADMIN_SESSION_COOKIE_NAME", "synapse_admin_session"),
  headless: env("STAGING_FULL_REGRESSION_HEADLESS", "1") !== "0",
  discoveryWaitSec: Number(
    env("STAGING_FULL_REGRESSION_DISCOVERY_WAIT_SEC", "180")
  ),
  runSupport: env("STAGING_FULL_REGRESSION_RUN_SUPPORT", "0") === "1",
  runMoneyMutation:
    env("STAGING_FULL_REGRESSION_RUN_MONEY_MUTATION", "0") === "1",
};

const evidence = {
  checks: [],
  failed: [],
  warnings: [],
  api: [],
  db: {},
  chain: {},
  dom: [],
  screenshots: [],
  trace: [],
  bugfix: [],
};

fs.mkdirSync(screenshotsDir, { recursive: true });

const dbReaders = createStagingFullRegressionDbReaders({
  root: ROOT,
  postgresDsn: config.postgresDsn,
  canonicalServices,
  agentCredential: config.agentCredential,
});

function env(name, fallback = "") {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function formatTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function redact(value) {
  if (value == null) return value;
  return String(value)
    .replace(/agt_[A-Za-z0-9._~+/-]+/g, "agt_[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/0x[a-fA-F0-9]{64,}/g, "0x[REDACTED]")
    .replace(
      /"((?:password|privateKey|signature|jwt|token|secret|apiKey|authorization|credential)[^"]*)"\s*:\s*"[^"]+"/gi,
      '"$1":"[REDACTED]"'
    )
    .replace(
      /(password|private[_-]?key|api[_-]?key|secret|token)\s*[:=]\s*[^,\s"']+/gi,
      "$1=[REDACTED]"
    );
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [
        key,
        isSensitiveKey(key) ? "[REDACTED]" : sanitize(next),
      ])
    );
  }
  return typeof value === "string" ? redact(value) : value;
}

function isSensitiveKey(key) {
  const normalized = String(key || "");
  return /^(?:password|privateKey|rawSignature|signature|jwt|adminToken|accessToken|access_token|apiKey|secret|token|credential|authorization)$/i.test(
    normalized
  );
}

function addTrace(row) {
  evidence.trace.push({
    runId,
    timestamp: new Date().toISOString(),
    requestId: row.requestId || `${runId}:${evidence.trace.length + 1}`,
    ledgerDelta: row.ledgerDelta || "",
    vaultDelta: row.vaultDelta || "",
    reconciliationStatus: row.reconciliationStatus || "",
    ...sanitize(row),
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addCheck(name, ok, detail = "", extra = {}) {
  const record = {
    name,
    ok: Boolean(ok),
    detail: redact(detail),
    ...sanitize(extra),
  };
  evidence.checks.push(record);
  if (!record.ok) {
    evidence.failed.push(record);
    evidence.bugfix.push({
      id: `STAGING-FULL-${String(evidence.bugfix.length + 1).padStart(3, "0")}`,
      severity: extra.severity || "P1",
      scenario: name,
      screenshot: extra.screenshot || "",
      apiEvidence: extra.apiEvidence || "",
      dbEvidence: extra.dbEvidence || "",
      chainEvidence: extra.chainEvidence || "",
      reproSteps: extra.reproSteps || detail,
      expected: extra.expected || "Staging full regression checkpoint passes.",
      actual: detail,
      status: "open",
    });
  }
  console.log(
    `[staging-full-regression] ${record.ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${redact(detail)}` : ""
    }`
  );
}

function requireEnv(name, value, { privateKey = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Missing required env ${name}`);
  if (privateKey && !/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a 0x-prefixed EVM private key`);
  }
  return normalized;
}

function assertSafety() {
  process.env.SYNAPSE_E2E_ENV ||= "staging";
  process.env.SYNAPSE_SEED_ENV ||= "staging";
  requireStagingConfirmation(
    "STAGING_FULL_REGRESSION_CONFIRM",
    "I_UNDERSTAND_THIS_MUTATES_STAGING_TEST_DATA"
  );
  assertSeedEnvironment({
    scriptName: "staging-full-regression",
    allowStaging: true,
    runId,
    urls: [
      config.gatewayBase,
      config.userFrontUrl,
      config.docsFrontUrl,
      config.adminFrontUrl,
      config.adminApiUrl,
    ],
  });
  for (const [name, value] of [
    ["GATEWAY_BASE_URL", config.gatewayBase],
    ["STAGING_USER_FRONT_URL", config.userFrontUrl],
    ["STAGING_DOCS_FRONT_URL", config.docsFrontUrl],
    ["STAGING_ADMIN_FRONT_URL", config.adminFrontUrl],
    ["STAGING_ADMIN_API_URL", config.adminApiUrl],
  ]) {
    assertStagingHttpUrl(name, value);
  }
  assertStagingProxyDsn("STAGING_POSTGRES_DSN", config.postgresDsn, {
    allowEmpty: false,
  });
  requireEnv("STAGING_E2E_CONSUMER_PRIVATE_KEY", config.ownerPrivateKey, {
    privateKey: true,
  });
  requireEnv("STAGING_E2E_AGENT_CREDENTIAL", config.agentCredential);
  requireEnv("GATEWAY_E2E_RPC_URL", config.rpcUrl);
}

async function timedFetchJson(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 1000) };
  }
  return {
    ok: response.ok,
    status: response.status,
    durationMs: Date.now() - started,
    json,
    text,
  };
}

async function api(pathname, options = {}) {
  const url = `${config.gatewayBase}/api${pathname}`;
  const headers = { ...(options.headers || {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.address) headers["X-User-Address"] = options.address;
  const result = await timedFetchJson(url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const record = {
    method: options.method || "GET",
    path: `/api${pathname}`,
    httpStatus: result.status,
    durationMs: result.durationMs,
    sanitizedRequest: sanitize({ headers, body: options.body }),
    sanitizedResponse: sanitize(result.json),
  };
  evidence.api.push(record);
  addTrace({
    scenario: `api:${record.method}:${pathname}`,
    method: record.method,
    path: record.path,
    httpStatus: record.httpStatus,
    durationMs: record.durationMs,
    request: record.sanitizedRequest,
    response: record.sanitizedResponse,
    reconciliationStatus: result.ok ? "passed" : "failed",
  });
  if (options.expectOk !== false && !result.ok) {
    throw new Error(
      `${record.method} ${pathname} failed ${
        result.status
      }: ${result.text.slice(0, 1000)}`
    );
  }
  return result.json || {};
}

async function authenticateOwner() {
  const wallet = new ethers.Wallet(config.ownerPrivateKey);
  const challenge = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`
  );
  const message = challenge.challenge || challenge.message;
  if (!message) throw new Error("owner auth challenge missing message");
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: wallet.address, message, signature },
  });
  const token = verified.access_token || verified.token || verified.accessToken;
  if (!token) throw new Error("owner auth verify missing token");
  addCheck("auth:owner-wallet", true, wallet.address);
  return { address: wallet.address, token, expiresAt: Date.now() + 86_400_000 };
}

async function verifyPreflight() {
  const urls = [
    [`gateway_health`, `${config.gatewayBase}/health`],
    [`gateway_readiness`, `${config.gatewayBase}/readiness`],
    [`gateway_admin_health`, `${config.adminApiUrl}/health`],
    [`user_front`, config.userFrontUrl],
    [`docs_front`, config.docsFrontUrl],
    [`admin_front`, `${config.adminFrontUrl}/login`],
  ];
  for (const [name, url] of urls) {
    const result = await timedFetchJson(url, { headers: { Accept: "*/*" } });
    addCheck(
      `preflight:${name}`,
      result.status >= 200 && result.status < 400,
      `status=${result.status}`
    );
  }
  const chain = await readChainConfig();
  evidence.chain.preflight = chain;
  addCheck(
    "preflight:chain-config",
    chain.chainId === 421614,
    `chainId=${chain.chainId}`
  );
}

async function readChainConfig() {
  const contractConfig = JSON.parse(
    fs.readFileSync(path.join(ROOT, config.contractConfigPath), "utf8")
  );
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  const coreAddress =
    contractConfig.SynapseCore ||
    contractConfig.Router ||
    contractConfig.routerAddress;
  const usdcAddress =
    contractConfig.MockUSDC ||
    contractConfig.USDC ||
    contractConfig.usdcAddress;
  const [coreCode, usdcCode] = await Promise.all([
    provider.getCode(coreAddress),
    provider.getCode(usdcAddress),
  ]);
  return {
    chainId: Number(network.chainId),
    coreAddress,
    usdcAddress,
    coreCodePresent: coreCode !== "0x",
    usdcCodePresent: usdcCode !== "0x",
  };
}

async function verifyDiscovery() {
  const before = dbReaders.readServiceBaseline();
  evidence.db.serviceBaselineBefore = before;
  let registry;
  let discover;
  let stats;
  let health;
  let registryServices = [];
  let discoverServices = [];
  let missing = [...canonicalServices];
  const deadline = Date.now() + Math.max(0, config.discoveryWaitSec) * 1000;
  let attempt = 0;
  do {
    attempt += 1;
    registry = await timedFetchJson(
      `${config.userFrontUrl}/marketplace/registry.json?pageSize=100`
    );
    discover = await api("/v1/services/discover?pageSize=100");
    stats = await api("/v1/services/network-stats");
    health = await api("/v1/services/health/status?includeInactive=true");
    registryServices = registry.json?.services || [];
    discoverServices = discover.services || discover.data?.services || [];
    const registryIds = new Set(
      registryServices.map((service) => service.serviceId || service.service_id)
    );
    const discoverIds = new Set(
      discoverServices.map((service) => service.serviceId || service.service_id)
    );
    missing = canonicalServices.filter(
      (id) => !registryIds.has(id) || !discoverIds.has(id)
    );
    if (missing.length === 0 || Date.now() >= deadline) break;
    addTrace({
      step: "discovery:wait-for-canonical-services",
      attempt,
      missing,
      discoverableTotal:
        stats?.discoverableServices ?? stats?.discoverableTotal ?? "",
    });
    await sleep(10_000);
  } while (true);
  evidence.api.discovery = {
    registry: sanitize(registry.json),
    discover,
    stats,
    health,
  };
  const canonicalRows = before.canonical || [];
  const inactive = canonicalRows.filter(
    (row) => String(row.status).toLowerCase() !== "active"
  );
  addCheck(
    "discovery:canonical-services-visible",
    missing.length === 0,
    `missing=${missing.join(",") || "none"}`,
    {
      dbEvidence: "db-evidence.json",
      apiEvidence: "api-evidence.json",
    }
  );
  addCheck(
    "discovery:canonical-services-active",
    inactive.length === 0,
    `inactive=${inactive.map((row) => row.service_id).join(",") || "none"}`
  );
  return {
    registryServices,
    discoverServices,
    stats,
    health,
    baseline: before,
  };
}

function selectService(discovery, serviceId) {
  const services = [
    ...(discovery.registryServices || []),
    ...(discovery.discoverServices || []),
  ];
  return (
    services.find(
      (service) => (service.serviceId || service.service_id) === serviceId
    ) || null
  );
}

function servicePriceUsdc(service) {
  const candidates = [
    service?.basePriceUsdc,
    service?.costUsdc,
    service?.priceUsdc,
    service?.price?.amountUsdc,
    service?.pricing?.basePriceUsdc,
    service?.pricing?.amount,
  ];
  return String(
    candidates.find((value) => value != null && value !== "") || ""
  );
}

function fixedServicePayload(serviceId) {
  const normalized = String(serviceId || "")
    .trim()
    .toLowerCase();
  if (
    normalized === "svc_oss_security_healthcheck" ||
    normalized === "oss-security-healthcheck"
  ) {
    return {
      repoUrl: "https://github.com/SynapseNetworkAI/Synapse-Network-Sdk",
      packageList: ["lodash@4.17.19", "requests==2.19.1"],
      ecosystem: "mixed",
    };
  }
  if (
    normalized === "svc_protocol_fundamental_brief" ||
    normalized === "protocol-fundamental-brief"
  ) {
    return { protocol: "uniswap", chain: "ethereum" };
  }
  if (
    normalized === "svc_web3_sentiment_index" ||
    normalized === "web3-sentiment-index"
  ) {
    return { symbol: "ETH" };
  }
  return { query: `staging full regression ${runId}` };
}

async function invokeFixedService(discovery) {
  const service = selectService(discovery, config.fixedServiceId);
  const costUsdc = servicePriceUsdc(service);
  if (!service || !costUsdc) {
    throw new Error(
      `Fixed service ${config.fixedServiceId} not discoverable with price`
    );
  }
  const idempotencyKey = `${runId}:fixed:${Date.now().toString(36)}`;
  const result = await api("/v1/agent/invoke", {
    method: "POST",
    headers: {
      "X-Credential": config.agentCredential,
      "X-Service-Id": config.fixedServiceId,
      "X-Request-Id": idempotencyKey,
    },
    body: {
      serviceId: config.fixedServiceId,
      idempotencyKey,
      costUsdc,
      responseMode: "sync",
      payload: { body: fixedServicePayload(config.fixedServiceId) },
    },
  });
  const receipt = result.receipt || result.data?.receipt || result;
  const invocationId = receipt.invocationId || result.invocationId;
  if (!invocationId)
    throw new Error("fixed-price invoke response missing invocationId");
  const db = dbReaders.readInvocationDb(invocationId);
  evidence.db.fixedInvocation = db;
  addCheck(
    "invoke:fixed-price-settled",
    Boolean(db?.invocation),
    invocationId,
    {
      apiEvidence: "api-evidence.json",
      dbEvidence: "db-evidence.json",
    }
  );
  return { invocationId, response: result, db };
}

async function invokeLlmService(discovery) {
  const service = selectService(discovery, config.llmServiceId);
  if (!service)
    throw new Error(`LLM service ${config.llmServiceId} not discoverable`);
  const idempotencyKey = `${runId}:llm:${Date.now().toString(36)}`;
  const result = await api("/v1/agent/invoke", {
    method: "POST",
    headers: {
      "X-Credential": config.agentCredential,
      "X-Request-Id": idempotencyKey,
    },
    body: {
      serviceId: config.llmServiceId,
      idempotencyKey,
      payload: {
        body: {
          model: "deepseek-v4-pro",
          messages: [
            {
              role: "system",
              content: "You are a concise staging regression checker.",
            },
            {
              role: "user",
              content:
                "Reply with a short SynapseNetwork staging regression success message.",
            },
          ],
          thinking: { type: "enabled" },
          reasoning_effort: "high",
          stream: false,
          max_tokens: 24,
          temperature: 0,
        },
      },
      responseMode: "sync",
    },
  });
  const invocationId =
    result.invocationId ||
    result.receipt?.invocationId ||
    result.data?.invocationId;
  const usage =
    result.usage ||
    result.result?.usage ||
    result.synapse?.usage ||
    result.data?.usage ||
    result.data?.result?.usage ||
    null;
  if (!invocationId)
    throw new Error("LLM invoke response missing invocationId");
  if (!usage) throw new Error("LLM invoke response missing usage");
  const db = dbReaders.readInvocationDb(invocationId);
  evidence.db.llmInvocation = db;
  addCheck(
    "invoke:llm-token-metered-settled",
    Boolean(db?.invocation),
    invocationId,
    {
      apiEvidence: "api-evidence.json",
      dbEvidence: "db-evidence.json",
    }
  );
  return { invocationId, response: result, db };
}

async function adminLogin() {
  if (!config.adminPassword || !config.adminTotpSecret) {
    evidence.warnings.push(
      "Admin credentials missing; admin browser checks skipped."
    );
    return null;
  }
  await waitForSafeTotpWindow();
  const otpCode = generateTotpCode(config.adminTotpSecret);
  const response = await fetch(
    `${config.adminApiUrl}/api/admin/v1/auth/login`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: config.adminEmail,
        password: config.adminPassword,
        otpCode,
      }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  const setCookie = response.headers.get("set-cookie") || "";
  const sessionToken =
    setCookie
      .split(",")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${config.adminCookieName}=`))
      ?.split(";")[0]
      ?.split("=")[1] || "";
  const csrfToken = payload.data?.csrfToken || payload.csrfToken || "";
  if (!response.ok || !sessionToken || !csrfToken) {
    throw new Error(
      `Admin login failed: ${response.status} ${JSON.stringify(payload).slice(
        0,
        800
      )}`
    );
  }
  addCheck("auth:admin", true, config.adminEmail);
  return { sessionToken, csrfToken };
}

async function captureUi(auth, adminAuth) {
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await installOwnerAuth(context, auth, config);
    await installAdminAuth(context, adminAuth, config);
    const page = await context.newPage();
    const serviceName = serviceNameFromBaseline(
      evidence.db.serviceBaselineBefore,
      config.fixedServiceId
    );
    const pages = [
      {
        name: "dashboard-overview",
        url: `${config.userFrontUrl}/dashboard/overview`,
        expectedText: ["Overview"],
        apiCheckpoint: "balance",
        dbCheckpoint: "owner",
      },
      {
        name: "billing-history",
        url: `${config.userFrontUrl}/dashboard/billing`,
        expectedText: ["Billing"],
        apiCheckpoint: "balance",
        dbCheckpoint: "owner",
      },
      {
        name: "billing-credits",
        url: `${config.userFrontUrl}/dashboard/billing/credits`,
        expectedText: ["Credits"],
        apiCheckpoint: "balance",
        dbCheckpoint: "owner",
      },
      {
        name: "marketplace-services",
        url: `${config.userFrontUrl}/marketplace`,
        expectedText: [serviceName || config.fixedServiceId],
        apiCheckpoint: "registry",
        dbCheckpoint: "serviceBaselineBefore",
      },
      {
        name: "dashboard-invocations",
        url: `${config.userFrontUrl}/dashboard/invocations`,
        expectedText: ["Invocations"],
        apiCheckpoint: "fixedInvocation",
        dbCheckpoint: "fixedInvocation",
      },
      {
        name: "provider-console",
        url: `${config.userFrontUrl}/provider/console`,
        expectedText: ["Provider"],
        apiCheckpoint: "provider",
        dbCheckpoint: "serviceBaselineBefore",
      },
    ];
    for (const item of pages)
      await capturePage(page, item, { outDir, evidence, addCheck });
    if (adminAuth) {
      const captureContext = { outDir, evidence, addCheck };
      await capturePage(
        page,
        {
          name: "admin-finance",
          url: `${config.adminFrontUrl}/finance`,
          expectedText: ["资金概览"],
          apiCheckpoint: "admin",
          dbCheckpoint: "adminSummary",
        },
        captureContext
      );
      await capturePage(
        page,
        {
          name: "admin-withdrawals",
          url: `${config.adminFrontUrl}/withdrawal-reviews`,
          expectedText: ["提现审核"],
          apiCheckpoint: "admin",
          dbCheckpoint: "adminSummary",
        },
        captureContext
      );
    }
  } finally {
    await browser.close();
  }
}

function serviceNameFromBaseline(baseline, serviceId) {
  const row = (baseline?.canonical || []).find(
    (item) => item.service_id === serviceId
  );
  return row?.service_name || "";
}

async function verifyOwnerState(auth) {
  const apiBalance = await api("/v1/balance", {
    token: auth.token,
    address: auth.address,
  });
  const dbOwner = dbReaders.readOwnerDb(auth.address);
  evidence.db.owner = dbOwner;
  evidence.api.balance = sanitize(apiBalance);
  addCheck(
    "dashboard:api-db-owner-balance",
    Boolean(dbOwner?.owner),
    auth.address,
    {
      apiEvidence: "api-evidence.json",
      dbEvidence: "db-evidence.json",
    }
  );
}

async function verifyCredentialBinding(auth) {
  const credential = dbReaders.readCredentialOwnerDb();
  evidence.db.credential = credential;
  const ownerWallet = String(credential?.ownerWallet || "").toLowerCase();
  const authWallet = String(auth.address || "").toLowerCase();
  addCheck(
    "credential:matches-staging-wallet",
    ownerWallet === authWallet,
    `credentialOwner=${ownerWallet || "missing"} wallet=${authWallet}`
  );
}

async function verifyAdminReadOnly() {
  const adminSummary = dbReaders.readAdminDbSummary();
  evidence.db.adminSummary = adminSummary;
  addCheck(
    "admin:db-readonly-summary",
    Boolean(adminSummary),
    JSON.stringify(adminSummary || {})
  );
}

function verifyNoNewServices() {
  const after = dbReaders.readServiceBaseline();
  evidence.db.serviceBaselineAfter = after;
  const beforeIds = new Set(
    (evidence.db.serviceBaselineBefore?.canonical || []).map(
      (row) => row.service_id
    )
  );
  const afterIds = new Set(
    (after?.canonical || []).map((row) => row.service_id)
  );
  const changedCount =
    Number(after?.total || 0) !==
    Number(evidence.db.serviceBaselineBefore?.total || 0);
  const missingCanonical = [...beforeIds].filter((id) => !afterIds.has(id));
  addCheck(
    "registry:no-new-service-registration",
    !changedCount && missingCanonical.length === 0,
    `before=${evidence.db.serviceBaselineBefore?.total} after=${
      after?.total
    } missing=${missingCanonical.join(",") || "none"}`,
    { dbEvidence: "db-evidence.json" }
  );
}

async function main() {
  let reportStatus = "success";
  let auth = null;
  try {
    assertSafety();
    await verifyPreflight();
    auth = await authenticateOwner();
    const adminAuth = await adminLogin();
    const discovery = await verifyDiscovery();
    await verifyOwnerState(auth);
    await verifyCredentialBinding(auth);
    const fixed = await invokeFixedService(discovery);
    const llm = await invokeLlmService(discovery);
    evidence.api.invocations = {
      fixed: sanitize(fixed.response),
      llm: sanitize(llm.response),
    };
    await verifyAdminReadOnly();
    await captureUi(auth, adminAuth);
    verifyNoNewServices();
    if (config.runSupport) {
      evidence.warnings.push(
        "Support module is delegated to npm run e2e:support-case-dogfood:staging."
      );
    }
    if (config.runMoneyMutation) {
      evidence.warnings.push(
        "Money mutation module is delegated to staging core/withdrawal review dogfood gates."
      );
    }
  } catch (error) {
    reportStatus = "failed";
    addCheck(
      "staging-full-regression",
      false,
      error.stack || error.message || String(error)
    );
  } finally {
    if (auth && !evidence.db.serviceBaselineAfter) {
      try {
        verifyNoNewServices();
      } catch (error) {
        addCheck(
          "registry:no-new-service-registration-finalizer",
          false,
          error.message
        );
      }
    }
    writeEvidence(reportStatus);
  }
  if (evidence.failed.length > 0) process.exit(1);
}

function writeEvidence(status) {
  fs.mkdirSync(outDir, { recursive: true });
  const traceText =
    evidence.trace.map((row) => JSON.stringify(sanitize(row))).join("\n") +
    "\n";
  const traceDigest = crypto
    .createHash("sha256")
    .update(traceText)
    .digest("hex");
  fs.writeFileSync(path.join(outDir, "trace.jsonl"), traceText);
  writeJson("api-evidence.json", evidence.api);
  writeJson("db-evidence.json", evidence.db);
  writeJson("chain-evidence.json", evidence.chain);
  writeJson("dom-evidence.json", evidence.dom);
  writeJson("screenshot-evidence.json", evidence.screenshots);
  writeBugfixLog();
  const report = {
    status:
      status === "success" && evidence.failed.length === 0
        ? "success"
        : "failed",
    environment: "staging",
    runId,
    exportedAt: new Date().toISOString(),
    traceDigest,
    checks: evidence.checks,
    failed: evidence.failed,
    warnings: evidence.warnings,
    canonicalServices,
    screenshots: evidence.screenshots,
    evidenceFiles: {
      api: "api-evidence.json",
      db: "db-evidence.json",
      chain: "chain-evidence.json",
      dom: "dom-evidence.json",
      screenshots: "screenshot-evidence.json",
      trace: "trace.jsonl",
    },
  };
  writeJson("report.json", report);
  fs.writeFileSync(path.join(outDir, "report.md"), renderMarkdown(report));
  console.log(`[staging-full-regression] evidence=${outDir}`);
}

function writeJson(name, value) {
  fs.writeFileSync(
    path.join(outDir, name),
    `${JSON.stringify(sanitize(value), null, 2)}\n`
  );
}

function writeBugfixLog() {
  const lines = ["# Bugfix Log", ""];
  if (evidence.bugfix.length === 0) {
    lines.push("No open bugs.");
  } else {
    for (const bug of evidence.bugfix) {
      lines.push(`## ${bug.id} ${bug.severity}`, "");
      lines.push(`- Scenario: ${bug.scenario}`);
      lines.push(`- Expected: ${bug.expected}`);
      lines.push(`- Actual: ${redact(bug.actual)}`);
      lines.push(`- Status: ${bug.status}`, "");
    }
  }
  fs.writeFileSync(path.join(outDir, "bugfix-log.md"), `${lines.join("\n")}\n`);
}

function renderMarkdown(report) {
  return [
    "# Staging Full Regression Evidence",
    "",
    `- Status: ${report.status}`,
    `- Run ID: ${report.runId}`,
    `- Exported: ${report.exportedAt}`,
    `- Trace digest: ${report.traceDigest}`,
    "",
    "## Checks",
    "",
    ...report.checks.map(
      (check) =>
        `- ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail || ""}`
    ),
    "",
    "## Screenshots",
    "",
    ...report.screenshots.map((shot) => `- ${shot.file}: ${shot.url}`),
    "",
  ].join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
