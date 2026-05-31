#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";
import {
  projectIdFromEnv,
  readDotenvFile,
  readStagingSecret,
  requireStagingConfirmation,
} from "../lib/e2e_env_guard.mjs";
import {
  assertBillingRowStatus,
  assertCreditsPage,
  captureScreenshot,
  installAuth,
  queryDepositIndexerJobLogs,
  queryGatewayLogs,
} from "./staging_webhook_deposit_helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const TIMESTAMP = GENERATED_AT.toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const RUN_ID =
  process.env.STAGING_WEBHOOK_DEPOSIT_RUN_ID ||
  `staging-webhook-deposit-${Date.now().toString(36)}`;
const OUT_DIR = path.resolve(
  process.env.STAGING_WEBHOOK_DEPOSIT_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "docs/evidence/staging/webhook-deposit",
      `${TIMESTAMP}-staging-webhook-deposit`
    )
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const DEFAULT_CONTRACT_CONFIG = path.join(
  ROOT,
  "services/user-front/src/contract-config.arbitrum-sepolia.example.json"
);
const BASE_PROJECT_ID = env(
  "PROJECT_ID",
  projectIdFromEnv() || "fabled-archive-494108-k5"
);

loadEnvFile(
  process.env.ENV_FILE || path.join(ROOT, "services/gateway/.env.staging")
);

const config = {
  projectId: BASE_PROJECT_ID,
  region: env("REGION", "us-central1"),
  gatewayServiceName: env("STAGING_GATEWAY_SERVICE_NAME", "synapse-staging-gateway"),
  gatewayBase: stripSlash(
    env("GATEWAY_E2E_GATEWAY_BASE", "https://api-staging.synapse-network.ai")
  ),
  userFrontUrl: stripSlash(
    env("STAGING_USER_FRONT_URL", "https://staging.synapse-network.ai")
  ),
  rpcUrl: envOrSecret("GATEWAY_E2E_RPC_URL", "synapse-staging-arbitrum-sepolia-rpc-url", {
    invalidSubstrings: ["YOUR_ALCHEMY_KEY"],
  }),
  postgresDsn: env("POSTGRES_DSN") || readSecret("synapse-staging-postgres-dsn"),
  consumerKey: envOrSecret(
    "GATEWAY_E2E_OWNER_KEY",
    "synapse-staging-e2e-consumer-private-key",
    { invalidSubstrings: ["YourStagingE2EOwnerPrivateKey"] }
  ),
  depositUsdc: env("STAGING_WEBHOOK_DEPOSIT_USDC", "5.000000"),
  chainId: Number(env("CHAIN_ID", "421614")),
  creditSloSec: Number(env("STAGING_WEBHOOK_DEPOSIT_CREDIT_SLO_SEC", "120")),
  logLookbackSec: Number(env("STAGING_WEBHOOK_DEPOSIT_LOG_LOOKBACK_SEC", "180")),
  contractConfigPath: path.resolve(
    env("GATEWAY_E2E_CONTRACT_CONFIG_PATH", DEFAULT_CONTRACT_CONFIG)
  ),
  headless: env("STAGING_WEBHOOK_DEPOSIT_HEADLESS", "1") !== "0",
};

config.consumerKey = normalizePrivateKey(config.consumerKey);

const evidence = {
  checks: [],
  failed: [],
  api: [],
  db: {},
  chain: {},
  logs: {},
  browser: {
    console: [],
    pageErrors: [],
    apiResponses: [],
    stateSnapshots: [],
  },
  screenshots: [],
  screenshotEvidence: {},
  trace: [],
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim()
    ? process.env[name].trim()
    : fallback;
}

function envOrSecret(name, secretId, { invalidSubstrings = [] } = {}) {
  const candidate = env(name, "");
  const looksPlaceholder =
    !candidate ||
    invalidSubstrings.some((substring) => candidate.includes(substring));
  return looksPlaceholder ? readSecret(secretId) : candidate;
}

function normalizePrivateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function parseGatewayUtcTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(`${raw.replace(" ", "T")}Z`);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function loadEnvFile(filePath) {
  const values = readDotenvFile(filePath);
  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function redact(value) {
  if (value == null) return value;
  return String(value)
    .replace(
      /https:\/\/([^/\s]+)\/v2\/[A-Za-z0-9_-]+/g,
      "https://$1/v2/[REDACTED]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/0x[a-fA-F0-9]{64,}/g, "0x[REDACTED]")
    .replace(
      /(authorization|password|private[_-]?key|api[_-]?key|secret|token)\s*[:=]\s*[^,\s"']+/gi,
      "$1=[REDACTED]"
    );
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [
        key,
        /password|privateKey|signature|secret|token|authorization/i.test(key)
          ? "[REDACTED]"
          : sanitize(next),
      ])
    );
  }
  if (typeof value === "string") return redact(value);
  return value;
}

function utcNow() {
  return new Date().toISOString();
}

function addTrace(row) {
  evidence.trace.push(
    sanitize({
      runId: RUN_ID,
      timestamp: utcNow(),
      ...row,
    })
  );
}

function addCheck(name, ok, detail = "", extra = {}) {
  const row = sanitize({ name, ok: Boolean(ok), detail, ...extra });
  evidence.checks.push(row);
  if (!row.ok) evidence.failed.push(row);
  console.log(
    `[staging-webhook-deposit] ${row.ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${detail}` : ""
    }`
  );
}

function fail(message) {
  throw new Error(message);
}

function readSecret(secretId) {
  return readStagingSecret(secretId, {
    projectId: BASE_PROJECT_ID,
    required: true,
  });
}

function assertSafety() {
  requireStagingConfirmation(
    "STAGING_WEBHOOK_DEPOSIT_CONFIRM",
    "I_UNDERSTAND_THIS_MUTATES_STAGING"
  );
  if (process.env.SYNAPSE_E2E_ENV !== "staging") {
    throw new Error("SYNAPSE_E2E_ENV must be staging");
  }
  if (process.env.ALLOW_GCP_SECRET_MANAGER !== "1") {
    throw new Error("ALLOW_GCP_SECRET_MANAGER=1 is required");
  }
  if (!config.postgresDsn.includes("127.0.0.1") && !config.postgresDsn.includes("localhost")) {
    throw new Error("POSTGRES_DSN must point to Cloud SQL Auth Proxy on localhost");
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(config.consumerKey)) {
    throw new Error("GATEWAY_E2E_OWNER_KEY must be a valid 0x private key");
  }
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function psqlJson(sql) {
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
    throw new Error(`psql query failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return JSON.parse(result.stdout.trim() || "null");
}

function selectJson(sql) {
  return (
    psqlJson(`SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (${sql}) AS t;`) || []
  );
}

async function api(
  pathname,
  { method = "GET", token, address, body, headers = {}, expectOk = true } = {}
) {
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
    sanitizedRequest: sanitize({ headers: requestHeaders, body }),
    sanitizedResponse: sanitize(payload),
  };
  evidence.api.push(record);
  addTrace({ scenario: `api:${method}:${pathname}`, ...record });
  if (expectOk && !response.ok) {
    throw new Error(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`
    );
  }
  return { response, payload, record };
}

async function authenticate(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const challenge = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(address)}`
  );
  const message = challenge.payload.challenge || challenge.payload.message;
  if (!message) fail("auth challenge missing message");
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: address, message, signature },
  });
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  if (!token) fail("auth verification missing token");
  return {
    address: address.toLowerCase(),
    token,
    expiresAt: Date.now() + 3600_000,
  };
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  const contractConfig = JSON.parse(fs.readFileSync(config.contractConfigPath, "utf8"));
  if (Number(network.chainId) !== Number(contractConfig.chainId || config.chainId)) {
    throw new Error(
      `RPC chain mismatch expected=${contractConfig.chainId || config.chainId} got=${network.chainId}`
    );
  }
  return {
    provider,
    chainId: Number(network.chainId),
    coreAddress: ethers.getAddress(contractConfig.SynapseCore),
    usdcAddress: ethers.getAddress(contractConfig.MockUSDC),
    coreAbi: JSON.parse(
      fs.readFileSync(path.join(ROOT, "services/user-front/src/SynapseCoreABI.json"), "utf8")
    ),
    usdcAbi: JSON.parse(
      fs.readFileSync(path.join(ROOT, "services/user-front/src/MockUSDCABI.json"), "utf8")
    ),
  };
}

async function sendWithRetry(label, makeTx, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await makeTx();
    } catch (error) {
      lastError = error;
      if (
        !/nonce|replacement|underpriced|already known|transaction underpriced/i.test(
          error.message || ""
        )
      ) {
        throw error;
      }
      console.log(
        `[staging-webhook-deposit] ${label} retry ${attempt}/${attempts}: ${redact(
          error.message || String(error)
        )}`
      );
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

function readDepositRows(txHash) {
  return selectJson(`
    SELECT deposit_id, owner_id, owner_address, target_account_id, tx_hash,
           amount_usdc::text AS amount_usdc, status, block_number,
           request_id, created_at::text AS created_at, updated_at::text AS updated_at
    FROM synapse_vault_deposits
    WHERE lower(tx_hash) = lower(${sqlLiteral(txHash)})
    ORDER BY created_at DESC
  `);
}

function readBalanceRow(accountId) {
  const rows = selectJson(`
    SELECT account_id, available_balance::text AS available_balance,
           pending_balance::text AS pending_balance,
           frozen_balance::text AS frozen_balance,
           updated_at::text AS updated_at
    FROM synapse_account_balances
    WHERE account_id = ${sqlLiteral(accountId)}
  `);
  return (
    rows[0] || {
      account_id: accountId,
      available_balance: "0.000000",
      pending_balance: "0.000000",
      frozen_balance: "0.000000",
      updated_at: "",
    }
  );
}

async function depositOnChain(auth) {
  const { provider, coreAddress, usdcAddress, coreAbi, usdcAbi } = await getChainContext();
  const signer = new ethers.Wallet(config.consumerKey, provider);
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, signer);
  const core = new ethers.Contract(coreAddress, coreAbi, signer);
  const decimals = Number(await usdc.decimals());
  const walletAtomicBefore = await usdc.balanceOf(auth.address);
  const amountAtomic = ethers.parseUnits(config.depositUsdc, decimals);
  if (walletAtomicBefore < amountAtomic) {
    throw new Error(
      `insufficient MockUSDC for staging deposit: have=${ethers.formatUnits(walletAtomicBefore, decimals)} need=${config.depositUsdc}`
    );
  }
  const approveTx = await sendWithRetry("approve-mock-usdc", async () =>
    usdc.approve(coreAddress, amountAtomic)
  );
  await approveTx.wait();
  const depositTx = await sendWithRetry("deposit-mock-usdc", async () =>
    core.deposit(amountAtomic)
  );
  const receipt = await depositTx.wait();
  if (Number(receipt?.status ?? 0) !== 1) {
    throw new Error(`deposit tx failed: ${depositTx.hash}`);
  }
  evidence.chain.deposit = sanitize({
    txHash: depositTx.hash,
    amountAtomic: amountAtomic.toString(),
    amountUsdc: config.depositUsdc,
    blockNumber: Number(receipt.blockNumber || 0),
  });
  addTrace({
    scenario: "chain:deposit",
    txHash: depositTx.hash,
    amountUsdc: config.depositUsdc,
    blockNumber: Number(receipt.blockNumber || 0),
  });
  return { txHash: depositTx.hash, amountAtomic, receipt };
}

function readServiceRevision() {
  const raw = execFileSync(
    "gcloud",
    [
      "run",
      "services",
      "describe",
      config.gatewayServiceName,
      `--project=${config.projectId}`,
      `--region=${config.region}`,
      "--format=json",
    ],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const payload = JSON.parse(raw);
  return payload.status?.latestReadyRevisionName || "";
}

async function snapshotBrowserState(page, label) {
  const state = await page.evaluate(() => ({
    href: globalThis.location.href,
    title: globalThis.document.title,
    authSession: globalThis.localStorage.getItem("a2a_auth_session"),
    wagmiStore: globalThis.localStorage.getItem("wagmi.store"),
    recentConnectorId: globalThis.localStorage.getItem("wagmi.recentConnectorId"),
    injectedConnected: globalThis.localStorage.getItem("wagmi.injected.connected"),
    disconnected: globalThis.localStorage.getItem("wagmi.injected.disconnected"),
    body: globalThis.document.body.innerText.slice(0, 2400),
  }));
  evidence.browser.stateSnapshots.push(sanitize({ label, ...state }));
}

async function main() {
  assertSafety();
  let browser;
  try {
    const auth = await authenticate(config.consumerKey);
    const accountId = `consumer_wallet::${auth.address}`;
    const revision = readServiceRevision();
    const beforeBalance = readBalanceRow(accountId);
    evidence.db.beforeBalance = beforeBalance;
    evidence.logs.gatewayRevision = revision;

    const { txHash } = await depositOnChain(auth);
    const proofStartAt = new Date();
    const intentResponse = await api("/v1/balance/deposit/intent", {
      method: "POST",
      token: auth.token,
      address: auth.address,
      headers: { "X-Idempotency-Key": `staging-webhook-deposit-${RUN_ID}` },
      body: { txHash, amountUsdc: Number(config.depositUsdc) },
    });
    const intent = intentResponse.payload.intent || {};
    const depositIntentId = intent.id || intent.depositId;
    if (!depositIntentId) {
      throw new Error(`deposit intent response missing id: ${JSON.stringify(intentResponse.payload).slice(0, 800)}`);
    }
    const intentCreatedAt = String(intent.createdAt || utcNow());
    const pendingRows = readDepositRows(txHash);
    if (pendingRows.length !== 1) {
      throw new Error(`deposit row lookup mismatch after intent: ${JSON.stringify(pendingRows).slice(0, 800)}`);
    }
    const initialIntentStatus = String(intent.status || "").toUpperCase();
    const initialSqlStatus = String(pendingRows[0].status || "").toUpperCase();
    const immediateWebhookConfirm =
      initialIntentStatus === "PENDING_CONFIRMATION" && initialSqlStatus === "CONFIRMED";
    if (
      initialSqlStatus !== "PENDING_CONFIRMATION" &&
      !immediateWebhookConfirm
    ) {
      throw new Error(
        `deposit row entered unexpected initial state intent=${initialIntentStatus} sql=${initialSqlStatus} rows=${JSON.stringify(pendingRows).slice(0, 800)}`
      );
    }
    const pendingBalance = readBalanceRow(accountId);
    evidence.db.pending = { deposits: pendingRows, balance: pendingBalance };
    addCheck("deposit:intent-pending", true, `intent=${depositIntentId}`, {
      txHash,
      sqlStatusBefore: initialIntentStatus || initialSqlStatus,
      sqlStatusFirstRead: initialSqlStatus,
      immediateWebhookConfirm,
    });

    browser = await chromium.launch({ headless: config.headless, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 840 } });
    await installAuth(context, auth, { chainId: config.chainId, rpcUrl: config.rpcUrl });
    const page = await context.newPage();
    page.on("console", (message) => {
      evidence.browser.console.push(
        sanitize({ type: message.type(), text: message.text() })
      );
    });
    page.on("pageerror", (error) => {
      evidence.browser.pageErrors.push(
        sanitize({ error: error.stack || error.message || String(error) })
      );
    });
    page.on("response", async (response) => {
      const url = response.url();
      if (!url.includes("/api/v1/balance")) return;
      let body = "";
      try {
        body = await response.text();
      } catch {
        body = "";
      }
      evidence.browser.apiResponses.push(
        sanitize({
          url,
          status: response.status(),
          body: body.slice(0, 1600),
        })
      );
    });
    if (!immediateWebhookConfirm) {
      const pendingBillingText = await assertBillingRowStatus(
        page,
        config.userFrontUrl,
        txHash,
        "Pending",
        config.depositUsdc
      );
      await captureScreenshot(page, OUT_DIR, evidence, "billing-pending.png", sanitize({
        expectedStatus: "Pending",
        txHash,
        depositIntentId,
        sqlStatusBefore: initialIntentStatus || initialSqlStatus,
        actualDom: pendingBillingText,
      }));
      const pendingCredits = await assertCreditsPage(
        page,
        config.userFrontUrl,
        beforeBalance.available_balance,
        pendingBalance.pending_balance
      );
      await snapshotBrowserState(page, "credits-pending");
      await captureScreenshot(page, OUT_DIR, evidence, "credits-pending.png", sanitize({
        expectedAvailable: beforeBalance.available_balance,
        expectedPending: pendingBalance.pending_balance,
        txHash,
        depositIntentId,
        bodyText: pendingCredits.bodyText,
      }));
    } else {
      const fastConfirmedBillingText = await assertBillingRowStatus(
        page,
        config.userFrontUrl,
        txHash,
        "Completed",
        config.depositUsdc
      );
      await captureScreenshot(page, OUT_DIR, evidence, "billing-pending.png", sanitize({
        expectedStatus: "Pending",
        observedStatus: "Completed-fastpath",
        txHash,
        depositIntentId,
        sqlStatusBefore: initialIntentStatus,
        sqlStatusFirstRead: initialSqlStatus,
        actualDom: fastConfirmedBillingText,
      }));
      await page.goto(`${config.userFrontUrl}/dashboard/billing/credits`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await snapshotBrowserState(page, "credits-pending-fastpath");
      const fastCreditsBody = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
      await captureScreenshot(page, OUT_DIR, evidence, "credits-pending.png", sanitize({
        expectedAvailable: beforeBalance.available_balance,
        expectedPending: pendingBalance.pending_balance,
        observedStatus: "Completed-fastpath",
        txHash,
        depositIntentId,
        bodyText: fastCreditsBody.slice(0, 1600),
      }));
    }

    const deadline = Date.now() + config.creditSloSec * 1000;
    let webhookLog = null;
    let creditLog = null;
    let finalDeposit = null;
    let finalBalance = null;
    let finalApiBalance = null;

    while (Date.now() < deadline) {
      const logs = await queryGatewayLogs(
        config.projectId,
        config.gatewayServiceName,
        proofStartAt.toISOString(),
        txHash,
        depositIntentId
      );
      const webhookCandidate = logs.find((row) =>
        String(row.textPayload || "").includes("ALCHEMY_DEPOSIT_WEBHOOK_RECEIVED")
      );
      const creditCandidate = logs.find((row) =>
        String(row.textPayload || "").includes("DEPOSIT_CREDITED") ||
        String(row.textPayload || "").toLowerCase().includes("deposit credited")
      );
      if (webhookCandidate) webhookLog = webhookCandidate;
      if (creditCandidate) creditLog = creditCandidate;

      const depositRows = readDepositRows(txHash);
      const balanceRow = readBalanceRow(accountId);
      const balancePayload = (
        await api("/v1/balance", { token: auth.token, address: auth.address })
      ).payload.balance;
      evidence.db.poll = { deposits: depositRows, balance: balanceRow };
      evidence.apiBalance = sanitize(balancePayload);

      if (
        depositRows[0] &&
        String(depositRows[0].status || "").toUpperCase() === "CONFIRMED" &&
        Number(balanceRow.available_balance) >=
          Number(beforeBalance.available_balance) + Number(config.depositUsdc) - 0.000001
      ) {
        finalDeposit = depositRows[0];
        finalBalance = balanceRow;
        finalApiBalance = balancePayload;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!finalDeposit || !finalBalance || !finalApiBalance) {
      throw new Error(`deposit did not confirm within ${config.creditSloSec}s`);
    }
    if (!webhookLog) {
      throw new Error("deposit credited without matching webhook log evidence");
    }
    if (creditLog && webhookLog.timestamp > creditLog.timestamp) {
      throw new Error(
        `webhook log arrived after credit log webhook=${webhookLog.timestamp} credit=${creditLog.timestamp}`
      );
    }
    const jobLogs = await queryDepositIndexerJobLogs(config.projectId, proofStartAt.toISOString());
    if (jobLogs.length > 0) {
      throw new Error(
        `deposit-indexer job executed during webhook lane window; webhook proof is ambiguous`
      );
    }

    const creditedAt = finalDeposit.updated_at || creditLog?.timestamp || "";
    const webhookLogAt = webhookLog.timestamp || "";
    const creditedAtDate = parseGatewayUtcTimestamp(creditedAt);
    const intentCreatedAtDate = parseGatewayUtcTimestamp(intentCreatedAt);
    const creditedDelaySec = Math.round(
      (
        (creditedAtDate?.getTime() ?? Date.now()) -
        (intentCreatedAtDate?.getTime() ?? proofStartAt.getTime())
      ) /
        1000
    );
    if (creditedDelaySec > config.creditSloSec) {
      throw new Error(
        `credited delay exceeded ${config.creditSloSec}s: ${creditedDelaySec}s`
      );
    }

    evidence.db.final = { deposit: finalDeposit, balance: finalBalance };
    evidence.logs.webhook = webhookLog;
    evidence.logs.credit = creditLog;
    evidence.logs.depositIndexerJob = jobLogs;
    evidence.chain.result = {
      txHash,
      ownerAddress: auth.address,
      amountUsdc: config.depositUsdc,
      depositIntentId,
      intentCreatedAt,
      webhookLogAt,
      creditedAt,
      creditedDelaySec,
    };

    const completedBillingText = await assertBillingRowStatus(
      page,
      config.userFrontUrl,
      txHash,
      "Completed",
      config.depositUsdc
    );
    await captureScreenshot(page, OUT_DIR, evidence, "billing-completed.png", sanitize({
      expectedStatus: "Completed",
      txHash,
      depositIntentId,
      creditedDelaySec,
      actualDom: completedBillingText,
    }));
    const completedCredits = await assertCreditsPage(
      page,
      config.userFrontUrl,
      finalBalance.available_balance,
      finalBalance.pending_balance
    );
    await snapshotBrowserState(page, "credits-completed");
    await captureScreenshot(page, OUT_DIR, evidence, "credits-completed.png", sanitize({
      expectedAvailable: finalBalance.available_balance,
      expectedPending: finalBalance.pending_balance,
      txHash,
      depositIntentId,
      creditedDelaySec,
      bodyText: completedCredits.bodyText,
    }));

    addCheck("deposit:webhook-credit-slo", true, `${creditedDelaySec}s`, {
      txHash,
      depositIntentId,
      ownerAddress: auth.address,
      amountUsdc: config.depositUsdc,
      intentCreatedAt,
      webhookLogAt,
      creditedAt,
      creditedDelaySec,
      sqlStatusBefore: initialIntentStatus || initialSqlStatus,
      sqlStatusFirstRead: initialSqlStatus,
      sqlStatusAfter: finalDeposit.status,
      immediateWebhookConfirm,
    });
  } catch (error) {
    addCheck("fatal", false, error.stack || error.message || String(error), {
      severity: "P0",
    });
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    writeEvidence();
    const status = evidence.failed.length === 0 ? "success" : "failed";
    console.log(`[staging-webhook-deposit] evidence=${OUT_DIR}`);
    console.log(
      `[staging-webhook-deposit] status=${status} checks=${evidence.checks.length} failed=${evidence.failed.length}`
    );
    if (status !== "success") process.exitCode = 1;
  }
}

function writeEvidence() {
  const traceText = evidence.trace.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const traceDigest = crypto.createHash("sha256").update(traceText).digest("hex");
  const report = {
    status: evidence.failed.length === 0 ? "success" : "failed",
    scriptVersion: "staging-webhook-deposit:v1",
    runId: RUN_ID,
    generatedAt: GENERATED_AT.toISOString(),
    finishedAt: utcNow(),
    environment: "staging",
    endpoints: {
      gatewayBase: config.gatewayBase,
      userFrontUrl: config.userFrontUrl,
    },
    checks: evidence.checks,
    failed: evidence.failed,
    screenshots: evidence.screenshots,
    traceDigest,
    evidenceFiles: {
      report: "report.json",
      markdown: "report.md",
      trace: "trace.jsonl",
      api: "api-evidence.json",
      db: "db-evidence.json",
      chain: "chain-evidence.json",
      logs: "log-evidence.json",
      browser: "browser-evidence.json",
      screenshots: "screenshot-evidence.json",
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, "trace.jsonl"), traceText, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, "api-evidence.json"),
    `${JSON.stringify(sanitize(evidence.api), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "db-evidence.json"),
    `${JSON.stringify(sanitize(evidence.db), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "chain-evidence.json"),
    `${JSON.stringify(sanitize(evidence.chain), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "log-evidence.json"),
    `${JSON.stringify(sanitize(evidence.logs), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "browser-evidence.json"),
    `${JSON.stringify(sanitize(evidence.browser), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "screenshot-evidence.json"),
    `${JSON.stringify(sanitize(evidence.screenshotEvidence), null, 2)}\n`
  );
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), renderMarkdown(report), "utf8");
}

function renderMarkdown(report) {
  return (
    [
      "# Staging Webhook Deposit Evidence",
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
      ...report.checks.map(
        (check) =>
          `| ${check.name} | ${check.ok ? "PASS" : "FAIL"} | ${String(check.detail || "").replace(/\|/g, "\\|")} |`
      ),
      "",
      "## Screenshots",
      "",
      ...report.screenshots.map((item) => `- \`${item}\``),
      "",
    ].join("\n") + "\n"
  );
}

main().catch((error) => {
  console.error(
    `[staging-webhook-deposit] fatal: ${redact(error.stack || error.message || String(error))}`
  );
  process.exit(1);
});
