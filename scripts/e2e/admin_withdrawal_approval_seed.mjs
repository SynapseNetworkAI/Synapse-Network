#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { createAdminWithdrawalApprovalHelpers } from "./admin_withdrawal_approval_helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "tmp/admin-withdrawal-approval");
const FIXTURE_PATH = process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE
  ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE)
  : path.join(OUT_DIR, "fixture.json");

const GATEWAY_BASE_URL = (
  process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (
  process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300"
).replace(/\/+$/, "");
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const API_BASE = `${GATEWAY_BASE_URL}/api`;
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const RUN_ID =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_RUN_ID ||
  `awa-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
const MOCK_PORT = Number.parseInt(
  process.env.ADMIN_WITHDRAWAL_APPROVAL_MOCK_PORT || "19991",
  10
);
const SERVICE_PRICE_USDC =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_SERVICE_PRICE_USDC || "120.000000";
const DEPOSIT_USDC =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_DEPOSIT_USDC || "150.000000";
const WITHDRAW_AMOUNT_USDC =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_AMOUNT_USDC || "100.000000";
const CONSUMER_ETH_TARGET =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_CONSUMER_ETH || "2.0";
const PROVIDER_ETH_TARGET =
  process.env.ADMIN_WITHDRAWAL_APPROVAL_PROVIDER_ETH || "2.0";
const POSTGRES_DSN =
  process.env.GATEWAY_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
// withdrawal status source: services/gateway provider withdrawal state machine and synapse_vault_withdrawals.status.

const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "super@synapse.network";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qwer@1234";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";

const DEFAULT_KEYS = {
  deployer:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  consumer:
    "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07",
  provider:
    "0x47e179ec197488bf6f785afa0fc15f4dee1a74f3f44fffedce27f84d349a926a",
};

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || DEFAULT_KEYS.deployer;
const CONSUMER_KEY =
  process.env.CONSUMER_KEY || ethers.Wallet.createRandom().privateKey;
const PROVIDER_KEY =
  process.env.PROVIDER_KEY || ethers.Wallet.createRandom().privateKey;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message) {
  console.log(`[admin-withdrawal-seed] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function runPsql(sql) {
  const result = spawnSync(
    "psql",
    [POSTGRES_DSN, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    fail(`psql failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout.trim();
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
  const usesDefaultKey = [DEPLOYER_KEY, CONSUMER_KEY, PROVIDER_KEY].some(
    (key) => Object.values(DEFAULT_KEYS).includes(key)
  );
  if (usesDefaultKey && CHAIN_ID !== 31337) {
    fail("Refusing to use default local test keys outside CHAIN_ID=31337.");
  }
  if (
    usesDefaultKey &&
    (!isLocalUrl(RPC_URL) ||
      !isLocalUrl(GATEWAY_BASE_URL) ||
      !isLocalUrl(ADMIN_GATEWAY_URL))
  ) {
    fail(
      "Refusing to use default local test keys against non-local endpoints."
    );
  }
  if (
    (ADMIN_PASSWORD === "qwer@1234" ||
      ADMIN_TOTP_SECRET === "JBSWY3DPEHPK3PXP") &&
    !isLocalUrl(ADMIN_GATEWAY_URL)
  ) {
    fail(
      "Refusing to use default admin credentials against a non-local admin gateway."
    );
  }
}

async function assertReachable(name, url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= (options.attempts || 4); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs || 15000
    );
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        signal: controller.signal,
        body: options.body,
        headers: options.headers,
      });
      if (!response.ok && !options.allowNonOk) {
        fail(
          `${name} not ready: ${response.status} ${response.statusText} at ${url}`
        );
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
  fail(
    `${name} not reachable at ${url}. ${lastError?.message || "unknown error"}`
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
    fail(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return { response, payload };
}

async function authenticate(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const challengeResponse = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(address)}`
  );
  const message =
    challengeResponse.payload.challenge || challengeResponse.payload.message;
  if (!message) fail(`${label} auth challenge missing message`);
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: address, message, signature },
  });
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  if (!token) fail(`${label} auth verification did not return a token`);
  log(`${label} authenticated as ${address}`);
  return {
    address,
    token,
    privateKey,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
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
      if (
        !/nonce|replacement|underpriced|already known|transaction underpriced/i.test(
          error.message || ""
        )
      ) {
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
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0").slice(0, decimals))
  );
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
    if (object && object[key] !== undefined && object[key] !== null)
      return String(object[key]);
  }
  return fallback;
}

async function topUpEthIfNeeded({
  targetAddress,
  targetEth,
  deployer,
  provider,
  label,
}) {
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
  const { provider, coreAbi, usdcAbi, usdcAddress, coreAddress } =
    await getChainContext();
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const consumer = new ethers.Wallet(CONSUMER_KEY, provider);
  const usdcDeployer = new ethers.Contract(usdcAddress, usdcAbi, deployer);
  const usdcConsumer = new ethers.Contract(usdcAddress, usdcAbi, consumer);
  const coreConsumer = new ethers.Contract(coreAddress, coreAbi, consumer);
  const decimals = Number(await usdcDeployer.decimals());
  const amountAtomic = ethers.parseUnits(DEPOSIT_USDC, decimals);

  const consumerEthTopupTx = await topUpEthIfNeeded({
    targetAddress: consumerAddress,
    targetEth: CONSUMER_ETH_TARGET,
    deployer,
    provider,
    label: "consumer",
  });
  const providerEthTopupTx = await topUpEthIfNeeded({
    targetAddress: providerAddress,
    targetEth: PROVIDER_ETH_TARGET,
    deployer,
    provider,
    label: "provider",
  });

  const mintTx = await sendWithRetry("mint-usdc", async () =>
    usdcDeployer.mint(consumerAddress, amountAtomic)
  );
  await mintTx.wait();
  log(`${DEPOSIT_USDC} MockUSDC minted for consumer`);

  const approveTx = await sendWithRetry("approve-usdc", async () =>
    usdcConsumer.approve(coreAddress, amountAtomic)
  );
  await approveTx.wait();
  log("SynapseCore approval confirmed");

  const depositTx = await sendWithRetry("deposit", async () =>
    coreConsumer.deposit(amountAtomic)
  );
  const receipt = await depositTx.wait();
  if (receipt?.status !== 1)
    fail(`deposit transaction failed: ${depositTx.hash}`);
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
    headers: {
      "X-Idempotency-Key": `awa-deposit-${txHash
        .replace(/^0x/, "")
        .slice(0, 80)}`,
    },
    body: { txHash, amountUsdc },
  });
  log(
    `deposit intent registered: ${
      result.payload.intent?.id || result.payload.id || txHash
    }`
  );
  return result.payload;
}

async function confirmLocalDepositIntent({
  token,
  address,
  depositIntent,
  txHash,
}) {
  const depositIntentId = depositIntent.intent?.id || depositIntent.id;
  if (!depositIntentId)
    fail(
      `deposit intent response missing id: ${JSON.stringify(
        depositIntent
      ).slice(0, 600)}`
    );
  const confirmed = await api(
    `/v1/balance/deposit/intents/${encodeURIComponent(
      depositIntentId
    )}/confirm`,
    {
      method: "POST",
      token,
      address,
      body: {
        eventKey: `admin-withdrawal-approval:${String(txHash).toLowerCase()}`,
        confirmations: 1,
      },
    }
  );
  log(`deposit intent confirmed locally: ${depositIntentId}`);
  return confirmed.payload;
}

async function waitForBalanceAtLeast({ token, address, expectedUsdc, txHash }) {
  const expected = decimalToAtomic(expectedUsdc);
  let lastBalance = "0";
  for (let i = 0; i < 40; i += 1) {
    await api(
      `/v1/balance/deposit/sync?txHash=${encodeURIComponent(
        String(txHash).toLowerCase()
      )}`,
      {
        token,
        address,
        expectOk: false,
      }
    ).catch(() => null);
    const payload = (await api("/v1/balance", { token, address })).payload;
    const balance = payload.balance || {};
    lastBalance = String(
      balance.consumerAvailableBalance ?? balance.ownerBalance ?? "0"
    );
    if (decimalToAtomic(lastBalance) >= expected) {
      log(`consumer gateway balance synced: ${lastBalance} USDC`);
      return payload;
    }
    await sleep(1500);
  }
  fail(
    `consumer balance did not reach ${expectedUsdc} USDC; last=${lastBalance}`
  );
}

async function ensureMockUpstream() {
  const healthUrl = `http://127.0.0.1:${MOCK_PORT}/health`;
  const existing = await fetch(healthUrl)
    .then((res) => res.ok)
    .catch(() => false);
  if (existing) {
    log(`mock upstream already running on ${healthUrl}`);
    return { url: `http://127.0.0.1:${MOCK_PORT}`, pid: null, reused: true };
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const logPath = path.join(OUT_DIR, "mock-upstream.log");
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "--mock-upstream"],
    {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", fs.openSync(logPath, "a"), fs.openSync(logPath, "a")],
    }
  );
  child.unref();

  for (let i = 0; i < 30; i += 1) {
    if (
      await fetch(healthUrl)
        .then((res) => res.ok)
        .catch(() => false)
    ) {
      log(`mock upstream started on ${healthUrl} (pid ${child.pid})`);
      return {
        url: `http://127.0.0.1:${MOCK_PORT}`,
        pid: child.pid,
        reused: false,
      };
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
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = { raw };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          runId: RUN_ID,
          service: "admin-withdrawal-approval-provider",
          echo: parsed,
          receivedAt: new Date().toISOString(),
        })
      );
    });
  });
  server.listen(MOCK_PORT, "127.0.0.1", () => {
    console.log(
      `[admin-withdrawal-mock] listening on http://127.0.0.1:${MOCK_PORT}`
    );
  });
}

function matureProviderChargeLedger({ providerAddress, invocationId }) {
  const updated = runPsql(`
    WITH target_provider AS (
      SELECT la.account_id
      FROM synapse_ledger_accounts la
      JOIN synapse_owner_accounts oa ON oa.owner_id = la.owner_id
      WHERE lower(oa.owner_wallet) = lower(${sqlLiteral(providerAddress)})
        AND la.account_kind = 'provider_wallet'
      LIMIT 1
    ),
    updated AS (
      UPDATE synapse_ledger_entries entry
      SET created_at = NOW() - INTERVAL '8 days'
      WHERE entry.credit_account_id = (SELECT account_id FROM target_provider)
        AND entry.business_type = 'charge'
        AND entry.status = 'posted'
        AND entry.created_at >= NOW() - INTERVAL '2 hours'
        AND (
          entry.reference_id = ${sqlLiteral(invocationId)}
          OR ${sqlLiteral(invocationId)} = ''
        )
      RETURNING entry.entry_id
    )
    SELECT COUNT(*) FROM updated
  `);
  if (Number.parseInt(updated || "0", 10) < 1) {
    fail(
      `No provider charge ledger row matured for invocation ${invocationId}`
    );
  }
  log(`provider charge ledger matured for T+7 withdrawal: ${updated} row(s)`);
}

async function readProviderCapability(auth) {
  return (await api("/v1/providers/withdrawals/capability", auth)).payload;
}

async function readProviderWithdrawals(auth) {
  return (
    (await api("/v1/providers/withdrawals?limit=50", auth)).payload
      .withdrawals || []
  );
}

async function createWithdrawal(
  auth,
  { amountUsdc, idempotencyKey, expectOk = true }
) {
  return api("/v1/providers/withdrawals/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: { "X-Idempotency-Key": idempotencyKey },
    body: { amountUsdc },
    expectOk,
  });
}

const {
  adminApi,
  invalidInternalTokenReview,
  invokeService,
  issueAgentCredential,
  issueProviderSecret,
  loginAdmin,
  readChainBalances,
  registerService,
  waitForServiceDiscoverable,
} = createAdminWithdrawalApprovalHelpers({
  adminCookieName: ADMIN_COOKIE_NAME,
  adminEmail: ADMIN_EMAIL,
  adminGatewayUrl: ADMIN_GATEWAY_URL,
  adminPassword: ADMIN_PASSWORD,
  adminTotpSecret: ADMIN_TOTP_SECRET,
  api,
  apiBase: API_BASE,
  chainId: CHAIN_ID,
  ethers,
  fail,
  getChainContext,
  log,
  moneyFromObject,
  runId: RUN_ID,
  servicePriceUsdc: SERVICE_PRICE_USDC,
  sleep,
});

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

  const deposit = await fundAndDeposit({
    consumerAddress: consumerAuth.address,
    providerAddress: providerAuth.address,
  });
  const depositIntent = await registerDepositIntent({
    ...consumerAuth,
    txHash: deposit.txHash,
    amountUsdc: deposit.amountUsdc,
  });
  const confirmedDeposit = await confirmLocalDepositIntent({
    ...consumerAuth,
    depositIntent,
    txHash: deposit.txHash,
  });
  const balanceBeforeInvoke = await waitForBalanceAtLeast({
    ...consumerAuth,
    expectedUsdc: deposit.amountUsdc,
    txHash: deposit.txHash,
  });
  const credential = await issueAgentCredential(consumerAuth);
  const invocation = await invokeService({
    credentialToken: credential.token,
    service,
  });
  matureProviderChargeLedger({
    providerAddress: providerAuth.address,
    invocationId: invocation.invocationId,
  });

  const capabilityBeforeWithdraw = await readProviderCapability(providerAuth);
  const chainBeforeWithdraw = await readChainBalances(providerAuth.address);
  const primaryKey = `admin-withdrawal-approval:${RUN_ID}:primary`;
  const withdrawalResult = await createWithdrawal(providerAuth, {
    amountUsdc: WITHDRAW_AMOUNT_USDC,
    idempotencyKey: primaryKey,
  });
  const withdrawal = withdrawalResult.payload;
  if (withdrawal.status !== "PENDING_MANUAL_REVIEW") {
    fail(
      `Expected withdrawal to enter PENDING_MANUAL_REVIEW. Got ${withdrawal.status}. Start gateway with WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC=1.000000.`
    );
  }
  if (withdrawal.ticket && Object.keys(withdrawal.ticket).length > 0) {
    fail("Manual review withdrawal returned a ticket before approval.");
  }

  const capabilityAfterRequest = await readProviderCapability(providerAuth);
  const withdrawalsAfterRequest = await readProviderWithdrawals(providerAuth);
  const duplicateSameKey = await createWithdrawal(providerAuth, {
    amountUsdc: WITHDRAW_AMOUNT_USDC,
    idempotencyKey: primaryKey,
  });
  if (duplicateSameKey.payload.withdrawalId !== withdrawal.withdrawalId) {
    fail(
      `Same idempotency key returned different withdrawalId: ${duplicateSameKey.payload.withdrawalId}`
    );
  }

  const duplicateActiveSameAmount = await createWithdrawal(providerAuth, {
    amountUsdc: WITHDRAW_AMOUNT_USDC,
    idempotencyKey: `admin-withdrawal-approval:${RUN_ID}:active-same-amount`,
  });
  if (
    duplicateActiveSameAmount.payload.withdrawalId !== withdrawal.withdrawalId
  ) {
    fail(
      `Active same-amount withdrawal returned different withdrawalId: ${duplicateActiveSameAmount.payload.withdrawalId}`
    );
  }

  const duplicateActiveDifferentAmount = await createWithdrawal(providerAuth, {
    amountUsdc: "101.000000",
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
  const adminQueue = await adminApi(
    `/api/admin/v1/withdrawal-reviews?limit=20`,
    adminAuth
  );
  const projected = (adminQueue.items || []).find(
    (item) => item.withdrawalId === withdrawal.withdrawalId
  );
  if (!projected) {
    fail(
      `gateway-admin did not project withdrawal ${withdrawal.withdrawalId} into /withdrawal-reviews.`
    );
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
      confirmedIntentId:
        confirmedDeposit.intent?.id || confirmedDeposit.id || null,
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
  console.error(
    `[admin-withdrawal-seed] fatal: ${
      error.stack || error.message || String(error)
    }`
  );
  process.exit(1);
});
