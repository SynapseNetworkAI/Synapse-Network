#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { ethers } from "ethers";
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
        : "output/dogfood/withdrawal-review",
      `${timestamp}-${MODE}-withdrawal-review-dogfood`
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
    "http://localhost:4000"
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
      process.env.POSTGRES_DSN ||
      process.env.GATEWAY_POSTGRES_DSN ||
      "postgresql://synapse_gateway_app:local-dev-gateway-app-password@localhost:5432/synapse_gateway",
  adminCookieName:
    process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session",
  adminTotpSecret:
    process.env.STAGING_ADMIN_E2E_OTP_SECRET ||
    process.env.ADMIN_TOTP_SECRET ||
    "JBSWY3DPEHPK3PXP",
  adminEmail:
    process.env.ADMIN_EMAIL ||
    (IS_STAGING
      ? "staging-admin-e2e@synapse-network.ai"
      : "local-admin-e2e@synapse.network"),
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
    process.env.WITHDRAWAL_REVIEW_PROVIDER_REJECT_AMOUNT_USDC || "2.000000",
  topupDepositUsdc:
    process.env.WITHDRAWAL_REVIEW_TOPUP_DEPOSIT_USDC || "1200.000000",
};

const evidence = {
  trace: [],
  api: {},
  db: {},
  chain: {},
  screenshots: [],
  passed: [],
  failed: [],
  warnings: [],
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
    "postgresql://synapse_admin_app:12345678@localhost:5432/synapse_gateway_admin";
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
  return { sessionToken, csrfToken: body.data?.csrfToken || "" };
}

async function authWallet(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
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

function serviceEndpointId(serviceId, targetUrl, index = 0) {
  const suffix = crypto
    .createHash("sha1")
    .update(String(targetUrl))
    .digest("hex")
    .slice(0, 10);
  return `${serviceId}:ep:${index}:${suffix}`;
}

function seedServiceHealth(serviceId, targetUrl) {
  const nowMs = Date.now();
  const endpointId = serviceEndpointId(serviceId, targetUrl);
  const stateKey = `service_health_meta::${serviceId}::${targetUrl}`;
  const healthPayload = JSON.stringify({
    status: "healthy",
    overallStatus: "healthy",
    lastCheckedAt: nowMs,
    lastHealthyAt: nowMs,
    httpStatus: 200,
    latencyMs: 50,
    consecutiveSuccesses: 3,
    consecutiveFailures: 0,
    healthyTargets: 1,
    totalTargets: 1,
  });
  queryJson(`
    WITH endpoint_upsert AS (
      INSERT INTO synapse_service_endpoints
        (endpoint_id, service_id, endpoint_url, auth_mode, timeout_ms,
         max_payload_bytes, streaming_supported, async_supported,
         callback_supported, weight, is_primary, status,
         created_at, updated_at)
      VALUES (
        ${sqlLiteral(endpointId)}, ${sqlLiteral(serviceId)}, ${sqlLiteral(
    targetUrl
  )}, 'gateway_signed', 30000,
        1048576, FALSE, FALSE,
        FALSE, 100, TRUE, 'active',
        NOW(), NOW()
      )
      ON CONFLICT (endpoint_id) DO UPDATE SET updated_at = NOW()
      RETURNING endpoint_id
    ),
    snapshot_upsert AS (
      INSERT INTO synapse_service_health_snapshots
        (service_id, endpoint_id, health_score, p95_latency_ms,
         last_checked_at, updated_at)
      VALUES (${sqlLiteral(serviceId)}, ${sqlLiteral(
    endpointId
  )}, 100, 50, NOW(), NOW())
      ON CONFLICT (service_id, endpoint_id) DO UPDATE SET
        health_score = 100,
        p95_latency_ms = 50,
        last_checked_at = NOW(),
        updated_at = NOW()
      RETURNING service_id
    ),
    state_upsert AS (
      INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
      VALUES (${sqlLiteral(stateKey)}, ${sqlLiteral(
    healthPayload
  )}::jsonb, NOW())
      ON CONFLICT (state_key) DO UPDATE SET
        payload = ${sqlLiteral(healthPayload)}::jsonb,
        updated_at = NOW()
      RETURNING state_key
    )
    SELECT json_build_object('serviceId', ${sqlLiteral(
      serviceId
    )}, 'endpointId', ${sqlLiteral(endpointId)})
  `);
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

async function screenshotAdmin(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  evidence.screenshots.push(filePath);
  return filePath;
}

async function openAdminContext(adminAuth) {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const adminCookie = {
    name: config.adminCookieName,
    value: adminAuth.sessionToken,
    httpOnly: true,
    sameSite: "Lax",
  };
  await context.addCookies([
    IS_STAGING
      ? {
          ...adminCookie,
          domain: ".synapse-network.ai",
          path: "/",
          secure: true,
        }
      : {
          ...adminCookie,
          url: config.adminFront,
        },
  ]);
  if (adminAuth.csrfToken) {
    await context.addInitScript((csrfToken) => {
      window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
    }, adminAuth.csrfToken);
  }
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("Failed to fetch RSC payload")
    ) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  return { browser, page, consoleErrors };
}

async function captureReviewScreenshots(adminAuth, withdrawalId, prefix) {
  const { browser, page, consoleErrors } = await openAdminContext(adminAuth);
  try {
    await page.goto(
      `${config.adminFront}/withdrawal-reviews?q=${encodeURIComponent(
        withdrawalId
      )}`,
      { waitUntil: "networkidle", timeout: 45_000 }
    );
    await page
      .getByText(withdrawalId)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await screenshotAdmin(page, `${prefix}-review-queue`);
    await page
      .getByText(/Consumer withdrawal|Provider withdrawal/)
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
      .catch(() => null);
    const row = page.locator("tr", { hasText: withdrawalId }).first();
    if (await row.count()) {
      const detail = row.getByRole("button", { name: /详情|Detail/i }).first();
      if (await detail.isVisible().catch(() => false)) await detail.click();
    }
    await page.waitForTimeout(500);
    await screenshotAdmin(page, `${prefix}-review-detail`);
    if (consoleErrors.length > 0)
      throw new Error(
        `Admin console errors: ${consoleErrors.join(" | ").slice(0, 800)}`
      );
  } finally {
    await browser.close();
  }
}

async function adminDecision(adminAuth, withdrawalId, decision, scenario) {
  await waitForSafeTotpWindow({
    guardSeconds: 8,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  return httpJson(
    config.adminApi,
    `/api/admin/v1/withdrawal-reviews/${encodeURIComponent(
      withdrawalId
    )}/decision`,
    {
      method: "POST",
      session: adminAuth.sessionToken,
      csrfToken: adminAuth.csrfToken,
      otpCode: generateTotpCode(config.adminTotpSecret),
      body: { decision, note: `${scenario} ${runId()}` },
      scenario,
    }
  );
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
  seedServiceHealth(fixture.service.id, fixture.service.mockUrl);
  const requestId = `withdrawal-review-${runId()}-${suffix}`;
  const started = Date.now();
  const response = await fetch(
    `${config.gatewayBase}/api/v1/gateway/generate`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Credential": fixture.credential.token,
        "X-Service-Id": fixture.service.id,
        "X-Request-Id": requestId,
      },
      body: JSON.stringify({
        prompt: "Withdrawal review dogfood provider receivable top-up",
        payload: { query: `withdrawal review ${suffix}` },
      }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  addTrace({
    scenario: `provider-invoke-${suffix}`,
    method: "POST",
    path: "/api/v1/gateway/generate",
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

async function runProviderApprovalBaseline() {
  if (IS_STAGING) {
    if (!config.stagingFixture || !fs.existsSync(config.stagingFixture)) {
      throw new Error(
        "Staging provider review requires WITHDRAWAL_REVIEW_DOGFOOD_FIXTURE. " +
          "The fixture must contain authenticated consumer/provider tokens, a provider service id, and an agent credential token."
      );
    }
    const fixture = readJson(config.stagingFixture);
    pass("provider:staging-fixture-loaded", config.stagingFixture);
    return fixture;
  }
  const fixturePath = path.join(OUT_DIR, "provider-approval-fixture.json");
  const localConsumerKey =
    process.env.CONSUMER_KEY || ethers.Wallet.createRandom().privateKey;
  const localProviderKey =
    process.env.PROVIDER_KEY || ethers.Wallet.createRandom().privateKey;
  runCommand(
    "provider-approval-baseline",
    "npm",
    ["run", "e2e:admin-withdrawal-approval"],
    {
      ADMIN_WITHDRAWAL_APPROVAL_FIXTURE: fixturePath,
      ADMIN_WITHDRAWAL_APPROVAL_DEPOSIT_USDC: config.topupDepositUsdc,
      ADMIN_WITHDRAWAL_APPROVAL_AMOUNT_USDC:
        process.env.ADMIN_WITHDRAWAL_APPROVAL_AMOUNT_USDC || "2.000000",
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
  await invokeFixtureService(fixture, "provider-reject-a");
  await invokeFixtureService(fixture, "provider-reject-b");
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
  const adminAuth = fixture?.auth?.sessionToken
    ? {
        sessionToken: fixture.auth.sessionToken,
        csrfToken: fixture.auth.csrfToken || "",
      }
    : await loginAdmin();
  const consumerAuth =
    !IS_STAGING && fixture?.consumer?.token
      ? fixture.consumer
      : await authWallet(config.consumerKey, "consumer");
  const providerAuth =
    !IS_STAGING && fixture?.provider?.token
      ? fixture.provider
      : await authWallet(config.providerKey, "provider");

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
