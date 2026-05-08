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
  process.env.CONSUMER_WITHDRAW_APPROVAL_EXPIRY_RUN_ID || timestamp;
const OUT_DIR = process.env.CONSUMER_WITHDRAW_APPROVAL_EXPIRY_OUT_DIR
  ? path.resolve(process.env.CONSUMER_WITHDRAW_APPROVAL_EXPIRY_OUT_DIR)
  : path.join(
      ROOT,
      "output/dogfood/consumer-withdraw-approval-expiry",
      `${timestamp}-local`
    );
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const SCRIPT_VERSION = "consumer-withdraw-approval-expiry-local-e2e:v1";

function privateKeyFromSeed(seed) {
  return `0x${crypto.createHash("sha256").update(seed).digest("hex")}`;
}

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
  adminPassword: process.env.ADMIN_PASSWORD || "WithdrawExpiryDogfood#2026!",
  adminTotpSecret: process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP",
  deployerKey:
    process.env.DEPLOYER_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  consumerKey:
    process.env.CONSUMER_KEY ||
    privateKeyFromSeed(`consumer-withdraw-approval-expiry:${RUN_ID}`),
  depositUsdc:
    process.env.CONSUMER_WITHDRAW_APPROVAL_EXPIRY_DEPOSIT_USDC || "1200.000000",
  manualWithdrawUsdc:
    process.env.CONSUMER_WITHDRAW_APPROVAL_EXPIRY_MANUAL_USDC || "501.000000",
  shortTicketLifetimeSec: Number.parseInt(
    process.env.CONSUMER_WITHDRAW_APPROVAL_EXPIRY_SHORT_TICKET_SEC || "2",
    10
  ),
  expiryBufferSec: Number.parseInt(
    process.env.WITHDRAW_TICKET_EXPIRY_BUFFER_SEC || "3",
    10
  ),
  rpcFinalityMarginSec: Number.parseInt(
    process.env.WITHDRAW_RPC_FINALITY_MARGIN_SEC || "3",
    10
  ),
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
    `${JSON.stringify(sanitize(payload), null, 2)}\n`,
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
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            return [address];
          }
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
      "consumer withdraw approval expiry E2E refuses non-local Gateway/Admin/User-front/RPC endpoints."
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

const toolkit = createWithdrawalE2eToolkit({
  root: ROOT,
  postgresDsn: config.postgresDsn,
  rpcUrl: config.rpcUrl,
  chainId: config.chainId,
  runId: `cwax-${timestamp}`,
  fail: (message) => {
    throw new Error(message);
  },
});

const { getChainContext, queryJson, readChainBalances, topUpEthIfNeeded } =
  toolkit;

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

async function latestBlockTimestamp() {
  const { provider } = await getChainContext();
  const block = await provider.getBlock("latest");
  return Number(block?.timestamp || 0);
}

async function rpcCall(method, params = []) {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.error) {
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  }
  return payload.result;
}

async function minePastRpcDeadline(targetTimestamp) {
  const current = await latestBlockTimestamp();
  if (current <= targetTimestamp && isLocalUrl(config.rpcUrl)) {
    await rpcCall("evm_setNextBlockTimestamp", [targetTimestamp + 1]).catch(
      async () => {
        await rpcCall("evm_increaseTime", [
          Math.max(1, targetTimestamp + 1 - current),
        ]);
      }
    );
    await rpcCall("evm_mine");
  }
}

async function waitForExpiryWindow(deadline) {
  const target =
    Number(deadline) + config.expiryBufferSec + config.rpcFinalityMarginSec + 2;
  while (
    Math.floor(Date.now() / 1000) <=
    Number(deadline) + config.expiryBufferSec + 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await minePastRpcDeadline(target);
  while ((await latestBlockTimestamp()) <= target) {
    await rpcCall("evm_mine").catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function isTicketConsumed(ticketHash) {
  const { provider, coreAbi, coreAddress } = await getChainContext();
  const core = new ethers.Contract(coreAddress, coreAbi, provider);
  return Boolean(await core.isTicketConsumed(ticketHash));
}

async function getChainState(address) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const wallet = await readChainBalances(address);
  const core = new ethers.Contract(coreAddress, coreAbi, provider);
  const platformFeePoolAtomic = await core.platformFeePool();
  return {
    ...wallet,
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
      'withdrawalId', vw.withdrawal_id,
      'status', vw.status,
      'amountUsdc', vw.amount_usdc::text,
      'txHash', vw.tx_hash,
      'ticketHash', vw.ticket_hash,
      'deadline', vw.deadline,
      'createdAt', vw.created_at::text,
      'updatedAt', vw.updated_at::text,
      'metadata', rs.payload
    )
    FROM synapse_vault_withdrawals vw
    LEFT JOIN synapse_runtime_state rs
      ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
    WHERE vw.withdrawal_id = ${sqlLiteral(withdrawalId)}
    LIMIT 1
  `);
}

function dbAudit(withdrawalId, ownerAddress) {
  return queryJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT event_type, business_type, owner_id, amount_delta::text,
             result_status, error_code, detail_json, created_at::text
      FROM synapse_audit_events
      WHERE lower(owner_id) = lower(${sqlLiteral(
        `owner:${String(ownerAddress).toLowerCase()}`
      )})
        AND detail_json::text LIKE '%' || ${sqlLiteral(withdrawalId)} || '%'
      ORDER BY created_at ASC
    ) t
  `);
}

function shortenWithdrawalDeadline(withdrawalId, deadlineEpochSec) {
  const runtimeStateKey = `vault_withdrawal_meta::${withdrawalId}`;
  queryJson(`
    WITH updated_withdrawal AS (
      UPDATE synapse_vault_withdrawals
      SET deadline = ${Number(deadlineEpochSec)},
          updated_at = NOW()
      WHERE withdrawal_id = ${sqlLiteral(withdrawalId)}
      RETURNING withdrawal_id, deadline, updated_at
    ), updated_runtime AS (
      UPDATE synapse_runtime_state
      SET payload = jsonb_set(
            jsonb_set(
              COALESCE(payload, '{}'::jsonb),
              '{ticket,deadline}',
              to_jsonb(${Number(deadlineEpochSec)}::bigint),
              true
            ),
            '{requestMeta,ticketDeadline}',
            to_jsonb(${Number(deadlineEpochSec)}::bigint),
            true
          ),
          updated_at = NOW()
      WHERE state_key = ${sqlLiteral(runtimeStateKey)}
      RETURNING state_key, payload, updated_at
    )
    SELECT json_build_object(
      'withdrawal', (SELECT row_to_json(updated_withdrawal) FROM updated_withdrawal),
      'runtime', (SELECT row_to_json(updated_runtime) FROM updated_runtime)
    )
  `);
}

async function runConsumerWithdrawProcessorOnce(withdrawId) {
  const { coreAddress, usdcAddress } = await getChainContext();
  const python = path.join(ROOT, "services/gateway/.venv/bin/python");
  const code = String.raw`
import json
from src.core.config import settings
from src.storage import create_storage
from src.services.platform.tasks.consumer_withdraw_processor import (
    _collect_requested_consumer_withdrawals,
    _process_single_withdraw,
)

storage = create_storage(settings)
try:
    rows = _collect_requested_consumer_withdrawals(storage)
    target = next((row for row in rows if str(row.id) == ${JSON.stringify(
      String(withdrawId)
    )}), None)
    if target is None:
        raise SystemExit("TARGET_WITHDRAWAL_NOT_FOUND")
    changed = _process_single_withdraw(storage, target)
    print(json.dumps({"withdrawalId": str(target.id), "changed": bool(changed)}))
finally:
    close = getattr(storage, "close", None)
    if callable(close):
        close()
`;
  return runCommand("consumer-withdraw-processor-once", python, ["-c", code], {
    PYTHONPATH: path.join(ROOT, "services/gateway"),
    ENVIRONMENT: "test",
    POSTGRES_DSN: config.postgresDsn,
    RPC_URL: config.rpcUrl,
    ROUTER_ADDRESS: coreAddress,
    USDC_TOKEN_ADDRESS: usdcAddress,
    POSTGRES_POOL_MAX: "10",
    POSTGRES_POOL_TIMEOUT_SEC: "20",
    WITHDRAW_TICKET_EXPIRY_BUFFER_SEC: String(config.expiryBufferSec),
    WITHDRAW_RPC_FINALITY_MARGIN_SEC: String(config.rpcFinalityMarginSec),
  });
}

function forbiddenTexts() {
  return ["Internal server error", "Unauthorized", "Loading", "Connect Wallet"];
}

async function captureUserScreenshot(page, fileName, checkpoint) {
  let bodyText = "";
  const expectedTexts = checkpoint.expectedText || [];
  const forbidden = [...forbiddenTexts(), ...(checkpoint.forbiddenText || [])];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    bodyText = await page.locator("body").innerText({ timeout: 10_000 });
    for (const text of forbidden) {
      if (text && bodyText.includes(text)) {
        throw new Error(`forbidden text "${text}" present in ${fileName}`);
      }
    }
    const missing = expectedTexts.some((text) => !bodyText.includes(text));
    if (!missing) break;
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

async function captureWithdrawPage(
  page,
  expectedText,
  fileName,
  checkpoint,
  { navigate = true } = {}
) {
  if (navigate) {
    await page.goto(`${config.frontendUrl}/dashboard/account/withdraw`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
  }
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
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Consumer Withdraw Approval Expiry Local E2E",
      "",
      `- Status: ${status}`,
      `- Script version: ${SCRIPT_VERSION}`,
      `- Trace digest: ${traceDigest}`,
      "",
    ].join("\n"),
    "utf8"
  );
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
    const beforeCreateChain = await getChainState(consumerAuth.address);
    const beforeCreateDbBalance = dbBalance(consumerAuth.address);

    const created = await createConsumerWithdrawal(
      consumerAuth,
      config.manualWithdrawUsdc,
      "consumer-manual-review-withdraw-expiry"
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
      audit: dbAudit(withdrawId, consumerAuth.address),
    };
    evidence.chain.beforeCreate = beforeCreateChain;

    await captureWithdrawPage(
      userPage,
      ["Withdrawable credits", "Withdrawal processing credits", "In review"],
      "01-withdraw-under-review.png",
      {
        domCheckpoint: "withdraw page renders manual review state",
        apiCheckpoint: "created withdrawal status is PENDING_MANUAL_REVIEW",
        dbCheckpoint: "db withdrawal row is PENDING_MANUAL_REVIEW",
        forbiddenText: ["Spendable credits", "Continue Withdrawal"],
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
      "consumer-approve-expiry-before"
    );

    const decision = await adminDecision(
      adminAuth,
      withdrawId,
      "APPROVE",
      "consumer-approve-expiry"
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
          "consumer-withdrawals-after-approve-expiry"
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

    await captureWithdrawPage(
      userPage,
      [
        "Withdrawable credits",
        "Withdrawal processing credits",
        "Continue Withdrawal",
      ],
      "03-withdraw-ready-to-claim.png",
      {
        domCheckpoint: "withdraw page surfaces ready-to-continue claim CTA",
        apiCheckpoint: "approved withdrawal row claimable=true",
        dbCheckpoint: "db withdrawal row status REQUESTED",
        forbiddenText: ["Spendable credits", "Withdrawal approval expiring"],
      }
    );
    await captureAdminApproveResult(adminAuth, withdrawId);

    const currentEpoch = Math.floor(Date.now() / 1000);
    const shortenedDeadline = currentEpoch + config.shortTicketLifetimeSec;
    shortenWithdrawalDeadline(withdrawId, shortenedDeadline);
    const shortenedRow = await pollUntil(
      "shortened deadline visible in db",
      async () => dbWithdrawal(withdrawId),
      (row) =>
        Number(row?.deadline || 0) === shortenedDeadline &&
        Number(row?.metadata?.ticket?.deadline || 0) === shortenedDeadline &&
        Number(row?.metadata?.requestMeta?.ticketDeadline || 0) ===
          shortenedDeadline
    );
    evidence.db.afterShorten = {
      row: shortenedRow,
      shortenedDeadline,
    };

    await pollUntil(
      "withdraw page shows expiring approval",
      async () => {
        await userPage.waitForTimeout(1000);
        return userPage.locator("body").innerText();
      },
      (text) =>
        text.includes("Withdrawal approval expiring") &&
        !text.includes("Continue Withdrawal"),
      20,
      1000
    );
    await captureWithdrawPage(
      userPage,
      ["Withdrawal approval expiring", "withdrawable balance"],
      "04-withdraw-approval-expiring.png",
      {
        domCheckpoint: "withdraw page warns about near-expiry ticket",
        apiCheckpoint: "approved row still claimable before processor release",
        dbCheckpoint:
          "shortened deadline is visible in db and runtime metadata",
        forbiddenText: ["Spendable credits", "Continue Withdrawal"],
      },
      { navigate: false }
    );

    const beforeExpiryChain = await getChainState(consumerAuth.address);
    await waitForExpiryWindow(shortenedDeadline);
    await runConsumerWithdrawProcessorOnce(withdrawId);

    const expiredRow = await pollUntil(
      "consumer withdrawal failed expired",
      async () => dbWithdrawal(withdrawId),
      (row) => String(row?.status || "").toUpperCase() === "FAILED_EXPIRED",
      50,
      1000
    );
    const expiredBalance = dbBalance(consumerAuth.address);
    const expiredApiRows = await pollUntil(
      "consumer withdrawals failed expired api state",
      async () =>
        listConsumerWithdrawals(
          consumerAuth,
          "consumer-withdrawals-after-approval-expiry"
        ),
      (rows) =>
        rows.some(
          (row) =>
            (row.withdrawId || row.refundId || row.withdrawalId || row.id) ===
              withdrawId &&
            String(row.status || "").toUpperCase() === "FAILED_EXPIRED" &&
            row.claimable === false
        ),
      40,
      1000
    );
    const expiredApiRow = expiredApiRows.find(
      (row) =>
        (row.withdrawId || row.refundId || row.withdrawalId || row.id) ===
        withdrawId
    );
    const afterExpiryChain = await getChainState(consumerAuth.address);
    const consumed = approvedApiRow?.ticket?.ticketHash
      ? await isTicketConsumed(approvedApiRow.ticket.ticketHash)
      : false;

    evidence.api.afterExpiry = sanitize(expiredApiRow);
    evidence.db.afterExpiry = {
      balance: expiredBalance,
      row: expiredRow,
      audit: dbAudit(withdrawId, consumerAuth.address),
    };
    evidence.chain.afterExpiry = {
      before: beforeExpiryChain,
      after: afterExpiryChain,
      walletDeltaAtomic: (
        BigInt(afterExpiryChain.walletAtomic) -
        BigInt(beforeExpiryChain.walletAtomic)
      ).toString(),
      vaultDeltaAtomic: (
        BigInt(afterExpiryChain.vaultAtomic) -
        BigInt(beforeExpiryChain.vaultAtomic)
      ).toString(),
      feePoolDeltaAtomic: (
        BigInt(afterExpiryChain.platformFeePoolAtomic) -
        BigInt(beforeExpiryChain.platformFeePoolAtomic)
      ).toString(),
      ticketConsumed: consumed,
      rpcBlockTimestamp: await latestBlockTimestamp(),
    };

    await pollUntil(
      "withdraw page reflects expired release",
      async () => {
        await userPage.waitForTimeout(1000);
        return userPage.locator("body").innerText();
      },
      (text) =>
        text.includes("Failed") &&
        text.includes("Withdrawable credits") &&
        !text.includes("Withdrawal approval expiring"),
      25,
      1000
    );
    await captureWithdrawPage(
      userPage,
      ["Withdrawable credits", "Withdrawal history", "Failed"],
      "05-withdraw-expired-released.png",
      {
        domCheckpoint:
          "withdraw page shows released funds and failed_expired history row",
        apiCheckpoint: "withdrawal row is FAILED_EXPIRED claimable=false",
        dbCheckpoint: "pending balance released back to available",
        forbiddenText: [
          "Spendable credits",
          "Continue Withdrawal",
          "Withdrawal approval expiring",
        ],
      },
      { navigate: false }
    );

    evidence.api.summary = {
      withdrawId,
      depositTxHash,
      shortenedDeadline,
    };
    evidence.db.summary = {
      beforeCreateBalance: beforeCreateDbBalance,
      afterCreateBalance: afterCreateDbBalance,
      approvedBalance,
      expiredBalance,
    };
    evidence.dom.summary = {
      reviewStatus: "In review",
      readyStatus: "Continue Withdrawal",
      expiringStatus: "Withdrawal approval expiring",
      releasedStatus: "Failed",
    };

    if (String(expiredRow.status).toUpperCase() !== "FAILED_EXPIRED") {
      throw new Error(`expected FAILED_EXPIRED, got ${expiredRow.status}`);
    }
    if (expiredApiRow?.claimable !== false) {
      throw new Error("expired API row must have claimable=false");
    }
    if (q6Atomic(expiredBalance.pendingBalance) !== 0n) {
      throw new Error(
        `expected pending balance to return to zero, got ${expiredBalance.pendingBalance}`
      );
    }
    if (
      q6Atomic(expiredBalance.availableBalance) <
      q6Atomic(beforeCreateDbBalance.availableBalance)
    ) {
      throw new Error(
        `available balance did not recover after expiry release: ${JSON.stringify(
          expiredBalance
        )}`
      );
    }
    if (consumed) {
      throw new Error("expired ticket should not be consumed on-chain");
    }
    if (
      BigInt(evidence.chain.afterExpiry.walletDeltaAtomic || "0") !== 0n ||
      BigInt(evidence.chain.afterExpiry.vaultDeltaAtomic || "0") !== 0n ||
      BigInt(evidence.chain.afterExpiry.feePoolDeltaAtomic || "0") !== 0n
    ) {
      throw new Error("expiry release must not move wallet/vault/platform fee");
    }

    pass("consumer-withdraw-approval-expiry", `${withdrawId}`);
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
    console.log(`[consumer-withdraw-approval-expiry] evidence: ${OUT_DIR}`);
  });
