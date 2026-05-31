#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ethers } from "ethers";
import { createAdminWithdrawalReviewFocusHelpers } from "./admin_withdrawal_review_focus_helpers.mjs";
import { createWithdrawalReviewMaturityHelpers } from "./withdrawal_review_maturity_helpers.mjs";
import {
  generateTotpCode,
  waitForSafeTotpWindow,
} from "../lib/totp_window.mjs";
import {
  assertLocalDsn,
  assertStagingHttpUrl,
  assertStagingProxyDsn,
} from "../lib/e2e_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const MODE = (
  process.env.WITHDRAWAL_REVIEW_DOGFOOD_ENV ||
  process.argv[2] ||
  "local"
).toLowerCase();
const IS_STAGING = MODE === "staging";
const IS_ADMIN_REVIEW_FOCUSED = process.env.ADMIN_WITHDRAWAL_REVIEW_E2E === "1";
const LOCAL_ADMIN_E2E_TOTP_SECRET =
  process.env.LOCAL_ADMIN_E2E_TOTP_SECRET || "KVKFKRCPNZQUYMLXOVYDSQKJKZDTSRLD";
const LOCAL_DEFAULT_CONSUMER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const LOCAL_DEFAULT_PROVIDER_KEY =
  "0xa9bc3f60a86d4a18c83113631aed4e39c9a83d76c95b9e229385e5e0c60b2a71";
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const OUT_DIR = process.env.WITHDRAWAL_REVIEW_DOGFOOD_OUT_DIR
  ? path.resolve(process.env.WITHDRAWAL_REVIEW_DOGFOOD_OUT_DIR)
  : path.join(
      ROOT,
      IS_STAGING
        ? "docs/evidence/staging/withdrawal-review-dogfood"
        : IS_ADMIN_REVIEW_FOCUSED
        ? "output/dogfood/admin-withdrawal-review"
        : "output/dogfood/withdrawal-review",
      `${timestamp}-${MODE}-${
        IS_ADMIN_REVIEW_FOCUSED
          ? "admin-withdrawal-review"
          : "withdrawal-review-dogfood"
      }`
    );
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const config = {
  mode: MODE,
  gatewayBase: (
    process.env.GATEWAY_E2E_GATEWAY_BASE ||
    process.env.GATEWAY_BASE_URL ||
    "http://127.0.0.1:8000"
  ).replace(/\/+$/, ""),
  adminApi: (
    process.env.STAGING_ADMIN_API_URL ||
    process.env.ADMIN_GATEWAY_URL ||
    "http://127.0.0.1:8300"
  ).replace(/\/+$/, ""),
  adminFront: (
    process.env.STAGING_ADMIN_FRONT_URL ||
    process.env.ADMIN_FRONT_URL ||
    "http://localhost:3200"
  ).replace(/\/+$/, ""),
  rpcUrl:
    process.env.GATEWAY_E2E_RPC_URL ||
    process.env.RPC_URL ||
    "http://127.0.0.1:8545",
  postgresDsn: IS_STAGING
    ? process.env.POSTGRES_DSN ||
      process.env.STAGING_WITHDRAWAL_REVIEW_POSTGRES_DSN ||
      ""
    : process.env.LOCAL_POSTGRES_DSN ||
      process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
      process.env.POSTGRES_DSN ||
      process.env.GATEWAY_POSTGRES_DSN ||
      "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
  adminCookieName:
    process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session",
  adminTotpSecret: IS_STAGING
    ? process.env.STAGING_ADMIN_E2E_OTP_SECRET ||
      process.env.ADMIN_TOTP_SECRET ||
      "JBSWY3DPEHPK3PXP"
    : process.env.LOCAL_ADMIN_E2E_TOTP_SECRET ||
      LOCAL_ADMIN_E2E_TOTP_SECRET ||
      process.env.ADMIN_TOTP_SECRET ||
      "KVKFKRCPNZQUYMLXOVYDSQKJKZDTSRLD",
  adminEmail:
    process.env.ADMIN_EMAIL ||
    (IS_STAGING
      ? "staging-admin-e2e@synapse-network.ai"
      : "local-admin-e2e@synapse-network.ai"),
  adminPassword:
    process.env.STAGING_ADMIN_E2E_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    "WithdrawDogfood#2026!",
  consumerKey:
    process.env.GATEWAY_E2E_OWNER_KEY || process.env.CONSUMER_KEY || "",
  providerKey:
    process.env.GATEWAY_E2E_PROVIDER_KEY || process.env.PROVIDER_KEY || "",
  providerApprovalFixture: process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE
    ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE)
    : path.join(ROOT, "tmp/admin-withdrawal-approval/fixture.json"),
  stagingFixture: process.env.WITHDRAWAL_REVIEW_DOGFOOD_FIXTURE
    ? path.resolve(process.env.WITHDRAWAL_REVIEW_DOGFOOD_FIXTURE)
    : "",
  contractConfigPath: process.env.GATEWAY_E2E_CONTRACT_CONFIG_PATH
    ? path.resolve(process.env.GATEWAY_E2E_CONTRACT_CONFIG_PATH)
    : path.join(ROOT, "services/user-front/src/contract-config.json"),
  consumerManualAmountUsdc:
    process.env.WITHDRAWAL_REVIEW_CONSUMER_AMOUNT_USDC || "500.000000",
  providerRejectAmountUsdc:
    process.env.WITHDRAWAL_REVIEW_PROVIDER_REJECT_AMOUNT_USDC || "100.000000",
  topupDepositUsdc:
    process.env.WITHDRAWAL_REVIEW_TOPUP_DEPOSIT_USDC || "1200.000000",
};

const evidence = {
  trace: [],
  api: {},
  db: {},
  chain: {},
  screenshots: [],
  screenshotEvidence: [],
  passed: [],
  failed: [],
  warnings: [],
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const STAGING_PROVIDER_FIXTURE_CANDIDATES = [
  "svc_synapse_mock_cost_1usdc",
  "svc_deepseek_chat",
  "wr_staging_provider_",
  "svc_synapse_echo",
];
const E2E_CREDENTIAL_NAME_PREFIXES = [
  "e2e-agent-",
  "api-ref-test-",
  "inv-test-",
  "provider-gpp-e2e-local-",
  "staging-load-",
  "wr-staging-",
  "consumer-test-",
];

function redact(value) {
  return String(value ?? "")
    .replace(/0x[a-fA-F0-9]{64}/g, "[REDACTED_HEX64]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9._~+/=-]+/g, "[REDACTED_JWT]")
    .replace(
      /https:\/\/[^/\s]+\/v2\/[A-Za-z0-9._~-]+/g,
      "https://[REDACTED_RPC]"
    );
}

function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redact(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value === "object") {
    const result = {};
    for (const [key, inner] of Object.entries(value)) {
      if (
        /signature|token|secret|password|privateKey|authorization/i.test(key)
      ) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitize(inner);
      }
    }
    return result;
  }
  return redact(value);
}

function addTrace(row) {
  evidence.trace.push({
    runId: runId(),
    timestamp: new Date().toISOString(),
    scenario: row.scenario || "unknown",
    requestId: row.requestId || "",
    method: row.method || "",
    path: row.path || "",
    httpStatus: row.httpStatus ?? 0,
    durationMs: row.durationMs ?? 0,
    sanitizedRequest: sanitize(row.sanitizedRequest || {}),
    sanitizedResponse: sanitize(row.sanitizedResponse || {}),
    expected: sanitize(row.expected || {}),
    actual: sanitize(row.actual || {}),
    ledgerDelta: row.ledgerDelta || "",
    vaultDelta: row.vaultDelta || "",
    ticketHash: row.ticketHash || "",
    txHash: row.txHash || "",
    reconciliationStatus: row.reconciliationStatus || "pending",
  });
}

function pass(name, detail = "") {
  evidence.passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail, extra = {}) {
  evidence.failed.push({ name, detail: redact(detail), ...extra });
  console.error(`FAIL ${name} - ${redact(detail)}`);
}

function warn(name, detail = "") {
  evidence.warnings.push({ name, detail });
  console.warn(`WARN ${name}${detail ? ` - ${detail}` : ""}`);
}

const {
  captureAdminApproveResult,
  captureAdminLoginSuccess,
  captureReviewScreenshots,
  recordAdminAuthCheckpoint,
} = createAdminWithdrawalReviewFocusHelpers({
  config,
  enabled: IS_ADMIN_REVIEW_FOCUSED,
  evidence,
  isStaging: IS_STAGING,
  sanitize,
  screenshotDir: SCREENSHOT_DIR,
});
const { matureConsumerDeposits, matureProviderCharges, seedServiceHealth } =
  createWithdrawalReviewMaturityHelpers({
    evidence,
    pass,
    queryJson,
    sqlLiteral,
  });

function runId() {
  return process.env.WITHDRAWAL_REVIEW_DOGFOOD_RUN_ID || `wr-${timestamp}`;
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function readLocalProviderOnboardingKey() {
  const onboardingEnvPath = path.resolve(
    ROOT,
    "../Synapse-Network-Provider/.env.onboarding.local"
  );
  if (!fs.existsSync(onboardingEnvPath)) {
    return "";
  }
  const match = fs
    .readFileSync(onboardingEnvPath, "utf8")
    .match(/^SYNAPSE_PROVIDER_OWNER_PRIVATE_KEY=(.+)$/m);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

function assertSeedEnvironment() {
  if (!["local", "staging"].includes(MODE)) {
    throw new Error("WITHDRAWAL_REVIEW_DOGFOOD_ENV must be local or staging.");
  }
  if (IS_STAGING) {
    if (
      process.env.STAGING_WITHDRAWAL_REVIEW_DOGFOOD_CONFIRM !==
      "I_UNDERSTAND_THIS_MUTATES_STAGING"
    ) {
      throw new Error(
        "Set STAGING_WITHDRAWAL_REVIEW_DOGFOOD_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING before staging dogfood."
      );
    }
    for (const [name, value] of [
      ["GATEWAY_E2E_RPC_URL", config.rpcUrl],
      ["GATEWAY_E2E_OWNER_KEY", config.consumerKey],
      ["GATEWAY_E2E_PROVIDER_KEY", config.providerKey],
      ["STAGING_ADMIN_E2E_PASSWORD", config.adminPassword],
      ["STAGING_ADMIN_E2E_OTP_SECRET", config.adminTotpSecret],
      ["POSTGRES_DSN", config.postgresDsn],
    ]) {
      if (
        !value ||
        String(value).includes("qwer@1234") ||
        String(value).includes("JBSWY3D")
      ) {
        throw new Error(`Missing staging required env: ${name}`);
      }
    }
    assertStagingHttpUrl("GATEWAY_E2E_GATEWAY_BASE", config.gatewayBase);
    assertStagingHttpUrl("STAGING_ADMIN_API_URL", config.adminApi);
    assertStagingHttpUrl("STAGING_ADMIN_FRONT_URL", config.adminFront);
    assertStagingProxyDsn("POSTGRES_DSN", config.postgresDsn, {
      allowEmpty: false,
    });
    return;
  }
  if (
    !isLocalUrl(config.gatewayBase) ||
    !isLocalUrl(config.adminApi) ||
    !isLocalUrl(config.rpcUrl)
  ) {
    throw new Error(
      "Local withdrawal review dogfood refuses non-local Gateway/Admin/RPC endpoints."
    );
  }
  assertLocalDsn("LOCAL_POSTGRES_DSN", config.postgresDsn, {
    allowEmpty: false,
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(name, value) {
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

function runCommand(label, command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: "pipe",
  });
  fs.writeFileSync(
    path.join(OUT_DIR, `${label}.stdout.log`),
    redact(result.stdout || "")
  );
  fs.writeFileSync(
    path.join(OUT_DIR, `${label}.stderr.log`),
    redact(result.stderr || "")
  );
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit=${result.status}. See ${OUT_DIR}/${label}.stderr.log`
    );
  }
  return result;
}

function resetLocalAdminE2eAccount() {
  if (IS_STAGING) return;
  const pythonBin = fs.existsSync(
    path.join(ROOT, "services/gateway-admin/.venv/bin/python")
  )
    ? path.join(ROOT, "services/gateway-admin/.venv/bin/python")
    : "python3";
  const adminDsn =
    process.env.ADMIN_DATABASE_MIGRATION_DSN ||
    process.env.ADMIN_DATABASE_DSN ||
    "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin";
  runCommand(
    "reset-local-admin-e2e",
    pythonBin,
    [
      path.join(
        ROOT,
        "services/gateway-admin/scripts/reset_staging_e2e_admin.py"
      ),
      "--dsn",
      adminDsn,
      "--email",
      config.adminEmail,
      "--display-name",
      "Local Admin E2E",
      "--role-key",
      "super_admin",
    ],
    {
      STAGING_ADMIN_E2E_PASSWORD: config.adminPassword,
      STAGING_ADMIN_E2E_OTP_SECRET: config.adminTotpSecret,
    }
  );
  pass("admin:local-e2e-reset", config.adminEmail);
}

async function httpJson(
  base,
  pathname,
  {
    method = "GET",
    token,
    address,
    session,
    csrfToken,
    otpCode,
    body,
    expectOk = true,
    scenario = "api",
    headers: extraHeaders = {},
  } = {}
) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (address) headers["X-User-Address"] = address;
  if (session) headers.Cookie = `${config.adminCookieName}=${session}`;
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  if (otpCode) headers["X-Admin-OTP-Code"] = otpCode;
  const started = Date.now();
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 1000) };
    }
  }
  addTrace({
    scenario,
    method,
    path: pathname,
    httpStatus: response.status,
    durationMs: Date.now() - started,
    sanitizedRequest: body || {},
    sanitizedResponse: payload,
    reconciliationStatus: response.ok ? "passed" : "failed",
  });
  if (expectOk && (!response.ok || payload.success === false)) {
    throw new Error(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 900)}`
    );
  }
  return { response, payload };
}

function parseSessionCookie(setCookieHeader) {
  const header = Array.isArray(setCookieHeader)
    ? setCookieHeader.join(",")
    : String(setCookieHeader || "");
  const match = header
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${config.adminCookieName}=`));
  return match
    ? match.split(";")[0].slice(config.adminCookieName.length + 1)
    : "";
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return {
      sessionToken: process.env.ADMIN_SESSION_TOKEN,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
    };
  }
  const response = await fetch(`${config.adminApi}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: config.adminEmail,
      password: config.adminPassword,
      otpCode: generateTotpCode(config.adminTotpSecret),
    }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !body.success || !sessionToken) {
    recordAdminAuthCheckpoint("login", {
      httpStatus: response.status,
      sessionCookiePresent: Boolean(sessionToken),
      csrfTokenPresent: Boolean(body.data?.csrfToken),
      errorCode: body.error?.code,
      errorMessage: body.error?.message,
    });
    throw new Error(
      `Admin login failed: ${response.status} ${JSON.stringify(body).slice(
        0,
        800
      )}`
    );
  }
  addTrace({
    scenario: "admin_login",
    method: "POST",
    path: "/api/admin/v1/auth/login",
    httpStatus: response.status,
    sanitizedRequest: {
      emailHash: crypto
        .createHash("sha256")
        .update(config.adminEmail)
        .digest("hex"),
    },
    sanitizedResponse: {
      success: body.success,
      adminRole: body.data?.admin?.role,
    },
    reconciliationStatus: "passed",
  });
  recordAdminAuthCheckpoint("login", {
    httpStatus: response.status,
    sessionCookiePresent: true,
    csrfTokenPresent: Boolean(body.data?.csrfToken),
    permissions: body.data?.admin?.permissions || [],
    role: body.data?.admin?.role || "",
  });
  return { sessionToken, csrfToken: body.data?.csrfToken || "" };
}

async function authWallet(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const challenge = await httpJson(
        `${config.gatewayBase}/api`,
        `/v1/auth/challenge?address=${encodeURIComponent(address)}`,
        { scenario: `${label}:auth-challenge` }
      );
      const message = challenge.payload.challenge || challenge.payload.message;
      const signature = await wallet.signMessage(message);
      const verified = await httpJson(
        `${config.gatewayBase}/api`,
        "/v1/auth/verify",
        {
          method: "POST",
          body: { wallet_address: address, message, signature },
          scenario: `${label}:auth-verify`,
        }
      );
      const token =
        verified.payload.access_token ||
        verified.payload.token ||
        verified.payload.accessToken;
      if (!token) throw new Error(`${label} auth response missing token`);
      return { address, token, privateKey };
    } catch (error) {
      lastError = error;
      const text = String(error?.message || error);
      if (
        attempt < 3 &&
        (text.includes("Invalid signature or expired challenge") ||
          text.includes("401"))
      ) {
        warn(`${label}:auth-retry`, `attempt=${attempt}`);
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error(`${label} auth failed`);
}

function moneyString(...candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }
  return "0";
}

async function listProviderOwnedServices(auth) {
  const result = await httpJson(`${config.gatewayBase}/api`, "/v1/services", {
    token: auth.token,
    address: auth.address,
    scenario: "provider:owned-services",
  });
  return Array.isArray(result.payload?.services)
    ? result.payload.services
    : Array.isArray(result.payload?.data?.services)
    ? result.payload.data.services
    : [];
}

async function listActiveAgentCredentials(auth) {
  const result = await httpJson(
    `${config.gatewayBase}/api`,
    "/v1/credentials/agent/list?active_only=true",
    {
      token: auth.token,
      address: auth.address,
      scenario: "consumer:list-agent-credentials",
    }
  );
  return Array.isArray(result.payload?.credentials)
    ? result.payload.credentials
    : Array.isArray(result.payload?.data?.credentials)
    ? result.payload.data.credentials
    : [];
}

async function revokeCredential(auth, credentialId) {
  const revoke = await httpJson(
    `${config.gatewayBase}/api`,
    `/v1/credentials/agent/${encodeURIComponent(credentialId)}/revoke`,
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      scenario: "consumer:revoke-agent-credential",
      expectOk: false,
    }
  );
  return [200, 204, 404].includes(revoke.response.status);
}

async function rotateAgentCredential(auth, credentialId) {
  const result = await httpJson(
    `${config.gatewayBase}/api`,
    `/v1/credentials/agent/${encodeURIComponent(credentialId)}/rotate`,
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      scenario: "consumer:rotate-agent-credential",
    }
  );
  const credential = result.payload?.credential || result.payload || {};
  const token =
    credential.token || credential.secretKey || credential.agentToken || "";
  if (!credential.id || !token) {
    throw new Error(
      `agent credential rotate response missing id/token: ${JSON.stringify(
        credential
      ).slice(0, 800)}`
    );
  }
  return {
    id: credential.id,
    token,
    tokenPrefix: credential.tokenPrefix || credential.secretPrefix || "",
  };
}

async function reclaimE2eCredentialSlots(auth) {
  const credentials = await listActiveAgentCredentials(auth);
  let revoked = 0;
  for (const credential of credentials) {
    const name = String(credential.name || "").trim();
    if (
      !E2E_CREDENTIAL_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      continue;
    }
    const credentialId =
      credential.credentialId ||
      credential.credential_id ||
      credential.id ||
      "";
    if (!credentialId) continue;
    if (await revokeCredential(auth, credentialId)) {
      revoked += 1;
    }
  }
  return revoked;
}

async function issueAgentCredential(auth, namePrefix = "wr-staging") {
  const body = {
    name: `${namePrefix}-${runId()}`,
    rpm: 60,
    maxCalls: 500,
    creditLimit: "1000",
    resetInterval: "daily",
  };
  let result = await httpJson(
    `${config.gatewayBase}/api`,
    "/v1/credentials/agent/issue",
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      body,
      scenario: "consumer:issue-agent-credential",
      expectOk: false,
    }
  );
  const errorCode =
    result.payload?.detail?.code ||
    result.payload?.error?.code ||
    result.payload?.code;
  if (
    result.response.status === 409 &&
    String(errorCode).includes("AGENT_CREDENTIAL_LIMIT_REACHED")
  ) {
    const revoked = await reclaimE2eCredentialSlots(auth);
    warn("consumer:agent-credential-slots-reclaimed", `revoked=${revoked}`);
    result = await httpJson(
      `${config.gatewayBase}/api`,
      "/v1/credentials/agent/issue",
      {
        method: "POST",
        token: auth.token,
        address: auth.address,
        body,
        scenario: "consumer:issue-agent-credential-retry",
      }
    );
  } else if (!result.response.ok || result.payload?.success === false) {
    throw new Error(
      `POST /v1/credentials/agent/issue failed: ${
        result.response.status
      } ${JSON.stringify(result.payload).slice(0, 900)}`
    );
  }
  const credential = result.payload?.credential || result.payload || {};
  const token =
    credential.token || credential.secretKey || credential.agentToken || "";
  if (!credential.id || !token) {
    throw new Error(
      `agent credential issue response missing id/token: ${JSON.stringify(
        credential
      ).slice(0, 800)}`
    );
  }
  return {
    id: credential.id,
    token,
    tokenPrefix: credential.tokenPrefix || credential.secretPrefix || "",
  };
}

function selectStagingProviderFixtureService(services) {
  const rows = Array.isArray(services) ? services : [];
  for (const wanted of STAGING_PROVIDER_FIXTURE_CANDIDATES) {
    const healthyPaid = rows.find((row) => {
      const serviceId = String(
        row.serviceId || row.service_id || row.id || row.agentToolName || ""
      ).trim();
      const price = Number.parseFloat(
        moneyString(
          row.pricingAmount,
          row.priceUsdc,
          row.pricing?.amount,
          row.pricing?.amountUsdc
        )
      );
      return (
        row.runtimeAvailable === true &&
        Number.isFinite(price) &&
        price > 0 &&
        (wanted.endsWith("_")
          ? serviceId.startsWith(wanted)
          : serviceId === wanted)
      );
    });
    if (healthyPaid) return healthyPaid;
    const match = rows.find((row) => {
      const serviceId = String(
        row.serviceId || row.service_id || row.id || row.agentToolName || ""
      ).trim();
      if (!serviceId) return false;
      if (wanted.endsWith("_")) return serviceId.startsWith(wanted);
      return serviceId === wanted;
    });
    if (match) return match;
  }
  return rows.find((row) => {
    const price = Number.parseFloat(
      moneyString(
        row.pricingAmount,
        row.priceUsdc,
        row.pricing?.amount,
        row.pricing?.amountUsdc
      )
    );
    return Number.isFinite(price) && price > 0;
  });
}

function fixtureInvokePayload(serviceId, suffix) {
  const normalized = String(serviceId || "").trim();
  if (normalized === "svc_deepseek_chat") {
    return {
      messages: [
        {
          role: "user",
          content: `withdrawal review ${suffix}`,
        },
      ],
      stream: false,
    };
  }
  if (normalized === "svc_synapse_mock_cost_1usdc") {
    return {
      message: `withdrawal review ${suffix}`,
      source: "withdrawal-review-dogfood",
    };
  }
  if (normalized === "svc_synapse_echo") {
    return {
      message: `withdrawal review ${suffix}`,
      source: "withdrawal-review-dogfood",
    };
  }
  return { query: `withdrawal review ${suffix}` };
}

async function buildStagingProviderReviewFixture() {
  const consumerAuth = await authWallet(config.consumerKey, "consumer-fixture");
  const providerAuth = await authWallet(config.providerKey, "provider-fixture");
  const services = await listProviderOwnedServices(providerAuth);
  const service = selectStagingProviderFixtureService(services);
  if (!service) {
    throw new Error(
      `No provider-owned staging fixture service found for ${providerAuth.address}`
    );
  }
  const issuedCredential = await issueAgentCredential(consumerAuth);
  const credential = await rotateAgentCredential(
    consumerAuth,
    issuedCredential.id
  );
  const normalizedServiceId = String(
    service.serviceId ||
      service.service_id ||
      service.id ||
      service.agentToolName
  ).trim();
  const fixture = {
    version: 1,
    mode: "withdrawal-review-staging-provider",
    runId: runId(),
    generatedAt: new Date().toISOString(),
    consumer: {
      address: consumerAuth.address,
    },
    provider: {
      address: providerAuth.address,
    },
    service: {
      id: normalizedServiceId,
      name: service.serviceName || service.name || normalizedServiceId,
      priceUsdc: moneyString(
        service.pricingAmount,
        service.priceUsdc,
        service.pricing?.amount,
        service.pricing?.amountUsdc,
        "1.000000"
      ),
      mockUrl:
        service.primaryEndpoint?.endpointUrl ||
        service.invoke?.targets?.[0]?.url ||
        "",
      discovery: sanitize(service),
    },
    credential,
  };
  const fixturePath = path.join(
    OUT_DIR,
    `${runId()}-staging-provider-review-fixture.json`
  );
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
  pass(
    "provider:staging-fixture-generated",
    `${normalizedServiceId} credential=${credential.id}`
  );
  evidence.api.providerRejectFixture = {
    serviceId: normalizedServiceId,
    credentialId: credential.id,
    consumerAddress: consumerAuth.address,
    providerAddress: providerAuth.address,
  };
  return { fixturePath, fixture };
}

function queryJson(sql) {
  const result = spawnSync(
    "psql",
    [
      config.postgresDsn,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `psql query failed: ${redact(result.stderr || result.stdout || "")}`
    );
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function dbBalance(ownerAddress, kind) {
  const accountPredicate =
    kind === "provider"
      ? "account.account_kind IN ('provider', 'provider_wallet')"
      : `account.account_kind = ${sqlLiteral(kind)}`;
  return queryJson(`
    SELECT json_build_object(
      'ownerAddress', owner.owner_wallet,
      'accountKind', account.account_kind,
      'availableBalance', balance.available_balance::text,
      'pendingBalance', balance.pending_balance::text,
      'frozenBalance', balance.frozen_balance::text
    )
    FROM synapse_owner_accounts owner
    JOIN synapse_ledger_accounts account
      ON account.owner_id = owner.owner_id
     AND ${accountPredicate}
    JOIN synapse_account_balances balance
      ON balance.account_id = account.account_id
    WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
    LIMIT 1
  `);
}

function dbWithdrawal(withdrawalId) {
  return queryJson(`
    SELECT json_build_object(
      'withdrawalId', vw.withdrawal_id,
      'withdrawalKind', vw.withdrawal_kind,
      'status', vw.status,
      'amountUsdc', vw.amount_usdc::text,
      'txHash', vw.tx_hash,
      'ticketId', vw.ticket_id,
      'ticketHash', vw.ticket_hash,
      'signaturePresent', vw.signature IS NOT NULL,
      'nonce', vw.nonce,
      'deadline', vw.deadline,
      'updatedAt', vw.updated_at::text
    )
    FROM synapse_vault_withdrawals vw
    WHERE vw.withdrawal_id = ${sqlLiteral(withdrawalId)}
    LIMIT 1
  `);
}

function dbProviderMatureReceivable(ownerAddress) {
  return queryJson(`
    WITH provider_account AS (
      SELECT
        lower(owner.owner_wallet) AS provider_wallet,
        account.account_id
      FROM synapse_owner_accounts owner
      JOIN synapse_ledger_accounts account
        ON account.owner_id = owner.owner_id
       AND account.account_kind = 'provider_wallet'
      WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
      LIMIT 1
    ),
    matured_income AS (
      SELECT COALESCE(SUM(entry.amount_usdc), 0) AS amount
      FROM synapse_ledger_entries entry
      JOIN provider_account provider ON provider.account_id = entry.credit_account_id
      WHERE entry.business_type = 'charge'
        AND entry.status = 'posted'
        AND entry.created_at <= NOW() - INTERVAL '7 days'
    ),
    active_withdrawals AS (
      SELECT COALESCE(SUM(vw.amount_usdc), 0) AS amount
      FROM synapse_vault_withdrawals vw
      JOIN synapse_owner_accounts owner ON owner.owner_id = vw.owner_id
      JOIN provider_account provider
        ON lower(owner.owner_wallet) = provider.provider_wallet
      WHERE vw.withdrawal_kind = 'provider_withdrawal'
        AND vw.status NOT IN ('FAILED', 'FAILED_EXPIRED', 'REJECTED', 'CANCELLED')
    )
    SELECT json_build_object(
      'maturedIncomeUsdc', (SELECT amount::text FROM matured_income),
      'activeWithdrawOrLockedUsdc', (SELECT amount::text FROM active_withdrawals),
      'providerMatureReceivableUsdc',
        GREATEST(
          (SELECT amount FROM matured_income) - (SELECT amount FROM active_withdrawals),
          0
        )::text
    )
  `);
}

function dbPendingManualReviewRows(ownerAddress, withdrawalKind) {
  return (
    queryJson(`
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t."createdAt" ASC), '[]'::json)
      FROM (
        SELECT
          vw.withdrawal_id AS "withdrawalId",
          vw.withdrawal_kind AS "withdrawalKind",
          vw.status,
          vw.amount_usdc::text AS "amountUsdc",
          vw.created_at::text AS "createdAt"
        FROM synapse_vault_withdrawals vw
        JOIN synapse_owner_accounts owner ON owner.owner_id = vw.owner_id
        WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
          AND vw.withdrawal_kind = ${sqlLiteral(withdrawalKind)}
          AND vw.status = 'PENDING_MANUAL_REVIEW'
      ) t
    `) || []
  );
}

function q6Atomic(value) {
  const normalized = String(value ?? "0").trim();
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsigned = normalized.replace(/^-/, "");
  if (!/^\d+(\.\d+)?$/.test(unsigned)) {
    throw new Error(`Invalid q6 decimal: ${value}`);
  }
  const [whole, fraction = ""] = unsigned.split(".");
  return (
    sign *
    (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6)))
  );
}

function assertDelta(label, before, after, expected) {
  const actual = q6Atomic(after) - q6Atomic(before);
  const wanted = q6Atomic(expected);
  if (actual !== wanted) {
    throw new Error(
      `${label} delta mismatch expected=${expected} actualAtomic=${actual.toString()} before=${before} after=${after}`
    );
  }
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  const contractConfig = readJson(config.contractConfigPath);
  const coreAddress = ethers.getAddress(contractConfig.SynapseCore);
  const usdcAddress = ethers.getAddress(contractConfig.MockUSDC);
  return {
    provider,
    chainId: Number(network.chainId),
    coreAddress,
    usdcAddress,
    coreAbi: readJson(
      path.join(ROOT, "services/user-front/src/SynapseCoreABI.json")
    ),
    usdcAbi: readJson(
      path.join(ROOT, "services/user-front/src/MockUSDCABI.json")
    ),
  };
}

async function claimOnChain(privateKey, ticket) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const signer = new ethers.Wallet(privateKey, provider);
  const core = new ethers.Contract(coreAddress, coreAbi, signer);
  const signature = String(ticket.signature || "").startsWith("0x")
    ? ticket.signature
    : `0x${ticket.signature}`;
  const tx = await core.withdraw(
    BigInt(ticket.amount),
    BigInt(ticket.fee || 0),
    ticket.ticketId,
    BigInt(ticket.deadline),
    signature
  );
  const receipt = await tx.wait();
  if (Number(receipt?.status ?? -1) !== 1)
    throw new Error(`withdraw tx failed ${tx.hash}`);
  return { txHash: tx.hash, gasUsed: receipt?.gasUsed?.toString() || "" };
}

async function expectClaimReplayRejected(privateKey, ticket) {
  try {
    await claimOnChain(privateKey, ticket);
    throw new Error("ticket replay unexpectedly succeeded");
  } catch (error) {
    if (String(error.message || error).includes("unexpectedly succeeded"))
      throw error;
    return {
      rejected: true,
      message: redact(
        error.shortMessage || error.message || String(error)
      ).slice(0, 500),
    };
  }
}

async function isTicketConsumed(ticketHash) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const core = new ethers.Contract(coreAddress, coreAbi, provider);
  return Boolean(await core.isTicketConsumed(ticketHash));
}

async function adminDecision(adminAuth, withdrawalId, decision, scenario) {
  await waitForSafeTotpWindow({
    guardSeconds: 8,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const otpCode = generateTotpCode(config.adminTotpSecret);
  recordAdminAuthCheckpoint(`decision:${scenario}`, {
    sessionCookiePresent: Boolean(adminAuth.sessionToken),
    csrfTokenPresent: Boolean(adminAuth.csrfToken),
    otpCodePresent: Boolean(otpCode),
  });
  const result = await httpJson(
    config.adminApi,
    `/api/admin/v1/withdrawal-reviews/${encodeURIComponent(
      withdrawalId
    )}/decision`,
    {
      method: "POST",
      session: adminAuth.sessionToken,
      csrfToken: adminAuth.csrfToken,
      otpCode,
      body: { decision, note: `${scenario} ${runId()}` },
      scenario,
      expectOk: false,
    }
  );
  recordAdminAuthCheckpoint(`decision:${scenario}:response`, {
    sessionCookiePresent: Boolean(adminAuth.sessionToken),
    csrfTokenPresent: Boolean(adminAuth.csrfToken),
    otpCodePresent: Boolean(otpCode),
    httpStatus: result.response.status,
    requestId: result.payload?.requestId,
    errorCode: result.payload?.error?.code,
    errorMessage: result.payload?.error?.message,
  });
  if (!result.response.ok || result.payload?.success === false) {
    throw new Error(
      `POST withdrawal review decision failed: ${
        result.response.status
      } ${JSON.stringify(result.payload).slice(0, 900)}`
    );
  }
  return result;
}

async function rejectStaleManualReviewRows(
  adminAuth,
  ownerAddress,
  withdrawalKind,
  scenario
) {
  const rows = dbPendingManualReviewRows(ownerAddress, withdrawalKind);
  if (!rows.length) return [];
  const rejected = [];
  for (const row of rows) {
    await adminDecision(
      adminAuth,
      row.withdrawalId,
      "REJECT",
      `${scenario}:${row.withdrawalId}`
    );
    const refreshed = dbWithdrawal(row.withdrawalId);
    if (String(refreshed?.status || "").toUpperCase() !== "REJECTED") {
      throw new Error(
        `stale manual review cleanup failed for ${
          row.withdrawalId
        }: ${JSON.stringify(refreshed)}`
      );
    }
    rejected.push({
      withdrawalId: row.withdrawalId,
      amountUsdc: row.amountUsdc,
      withdrawalKind,
    });
  }
  warn(
    `${scenario}:stale-manual-review-rejected`,
    rejected.map((row) => row.withdrawalId).join(",")
  );
  return rejected;
}

async function createConsumerWithdrawal(auth, amountUsdc, label) {
  const idempotencyKey = `${label}:${runId()}:${crypto.randomUUID()}`;
  const result = await httpJson(
    `${config.gatewayBase}/api`,
    "/v1/balance/consumer/withdraw",
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      headers: { "X-Idempotency-Key": idempotencyKey },
      body: { amountUsdc, reason: `${label} ${runId()}` },
      scenario: label,
    }
  );
  const payload = result.payload;
  return {
    ...payload,
    withdrawId: payload.withdrawId || payload.refundId || payload.withdrawalId,
  };
}

async function completeConsumerWithdrawal(auth, withdrawId, txHash) {
  return httpJson(
    `${config.gatewayBase}/api`,
    `/v1/refunds/${encodeURIComponent(withdrawId)}/complete`,
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      body: { txHash },
      scenario: "consumer-complete",
    }
  );
}

async function createProviderWithdrawal(auth, amountUsdc, label) {
  const idempotencyKey = `${label}:${runId()}:${crypto.randomUUID()}`;
  const result = await httpJson(
    `${config.gatewayBase}/api`,
    "/v1/providers/withdrawals/intent",
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      headers: { "X-Idempotency-Key": idempotencyKey },
      body: { amountUsdc },
      scenario: label,
    }
  );
  return result.payload;
}

async function invokeFixtureService(fixture, suffix) {
  const targetUrl =
    fixture?.service?.mockUrl ||
    fixture?.service?.endpointUrl ||
    fixture?.service?.discovery?.primaryEndpoint?.endpointUrl ||
    fixture?.service?.discovery?.invoke?.targets?.[0]?.url ||
    "";
  if (!targetUrl) {
    throw new Error(
      `Provider fixture is missing an invokable target URL: ${JSON.stringify(
        fixture?.service || {}
      ).slice(0, 800)}`
    );
  }
  seedServiceHealth(fixture.service.id, targetUrl);
  const requestId = `withdrawal-review-${runId()}-${suffix}`;
  const started = Date.now();
  const response = await fetch(`${config.gatewayBase}/api/v1/agent/invoke`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Credential": fixture.credential.token,
      "X-Service-Id": fixture.service.id,
      "X-Request-Id": requestId,
    },
    body: JSON.stringify({
      serviceId: fixture.service.id,
      idempotencyKey: requestId,
      costUsdc: fixture.service.priceUsdc,
      payload: { body: fixtureInvokePayload(fixture.service.id, suffix) },
      responseMode: "sync",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  addTrace({
    scenario: `provider-invoke-${suffix}`,
    method: "POST",
    path: "/api/v1/agent/invoke",
    httpStatus: response.status,
    durationMs: Date.now() - started,
    sanitizedRequest: { serviceId: fixture.service.id, requestId },
    sanitizedResponse: payload,
    reconciliationStatus: response.ok ? "passed" : "failed",
  });
  if (!response.ok)
    throw new Error(
      `provider invoke ${suffix} failed: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  return payload;
}

async function ensureProviderMatureReceivable(
  fixture,
  providerAuth,
  targetAmountUsdc
) {
  const target = Number.parseFloat(targetAmountUsdc);
  if (!Number.isFinite(target) || target <= 0) {
    throw new Error(
      `Invalid provider mature receivable target: ${targetAmountUsdc}`
    );
  }
  const servicePrice = Number.parseFloat(
    moneyString(fixture?.service?.priceUsdc, "0")
  );
  if (!Number.isFinite(servicePrice) || servicePrice <= 0) {
    throw new Error(
      `Provider fixture service price is invalid: ${JSON.stringify(
        fixture?.service || {}
      )}`
    );
  }
  let maturity = dbProviderMatureReceivable(providerAuth.address);
  let current = Number.parseFloat(
    maturity?.providerMatureReceivableUsdc || "0"
  );
  if (Number.isFinite(current) && current >= target) {
    evidence.db.providerMatureReceivable = maturity;
    pass(
      "provider:mature-receivable-ready",
      `${maturity.providerMatureReceivableUsdc} USDC`
    );
    return maturity;
  }
  const initialCurrent = Number.isFinite(current) ? current : 0;
  const gap = Math.max(target - initialCurrent, 0);
  const conservativePerInvoke = Math.max(servicePrice * 0.5, 0.01);
  const maxInvokes = Math.max(3, Math.ceil(gap / conservativePerInvoke) + 6);
  let invokeCount = 0;

  while (invokeCount < maxInvokes) {
    invokeCount += 1;
    await invokeFixtureService(fixture, `provider-topup-${invokeCount}`);
    matureProviderCharges(providerAuth.address);
    maturity = dbProviderMatureReceivable(providerAuth.address);
    current = Number.parseFloat(maturity?.providerMatureReceivableUsdc || "0");
    if (Number.isFinite(current) && current >= target) {
      break;
    }
  }

  evidence.db.providerMatureReceivable = maturity;
  evidence.api.providerRejectFixtureTopup = {
    serviceId: fixture.service.id,
    priceUsdc: fixture.service.priceUsdc,
    targetAmountUsdc,
    invokeCount,
    initialProviderMatureReceivableUsdc: initialCurrent.toFixed(6),
    finalProviderMatureReceivableUsdc:
      maturity?.providerMatureReceivableUsdc || "0",
  };
  if (!Number.isFinite(current) || current < target) {
    throw new Error(
      `Provider mature receivable did not reach target after top-up: current=${maturity?.providerMatureReceivableUsdc} target=${targetAmountUsdc} invokes=${invokeCount}/${maxInvokes}`
    );
  }
  pass(
    "provider:mature-receivable-ready",
    `${maturity.providerMatureReceivableUsdc} USDC after ${invokeCount} invoke(s)`
  );
  return maturity;
}

async function runProviderApprovalBaseline() {
  if (IS_STAGING) {
    if (!config.stagingFixture || !fs.existsSync(config.stagingFixture)) {
      const generated = await buildStagingProviderReviewFixture();
      warn("provider:staging-fixture-autogenerated", generated.fixturePath);
      return generated.fixture;
    }
    const fixture = readJson(config.stagingFixture);
    pass("provider:staging-fixture-loaded", config.stagingFixture);
    return fixture;
  }
  const fixturePath = path.join(OUT_DIR, "provider-approval-fixture.json");
  const localConsumerKey =
    config.consumerKey ||
    process.env.CONSUMER_KEY ||
    LOCAL_DEFAULT_CONSUMER_KEY;
  const localProviderKey =
    config.providerKey ||
    process.env.PROVIDER_KEY ||
    readLocalProviderOnboardingKey() ||
    LOCAL_DEFAULT_PROVIDER_KEY;
  runCommand(
    "provider-approval-baseline",
    "npm",
    ["run", "e2e:admin-withdrawal-approval"],
    {
      ADMIN_WITHDRAWAL_APPROVAL_FIXTURE: fixturePath,
      ADMIN_WITHDRAWAL_APPROVAL_DEPOSIT_USDC: config.topupDepositUsdc,
      ADMIN_WITHDRAWAL_APPROVAL_AMOUNT_USDC:
        process.env.ADMIN_WITHDRAWAL_APPROVAL_AMOUNT_USDC || "10.000000",
      WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC:
        process.env.WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC || "1.000000",
      CONSUMER_KEY: localConsumerKey,
      PROVIDER_KEY: localProviderKey,
      ADMIN_EMAIL: config.adminEmail,
      ADMIN_PASSWORD: config.adminPassword,
      ADMIN_TOTP_SECRET: config.adminTotpSecret,
    }
  );
  const fixture = readJson(fixturePath);
  pass(
    "provider:approve-baseline",
    fixture.withdrawal?.withdrawalId || "provider baseline completed"
  );
  return fixture;
}

async function runConsumerReject(auth, adminAuth) {
  const before = dbBalance(auth.address, "consumer_wallet");
  const created = await createConsumerWithdrawal(
    auth,
    config.consumerManualAmountUsdc,
    "consumer-manual-reject"
  );
  if (String(created.status).toUpperCase() !== "PENDING_MANUAL_REVIEW") {
    throw new Error(
      `consumer reject fixture did not enter manual review: ${JSON.stringify(
        created
      ).slice(0, 800)}`
    );
  }
  await captureReviewScreenshots(
    adminAuth,
    created.withdrawId,
    "consumer-reject-before"
  );
  const decision = await adminDecision(
    adminAuth,
    created.withdrawId,
    "REJECT",
    "consumer-reject"
  );
  const after = dbBalance(auth.address, "consumer_wallet");
  const row = dbWithdrawal(created.withdrawId);
  if (row.status !== "REJECTED")
    throw new Error(
      `consumer reject DB status mismatch: ${JSON.stringify(row)}`
    );
  assertDelta(
    "consumer reject available",
    before.availableBalance,
    after.availableBalance,
    "0.000000"
  );
  assertDelta(
    "consumer reject frozen",
    before.frozenBalance,
    after.frozenBalance,
    "0.000000"
  );
  // Around the full operation, balances return to exactly the starting tuple.
  if (
    before.availableBalance !== after.availableBalance ||
    before.frozenBalance !== after.frozenBalance
  ) {
    throw new Error(
      `consumer reject did not restore balance tuple before=${JSON.stringify(
        before
      )} after=${JSON.stringify(after)}`
    );
  }
  evidence.db.consumerReject = { before, after, row };
  evidence.api.consumerReject = decision.payload;
  await duplicateDecisionMustFail(
    adminAuth,
    created.withdrawId,
    "consumer-reject"
  );
  pass("consumer:reject-no-funds-blackhole", created.withdrawId);
}

async function runConsumerApprove(auth, adminAuth) {
  const before = dbBalance(auth.address, "consumer_wallet");
  const created = await createConsumerWithdrawal(
    auth,
    config.consumerManualAmountUsdc,
    "consumer-manual-approve"
  );
  if (String(created.status).toUpperCase() !== "PENDING_MANUAL_REVIEW") {
    throw new Error(
      `consumer approve fixture did not enter manual review: ${JSON.stringify(
        created
      ).slice(0, 800)}`
    );
  }
  await captureReviewScreenshots(
    adminAuth,
    created.withdrawId,
    "consumer-approve-before"
  );
  const decision = await adminDecision(
    adminAuth,
    created.withdrawId,
    "APPROVE",
    "consumer-approve"
  );
  await captureAdminApproveResult(adminAuth, created.withdrawId);
  const result = decision.payload.data || decision.payload;
  const ticket = result.ticket || result.ticketMetadata || {};
  if (!ticket.signature)
    throw new Error(
      `consumer approve did not return ticket: ${JSON.stringify(result).slice(
        0,
        800
      )}`
    );
  const afterApprove = dbBalance(auth.address, "consumer_wallet");
  const rowAfterApprove = dbWithdrawal(created.withdrawId);
  if (
    !["REQUESTED", "APPROVED_AUTO"].includes(
      String(rowAfterApprove.status).toUpperCase()
    )
  ) {
    throw new Error(
      `consumer approve DB status mismatch: ${JSON.stringify(rowAfterApprove)}`
    );
  }
  const claim = await claimOnChain(auth.privateKey, ticket);
  await completeConsumerWithdrawal(auth, created.withdrawId, claim.txHash);
  const replay = await expectClaimReplayRejected(auth.privateKey, ticket);
  const consumed = await isTicketConsumed(ticket.ticketHash);
  const afterComplete = dbBalance(auth.address, "consumer_wallet");
  const rowAfterComplete = dbWithdrawal(created.withdrawId);
  if (rowAfterComplete.status !== "COMPLETED")
    throw new Error(
      `consumer complete DB status mismatch: ${JSON.stringify(
        rowAfterComplete
      )}`
    );
  if (!consumed || !replay.rejected)
    throw new Error(
      `consumer ticket replay/consumed mismatch: ${JSON.stringify({
        consumed,
        replay,
      })}`
    );
  assertDelta(
    "consumer approve available",
    before.availableBalance,
    afterComplete.availableBalance,
    `-${config.consumerManualAmountUsdc}`
  );
  assertDelta(
    "consumer approve pending",
    before.pendingBalance,
    afterComplete.pendingBalance,
    "0.000000"
  );
  assertDelta(
    "consumer approve frozen",
    before.frozenBalance,
    afterComplete.frozenBalance,
    "0.000000"
  );
  evidence.db.consumerApprove = {
    before,
    afterApprove,
    afterComplete,
    rowAfterApprove,
    rowAfterComplete,
  };
  evidence.api.consumerApprove = sanitize(decision.payload);
  evidence.chain.consumerApprove = {
    claim,
    replay,
    consumed,
    ticketHash: ticket.ticketHash,
  };
  await duplicateDecisionMustFail(
    adminAuth,
    created.withdrawId,
    "consumer-approve"
  );
  pass(
    "consumer:approve-claim-replay",
    `${created.withdrawId} tx=${claim.txHash}`
  );
}

async function runProviderReject(fixture, providerAuth, adminAuth) {
  if (!fixture?.credential?.token || !fixture?.service?.id) {
    throw new Error(
      "Provider reject requires provider approval fixture with service and credential."
    );
  }
  if (fixture?.consumer?.privateKey) {
    const consumerFixtureAuth = await authWallet(
      fixture.consumer.privateKey,
      "consumer-provider-reject-fixture"
    );
    fixture.credential = fixture?.credential?.id
      ? await rotateAgentCredential(consumerFixtureAuth, fixture.credential.id)
      : await issueAgentCredential(consumerFixtureAuth);
    evidence.api.providerRejectFixtureRefreshedCredential = {
      credentialId: fixture.credential.id,
      consumerAddress: consumerFixtureAuth.address,
    };
  }
  await ensureProviderMatureReceivable(
    fixture,
    providerAuth,
    config.providerRejectAmountUsdc
  );
  const before = dbBalance(providerAuth.address, "provider");
  const created = await createProviderWithdrawal(
    providerAuth,
    config.providerRejectAmountUsdc,
    "provider-manual-reject"
  );
  if (String(created.status).toUpperCase() !== "PENDING_MANUAL_REVIEW") {
    throw new Error(
      `provider reject fixture did not enter manual review: ${JSON.stringify(
        created
      ).slice(0, 800)}`
    );
  }
  await captureReviewScreenshots(
    adminAuth,
    created.withdrawalId,
    "provider-reject-before"
  );
  const decision = await adminDecision(
    adminAuth,
    created.withdrawalId,
    "REJECT",
    "provider-reject"
  );
  const after = dbBalance(providerAuth.address, "provider");
  const row = dbWithdrawal(created.withdrawalId);
  if (row.status !== "REJECTED")
    throw new Error(
      `provider reject DB status mismatch: ${JSON.stringify(row)}`
    );
  if (
    before.availableBalance !== after.availableBalance ||
    before.frozenBalance !== after.frozenBalance
  ) {
    throw new Error(
      `provider reject did not restore balance tuple before=${JSON.stringify(
        before
      )} after=${JSON.stringify(after)}`
    );
  }
  evidence.db.providerReject = { before, after, row };
  evidence.api.providerReject = decision.payload;
  await duplicateDecisionMustFail(
    adminAuth,
    created.withdrawalId,
    "provider-reject"
  );
  pass("provider:reject-no-funds-blackhole", created.withdrawalId);
}

async function duplicateDecisionMustFail(adminAuth, withdrawalId, label) {
  const result = await httpJson(
    config.adminApi,
    `/api/admin/v1/withdrawal-reviews/${encodeURIComponent(
      withdrawalId
    )}/decision`,
    {
      method: "POST",
      session: adminAuth.sessionToken,
      csrfToken: adminAuth.csrfToken,
      otpCode: generateTotpCode(config.adminTotpSecret),
      body: { decision: "APPROVE", note: `${label} duplicate must fail` },
      expectOk: false,
      scenario: `${label}:duplicate-decision`,
    }
  );
  if (result.response.ok)
    throw new Error(`${label} duplicate decision unexpectedly succeeded`);
  pass(
    `${label}:duplicate-decision-rejected`,
    `status=${result.response.status}`
  );
}

async function runStagingPreflight() {
  const [health, adminHealth] = await Promise.all([
    fetch(`${config.gatewayBase}/health`),
    fetch(`${config.adminApi}/health`),
  ]);
  if (!health.ok || !adminHealth.ok) {
    throw new Error(
      `staging preflight failed gateway=${health.status} admin=${adminHealth.status}`
    );
  }
  const chain = await getChainContext();
  if (chain.chainId !== 421614)
    throw new Error(
      `staging chainId mismatch expected=421614 actual=${chain.chainId}`
    );
  const coreCode = await chain.provider.getCode(chain.coreAddress);
  const usdcCode = await chain.provider.getCode(chain.usdcAddress);
  if (coreCode === "0x" || usdcCode === "0x")
    throw new Error("staging contract bytecode missing");
  pass("staging:preflight", `chainId=${chain.chainId}`);
}

async function runMain() {
  assertSeedEnvironment();
  if (IS_STAGING) await runStagingPreflight();
  resetLocalAdminE2eAccount();

  const fixture = await runProviderApprovalBaseline();
  const adminAuth =
    !IS_ADMIN_REVIEW_FOCUSED && fixture?.auth?.sessionToken
      ? {
          sessionToken: fixture.auth.sessionToken,
          csrfToken: fixture.auth.csrfToken || "",
        }
      : await loginAdmin();
  if (!IS_ADMIN_REVIEW_FOCUSED && fixture?.auth?.sessionToken) {
    recordAdminAuthCheckpoint("fixture-admin-session", {
      sessionCookiePresent: true,
      csrfTokenPresent: Boolean(fixture.auth.csrfToken),
      permissions: fixture.auth.admin?.permissions || [],
      role: fixture.auth.admin?.role || "",
    });
  }
  await captureAdminLoginSuccess(adminAuth);
  const consumerAuth =
    !IS_STAGING && fixture?.consumer?.token
      ? fixture.consumer
      : await authWallet(config.consumerKey, "consumer");
  const providerAuth =
    !IS_STAGING && fixture?.provider?.token
      ? fixture.provider
      : await authWallet(config.providerKey, "provider");

  if (IS_STAGING) {
    evidence.db.stagingCleanup = {
      consumer: await rejectStaleManualReviewRows(
        adminAuth,
        consumerAuth.address,
        "consumer_refund",
        "consumer-cleanup"
      ),
      provider: await rejectStaleManualReviewRows(
        adminAuth,
        providerAuth.address,
        "provider_withdrawal",
        "provider-cleanup"
      ),
    };
  }

  matureConsumerDeposits(consumerAuth.address);

  await runConsumerReject(consumerAuth, adminAuth);
  await runConsumerApprove(consumerAuth, adminAuth);
  if (fixture?.withdrawal?.withdrawalId) {
    await duplicateDecisionMustFail(
      adminAuth,
      fixture.withdrawal.withdrawalId,
      "provider-approve-baseline"
    );
  }
  await runProviderReject(fixture, providerAuth, adminAuth);
}

function secretScan(text) {
  const patterns = [
    /Bearer\s+[A-Za-z0-9._~+/=-]+/,
    /eyJ[A-Za-z0-9._~+/=-]+/,
    /"(?:[^"]*(?:privateKey|private_key|signature|authorization|token|secret|password)[^"]*)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    /\b(?:PRIVATE_KEY|PRIVATEKEY|JWT_SECRET|AUTH_SECRET|ADMIN_TOTP_SECRET)\b/,
  ];
  return patterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => String(pattern));
}

function writeEvidence() {
  const traceText =
    evidence.trace.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const traceDigest = crypto
    .createHash("sha256")
    .update(traceText)
    .digest("hex");
  const status = evidence.failed.length === 0 ? "success" : "failed";
  const report = {
    status,
    mode: MODE,
    runId: runId(),
    generatedAt: new Date().toISOString(),
    traceDigest,
    passed: evidence.passed,
    failed: evidence.failed,
    warnings: evidence.warnings,
    screenshots: evidence.screenshots,
    screenshotEvidence: evidence.screenshotEvidence,
    requiredScenarios: [
      "provider approve",
      "provider reject",
      "consumer approve",
      "consumer reject",
    ],
  };
  writeJson("report.json", report);
  writeJson("api-evidence.json", evidence.api);
  writeJson("db-evidence.json", evidence.db);
  writeJson("chain-evidence.json", evidence.chain);
  if (IS_ADMIN_REVIEW_FOCUSED) {
    writeJson("screenshot-evidence.json", evidence.screenshotEvidence);
  }
  fs.writeFileSync(path.join(OUT_DIR, "trace.jsonl"), traceText);
  const bugfixLines = [
    "# Withdrawal Review Dogfood Bugfix Log",
    "",
    `- Status: ${status}`,
    `- Run ID: ${runId()}`,
    "",
    "## Failures",
    ...(evidence.failed.length
      ? evidence.failed.map((item, index) =>
          [
            `### BUG-${String(index + 1).padStart(3, "0")}: ${item.name}`,
            "",
            `- Severity: P0/P1 finance review blocker`,
            `- Scenario: ${item.name}`,
            `- Screenshot: ${
              item.screenshot || "See screenshots/ if available"
            }`,
            `- API Evidence: api-evidence.json / trace.jsonl`,
            `- DB Evidence: db-evidence.json`,
            `- Chain Evidence: chain-evidence.json`,
            `- Repro Steps: rerun npm run e2e:withdrawal-review-dogfood:${MODE}`,
            `- Expected: ${
              item.expected ||
              "scenario passes with no balance/replay/audit regression"
            }`,
            `- Actual: ${item.detail}`,
            `- Status: open`,
            "",
          ].join("\n")
        )
      : ["- None"]),
    "",
  ];
  fs.writeFileSync(
    path.join(OUT_DIR, "bugfix-log.md"),
    `${bugfixLines.join("\n")}\n`
  );
  const md = [
    "# Withdrawal Review Dogfood Report",
    "",
    `- Status: ${status}`,
    `- Mode: ${MODE}`,
    `- Run ID: ${runId()}`,
    `- Trace digest: ${traceDigest}`,
    "",
    "## Passed",
    ...(evidence.passed.length
      ? evidence.passed.map(
          (item) => `- ${item.name}${item.detail ? `: ${item.detail}` : ""}`
        )
      : ["- None"]),
    "",
    "## Failed",
    ...(evidence.failed.length
      ? evidence.failed.map((item) => `- ${item.name}: ${item.detail}`)
      : ["- None"]),
    "",
    "## Screenshots",
    ...(evidence.screenshots.length
      ? evidence.screenshots.map((filePath) => `- ${filePath}`)
      : ["- None"]),
    "",
  ];
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), `${md.join("\n")}\n`);

  const combined = [
    JSON.stringify(report),
    JSON.stringify(evidence.api),
    JSON.stringify(evidence.db),
    JSON.stringify(evidence.chain),
    traceText,
  ].join("\n");
  const leaks = secretScan(combined);
  if (leaks.length) {
    console.error(
      `FATAL WITHDRAWAL-REVIEW-EVIDENCE-SECRET: evidence contains secret-like patterns ${leaks.join(
        ", "
      )}`
    );
    process.exitCode = 1;
  }
  console.log(`[withdrawal-review-dogfood] evidence: ${OUT_DIR}`);
  if (status !== "success") process.exitCode = 1;
}

runMain()
  .catch((error) => {
    fail("fatal", error.stack || error.message || String(error));
  })
  .finally(() => {
    writeEvidence();
  });
