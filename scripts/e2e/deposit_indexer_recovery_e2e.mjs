#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";
import {
  accountId,
  addMoney,
  assertLocalOnly,
  assertMoneyEqual,
  fetchJson,
  fail,
  moneyCandidates,
  ownerId,
  privateKeyFromSeed,
  readJson,
  redact,
  redactedObject,
  restartGateway,
  selectJson,
  sqlLiteral,
  stripSlash,
  writeDepositRecoveryEvidence,
} from "./deposit_indexer_recovery_utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "");
const RUN_ID = process.env.DEPOSIT_INDEXER_RECOVERY_RUN_ID || TIMESTAMP;
const OUT_DIR = path.resolve(
  process.env.DEPOSIT_INDEXER_RECOVERY_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "output/dogfood/deposit-indexer-recovery",
      `${TIMESTAMP}-local`
    )
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const config = {
  runId: RUN_ID,
  frontendUrl: stripSlash(
    process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000"
  ),
  gatewayBase: stripSlash(
    process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
  ),
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  postgresDsn:
    process.env.DEPOSIT_INDEXER_RECOVERY_POSTGRES_DSN ||
    process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
    "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
  chainId: Number.parseInt(process.env.CHAIN_ID || "31337", 10),
  depositUsdc: process.env.DEPOSIT_INDEXER_RECOVERY_USDC || "100.000000",
  invalidUsdc: process.env.DEPOSIT_INDEXER_INVALID_EVENT_USDC || "11.000000",
  headless: process.env.DEPOSIT_INDEXER_RECOVERY_HEADLESS !== "0",
  deployerKey:
    process.env.DEPLOYER_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  primaryKey: privateKeyFromSeed(`deposit-indexer-recovery:primary:${RUN_ID}`),
  backfillKey: privateKeyFromSeed(
    `deposit-indexer-recovery:backfill:${RUN_ID}`
  ),
  invalidKey: privateKeyFromSeed(`deposit-indexer-recovery:invalid:${RUN_ID}`),
};

const evidence = {
  environment: "local",
  generatedAt: new Date().toISOString(),
  failed: [],
  steps: [],
  api: [],
  db: {},
  chain: {},
  screenshots: [],
};

let activeBrowser = null;
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const readRepoJson = (relativePath) => readJson(ROOT, relativePath);
const selectDbJson = (sql) => selectJson(config, ROOT, sql);
const restartLocalGateway = (label, overrides) =>
  restartGateway({ config, evidence, label, overrides, root: ROOT });

function addStep(name, ok, detail = "", extra = {}) {
  const row = { name, ok, detail: redact(detail), ...redactedObject(extra) };
  evidence.steps.push(row);
  if (!ok) evidence.failed.push(row);
  console.log(
    `[deposit-indexer-recovery] ${ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${redact(detail)}` : ""
    }`
  );
}

async function gatewayApi(
  pathname,
  { method = "GET", token, address, body, headers = {}, expectOk = true } = {}
) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;
  const result = await fetchJson(`${config.gatewayBase}/api${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  evidence.api.push(
    redactedObject({
      method,
      pathname,
      httpStatus: result.response.status,
      request: { headers: requestHeaders, body },
      response: result.payload,
    })
  );
  if (expectOk && !result.response.ok)
    fail(`${method} ${pathname} failed: ${result.response.status}`);
  return result;
}

async function rawGateway(pathname) {
  const result = await fetchJson(`${config.gatewayBase}${pathname}`);
  evidence.api.push(
    redactedObject({
      method: "GET",
      pathname,
      httpStatus: result.response.status,
      response: result.payload,
    })
  );
  if (!result.response.ok)
    fail(`GET ${pathname} failed: ${result.response.status}`);
  return result.payload;
}

async function authenticate(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const challenge = await gatewayApi(
    `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`
  );
  const message = challenge.payload.challenge || challenge.payload.message;
  const signature = await wallet.signMessage(message);
  const verified = await gatewayApi("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: wallet.address, message, signature },
  });
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  if (!token) fail("auth verify missing token");
  return { address: wallet.address, token, expiresAt: Date.now() + 86_400_000 };
}

async function chainContext() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId)
    fail(`RPC chainId mismatch ${network.chainId}`);
  const contracts = readRepoJson(
    "services/user-front/src/contract-config.json"
  );
  return {
    provider,
    coreAddress: ethers.getAddress(contracts.SynapseCore),
    usdcAddress: ethers.getAddress(contracts.MockUSDC),
    coreAbi: readRepoJson("services/user-front/src/SynapseCoreABI.json"),
    usdcAbi: readRepoJson("services/user-front/src/MockUSDCABI.json"),
  };
}

async function waitTx(label, makeTx) {
  const tx = await makeTx();
  const receipt = await tx.wait();
  if (receipt?.status !== 1) fail(`${label} tx failed: ${tx.hash}`);
  return {
    txHash: String(tx.hash).toLowerCase(),
    blockNumber: Number(receipt.blockNumber),
  };
}

async function fundAndDeposit(privateKey, amountUsdc) {
  const ctx = await chainContext();
  const deployer = new ethers.NonceManager(
    new ethers.Wallet(config.deployerKey, ctx.provider)
  );
  const consumer = new ethers.NonceManager(
    new ethers.Wallet(privateKey, ctx.provider)
  );
  const consumerAddress = await consumer.getAddress();
  const usdcDeployer = new ethers.Contract(
    ctx.usdcAddress,
    ctx.usdcAbi,
    deployer
  );
  const usdcConsumer = new ethers.Contract(
    ctx.usdcAddress,
    ctx.usdcAbi,
    consumer
  );
  const coreConsumer = new ethers.Contract(
    ctx.coreAddress,
    ctx.coreAbi,
    consumer
  );
  const decimals = Number(await usdcDeployer.decimals());
  const amountAtomic = ethers.parseUnits(amountUsdc, decimals);
  const balance = await ctx.provider.getBalance(consumerAddress);
  const targetEth = ethers.parseEther("1");
  if (balance < targetEth) {
    await waitTx("eth topup", () =>
      deployer.sendTransaction({
        to: consumerAddress,
        value: targetEth - balance,
      })
    );
  }
  await waitTx("mint usdc", () =>
    usdcDeployer.mint(consumerAddress, amountAtomic)
  );
  await waitTx("approve usdc", () =>
    usdcConsumer.approve(ctx.coreAddress, amountAtomic)
  );
  const deposit = await waitTx("vault deposit", () =>
    coreConsumer.deposit(amountAtomic)
  );
  return {
    ...deposit,
    amountUsdc,
    ownerAddress: consumerAddress,
    coreAddress: ctx.coreAddress,
  };
}

async function mintOnlyTx(privateKey, amountUsdc) {
  const ctx = await chainContext();
  const deployer = new ethers.NonceManager(
    new ethers.Wallet(config.deployerKey, ctx.provider)
  );
  const wallet = new ethers.Wallet(privateKey, ctx.provider);
  const usdc = new ethers.Contract(ctx.usdcAddress, ctx.usdcAbi, deployer);
  const decimals = Number(await usdc.decimals());
  const amountAtomic = ethers.parseUnits(amountUsdc, decimals);
  return waitTx("invalid mint-only tx", () =>
    usdc.mint(wallet.address, amountAtomic)
  );
}

function readDepositRows(txHash) {
  return selectDbJson(`
    SELECT deposit_id, owner_address, tx_hash, amount_usdc::text AS amount_usdc,
           status, request_id, created_at::text AS created_at, updated_at::text AS updated_at
    FROM synapse_vault_deposits
    WHERE tx_hash = ${sqlLiteral(txHash)}
    ORDER BY created_at DESC
  `);
}

function readBalanceRow(address) {
  const id = accountId(address);
  const rows = selectDbJson(`
    SELECT account_id, available_balance::text AS available_balance,
           pending_balance::text AS pending_balance,
           frozen_balance::text AS frozen_balance, updated_at::text AS updated_at
    FROM synapse_account_balances
    WHERE account_id = ${sqlLiteral(id)}
  `);
  return (
    rows[0] || {
      account_id: id,
      available_balance: "0.000000",
      pending_balance: "0.000000",
      frozen_balance: "0.000000",
    }
  );
}

function readAuditRows(address) {
  return selectDbJson(`
    SELECT event_type, owner_id, amount_delta::text AS amount_delta, result_status,
           detail_json, created_at::text AS created_at
    FROM synapse_audit_events
    WHERE owner_id = ${sqlLiteral(ownerId(address))}
      AND event_type = 'CONSUMER_DEPOSIT_CONFIRMED'
    ORDER BY created_at DESC
    LIMIT 10
  `);
}

async function registerDepositIntent(auth, deposit, idempotencyPrefix) {
  const response = await gatewayApi("/v1/balance/deposit/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: {
      "X-Idempotency-Key": `${idempotencyPrefix}-${deposit.txHash
        .replace(/^0x/, "")
        .slice(0, 80)}`,
    },
    body: { txHash: deposit.txHash, amountUsdc: deposit.amountUsdc },
  });
  const intent = response.payload.intent || {};
  if (!intent.id && !intent.depositId)
    fail(`deposit intent missing id: ${JSON.stringify(response.payload)}`);
  return intent;
}

async function pollDepositStatus(
  auth,
  txHash,
  expectedStatus,
  timeoutMs = 60_000
) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const result = await gatewayApi(
      `/v1/balance/deposit/sync?txHash=${encodeURIComponent(txHash)}`,
      {
        token: auth.token,
        address: auth.address,
      }
    );
    latest = result.payload.sync || {};
    if (String(latest.status || "").toUpperCase() === expectedStatus)
      return latest;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(
    `deposit ${txHash} did not reach ${expectedStatus}; latest=${JSON.stringify(
      latest
    )}`
  );
}

async function pollDbDeposit(txHash, expectedStatus, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let rows = [];
  while (Date.now() < deadline) {
    rows = readDepositRows(txHash);
    if (
      rows.some(
        (row) => String(row.status || "").toUpperCase() === expectedStatus
      )
    )
      return rows;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(
    `DB deposit ${txHash} did not reach ${expectedStatus}; rows=${JSON.stringify(
      rows
    )}`
  );
}

function assertPendingBeforeConfirm(before, pending, amount) {
  assertMoneyEqual(
    "available unchanged while indexer down",
    pending.available_balance,
    before.available_balance
  );
  assertMoneyEqual(
    "pending increased while indexer down",
    pending.pending_balance,
    addMoney(before.pending_balance, amount)
  );
}

function assertConfirmedAfterIndexer(before, final, amount) {
  assertMoneyEqual(
    "available increased after indexer recovery",
    final.available_balance,
    addMoney(before.available_balance, amount)
  );
  assertMoneyEqual(
    "pending returned after indexer recovery",
    final.pending_balance,
    before.pending_balance
  );
}

function wagmiStore(address) {
  return {
    state: {
      connections: {
        __type: "Map",
        value: [
          [
            "injected",
            {
              accounts: [address],
              chainId: config.chainId,
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
      chainId: config.chainId,
      current: "injected",
      status: "connected",
    },
    version: 2,
  };
}

async function installAuth(context, auth) {
  await context.addInitScript(
    ({ address, token, expiresAt, chainId, rpcUrl, store }) => {
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_selected_role", "CONSUMER");
      localStorage.setItem(
        `a2a_role_${String(address).toLowerCase()}`,
        "CONSUMER"
      );
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          wallet: String(address).toLowerCase(),
          token,
          expiresAt,
        })
      );
      localStorage.setItem("wagmi.store", JSON.stringify(store));
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      window.ethereum = {
        isMetaMask: true,
        chainId: `0x${Number(chainId).toString(16)}`,
        selectedAddress: address,
        isConnected: () => true,
        request: async (args) => {
          const method = args?.method;
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [address];
          if (method === "eth_chainId")
            return `0x${Number(chainId).toString(16)}`;
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
          if (payload.error)
            throw new Error(payload.error.message || "RPC failed");
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
      store: wagmiStore(auth.address),
    }
  );
}

async function screenshot(page, name, metadata) {
  const body = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  const forbidden = [
    "Connect Wallet",
    "Please connect your wallet",
    "Sign In",
    "Application error",
  ].find((text) => body.includes(text));
  if (forbidden)
    fail(`Screenshot ${name} blocked by forbidden text: ${forbidden}`);
  const relative = `screenshots/${name}`;
  await page.screenshot({
    path: path.join(OUT_DIR, relative),
    fullPage: false,
  });
  evidence.screenshots.push({
    path: relative,
    forbiddenTextAbsent: true,
    ...metadata,
  });
}

async function waitForAnyText(page, candidates, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const body = await page
      .locator("body")
      .innerText({ timeout: 5000 })
      .catch(() => "");
    const hit = candidates.find((candidate) => body.includes(candidate));
    if (hit) return hit;
    await page.waitForTimeout(500);
  }
  fail(`${label} did not find ${candidates.join(", ")}`);
}

async function assertBillingStatus(page, txHash, expected) {
  await page.goto(`${config.frontendUrl}/dashboard/billing`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const row = page
    .locator(`a[href*="${txHash}"]`)
    .locator("xpath=ancestor::tr")
    .first();
  await row.waitFor({ state: "visible", timeout: 30_000 });
  const text = await row.innerText();
  if (!text.includes(expected))
    fail(`billing row expected ${expected}; row=${text}`);
  return text;
}

async function capturePendingUi(auth, deposit, before, pending, depositId) {
  activeBrowser = await chromium.launch({
    headless: config.headless,
    args: ["--no-sandbox"],
  });
  const context = await activeBrowser.newContext({
    viewport: { width: 1180, height: 820 },
  });
  await installAuth(context, auth);
  const page = await context.newPage();
  const pendingRow = await assertBillingStatus(page, deposit.txHash, "Pending");
  if (pendingRow.includes("Completed"))
    fail(`pending row leaked Completed: ${pendingRow}`);
  await screenshot(page, "billing-pending-before-indexer.png", {
    expectedText: "Pending",
    actualDom: pendingRow,
    sqlStatus: "PENDING_CONFIRMATION",
    txHash: deposit.txHash,
    depositId,
  });
  await page.goto(`${config.frontendUrl}/dashboard/billing/credits`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const pendingText = await waitForAnyText(
    page,
    [
      "Pending / syncing credits",
      ...moneyCandidates(pending.pending_balance),
      ...moneyCandidates(before.available_balance),
    ],
    "credits pending before indexer"
  );
  await screenshot(page, "credits-pending-before-indexer.png", {
    expectedText: "Pending / syncing credits",
    actualDom: pendingText,
    sqlAvailableBalance: pending.available_balance,
    sqlPendingBalance: pending.pending_balance,
    depositId,
  });
  return { context, page };
}

async function captureCompletedUi(page, deposit, final, depositId) {
  const completedRow = await assertBillingStatus(
    page,
    deposit.txHash,
    "Completed"
  );
  await screenshot(page, "billing-completed-after-indexer.png", {
    expectedText: "Completed",
    actualDom: completedRow,
    sqlStatus: "CONFIRMED",
    txHash: deposit.txHash,
    depositId,
  });
  await page.goto(`${config.frontendUrl}/dashboard/billing/credits`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const availableText = await waitForAnyText(
    page,
    moneyCandidates(final.available_balance),
    "credits available after indexer"
  );
  await screenshot(page, "credits-available-after-indexer.png", {
    expectedBalance: final.available_balance,
    actualDom: availableText,
    sqlAvailableBalance: final.available_balance,
    depositId,
  });
}

async function preflight() {
  assertLocalOnly(config);
  await fetch(`${config.gatewayBase}/health`).then((response) => {
    if (!response.ok) fail(`Gateway health failed: ${response.status}`);
  });
  await fetch(config.frontendUrl).then((response) => {
    if (!response.ok) fail(`User-front failed: ${response.status}`);
  });
  await chainContext();
  addStep("preflight:local-api-db-chain-ui", true);
}

async function scenarioTaskDownPendingUi() {
  restartLocalGateway("gateway:indexer-disabled", {
    V2_INDEXER_ENABLED: "false",
    V2_BACKFILL_ENABLED: "false",
    DEPOSIT_INDEXER_TRIGGER_ENABLED: "false",
  });
  const readiness = await rawGateway("/readiness");
  const monitor = readiness.monitors?.deposit_indexer || {};
  if (monitor.enabled !== false)
    fail(`deposit_indexer should be disabled: ${JSON.stringify(monitor)}`);
  const auth = await authenticate(config.primaryKey);
  const before = readBalanceRow(auth.address);
  const deposit = await fundAndDeposit(config.primaryKey, config.depositUsdc);
  const intent = await registerDepositIntent(auth, deposit, "dir-intent-down");
  const rows = readDepositRows(deposit.txHash);
  const pending = readBalanceRow(auth.address);
  if (rows[0]?.status !== "PENDING_CONFIRMATION")
    fail(`expected pending row: ${JSON.stringify(rows)}`);
  assertPendingBeforeConfirm(before, pending, deposit.amountUsdc);
  evidence.db.taskDown = {
    beforeBalance: before,
    pendingBalance: pending,
    deposits: rows,
    readiness: monitor,
  };
  evidence.chain.primary = { ...deposit, accountId: accountId(auth.address) };
  addStep("task_down_pending_ui", true, deposit.txHash);
  const ui = await capturePendingUi(
    auth,
    deposit,
    before,
    pending,
    intent.id || intent.depositId
  );
  return {
    auth,
    deposit,
    before,
    ui,
    depositId: intent.id || intent.depositId,
  };
}

async function scenarioRestartAutoCredit(state) {
  restartLocalGateway("gateway:indexer-enabled", {
    V2_INDEXER_ENABLED: "true",
    V2_INDEXER_POLL_INTERVAL_SEC: "1",
    V2_INDEXER_STARTUP_DELAY_SEC: "0",
    V2_DEPOSIT_CONFIRMATIONS: "1",
    V2_BACKFILL_ENABLED: "false",
  });
  const sync = await pollDepositStatus(
    state.auth,
    state.deposit.txHash,
    "CONFIRMED"
  );
  const rows = readDepositRows(state.deposit.txHash);
  const final = readBalanceRow(state.auth.address);
  assertConfirmedAfterIndexer(state.before, final, state.deposit.amountUsdc);
  const auditRows = readAuditRows(state.auth.address);
  if (!auditRows.length) fail("CONSUMER_DEPOSIT_CONFIRMED audit missing");
  evidence.db.autoCredit = { sync, deposits: rows, balance: final, auditRows };
  addStep("restart_auto_credit", true, state.deposit.txHash);
  await captureCompletedUi(
    state.ui.page,
    state.deposit,
    final,
    state.depositId
  );
  await activeBrowser.close();
  activeBrowser = null;
  return { ...state, final };
}

async function scenarioReplaySafe(state) {
  restartLocalGateway("gateway:indexer-replay", {
    V2_INDEXER_ENABLED: "true",
    V2_INDEXER_POLL_INTERVAL_SEC: "1",
    V2_INDEXER_STARTUP_DELAY_SEC: "0",
    V2_DEPOSIT_CONFIRMATIONS: "1",
    V2_BACKFILL_ENABLED: "false",
  });
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const replayBalance = readBalanceRow(state.auth.address);
  const replayRows = readDepositRows(state.deposit.txHash);
  assertMoneyEqual(
    "replay available unchanged",
    replayBalance.available_balance,
    state.final.available_balance
  );
  assertMoneyEqual(
    "replay pending unchanged",
    replayBalance.pending_balance,
    state.final.pending_balance
  );
  evidence.db.replay = { balance: replayBalance, deposits: replayRows };
  addStep("replay_safe", true, state.deposit.txHash);
}

async function scenarioMissedIntentBackfill() {
  restartLocalGateway("gateway:indexer-disabled-backfill-fixture", {
    V2_INDEXER_ENABLED: "false",
    V2_BACKFILL_ENABLED: "false",
  });
  const auth = await authenticate(config.backfillKey);
  const before = readBalanceRow(auth.address);
  const deposit = await fundAndDeposit(config.backfillKey, config.depositUsdc);
  restartLocalGateway("gateway:indexer-backfill", {
    V2_INDEXER_ENABLED: "true",
    V2_INDEXER_POLL_INTERVAL_SEC: "1",
    V2_INDEXER_STARTUP_DELAY_SEC: "0",
    V2_DEPOSIT_CONFIRMATIONS: "1",
    V2_BACKFILL_ENABLED: "true",
    V2_BACKFILL_START_BLOCK: String(deposit.blockNumber),
    V2_BACKFILL_BLOCK_BATCH: "25",
  });
  const rows = await pollDbDeposit(deposit.txHash, "CONFIRMED");
  const final = readBalanceRow(auth.address);
  assertConfirmedAfterIndexer(before, final, deposit.amountUsdc);
  evidence.db.backfill = {
    beforeBalance: before,
    finalBalance: final,
    deposits: rows,
  };
  evidence.chain.backfill = { ...deposit, accountId: accountId(auth.address) };
  addStep("missed_intent_backfill", true, deposit.txHash, {
    startBlock: deposit.blockNumber,
  });
}

async function scenarioInvalidEventNoCredit() {
  const auth = await authenticate(config.invalidKey);
  const before = readBalanceRow(auth.address);
  const invalidTx = await mintOnlyTx(config.invalidKey, config.invalidUsdc);
  const fakeDeposit = {
    txHash: invalidTx.txHash,
    amountUsdc: config.invalidUsdc,
  };
  await registerDepositIntent(auth, fakeDeposit, "dir-invalid-event");
  await pollDbDeposit(invalidTx.txHash, "FAILED");
  const after = readBalanceRow(auth.address);
  assertMoneyEqual(
    "invalid event available unchanged",
    after.available_balance,
    before.available_balance
  );
  evidence.db.invalidEvent = {
    beforeBalance: before,
    afterBalance: after,
    deposits: readDepositRows(invalidTx.txHash),
  };
  evidence.chain.invalidEvent = { ...invalidTx, ownerAddress: auth.address };
  addStep("invalid_event_no_credit", true, invalidTx.txHash);
}

async function main() {
  await preflight();
  const pendingState = await scenarioTaskDownPendingUi();
  const creditedState = await scenarioRestartAutoCredit(pendingState);
  await scenarioReplaySafe(creditedState);
  await scenarioMissedIntentBackfill();
  await scenarioInvalidEventNoCredit();
  writeEvidence("success");
}

main().catch(async (error) => {
  if (activeBrowser) await activeBrowser.close().catch(() => {});
  addStep(
    "fatal",
    false,
    error instanceof Error
      ? `${error.message}\n${error.stack || ""}`
      : String(error)
  );
  writeEvidence("failed");
  process.exitCode = 1;
});

function writeEvidence(status) {
  writeDepositRecoveryEvidence({ config, evidence, outDir: OUT_DIR, status });
}
