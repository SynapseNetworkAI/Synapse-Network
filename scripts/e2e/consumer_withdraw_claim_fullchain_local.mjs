#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";
import { createWithdrawalE2eToolkit } from "./withdrawal_e2e_helpers.mjs";
import { createAdminWithdrawalReviewFocusHelpers } from "./admin_withdrawal_review_focus_helpers.mjs";
import {
  generateTotpCode,
  waitForSafeTotpWindow,
} from "../lib/totp_window.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const RUN_ID =
  process.env.CONSUMER_WITHDRAW_CLAIM_FULLCHAIN_RUN_ID || timestamp;

function privateKeyFromSeed(seed) {
  return `0x${crypto.createHash("sha256").update(seed).digest("hex")}`;
}

const OUT_DIR = process.env.CONSUMER_WITHDRAW_CLAIM_FULLCHAIN_OUT_DIR
  ? path.resolve(process.env.CONSUMER_WITHDRAW_CLAIM_FULLCHAIN_OUT_DIR)
  : path.join(
      ROOT,
      "output/dogfood/consumer-withdraw-claim-fullchain",
      `${timestamp}-local`
    );
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const SCRIPT_VERSION = "consumer-withdraw-claim-fullchain-local-e2e:v1";

const config = {
  gatewayBase: (
    process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
  ).replace(/\/+$/, ""),
  adminApi: (process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300").replace(
    /\/+$/,
    ""
  ),
  adminFront: (process.env.ADMIN_FRONT_URL || "http://127.0.0.1:3200").replace(
    /\/+$/,
    ""
  ),
  frontendUrl: (
    process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000"
  ).replace(/\/+$/, ""),
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  chainId: Number.parseInt(process.env.CHAIN_ID || "31337", 10),
  postgresDsn:
    process.env.LOCAL_POSTGRES_DSN ||
    process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
    process.env.POSTGRES_DSN ||
    process.env.GATEWAY_POSTGRES_DSN ||
    "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
  adminCookieName:
    process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session",
  adminEmail: process.env.ADMIN_EMAIL || "local-admin-e2e@synapse-network.ai",
  adminPassword: process.env.ADMIN_PASSWORD || "WithdrawDogfood#2026!",
  adminTotpSecret: process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP",
  deployerKey:
    process.env.DEPLOYER_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  consumerKey:
    process.env.CONSUMER_KEY ||
    privateKeyFromSeed(`consumer-withdraw-claim-fullchain:${RUN_ID}`),
  platformOwnerKey:
    process.env.PLATFORM_OWNER_KEY ||
    process.env.DEPLOYER_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  depositUsdc:
    process.env.CONSUMER_WITHDRAW_FULLCHAIN_DEPOSIT_USDC || "1200.000000",
  manualWithdrawUsdc:
    process.env.CONSUMER_WITHDRAW_FULLCHAIN_MANUAL_USDC || "500.000000",
  contractConfigPath: process.env.GATEWAY_E2E_CONTRACT_CONFIG_PATH
    ? path.resolve(process.env.GATEWAY_E2E_CONTRACT_CONFIG_PATH)
    : path.join(ROOT, "services/user-front/src/contract-config.json"),
};

const evidence = {
  trace: [],
  api: {},
  db: {},
  chain: {},
  dom: {},
  screenshots: [],
  screenshotEvidence: [],
  passed: [],
  failed: [],
  warnings: [],
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function redact(value) {
  return String(value ?? "")
    .replace(/0x[a-fA-F0-9]{64}/g, "[REDACTED_HEX64]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9._~+/=-]+/g, "[REDACTED_JWT]");
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
    timestamp: new Date().toISOString(),
    scenario: row.scenario || "unknown",
    method: row.method || "",
    path: row.path || "",
    httpStatus: row.httpStatus ?? 0,
    durationMs: row.durationMs ?? 0,
    sanitizedRequest: sanitize(row.sanitizedRequest || {}),
    sanitizedResponse: sanitize(row.sanitizedResponse || {}),
    expected: sanitize(row.expected || {}),
    actual: sanitize(row.actual || {}),
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

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function writeJson(name, payload) {
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
}

function qAtomic(value, decimals = 18) {
  const normalized = String(value ?? "0").trim();
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsigned = normalized.replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  return (
    sign *
    (BigInt(whole || "0") * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, "0").slice(0, decimals)))
  );
}

function q6Atomic(value) {
  return qAtomic(value, 6);
}

function formatAtomic(value, decimals = 18) {
  return ethers.formatUnits(BigInt(value || 0), decimals);
}

function buildWagmiStore(address, chainId) {
  return {
    state: {
      connections: {
        __type: "Map",
        value: [
          [
            "injected",
            {
              accounts: [address],
              chainId,
              connector: {
                id: "injected",
                name: "Injected",
                type: "injected",
                uid: "injected",
              },
            },
          ],
        ],
      },
      chainId,
      current: "injected",
      status: "connected",
    },
    version: 2,
  };
}

async function installAuth(context, auth) {
  const wagmiStore = buildWagmiStore(auth.address, config.chainId);
  await context.addInitScript(
    ({ address, token, expiresAt, chainId, rpcUrl, wagmiStore }) => {
      const session = {
        wallet: String(address).toLowerCase(),
        token,
        expiresAt,
      };
      const chainHex = `0x${Number(chainId).toString(16)}`;
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_selected_role", "CONSUMER");
      localStorage.setItem(
        `a2a_role_${String(address).toLowerCase()}`,
        "CONSUMER"
      );
      localStorage.setItem("a2a_auth_session", JSON.stringify(session));
      localStorage.setItem("wagmi.store", JSON.stringify(wagmiStore));
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      window.ethereum = {
        isMetaMask: true,
        chainId: chainHex,
        selectedAddress: address,
        isConnected: () => true,
        request: async (args) => {
          const method = args?.method;
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [address];
          if (method === "eth_chainId") return chainHex;
          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Date.now(),
              method,
              params: args?.params || [],
            }),
          });
          const payload = await response.json();
          if (payload.error) {
            throw new Error(payload.error.message || "RPC request failed");
          }
          return payload.result;
        },
        on: () => {},
        removeListener: () => {},
      };
    },
    {
      address: auth.address,
      token: auth.token,
      expiresAt: auth.expiresAt,
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      wagmiStore,
    }
  );
}

function assertLocalEnvironment() {
  if (
    !isLocalUrl(config.gatewayBase) ||
    !isLocalUrl(config.adminApi) ||
    !isLocalUrl(config.adminFront) ||
    !isLocalUrl(config.frontendUrl) ||
    !isLocalUrl(config.rpcUrl)
  ) {
    throw new Error(
      "consumer withdraw claim fullchain E2E refuses non-local Gateway/Admin/User-front/RPC endpoints."
    );
  }
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

async function loginAdmin() {
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
  return {
    address,
    token,
    privateKey,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}

async function pollUntil(label, fn, predicate, attempts = 30, sleepMs = 1000) {
  let lastValue = null;
  for (let index = 0; index < attempts; index += 1) {
    lastValue = await fn();
    if (predicate(lastValue)) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
  throw new Error(
    `${label} did not satisfy predicate. Last value=${JSON.stringify(
      sanitize(lastValue)
    ).slice(0, 1000)}`
  );
}

function assertStatusEquals(actual, expected, label) {
  if (String(actual).toUpperCase() !== String(expected).toUpperCase()) {
    throw new Error(`${label} expected=${expected} actual=${actual}`);
  }
}

async function sendWithNonceRetry(label, makeTx, attempts = 4) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await makeTx();
    } catch (error) {
      lastError = error;
      if (
        !/nonce|replacement|underpriced|already known|NONCE_EXPIRED|transaction underpriced/i.test(
          String(error?.message || error)
        )
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (index + 1)));
    }
  }
  throw new Error(
    `${label} failed after nonce retries: ${lastError?.message || lastError}`
  );
}

const toolkit = createWithdrawalE2eToolkit({
  root: ROOT,
  postgresDsn: config.postgresDsn,
  rpcUrl: config.rpcUrl,
  chainId: config.chainId,
  runId: `cwcf-${timestamp}`,
  fail: (message) => {
    throw new Error(message);
  },
});

const {
  claimOnChain,
  getChainContext,
  queryJson,
  readChainBalances,
  topUpEthIfNeeded,
} = toolkit;

const {
  captureAdminApproveResult,
  captureAdminLoginSuccess,
  captureReviewScreenshots,
} = createAdminWithdrawalReviewFocusHelpers({
  config,
  enabled: true,
  evidence,
  isStaging: false,
  sanitize,
  screenshotDir: SCREENSHOT_DIR,
});

async function getChainState(address) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const wallet = await readChainBalances(address);
  const core = new ethers.Contract(coreAddress, coreAbi, provider);
  const platformFeePoolAtomic = await core.platformFeePool();
  const owner = await core.owner();
  return {
    ...wallet,
    owner,
    platformFeePoolAtomic: platformFeePoolAtomic.toString(),
    platformFeePoolUsdc: ethers.formatUnits(
      platformFeePoolAtomic,
      wallet.decimals
    ),
  };
}

async function fundAndDeposit(auth, amountUsdc) {
  const { provider, coreAddress, usdcAddress, usdcAbi, coreAbi } =
    await getChainContext();
  const amount = ethers.parseUnits(amountUsdc, 18);
  const buyerAddress = new ethers.Wallet(auth.privateKey).address;

  await topUpEthIfNeeded(buyerAddress, "1.0");
  const mintTx = await sendWithNonceRetry("mint-usdc-for-deposit", async () => {
    const deployer = new ethers.Wallet(config.deployerKey, provider);
    const usdcDeployer = new ethers.Contract(usdcAddress, usdcAbi, deployer);
    return usdcDeployer.mint(buyerAddress, amount);
  });
  await mintTx.wait();
  const approveTx = await sendWithNonceRetry(
    "approve-usdc-for-deposit",
    async () => {
      const buyerSigner = new ethers.Wallet(auth.privateKey, provider);
      const usdcBuyer = new ethers.Contract(usdcAddress, usdcAbi, buyerSigner);
      return usdcBuyer.approve(coreAddress, amount);
    }
  );
  await approveTx.wait();
  const depositTx = await sendWithNonceRetry(
    "deposit-usdc-into-core",
    async () => {
      const buyerSigner = new ethers.Wallet(auth.privateKey, provider);
      const coreBuyer = new ethers.Contract(coreAddress, coreAbi, buyerSigner);
      return coreBuyer.deposit(amount);
    }
  );
  await depositTx.wait();

  const intent = await httpJson(
    `${config.gatewayBase}/api`,
    "/v1/balance/deposit/intent",
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      headers: {
        "X-Idempotency-Key": `deposit-intent:${timestamp}:${crypto.randomUUID()}`,
      },
      body: { txHash: depositTx.hash, amountUsdc },
      scenario: "consumer-deposit-intent",
    }
  );
  evidence.api.depositIntent = sanitize(intent.payload);
  const synced = await pollUntil(
    "deposit-sync",
    async () =>
      httpJson(
        `${config.gatewayBase}/api`,
        `/v1/balance/deposit/sync?txHash=${encodeURIComponent(depositTx.hash)}`,
        {
          token: auth.token,
          address: auth.address,
          scenario: "consumer-deposit-sync",
        }
      ),
    (result) => {
      const sync = result?.payload?.sync || result?.payload || {};
      return (
        String(sync.status || "").toUpperCase() === "CONFIRMED" ||
        sync.confirmed === true ||
        sync.canRefreshBalance === true
      );
    },
    40,
    1500
  );
  evidence.api.depositSync = sanitize(synced.payload?.sync || synced.payload);
  await pollUntil(
    "consumer balance after deposit confirm",
    async () => fetchBalance(auth, "consumer-balance-after-deposit-confirm"),
    (balance) => {
      const available = q6Atomic(
        balance.consumerAvailableBalance ||
          balance.availableBalance ||
          balance.availableUsdc ||
          "0"
      );
      return available >= q6Atomic(amountUsdc);
    },
    20,
    1000
  );
  return depositTx.hash;
}

async function fetchBalance(auth, scenario = "consumer-balance") {
  const result = await httpJson(`${config.gatewayBase}/api`, "/v1/balance", {
    token: auth.token,
    address: auth.address,
    scenario,
  });
  return result.payload.balance || result.payload;
}

async function createConsumerWithdrawal(auth, amountUsdc, label) {
  const idempotencyKey = `${label}:${timestamp}:${crypto.randomUUID()}`;
  const result = await httpJson(
    `${config.gatewayBase}/api`,
    "/v1/balance/consumer/withdraw",
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      headers: { "X-Idempotency-Key": idempotencyKey },
      body: { amountUsdc, reason: `${label} ${timestamp}` },
      scenario: label,
    }
  );
  const payload = result.payload;
  return {
    ...payload,
    withdrawId: payload.withdrawId || payload.refundId || payload.withdrawalId,
  };
}

async function listConsumerWithdrawals(
  auth,
  scenario = "consumer-withdrawals"
) {
  const result = await httpJson(
    `${config.gatewayBase}/api`,
    "/v1/balance/consumer/withdrawals?limit=20",
    {
      token: auth.token,
      address: auth.address,
      scenario,
    }
  );
  const rows = Array.isArray(result.payload)
    ? result.payload
    : result.payload.withdrawals || [];
  return rows.map((row) => ({
    ...row,
    withdrawId: row.withdrawId || row.refundId || row.withdrawalId || row.id,
    withdrawalId: row.withdrawalId || row.withdrawId || row.refundId || row.id,
  }));
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
      expectOk: false,
    }
  );
}

async function adminDecision(adminAuth, withdrawalId, decision, scenario) {
  await waitForSafeTotpWindow({
    guardSeconds: 8,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  const otpCode = generateTotpCode(config.adminTotpSecret);
  return httpJson(
    config.adminApi,
    `/api/admin/v1/withdrawal-reviews/${encodeURIComponent(
      withdrawalId
    )}/decision`,
    {
      method: "POST",
      session: adminAuth.sessionToken,
      csrfToken: adminAuth.csrfToken,
      otpCode,
      body: { decision, note: `${scenario} ${timestamp}` },
      scenario,
    }
  );
}

async function listAdminWithdrawReviews(
  adminAuth,
  scenario = "admin-withdraw-review-list"
) {
  const result = await httpJson(
    config.adminApi,
    "/api/admin/v1/withdrawal-reviews?limit=100",
    {
      method: "GET",
      session: adminAuth.sessionToken,
      scenario,
    }
  );
  return result.payload?.data?.items || result.payload?.items || [];
}

function dbBalance(ownerAddress) {
  return queryJson(`
    SELECT json_build_object(
      'ownerAddress', owner.owner_wallet,
      'availableBalance', balance.available_balance::text,
      'pendingBalance', balance.pending_balance::text,
      'frozenBalance', balance.frozen_balance::text
    )
    FROM synapse_owner_accounts owner
    JOIN synapse_ledger_accounts account
      ON account.owner_id = owner.owner_id
     AND account.account_kind = 'consumer_wallet'
    JOIN synapse_account_balances balance
      ON balance.account_id = account.account_id
    WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
    LIMIT 1
  `);
}

function dbWithdrawal(withdrawalId) {
  return queryJson(`
    SELECT json_build_object(
      'withdrawalId', withdrawal_id,
      'status', status,
      'amountUsdc', amount_usdc::text,
      'feeUsdc', NULL,
      'txHash', tx_hash,
      'createdAt', created_at::text,
      'updatedAt', updated_at::text,
      'completedAt', NULL
    )
    FROM synapse_vault_withdrawals
    WHERE withdrawal_id = ${sqlLiteral(withdrawalId)}
    LIMIT 1
  `);
}

function dbAudit(withdrawalId, ownerAddress) {
  return queryJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT event_type, business_type, owner_id, amount_delta::text,
             result_status, error_code, created_at::text
      FROM synapse_audit_events
      WHERE lower(owner_id) = lower(${sqlLiteral(
        `owner:${String(ownerAddress).toLowerCase()}`
      )})
        AND detail_json::text LIKE '%' || ${sqlLiteral(withdrawalId)} || '%'
      ORDER BY created_at ASC
    ) t
  `);
}

async function withdrawPlatformFees(ownerKey, amountAtomic) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const tx = await sendWithNonceRetry("withdraw-platform-fees", async () => {
    const signer = new ethers.Wallet(ownerKey, provider);
    const core = new ethers.Contract(coreAddress, coreAbi, signer);
    return core.withdrawPlatformFees(amountAtomic);
  });
  const receipt = await tx.wait();
  if (Number(receipt?.status ?? 0) !== 1) {
    throw new Error(`withdrawPlatformFees failed: ${tx.hash}`);
  }
  return { txHash: tx.hash, gasUsed: receipt?.gasUsed?.toString() || "" };
}

async function expectPlatformFeeOverdrawRevert(ownerKey, amountAtomic) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const signer = new ethers.Wallet(ownerKey, provider);
  const core = new ethers.Contract(coreAddress, coreAbi, signer);
  try {
    await core.withdrawPlatformFees(amountAtomic);
    throw new Error("platform fee overdraw unexpectedly succeeded");
  } catch (error) {
    if (String(error.message || error).includes("unexpectedly succeeded")) {
      throw error;
    }
    return {
      rejected: true,
      message: redact(
        error.shortMessage || error.message || String(error)
      ).slice(0, 500),
    };
  }
}

function forbiddenTexts() {
  return ["Internal server error", "Unauthorized", "Loading", "Connect Wallet"];
}

async function captureUserScreenshot(page, fileName, checkpoint) {
  let bodyText = "";
  const expectedTexts = checkpoint.expectedText || [];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    bodyText = await page.locator("body").innerText({ timeout: 10_000 });
    let hasForbidden = false;
    for (const text of forbiddenTexts()) {
      if (bodyText.includes(text)) {
        throw new Error(`forbidden text "${text}" present in ${fileName}`);
      }
    }
    for (const text of expectedTexts) {
      if (!bodyText.includes(text)) {
        hasForbidden = true;
        break;
      }
    }
    if (!hasForbidden) {
      break;
    }
    await page.waitForTimeout(500);
  }
  for (const text of expectedTexts) {
    if (!bodyText.includes(text)) {
      throw new Error(`missing expected text "${text}" in ${fileName}`);
    }
  }
  const filePath = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  evidence.screenshots.push(filePath);
  evidence.screenshotEvidence.push({
    file: filePath,
    url: page.url(),
    expectedText: checkpoint.expectedText || [],
    forbiddenTextAbsent: true,
    domCheckpoint: checkpoint.domCheckpoint,
    apiCheckpoint: checkpoint.apiCheckpoint,
    dbCheckpoint: checkpoint.dbCheckpoint,
    capturedAt: new Date().toISOString(),
  });
  return bodyText;
}

async function captureCreditsPage(page, expectedText, fileName, checkpoint) {
  await page.goto(`${config.frontendUrl}/dashboard/billing/credits`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  return captureUserScreenshot(page, fileName, {
    expectedText,
    ...checkpoint,
  });
}

async function captureBillingPage(page, expectedText, fileName, checkpoint) {
  await page.goto(`${config.frontendUrl}/dashboard/billing`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  return captureUserScreenshot(page, fileName, {
    expectedText,
    ...checkpoint,
  });
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
    scriptVersion: SCRIPT_VERSION,
    generatedAt: new Date().toISOString(),
    traceDigest,
    passed: evidence.passed,
    failed: evidence.failed,
    warnings: evidence.warnings,
  };
  writeJson("report.json", report);
  writeJson("api-evidence.json", evidence.api);
  writeJson("db-evidence.json", evidence.db);
  writeJson("chain-evidence.json", evidence.chain);
  writeJson("dom-evidence.json", evidence.dom);
  writeJson("screenshot-evidence.json", evidence.screenshotEvidence);
  fs.writeFileSync(path.join(OUT_DIR, "trace.jsonl"), traceText, "utf8");
  const md = [
    "# Consumer Withdraw Claim Fullchain Local E2E",
    "",
    `- Status: ${status}`,
    `- Script version: ${SCRIPT_VERSION}`,
    `- Trace digest: ${traceDigest}`,
    "",
  ];
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), `${md.join("\n")}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, "bugfix-log.md"),
    evidence.failed.length === 0
      ? "# Bugfix Log\n\nNo open bugs.\n"
      : [
          "# Bugfix Log",
          "",
          ...evidence.failed.map(
            (item, index) =>
              `## BUG-${String(index + 1).padStart(3, "0")}: ${
                item.name
              }\n- Status: open\n- Detail: ${item.detail}\n`
          ),
        ].join("\n"),
    "utf8"
  );
  if (status !== "success") process.exitCode = 1;
}

async function main() {
  assertLocalEnvironment();
  resetLocalAdminE2eAccount();

  const [gatewayHealth, adminHealth, userFrontHealth, adminFrontHealth] =
    await Promise.all([
      fetch(`${config.gatewayBase}/health`),
      fetch(`${config.adminApi}/health`),
      fetch(config.frontendUrl),
      fetch(`${config.adminFront}/login`),
    ]);
  if (
    !gatewayHealth.ok ||
    !adminHealth.ok ||
    !userFrontHealth.ok ||
    !adminFrontHealth.ok
  ) {
    throw new Error(
      `health preflight failed gateway=${gatewayHealth.status} admin=${adminHealth.status} userFront=${userFrontHealth.status} adminFront=${adminFrontHealth.status}`
    );
  }

  const adminAuth = await loginAdmin();
  const consumerAuth = await authWallet(config.consumerKey, "consumer");
  const ownerAuth = await authWallet(config.platformOwnerKey, "platform-owner");

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
  });
  const userContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  await installAuth(userContext, consumerAuth);
  const userPage = await userContext.newPage();

  try {
    await captureAdminLoginSuccess(adminAuth);

    const depositTxHash = await fundAndDeposit(
      consumerAuth,
      config.depositUsdc
    );
    const balanceAfterDeposit = await fetchBalance(
      consumerAuth,
      "consumer-balance-after-deposit"
    );
    evidence.api.balanceAfterDeposit = sanitize(balanceAfterDeposit);

    const beforeCreateChain = await getChainState(consumerAuth.address);
    const beforeCreateDbBalance = dbBalance(consumerAuth.address);

    const created = await createConsumerWithdrawal(
      consumerAuth,
      config.manualWithdrawUsdc,
      "consumer-manual-review-withdraw"
    );
    if (String(created.status).toUpperCase() !== "PENDING_MANUAL_REVIEW") {
      throw new Error(
        `manual review create did not return PENDING_MANUAL_REVIEW: ${JSON.stringify(
          created
        ).slice(0, 800)}`
      );
    }
    const withdrawId = created.withdrawId;
    if (!withdrawId) throw new Error("withdrawId missing from create response");
    const afterCreateDbRow = await pollUntil(
      "db withdrawal row after create",
      async () => dbWithdrawal(withdrawId),
      (row) =>
        String(row?.status || "").toUpperCase() === "PENDING_MANUAL_REVIEW"
    );
    const afterCreateDbBalance = dbBalance(consumerAuth.address);
    evidence.api.createdWithdrawal = sanitize(created);
    evidence.db.afterCreate = {
      balance: afterCreateDbBalance,
      row: afterCreateDbRow,
    };
    evidence.chain.beforeCreate = beforeCreateChain;

    await captureCreditsPage(
      userPage,
      ["Frozen / review credits"],
      "01-credits-under-review.png",
      {
        domCheckpoint: "credits page renders under review withdrawal state",
        apiCheckpoint: "created withdrawal status is PENDING_MANUAL_REVIEW",
        dbCheckpoint: "db withdrawal row is PENDING_MANUAL_REVIEW",
      }
    );
    const pendingAdminItems = await pollUntil(
      "admin review queue contains withdrawal",
      async () =>
        listAdminWithdrawReviews(
          adminAuth,
          "admin-withdraw-review-list-before-approve"
        ),
      (items) =>
        items.some(
          (item) =>
            String(item.withdrawalId || "") === withdrawId &&
            String(item.status || "").toUpperCase() === "PENDING_MANUAL_REVIEW"
        ),
      20,
      1000
    );
    evidence.api.adminPendingQueue = sanitize(pendingAdminItems);
    await captureReviewScreenshots(
      adminAuth,
      withdrawId,
      "consumer-approve-before"
    );

    const decision = await adminDecision(
      adminAuth,
      withdrawId,
      "APPROVE",
      "consumer-approve-fullchain"
    );
    evidence.api.adminApprove = sanitize(decision.payload);

    const approvedRow = await pollUntil(
      "consumer withdrawal requested",
      async () => dbWithdrawal(withdrawId),
      (row) => String(row?.status || "").toUpperCase() === "REQUESTED"
    );
    const approvedBalance = dbBalance(consumerAuth.address);
    const approvedList = await pollUntil(
      "consumer withdrawals claimable",
      async () =>
        listConsumerWithdrawals(
          consumerAuth,
          "consumer-withdrawals-after-approve"
        ),
      (rows) =>
        rows.some(
          (row) =>
            (row.withdrawId || row.refundId || row.withdrawalId) ===
              withdrawId &&
            String(row.status || "").toUpperCase() === "REQUESTED" &&
            row.claimable === true &&
            row.ticket
        )
    );
    const approvedApiRow = approvedList.find(
      (row) =>
        (row.withdrawId || row.refundId || row.withdrawalId) === withdrawId
    );
    evidence.api.afterApprove = sanitize(approvedApiRow);
    evidence.db.afterApprove = {
      balance: approvedBalance,
      row: approvedRow,
      audit: dbAudit(withdrawId, consumerAuth.address),
    };

    assertStatusEquals(approvedRow.status, "REQUESTED", "approved DB row");
    if (!approvedApiRow?.claimable) {
      throw new Error("approved API row is not claimable");
    }
    if (approvedApiRow.txHash) {
      throw new Error("approved API row unexpectedly already has txHash");
    }

    await captureCreditsPage(
      userPage,
      ["Claimable withdrawal credits", "Claim now"],
      "03-credits-ready-to-claim.png",
      {
        domCheckpoint: "credits page surfaces ready-to-claim CTA",
        apiCheckpoint: "approved withdrawal row claimable=true",
        dbCheckpoint: "db withdrawal row status REQUESTED",
      }
    );
    await captureBillingPage(
      userPage,
      ["Ready to claim", "Withdraw"],
      "04-payments-ready-to-claim.png",
      {
        domCheckpoint: "payments page renders ready-to-claim state",
        apiCheckpoint: "approved withdrawal row claimable=true",
        dbCheckpoint: "db withdrawal row status REQUESTED",
      }
    );
    await captureAdminApproveResult(adminAuth, withdrawId);

    const ticket = approvedApiRow.ticket;
    const preClaimChain = await getChainState(consumerAuth.address);
    const claim = await claimOnChain(consumerAuth.privateKey, ticket);
    const complete = await completeConsumerWithdrawal(
      consumerAuth,
      withdrawId,
      claim.txHash
    );
    evidence.api.complete = sanitize(complete.payload);
    const completedRow = await pollUntil(
      "consumer withdrawal completed",
      async () => dbWithdrawal(withdrawId),
      (row) => String(row?.status || "").toUpperCase() === "COMPLETED",
      40,
      1000
    );
    const completedBalance = dbBalance(consumerAuth.address);
    const postClaimChain = await getChainState(consumerAuth.address);
    const completedList = await pollUntil(
      "consumer withdrawals completed api state",
      async () =>
        listConsumerWithdrawals(
          consumerAuth,
          "consumer-withdrawals-after-complete"
        ),
      (rows) =>
        rows.some(
          (row) =>
            (row.withdrawId || row.refundId || row.withdrawalId || row.id) ===
              withdrawId &&
            String(row.status || "").toUpperCase() === "COMPLETED" &&
            row.claimable === false &&
            Boolean(row.txHash)
        ),
      40,
      1000
    );
    const completedApiRow = completedList.find(
      (row) =>
        (row.withdrawId || row.refundId || row.withdrawalId || row.id) ===
        withdrawId
    );
    evidence.api.afterComplete = sanitize(completedApiRow);
    evidence.db.afterComplete = {
      balance: completedBalance,
      row: completedRow,
      audit: dbAudit(withdrawId, consumerAuth.address),
    };
    evidence.chain.afterClaim = {
      before: preClaimChain,
      after: postClaimChain,
      claim,
      netDeltaAtomic: (
        BigInt(postClaimChain.walletAtomic) - BigInt(preClaimChain.walletAtomic)
      ).toString(),
      vaultDeltaAtomic: (
        BigInt(postClaimChain.vaultAtomic) - BigInt(preClaimChain.vaultAtomic)
      ).toString(),
      feePoolDeltaAtomic: (
        BigInt(postClaimChain.platformFeePoolAtomic) -
        BigInt(preClaimChain.platformFeePoolAtomic)
      ).toString(),
    };

    assertStatusEquals(completedRow.status, "COMPLETED", "completed DB row");
    if (completedApiRow?.claimable !== false) {
      throw new Error("completed API row must have claimable=false");
    }
    if (!completedApiRow?.txHash) {
      throw new Error("completed API row missing txHash");
    }

    await captureCreditsPage(
      userPage,
      ["Spendable credits", "Withdrawable credits"],
      "05-credits-completed.png",
      {
        domCheckpoint: "credits page reflects completed withdrawal",
        apiCheckpoint: "completed withdrawal row claimable=false",
        dbCheckpoint: "db withdrawal row status COMPLETED",
      }
    );
    await captureBillingPage(
      userPage,
      ["Completed", "Withdraw"],
      "06-payments-completed.png",
      {
        domCheckpoint: "payments page reflects completed withdrawal",
        apiCheckpoint: "completed withdrawal row txHash present",
        dbCheckpoint: "db withdrawal row status COMPLETED",
      }
    );

    const feePoolDeltaAtomic = BigInt(
      evidence.chain.afterClaim.feePoolDeltaAtomic || "0"
    );
    const feePoolBeforePlatformWithdraw = BigInt(
      postClaimChain.platformFeePoolAtomic
    );
    const overdraw = await expectPlatformFeeOverdrawRevert(
      config.platformOwnerKey,
      feePoolBeforePlatformWithdraw + 1n
    );
    evidence.chain.platformFeeOverdraw = overdraw;
    const platformChainBefore = await getChainState(ownerAuth.address);
    const { owner: onChainOwner } = platformChainBefore;
    if (
      String(onChainOwner).toLowerCase() !==
      String(ownerAuth.address).toLowerCase()
    ) {
      throw new Error(
        `platform owner key mismatch on-chain owner=${onChainOwner} auth=${ownerAuth.address}`
      );
    }
    const platformWithdraw = await withdrawPlatformFees(
      config.platformOwnerKey,
      feePoolDeltaAtomic
    );
    const platformChainAfter = await getChainState(ownerAuth.address);
    evidence.chain.platformFeeWithdrawal = {
      before: platformChainBefore,
      after: platformChainAfter,
      tx: platformWithdraw,
      walletDeltaAtomic: (
        BigInt(platformChainAfter.walletAtomic) -
        BigInt(platformChainBefore.walletAtomic)
      ).toString(),
      vaultDeltaAtomic: (
        BigInt(platformChainAfter.vaultAtomic) -
        BigInt(platformChainBefore.vaultAtomic)
      ).toString(),
      poolDeltaAtomic: (
        BigInt(platformChainAfter.platformFeePoolAtomic) -
        BigInt(platformChainBefore.platformFeePoolAtomic)
      ).toString(),
    };

    evidence.db.summary = {
      beforeCreateBalance: beforeCreateDbBalance,
      afterApproveBalance: approvedBalance,
      afterCompleteBalance: completedBalance,
      withdrawId,
      depositTxHash,
    };
    evidence.dom.summary = {
      underReviewStatus: "审核中",
      readyToClaimStatus: "待领取",
      completedStatus: "已完成",
    };

    pass("consumer-withdraw-fullchain", `${withdrawId} tx=${claim.txHash}`);
    pass("platform-fee-withdraw-fullchain", `tx=${platformWithdraw.txHash}`);
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    fail("fatal", error.stack || error.message || String(error));
  })
  .finally(() => {
    writeEvidence();
    console.log(`[consumer-withdraw-claim-fullchain] evidence: ${OUT_DIR}`);
  });
