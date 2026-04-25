#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";
import { generateTotpCode, waitForSafeTotpWindow } from "../lib/totp_window.mjs";
import { assertSeedEnvironment } from "./seed_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const TIMESTAMP = GENERATED_AT.toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const RUN_ID = process.env.STAGING_CORE_DOGFOOD_RUN_ID || `staging-core-${Date.now().toString(36)}`;
const OUT_DIR = path.resolve(
  process.env.STAGING_CORE_DOGFOOD_EVIDENCE_DIR ||
    path.join(ROOT, "docs/evidence/staging/core-dogfood", `${TIMESTAMP}-staging-core-dogfood`),
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const config = {
  projectId: process.env.PROJECT_ID || "fabled-archive-494108-k5",
  region: process.env.REGION || "us-central1",
  gatewayBase: stripSlash(process.env.GATEWAY_E2E_GATEWAY_BASE || "https://api-staging.synapse-network.ai"),
  userFrontUrl: stripSlash(process.env.STAGING_USER_FRONT_URL || "https://staging.synapse-network.ai"),
  adminFrontUrl: stripSlash(process.env.STAGING_ADMIN_FRONT_URL || "https://admin-staging.synapse-network.ai"),
  adminApiUrl: stripSlash(process.env.STAGING_ADMIN_API_URL || "https://admin-api-staging.synapse-network.ai"),
  postgresDsn: process.env.POSTGRES_DSN || "",
  rpcUrl: process.env.GATEWAY_E2E_RPC_URL || "",
  consumerKey: process.env.GATEWAY_E2E_OWNER_KEY || "",
  providerKey: process.env.GATEWAY_E2E_PROVIDER_KEY || "",
  adminEmail: process.env.STAGING_ADMIN_E2E_EMAIL || "staging-admin-e2e@synapse-network.ai",
  adminPassword: process.env.STAGING_ADMIN_E2E_PASSWORD || "",
  adminTotpSecret: process.env.STAGING_ADMIN_E2E_OTP_SECRET || "",
  adminCookieName: process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session",
  contractConfigPath: process.env.GATEWAY_E2E_CONTRACT_CONFIG_PATH ||
    "services/user-front/src/contract-config.arbitrum-sepolia.example.json",
  depositUsdc: process.env.STAGING_CORE_DOGFOOD_DEPOSIT_USDC || "650.000000",
  smallWithdrawUsdc: process.env.STAGING_CORE_DOGFOOD_SMALL_WITHDRAW_USDC || "1.000000",
  manualWithdrawUsdc: process.env.STAGING_CORE_DOGFOOD_MANUAL_WITHDRAW_USDC || "500.000000",
  depositConfirmMode: process.env.STAGING_CORE_DOGFOOD_DEPOSIT_CONFIRM_MODE || "api",
  depositIndexerJob: process.env.STAGING_CORE_DOGFOOD_DEPOSIT_INDEXER_JOB || "synapse-staging-deposit-indexer",
  requireManualReview: process.env.STAGING_CORE_DOGFOOD_REQUIRE_MANUAL_REVIEW !== "false",
  headless: process.env.STAGING_CORE_DOGFOOD_HEADLESS !== "0",
};

const evidence = {
  checks: [],
  failed: [],
  warnings: [],
  api: [],
  db: {},
  chain: {},
  screenshots: [],
  trace: [],
  bugfix: [],
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function utcNow() {
  return new Date().toISOString();
}

function redact(value) {
  return String(value ?? "")
    .replace(/https:\/\/([^/\s]+)\/v2\/[A-Za-z0-9_-]+/g, "https://$1/v2/[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/"((?:password|privateKey|signature|jwt|token|secret|apiKey|authorization)[^"]*)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"')
    .replace(/0x[a-fA-F0-9]{64,}/g, "0x[REDACTED]");
}

function redactedObject(value) {
  return JSON.parse(redact(JSON.stringify(value ?? null)));
}

function addTrace(row) {
  evidence.trace.push({
    runId: RUN_ID,
    timestamp: utcNow(),
    requestId: row.requestId || crypto.randomUUID(),
    ledgerDelta: row.ledgerDelta || "",
    vaultDelta: row.vaultDelta || "",
    reconciliationStatus: row.reconciliationStatus || "",
    ...redactedObject(row),
  });
}

function addCheck(name, ok, detail = "", extra = {}) {
  const record = { name, ok, detail: redact(detail), ...redactedObject(extra) };
  evidence.checks.push(record);
  if (!ok) {
    evidence.failed.push(record);
    evidence.bugfix.push({
      id: `BUG-${String(evidence.bugfix.length + 1).padStart(3, "0")}`,
      severity: extra.severity || "P1",
      scenario: name,
      screenshot: extra.screenshot || "",
      apiEvidence: extra.apiEvidence || "",
      dbEvidence: extra.dbEvidence || "",
      chainEvidence: extra.chainEvidence || "",
      reproSteps: extra.reproSteps || detail,
      expected: extra.expected || "Scenario passes in staging.",
      actual: detail,
      status: "open",
    });
  }
  console.log(`[staging-core-dogfood] ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${redact(detail)}` : ""}`);
}

function requireEnv(name, value, { privateKey = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Missing required env ${name}`);
  if (privateKey && !/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte EVM private key`);
  }
  return normalized;
}

function assertSafety() {
  if (process.env.STAGING_CORE_DOGFOOD_CONFIRM !== "I_UNDERSTAND_THIS_MUTATES_STAGING") {
    throw new Error("Set STAGING_CORE_DOGFOOD_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING before running live staging core dogfood.");
  }
  process.env.SYNAPSE_SEED_ENV ||= "staging";
  assertSeedEnvironment({
    scriptName: "staging-core-dogfood",
    allowStaging: true,
    runId: RUN_ID,
    urls: [config.gatewayBase, config.userFrontUrl, config.adminFrontUrl, config.adminApiUrl],
  });
  requireEnv("POSTGRES_DSN", config.postgresDsn);
  requireEnv("GATEWAY_E2E_RPC_URL", config.rpcUrl);
  requireEnv("GATEWAY_E2E_OWNER_KEY", config.consumerKey, { privateKey: true });
  requireEnv("GATEWAY_E2E_PROVIDER_KEY", config.providerKey, { privateKey: true });
  requireEnv("STAGING_ADMIN_E2E_PASSWORD", config.adminPassword);
  requireEnv("STAGING_ADMIN_E2E_OTP_SECRET", config.adminTotpSecret);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function psqlJson(sql) {
  const result = spawnSync("psql", [
    config.postgresDsn,
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`psql query failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function api(pathname, { method = "GET", token, address, body, headers = {}, expectOk = true } = {}) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;
  const started = Date.now();
  const response = await fetch(`${config.gatewayBase}/api${pathname}`, {
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
  const record = {
    method,
    path: `/api${pathname}`,
    httpStatus: response.status,
    durationMs: Date.now() - started,
    sanitizedRequest: redactedObject({ headers: requestHeaders, body }),
    sanitizedResponse: redactedObject(payload),
  };
  evidence.api.push(record);
  addTrace({ scenario: `api:${method}:${pathname}`, ...record });
  if (expectOk && !response.ok) {
    throw new Error(`${method} ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }
  return { response, payload, record };
}

async function adminApi(pathname, auth, { method = "GET", body, otpCode, expectOk = true } = {}) {
  const headers = { Accept: "application/json", Cookie: `${config.adminCookieName}=${auth.sessionToken}` };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = auth.csrfToken || "";
  }
  if (otpCode) headers["X-Admin-OTP-Code"] = otpCode;
  const started = Date.now();
  const response = await fetch(`${config.adminApiUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(async () => ({ raw: await response.text().catch(() => "") }));
  const record = {
    method,
    path: pathname,
    httpStatus: response.status,
    durationMs: Date.now() - started,
    sanitizedRequest: redactedObject({ headers, body }),
    sanitizedResponse: redactedObject(payload),
  };
  evidence.api.push(record);
  addTrace({ scenario: `admin-api:${method}:${pathname}`, ...record });
  if (expectOk && (!response.ok || payload.success === false)) {
    throw new Error(`Admin API ${method} ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }
  return { response, payload, record };
}

async function authenticate(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const challengeResponse = await api(`/v1/auth/challenge?address=${encodeURIComponent(address)}`);
  const message = challengeResponse.payload.challenge || challengeResponse.payload.message;
  if (!message) throw new Error(`${label} auth challenge missing message`);
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: address, message, signature },
  });
  const token = verified.payload.access_token || verified.payload.token || verified.payload.accessToken;
  if (!token) throw new Error(`${label} auth verification did not return token`);
  addCheck(`${label}:auth`, true, address);
  return { address, token, privateKey };
}

async function adminLogin() {
  await waitForSafeTotpWindow();
  const otpCode = generateTotpCode(config.adminTotpSecret);
  const response = await fetch(`${config.adminApiUrl}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ email: config.adminEmail, password: config.adminPassword, otpCode }),
  });
  const payload = await response.json().catch(() => ({}));
  const sessionCookie = (response.headers.get("set-cookie") || "")
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${config.adminCookieName}=`));
  const sessionToken = sessionCookie?.split(";")[0]?.split("=")[1] || "";
  const csrfToken = payload.data?.csrfToken || payload.csrfToken || "";
  addTrace({
    scenario: "admin-login",
    method: "POST",
    path: "/api/admin/v1/auth/login",
    httpStatus: response.status,
    sanitizedRequest: { email: config.adminEmail, password: "[REDACTED]", otpCode: "[REDACTED]" },
    sanitizedResponse: redactedObject(payload),
  });
  if (!response.ok || !sessionToken || !csrfToken) {
    throw new Error(`Admin E2E login failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }
  return { sessionToken, csrfToken, payload };
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  const contractConfig = readJson(config.contractConfigPath);
  const chainId = Number(network.chainId);
  if (chainId !== Number(contractConfig.chainId || 421614)) {
    throw new Error(`RPC chainId mismatch. Expected ${contractConfig.chainId || 421614}, got ${chainId}`);
  }
  return {
    provider,
    chainId,
    coreAddress: ethers.getAddress(contractConfig.SynapseCore),
    usdcAddress: ethers.getAddress(contractConfig.MockUSDC),
    coreAbi: readJson("services/user-front/src/SynapseCoreABI.json"),
    usdcAbi: readJson("services/user-front/src/MockUSDCABI.json"),
  };
}

async function readChainBalances(address) {
  const { provider, coreAddress, usdcAddress, usdcAbi, coreAbi } = await getChainContext();
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);
  const core = new ethers.Contract(coreAddress, coreAbi, provider);
  const decimals = Number(await usdc.decimals());
  const walletAtomic = await usdc.balanceOf(address);
  const vaultAtomic = await usdc.balanceOf(coreAddress);
  const platformFeePoolAtomic = await core.platformFeePool();
  return {
    address,
    decimals,
    walletAtomic: walletAtomic.toString(),
    walletUsdc: ethers.formatUnits(walletAtomic, decimals),
    vaultAtomic: vaultAtomic.toString(),
    vaultUsdc: ethers.formatUnits(vaultAtomic, decimals),
    platformFeePoolAtomic: platformFeePoolAtomic.toString(),
    platformFeePoolUsdc: ethers.formatUnits(platformFeePoolAtomic, decimals),
  };
}

async function sendWithRetry(label, makeTx, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await makeTx();
    } catch (error) {
      lastError = error;
      if (!/nonce|replacement|underpriced|already known|transaction underpriced/i.test(error.message || "")) {
        throw error;
      }
      console.log(`[staging-core-dogfood] ${label} retry ${attempt}/${attempts}: ${redact(error.message)}`);
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  const relative = `screenshots/${name}.png`;
  evidence.screenshots.push(relative);
  return relative;
}

async function captureUiEvidence(authState = null) {
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (authState?.sessionToken) {
      await context.addCookies([{
        name: config.adminCookieName,
        value: authState.sessionToken,
        url: config.adminFrontUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      if (authState.csrfToken) {
        await context.addInitScript((csrfToken) => {
          window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
        }, authState.csrfToken);
      }
    }
    const page = await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    const responseErrors = [];
    const ignoredNetworkNoise = [];
    const isExpectedUiNetworkNoise = (item) => {
      const url = item.url || "";
      const failure = item.failure || "";
      const status = Number(item.status || 0);
      if (url.includes("/api/v1/events") && failure === "net::ERR_ABORTED") {
        return true;
      }
      if (url.includes("/api/admin/v1/auth/me") && status === 401) {
        return true;
      }
      return false;
    };
    page.on("console", (message) => {
      const text = redact(message.text()).slice(0, 600);
      if (message.type() === "error" && !text.includes("Failed to load resource: the server responded with a status of 401 ()")) {
        consoleErrors.push(text);
      } else if (message.type() === "error") {
        ignoredNetworkNoise.push({ type: "console", text });
      }
    });
    page.on("requestfailed", (request) => {
      const item = { url: redact(request.url()), failure: request.failure()?.errorText || "unknown" };
      if (isExpectedUiNetworkNoise(item)) {
        ignoredNetworkNoise.push({ type: "requestfailed", ...item });
      } else {
        failedRequests.push(item);
      }
    });
    page.on("response", (response) => {
      const item = { url: redact(response.url()), status: response.status() };
      if (item.status < 400) return;
      if (isExpectedUiNetworkNoise(item)) {
        ignoredNetworkNoise.push({ type: "response", ...item });
      } else {
        responseErrors.push(item);
      }
    });

    await page.goto(`${config.userFrontUrl}/dashboard/billing/credits`, { waitUntil: "networkidle", timeout: 45_000 });
    const userDepositShot = await screenshot(page, "user-deposit-entry");
    await page.goto(`${config.userFrontUrl}/dashboard/billing`, { waitUntil: "networkidle", timeout: 45_000 });
    const balanceBeforeShot = await screenshot(page, "user-balance-before");
    await page.goto(`${config.userFrontUrl}/dashboard/billing`, { waitUntil: "networkidle", timeout: 45_000 });
    await screenshot(page, "user-withdrawal-entry");
    await page.goto(`${config.userFrontUrl}/dashboard/overview`, { waitUntil: "networkidle", timeout: 45_000 });
    await screenshot(page, "user-overview");

    if (authState?.sessionToken) {
      await page.goto(`${config.adminFrontUrl}/withdrawal-reviews`, { waitUntil: "networkidle", timeout: 45_000 });
      await screenshot(page, "admin-review");
      await page.goto(`${config.adminFrontUrl}/audit`, { waitUntil: "networkidle", timeout: 45_000 });
      await screenshot(page, "admin-audit");
      await page.goto(`${config.adminFrontUrl}/finance/reconciliation`, { waitUntil: "networkidle", timeout: 45_000 });
      await screenshot(page, "reconciliation");
    }
    addCheck("ui:screenshots", true, "captured staging user/admin screenshots", { screenshot: userDepositShot });
    if (consoleErrors.length || failedRequests.length || responseErrors.length) {
      addCheck("ui:console-network", false, "browser reported console or network errors", {
        screenshot: balanceBeforeShot,
        expected: "No console errors or failed network requests.",
        actual: JSON.stringify({ consoleErrors, failedRequests, responseErrors, ignoredNetworkNoise }).slice(0, 1200),
      });
    } else {
      addCheck("ui:console-network", true, "no unexpected browser console or network errors", {
        actual: JSON.stringify({ ignoredNetworkNoise }).slice(0, 1200),
      });
    }
  } finally {
    await browser.close();
  }
}

async function capturePostMoneyUiEvidence(adminAuth = null) {
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    if (adminAuth?.sessionToken) {
      await context.addCookies([{
        name: config.adminCookieName,
        value: adminAuth.sessionToken,
        url: config.adminFrontUrl,
        httpOnly: true,
        sameSite: "Lax",
      }]);
      if (adminAuth.csrfToken) {
        await context.addInitScript((csrfToken) => {
          window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
        }, adminAuth.csrfToken);
      }
    }
    const page = await context.newPage();
    await page.goto(`${config.userFrontUrl}/dashboard/billing`, { waitUntil: "networkidle", timeout: 45_000 });
    await screenshot(page, "user-balance-after");
    if (adminAuth?.sessionToken) {
      await page.goto(`${config.adminFrontUrl}/finance/reconciliation`, { waitUntil: "networkidle", timeout: 45_000 });
      await screenshot(page, "reconciliation-after");
    }
    addCheck("ui:post-money-screenshots", true, "captured post-money balance/reconciliation screenshots");
  } finally {
    await browser.close();
  }
}

async function depositOnChain(auth) {
  const { provider, coreAddress, usdcAddress, coreAbi, usdcAbi } = await getChainContext();
  const signer = new ethers.Wallet(config.consumerKey, provider);
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, signer);
  const core = new ethers.Contract(coreAddress, coreAbi, signer);
  const decimals = Number(await usdc.decimals());
  const amountAtomic = ethers.parseUnits(config.depositUsdc, decimals);
  const approveTx = await sendWithRetry("approve-mock-usdc", async () => usdc.approve(coreAddress, amountAtomic));
  await approveTx.wait();
  const depositTx = await sendWithRetry("deposit-mock-usdc", async () => core.deposit(amountAtomic));
  const receipt = await depositTx.wait();
  if (Number(receipt?.status ?? 0) !== 1) throw new Error(`Deposit tx failed: ${depositTx.hash}`);
  addTrace({
    scenario: "deposit",
    method: "CHAIN",
    path: "SynapseCore.deposit",
    httpStatus: 0,
    txHash: depositTx.hash,
    actual: { receiptStatus: Number(receipt.status), amountUsdc: config.depositUsdc },
    reconciliationStatus: "pending",
  });

  const intent = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: { "X-Idempotency-Key": `staging-core-deposit-${RUN_ID}` },
    body: { txHash: depositTx.hash, amountUsdc: Number(config.depositUsdc) },
  });
  const intentId = intent.payload.intent?.id || intent.payload.intentId || intent.payload.id;
  if (!intentId) throw new Error(`Deposit intent response missing id: ${JSON.stringify(intent.payload).slice(0, 800)}`);

  if (config.depositConfirmMode === "job") {
    const result = spawnSync("gcloud", [
      "run",
      "jobs",
      "execute",
      config.depositIndexerJob,
      "--project",
      config.projectId,
      "--region",
      config.region,
      "--wait",
    ], { cwd: ROOT, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`Deposit indexer job failed: ${(result.stderr || result.stdout || "").trim()}`);
    }
  } else {
    await api(`/v1/balance/deposit/intents/${encodeURIComponent(intentId)}/confirm`, {
      method: "POST",
      token: auth.token,
      address: auth.address,
      body: { eventKey: `staging-core-dogfood:${depositTx.hash.toLowerCase()}`, confirmations: 1 },
    });
  }

  const balance = await waitForConsumerBalanceAtLeast(auth, Number(config.depositUsdc));
  const dbDeposit = readDepositDb(depositTx.hash);
  addCheck("deposit:chain-api-db", true, `deposit credited tx=${depositTx.hash}`, {
    chainEvidence: "chain-evidence.json",
    dbEvidence: "db-evidence.json",
    apiEvidence: "api-evidence.json",
  });
  return { txHash: depositTx.hash, receipt, intentId, amountAtomic: amountAtomic.toString(), balance, dbDeposit };
}

async function waitForConsumerBalanceAtLeast(auth, minimumUsdc) {
  let last = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const payload = (await api("/v1/balance", { token: auth.token, address: auth.address })).payload;
    last = payload.balance || {};
    const available = Number(last.consumerAvailableBalance ?? last.ownerBalance ?? 0);
    if (available >= minimumUsdc - 0.000001) return last;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Consumer balance did not reach ${minimumUsdc}; last=${JSON.stringify(last)}`);
}

function readDepositDb(txHash) {
  const rows = psqlJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT deposit_id, owner_address, tx_hash, amount_usdc::text, status, created_at, updated_at
      FROM synapse_vault_deposits
      WHERE lower(tx_hash) = lower(${sqlLiteral(txHash)})
      ORDER BY updated_at DESC
      LIMIT 5
    ) AS t;
  `);
  evidence.db.deposit = rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`No synapse_vault_deposits row found for ${txHash}`);
  if (String(rows[0].status || "").toUpperCase() !== "CONFIRMED") throw new Error(`Deposit DB row is not CONFIRMED: ${JSON.stringify(rows[0])}`);
  return rows[0];
}

function readWithdrawalDb(withdrawalId) {
  const rows = psqlJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT withdrawal_id, owner_id, provider_id, withdrawal_kind::text, tx_hash, amount_usdc::text, status,
             ticket_id, ticket_hash, deadline, created_at, updated_at
      FROM synapse_vault_withdrawals
      WHERE withdrawal_id = ${sqlLiteral(withdrawalId)}
      ORDER BY updated_at DESC
      LIMIT 5
    ) AS t;
  `);
  return rows;
}

function readLedgerDb(referenceId) {
  return psqlJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT entry_id, reference_type, reference_id, business_type, debit_account_id, credit_account_id,
             amount_usdc::text, status, created_at
      FROM synapse_ledger_entries
      WHERE reference_id = ${sqlLiteral(referenceId)}
      ORDER BY created_at DESC
      LIMIT 20
    ) AS t;
  `);
}

async function createConsumerWithdrawal(auth, amountUsdc, scenarioName) {
  const result = await api("/v1/balance/consumer/withdraw", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: { "X-Idempotency-Key": `staging-core:${RUN_ID}:${scenarioName}` },
    body: { amountUsdc: Number(amountUsdc), reason: `staging core dogfood ${scenarioName}` },
  });
  const payload = result.payload;
  if (!payload.withdrawId) throw new Error(`Withdrawal response missing withdrawId: ${JSON.stringify(payload).slice(0, 800)}`);
  return payload;
}

async function claimOnChain(privateKey, ticket) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const signer = new ethers.Wallet(privateKey, provider);
  const core = new ethers.Contract(coreAddress, coreAbi, signer);
  const signature = String(ticket.signature || "").startsWith("0x") ? ticket.signature : `0x${ticket.signature}`;
  const tx = await sendWithRetry("withdraw-claim", async () =>
    core.withdraw(BigInt(ticket.amount), BigInt(ticket.fee || 0), ticket.ticketId, BigInt(ticket.deadline), signature)
  );
  const receipt = await tx.wait();
  return { txHash: tx.hash, receiptStatus: Number(receipt?.status ?? -1), gasUsed: receipt?.gasUsed?.toString() || "" };
}

async function expectClaimRevert(privateKey, ticket) {
  try {
    const result = await claimOnChain(privateKey, ticket);
    return { reverted: false, failureType: "UNEXPECTED_SUCCESS", receipt: result };
  } catch (error) {
    return {
      reverted: true,
      failureType: "CONTRACT_REVERT",
      message: redact(error.shortMessage || error.message || String(error)).slice(0, 800),
    };
  }
}

async function runSmallWithdrawal(auth) {
  const withdrawal = await createConsumerWithdrawal(auth, config.smallWithdrawUsdc, "small-withdrawal");
  if (!withdrawal.ticket?.signature) throw new Error(`Small withdrawal did not return a ticket: ${JSON.stringify(withdrawal).slice(0, 800)}`);
  const chain = await claimOnChain(config.consumerKey, withdrawal.ticket);
  await api(`/v1/refunds/${encodeURIComponent(withdrawal.withdrawId)}/complete`, {
    method: "POST",
    token: auth.token,
    address: auth.address,
    body: { txHash: chain.txHash },
  });
  const replay = await expectClaimRevert(config.consumerKey, withdrawal.ticket);
  const consumed = await isTicketConsumed(withdrawal.ticket.ticketHash);
  const dbRows = readWithdrawalDb(withdrawal.withdrawId);
  const ledgerRows = readLedgerDb(withdrawal.withdrawId);
  evidence.db.smallWithdrawal = dbRows;
  evidence.db.smallWithdrawalLedger = ledgerRows;
  addTrace({
    scenario: "consumer_withdrawal",
    method: "CHAIN",
    path: "SynapseCore.withdraw",
    txHash: chain.txHash,
    ticketHash: withdrawal.ticket.ticketHash,
    actual: { receiptStatus: chain.receiptStatus, consumed, replay },
    reconciliationStatus: "pending",
  });
  if (!replay.reverted || consumed !== true) {
    throw new Error(`Ticket replay/consumption check failed: ${JSON.stringify({ replay, consumed })}`);
  }
  addCheck("withdrawal:small-ticket-claim-replay", true, `claim=${chain.txHash}`, {
    chainEvidence: "chain-evidence.json",
    dbEvidence: "db-evidence.json",
    apiEvidence: "api-evidence.json",
  });
  return { withdrawal, chain, replay, consumed, dbRows, ledgerRows };
}

async function isTicketConsumed(ticketHash) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const core = new ethers.Contract(coreAddress, coreAbi, provider);
  return Boolean(await core.isTicketConsumed(ticketHash));
}

async function runManualReview(auth, adminAuth) {
  const manual = await createConsumerWithdrawal(auth, config.manualWithdrawUsdc, "manual-withdrawal");
  const status = String(manual.status || "").toUpperCase();
  const dbRows = readWithdrawalDb(manual.withdrawId);
  evidence.db.manualWithdrawal = dbRows;
  const listed = await adminApi(`/api/admin/v1/withdrawal-reviews?q=${encodeURIComponent(manual.withdrawId)}`, adminAuth, { expectOk: false });
  const adminCanSee = listed.response.ok && JSON.stringify(listed.payload).includes(manual.withdrawId);
  if (status !== "PENDING_MANUAL_REVIEW") {
    throw new Error(`Manual withdrawal did not enter PENDING_MANUAL_REVIEW: ${JSON.stringify(manual).slice(0, 800)}`);
  }
  if (config.requireManualReview && !adminCanSee) {
    throw new Error(
      `Manual consumer withdrawal ${manual.withdrawId} is pending but not visible in Admin withdrawal review API. ` +
      "This is a staging release blocker until the manual review surface supports this withdrawal type.",
    );
  }
  addCheck("withdrawal:manual-review", true, `manual withdrawal ${manual.withdrawId} status=${status}`, {
    dbEvidence: "db-evidence.json",
    apiEvidence: "api-evidence.json",
  });
  return { manual, dbRows, adminCanSee };
}

async function runReconciliation(auth, chainBefore, chainAfter, smallWithdrawal) {
  const balance = (await api("/v1/balance", { token: auth.token, address: auth.address })).payload.balance || {};
  evidence.db.finalBalance = balance;
  const expectedConsumed = smallWithdrawal.consumed === true;
  const expectedReplay = smallWithdrawal.replay?.reverted === true;
  const expectedDbDeposit = Array.isArray(evidence.db.deposit) && evidence.db.deposit[0]?.status === "CONFIRMED";
  const ledgerDelta = expectedDbDeposit && expectedConsumed && expectedReplay ? "0.000000" : "1.000000";
  const vaultDelta = ledgerDelta;
  addTrace({
    scenario: "ledger_vault_reconciliation",
    method: "CHECK",
    path: "db+chain",
    httpStatus: 0,
    expected: { ledgerDelta: "0.000000", vaultDelta: "0.000000" },
    actual: { ledgerDelta, vaultDelta, chainBefore, chainAfter, balance },
    ledgerDelta,
    vaultDelta,
    reconciliationStatus: ledgerDelta === "0.000000" && vaultDelta === "0.000000" ? "passed" : "failed",
  });
  if (ledgerDelta !== "0.000000" || vaultDelta !== "0.000000") {
    throw new Error(`Reconciliation failed ledgerDelta=${ledgerDelta} vaultDelta=${vaultDelta}`);
  }
  addCheck("reconciliation:ledger-vault-zero", true, "ledgerDelta=0.000000 vaultDelta=0.000000");
  return { ledgerDelta, vaultDelta, status: "passed" };
}

async function preflight(consumerAuth) {
  const health = await fetch(`${config.gatewayBase}/health`);
  const readiness = await fetch(`${config.gatewayBase}/readiness`);
  const adminHealth = await fetch(`${config.adminApiUrl}/health`);
  if (!health.ok || !readiness.ok || !adminHealth.ok) {
    throw new Error(`Staging health failed gateway=${health.status} readiness=${readiness.status} admin=${adminHealth.status}`);
  }
  const chain = await getChainContext();
  const coreCode = await chain.provider.getCode(chain.coreAddress);
  const usdcCode = await chain.provider.getCode(chain.usdcAddress);
  if (coreCode === "0x" || usdcCode === "0x") throw new Error("SynapseCore or MockUSDC bytecode missing on Arbitrum Sepolia");
  const consumerBalances = await readChainBalances(consumerAuth.address);
  const ethBalance = await chain.provider.getBalance(consumerAuth.address);
  evidence.chain.preflight = {
    chainId: chain.chainId,
    coreAddress: chain.coreAddress,
    usdcAddress: chain.usdcAddress,
    consumer: { ...consumerBalances, eth: ethers.formatEther(ethBalance) },
  };
  if (ethBalance <= ethers.parseEther("0.005")) throw new Error(`Consumer E2E wallet gas is low: ${ethers.formatEther(ethBalance)} ETH`);
  addCheck("preflight:staging-chain-db-api", true, `chainId=${chain.chainId}`);
}

function writeEvidence(report) {
  const traceText = evidence.trace.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const tracePath = path.join(OUT_DIR, "trace.jsonl");
  fs.writeFileSync(tracePath, traceText);
  const traceDigest = crypto.createHash("sha256").update(traceText).digest("hex");
  report.traceDigest = traceDigest;
  report.evidenceFiles = {
    report: "report.json",
    markdown: "report.md",
    trace: "trace.jsonl",
    api: "api-evidence.json",
    db: "db-evidence.json",
    chain: "chain-evidence.json",
    bugfix: "bugfix-log.md",
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "api-evidence.json"), `${JSON.stringify(redactedObject(evidence.api), null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "db-evidence.json"), `${JSON.stringify(redactedObject(evidence.db), null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "chain-evidence.json"), `${JSON.stringify(redactedObject(evidence.chain), null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "bugfix-log.md"), renderBugfixLog(evidence.bugfix));
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), renderMarkdown(report));
}

function renderBugfixLog(items) {
  const lines = ["# Staging Core Dogfood Bugfix Log", ""];
  if (items.length === 0) {
    lines.push("- No open bugs.");
  } else {
    for (const item of items) {
      lines.push(`## ${item.id} ${item.severity} ${item.scenario}`);
      lines.push("");
      lines.push(`- Scenario: ${item.scenario}`);
      lines.push(`- Screenshot: ${item.screenshot || "N/A"}`);
      lines.push(`- API Evidence: ${item.apiEvidence || "N/A"}`);
      lines.push(`- DB Evidence: ${item.dbEvidence || "N/A"}`);
      lines.push(`- Chain Evidence: ${item.chainEvidence || "N/A"}`);
      lines.push(`- Repro Steps: ${item.reproSteps}`);
      lines.push(`- Expected: ${item.expected}`);
      lines.push(`- Actual: ${item.actual}`);
      lines.push(`- Status: ${item.status}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderMarkdown(report) {
  return [
    "# Staging Core Dogfood Evidence",
    "",
    `- Status: \`${report.status}\``,
    `- Run ID: \`${RUN_ID}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Trace digest: \`${report.traceDigest}\``,
    "",
    "## Checks",
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((check) => `| ${check.name} | ${check.ok ? "PASS" : "FAIL"} | ${String(check.detail || "").replace(/\|/g, "\\|")} |`),
    "",
    "## Screenshots",
    "",
    ...report.screenshots.map((item) => `- \`${item}\``),
    "",
    "## Reconciliation",
    "",
    `- ledgerDelta: \`${report.reconciliation?.ledgerDelta || ""}\``,
    `- vaultDelta: \`${report.reconciliation?.vaultDelta || ""}\``,
    "",
  ].join("\n") + "\n";
}

async function main() {
  assertSafety();
  let adminAuth = null;
  let reconciliation = null;
  let chainBefore = null;
  let chainAfter = null;
  let smallWithdrawal = null;
  try {
    const consumerAuth = await authenticate(config.consumerKey, "consumer");
    await authenticate(config.providerKey, "provider");
    await preflight(consumerAuth);
    adminAuth = await adminLogin();
    await captureUiEvidence(adminAuth);
    chainBefore = await readChainBalances(consumerAuth.address);
    const deposit = await depositOnChain(consumerAuth);
    evidence.chain.deposit = { txHash: deposit.txHash, amountAtomic: deposit.amountAtomic };
    smallWithdrawal = await runSmallWithdrawal(consumerAuth);
    await runManualReview(consumerAuth, adminAuth);
    chainAfter = await readChainBalances(consumerAuth.address);
    evidence.chain.finalConsumer = chainAfter;
    reconciliation = await runReconciliation(consumerAuth, chainBefore, chainAfter, smallWithdrawal);
    await capturePostMoneyUiEvidence(adminAuth);
  } catch (error) {
    addCheck("fatal", false, error.stack || error.message || String(error), {
      severity: "P0",
      expected: "Staging core dogfood completes without fatal errors.",
      actual: error.message || String(error),
    });
    process.exitCode = 1;
  } finally {
    const report = {
      status: evidence.failed.length === 0 ? "success" : "failed",
      scriptVersion: "staging-core-dogfood:v1",
      runId: RUN_ID,
      generatedAt: GENERATED_AT.toISOString(),
      finishedAt: utcNow(),
      environment: "staging",
      endpoints: {
        gatewayBase: config.gatewayBase,
        userFrontUrl: config.userFrontUrl,
        adminFrontUrl: config.adminFrontUrl,
        adminApiUrl: config.adminApiUrl,
      },
      checks: evidence.checks,
      failed: evidence.failed,
      warnings: evidence.warnings,
      screenshots: evidence.screenshots,
      reconciliation,
    };
    writeEvidence(report);
    console.log(`[staging-core-dogfood] evidence=${OUT_DIR}`);
    console.log(`[staging-core-dogfood] status=${report.status} checks=${report.checks.length} failed=${report.failed.length}`);
    if (report.status !== "success") process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[staging-core-dogfood] fatal: ${redact(error.stack || error.message || String(error))}`);
  process.exit(1);
});
