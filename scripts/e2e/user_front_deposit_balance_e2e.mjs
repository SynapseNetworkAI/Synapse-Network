#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";
import { writeDepositBalanceEvidence } from "./deposit_balance_evidence_writer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TIMESTAMP = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const RUN_ID = process.env.USER_FRONT_DEPOSIT_BALANCE_RUN_ID || TIMESTAMP;
const OUT_DIR = path.resolve(
  process.env.USER_FRONT_DEPOSIT_BALANCE_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "output/dogfood/user-front-deposit-balance",
      `${TIMESTAMP}-local`
    )
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const config = {
  frontendUrl: stripSlash(
    process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000"
  ),
  gatewayBase: stripSlash(
    process.env.USER_FRONT_GATEWAY_BASE_URL || "http://127.0.0.1:8000"
  ),
  rpcUrl: process.env.USER_FRONT_RPC_URL || "http://127.0.0.1:8545",
  postgresDsn:
    process.env.USER_FRONT_DEPOSIT_BALANCE_POSTGRES_DSN ||
    process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
    "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
  chainId: Number.parseInt(process.env.CHAIN_ID || "31337", 10),
  depositUsdc: process.env.USER_FRONT_DEPOSIT_BALANCE_USDC || "100.000000",
  headless: process.env.USER_FRONT_DEPOSIT_BALANCE_HEADLESS !== "0",
  deployerKey:
    process.env.DEPLOYER_KEY ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  consumerKey:
    process.env.USER_FRONT_DEPOSIT_BALANCE_CONSUMER_KEY ||
    privateKeyFromSeed(`synapse-user-front-deposit-balance:${RUN_ID}`),
  runId: RUN_ID,
};

const evidence = {
  environment: "local",
  generatedAt: new Date().toISOString(),
  steps: [],
  failed: [],
  screenshots: [],
  db: {},
  chain: {},
  dom: {},
  api: [],
};
let activeBrowser = null;

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function privateKeyFromSeed(seed) {
  return `0x${crypto.createHash("sha256").update(seed).digest("hex")}`;
}

function addStep(name, ok, detail = "", extra = {}) {
  const row = { name, ok, detail: redact(detail), ...redactedObject(extra) };
  evidence.steps.push(row);
  if (!ok) evidence.failed.push(row);
  console.log(
    `[deposit-balance-e2e] ${ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${redact(detail)}` : ""
    }`
  );
}

function fail(message) {
  throw new Error(message);
}

function redact(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /"((?:password|privateKey|signature|jwt|token|secret|authorization)[^"]*)"\s*:\s*"[^"]+"/gi,
      '"$1":"[REDACTED]"'
    );
}

function redactedObject(value) {
  return JSON.parse(redact(JSON.stringify(value ?? null)));
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
  if (config.chainId !== 31337) {
    fail(
      `Refusing to run local deposit-balance E2E on chainId=${config.chainId}`
    );
  }
  for (const [name, value] of [
    ["frontendUrl", config.frontendUrl],
    ["gatewayBase", config.gatewayBase],
    ["rpcUrl", config.rpcUrl],
  ]) {
    if (!isLocalUrl(value)) {
      fail(
        `Refusing to run local deposit-balance E2E against non-local ${name}=${value}`
      );
    }
  }
  if (
    !config.postgresDsn.includes("127.0.0.1") &&
    !config.postgresDsn.includes("localhost")
  ) {
    fail(
      "Refusing to run local deposit-balance E2E against non-local Postgres DSN"
    );
  }
  if (!config.postgresDsn.endsWith("/synapse_gateway")) {
    fail(
      "USER_FRONT_DEPOSIT_BALANCE_POSTGRES_DSN must point at local synapse_gateway"
    );
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
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
    fail(`psql query failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function psqlExec(sql) {
  const result = spawnSync(
    "psql",
    [config.postgresDsn, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    fail(`psql exec failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
}

function selectJson(sql) {
  return psqlJson(
    `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (${sql}) AS t;`
  );
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
  const whole = atomic / scale;
  const fraction = String(atomic % scale).padStart(decimals, "0");
  return `${whole}.${fraction}`;
}

function addMoney(value, delta) {
  return atomicToDecimal(decimalToAtomic(value) + decimalToAtomic(delta));
}

function moneyCandidates(value) {
  const atomic = decimalToAtomic(value);
  const six = atomicToDecimal(atomic);
  const asNumber = Number(atomic) / 1_000_000;
  const roundedTwo = asNumber.toFixed(2);
  const centsFloor = atomic / 10_000n;
  const floorTwo = `${centsFloor / 100n}.${String(centsFloor % 100n).padStart(
    2,
    "0"
  )}`;
  return [
    ...new Set([
      six,
      roundedTwo,
      floorTwo,
      `$${roundedTwo}`,
      `$${floorTwo}`,
      `${roundedTwo} USDC`,
      `${floorTwo} USDC`,
    ]),
  ];
}

async function api(
  pathname,
  { method = "GET", token, address, body, headers = {}, expectOk = true } = {}
) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;
  const response = await fetch(`${config.gatewayBase}/api${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  evidence.api.push(
    redactedObject({
      method,
      pathname,
      httpStatus: response.status,
      request: { headers: requestHeaders, body },
      response: payload,
    })
  );
  if (expectOk && !response.ok) {
    fail(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return { response, payload };
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
  if (!token) fail("auth verify missing token");
  return {
    address,
    token,
    privateKey,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    fail(
      `RPC chainId mismatch: expected=${config.chainId} actual=${network.chainId}`
    );
  }
  const contractConfig = readJson(
    "services/user-front/src/contract-config.json"
  );
  return {
    provider,
    coreAddress: ethers.getAddress(contractConfig.SynapseCore),
    usdcAddress: ethers.getAddress(contractConfig.MockUSDC),
    coreAbi: readJson("services/user-front/src/SynapseCoreABI.json"),
    usdcAbi: readJson("services/user-front/src/MockUSDCABI.json"),
  };
}

async function sendTx(label, makeTx) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const tx = await makeTx();
      const receipt = await tx.wait();
      if (receipt?.status !== 1)
        fail(`${label} transaction failed: ${tx.hash}`);
      return tx.hash;
    } catch (error) {
      lastError = error;
      const code = error?.code || error?.error?.code || "";
      const message = String(
        error?.message || error?.info?.error?.message || ""
      );
      const isNonceRace =
        code === "NONCE_EXPIRED" ||
        message.toLowerCase().includes("nonce too low") ||
        message.toLowerCase().includes("nonce has already been used");
      if (!isNonceRace || attempt === 3) break;
      console.warn(
        `[deposit-balance-e2e] retry ${label} after local nonce race (attempt ${attempt})`
      );
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError;
}

async function chainDeposit(consumerAddress) {
  const { provider, coreAddress, usdcAddress, coreAbi, usdcAbi } =
    await getChainContext();
  const deployer = new ethers.NonceManager(
    new ethers.Wallet(config.deployerKey, provider)
  );
  const consumerWallet = new ethers.Wallet(config.consumerKey, provider);
  const consumer = new ethers.NonceManager(consumerWallet);
  const usdcDeployer = new ethers.Contract(usdcAddress, usdcAbi, deployer);
  const usdcConsumer = new ethers.Contract(usdcAddress, usdcAbi, consumer);
  const coreConsumer = new ethers.Contract(coreAddress, coreAbi, consumer);
  const decimals = Number(await usdcDeployer.decimals());
  const amountAtomic = ethers.parseUnits(config.depositUsdc, decimals);

  const ethBalance = await provider.getBalance(consumerAddress);
  const targetEth = ethers.parseEther("1");
  if (ethBalance < targetEth) {
    await sendTx("eth-topup", () =>
      deployer.sendTransaction({
        to: consumerAddress,
        value: targetEth - ethBalance,
      })
    );
  }
  await sendTx("mint-usdc", () =>
    usdcDeployer.mint(consumerAddress, amountAtomic)
  );
  await sendTx("approve-usdc", () =>
    usdcConsumer.approve(coreAddress, amountAtomic)
  );
  const txRequest = await coreConsumer.deposit.populateTransaction(
    amountAtomic
  );
  const populatedTx = await consumer.populateTransaction({
    ...txRequest,
    chainId: config.chainId,
  });
  const signedDepositTx = await consumerWallet.signTransaction(populatedTx);
  const txHash = ethers.keccak256(signedDepositTx);

  return {
    txHash: String(txHash).toLowerCase(),
    amountUsdc: config.depositUsdc,
    coreAddress,
    usdcAddress,
    decimals,
    broadcastDeposit: async () => {
      const tx = await provider.broadcastTransaction(signedDepositTx);
      const receipt = await tx.wait();
      if (receipt?.status !== 1) {
        fail(`deposit transaction failed: ${tx.hash}`);
      }
      return String(tx.hash).toLowerCase();
    },
  };
}

function readDepositRows(txHash) {
  return selectJson(`
    SELECT deposit_id, owner_id, owner_address, target_account_id, tx_hash,
           amount_usdc::text AS amount_usdc, status, block_number,
           request_id, created_at::text AS created_at, updated_at::text AS updated_at
    FROM synapse_vault_deposits
    WHERE tx_hash = ${sqlLiteral(txHash)}
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
    }
  );
}

function readConsumerWithdrawalRows(ownerAddress) {
  const ownerId = `owner:${String(ownerAddress || "").toLowerCase()}`;
  return selectJson(`
    SELECT withdrawal_id, owner_id, source_account_id, withdrawal_kind,
           amount_usdc::text AS amount_usdc, status, tx_hash, ticket_id,
           ticket_hash, deadline, request_id,
           created_at::text AS created_at, updated_at::text AS updated_at
    FROM synapse_vault_withdrawals
    WHERE owner_id = ${sqlLiteral(ownerId)}
      AND withdrawal_kind = 'consumer_refund'
    ORDER BY created_at DESC
  `);
}

function readAuditRows(ownerId) {
  return selectJson(`
    SELECT event_type, business_type, owner_id, amount_delta::text AS amount_delta,
           result_status, error_code, detail_json, created_at::text AS created_at
    FROM synapse_audit_events
    WHERE owner_id = ${sqlLiteral(ownerId)}
      AND event_type = 'CONSUMER_DEPOSIT_CONFIRMED'
    ORDER BY created_at DESC
    LIMIT 10
  `);
}

function assertMoneyEqual(name, actual, expected) {
  if (decimalToAtomic(actual) !== decimalToAtomic(expected)) {
    fail(`${name}: expected ${expected}, got ${actual}`);
  }
}

function assertRow(name, condition, detail) {
  if (!condition) fail(`${name}: ${detail}`);
}

function errorCodeFromPayload(payload) {
  return (
    payload?.detail?.code ||
    payload?.code ||
    payload?.error?.code ||
    payload?.detail?.[0]?.type ||
    ""
  );
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
          if (payload.error)
            throw new Error(payload.error.message || "RPC request failed");
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

async function screenshot(page, name, metadata) {
  const relative = `screenshots/${name}`;
  const out = path.join(OUT_DIR, relative);
  await page.screenshot({ path: out, fullPage: false });
  evidence.screenshots.push({ path: relative, ...metadata });
}

async function waitForAnyText(page, candidates, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastBody = "";
  while (Date.now() < deadline) {
    lastBody = await page
      .locator("body")
      .innerText({ timeout: 5000 })
      .catch(() => "");
    const found = candidates.find((candidate) => lastBody.includes(candidate));
    if (found) return found;
    await page.waitForTimeout(500);
  }
  fail(
    `${label} did not find any of: ${candidates.join(
      ", "
    )}. Body: ${lastBody.slice(0, 1000)}`
  );
}

async function readBodyText(page) {
  return page
    .locator("body")
    .innerText({ timeout: 10000 })
    .catch(() => "");
}

async function assertCreditsSpendableWithdrawable(
  page,
  { spendable, withdrawable }
) {
  await page.goto(`${config.frontendUrl}/dashboard/billing/credits`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const spendableMatched = await waitForAnyText(
    page,
    moneyCandidates(spendable),
    "credits spendable balance"
  );
  const bodyText = await readBodyText(page);
  assertRow(
    "credits spendable label",
    bodyText.includes("Spendable credits"),
    bodyText.slice(0, 1000)
  );
  assertRow(
    "credits withdrawable label",
    bodyText.includes("Withdrawable credits"),
    bodyText.slice(0, 1000)
  );
  const withdrawableMatch = moneyCandidates(withdrawable).find((candidate) =>
    bodyText.includes(candidate)
  );
  assertRow(
    "credits withdrawable amount",
    Boolean(withdrawableMatch),
    `expected one of ${moneyCandidates(withdrawable).join(
      ", "
    )} in ${bodyText.slice(0, 1000)}`
  );
  const tooltip =
    (await page
      .locator('[aria-label*="AML"]')
      .first()
      .getAttribute("aria-label")
      .catch(() => "")) || "";
  assertRow(
    "credits withdrawable tooltip AML",
    tooltip.includes("AML") && tooltip.includes("7 days"),
    tooltip || "missing aria-label tooltip"
  );
  return {
    spendableMatched,
    withdrawableMatched: withdrawableMatch,
    tooltip,
    bodyText: bodyText.slice(0, 1600),
  };
}

async function assertWithdrawModalT7Disabled(page) {
  await page
    .getByRole("button", { name: /^Withdraw$/ })
    .first()
    .click();
  await page
    .getByRole("heading", { name: "Withdraw Balance" })
    .waitFor({ state: "visible", timeout: 30000 });
  const bodyText = await readBodyText(page);
  const expectedWarning =
    "Recent deposits are available for API usage, but require T+7 before withdrawal.";
  const expectedRule = "Minimum withdrawal amount: 10.00 USDC";
  assertRow(
    "withdraw modal T+7 warning",
    bodyText.includes(expectedWarning),
    bodyText
  );
  assertRow(
    "withdraw modal min rule",
    bodyText.includes(expectedRule),
    bodyText
  );
  const submit = page.getByRole("button", { name: /^Withdraw$/ }).last();
  const submitDisabled = await submit.isDisabled();
  assertRow("withdraw modal submit disabled", submitDisabled, bodyText);
  return {
    expectedWarning,
    expectedRule,
    submitDisabled,
    bodyText: bodyText.slice(0, 1600),
  };
}

async function assertBillingRowStatus(
  page,
  txHash,
  expectedStatus,
  amountUsdc
) {
  await page.goto(`${config.frontendUrl}/dashboard/billing`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const amountCandidates = moneyCandidates(amountUsdc || config.depositUsdc);
  const deadline = Date.now() + 30000;
  let lastBody = "";
  while (Date.now() < deadline) {
    const row = page
      .locator("tr")
      .filter({ hasText: expectedStatus })
      .filter({ hasText: "Deposit" })
      .first();
    if (await row.isVisible().catch(() => false)) {
      const text = await row.innerText();
      if (amountCandidates.some((candidate) => text.includes(candidate))) {
        return text;
      }
    }
    const linkRow = page
      .locator(`a[href*="${txHash}"]`)
      .locator("xpath=ancestor::tr")
      .first();
    if (await linkRow.isVisible().catch(() => false)) {
      const text = await linkRow.innerText();
      if (
        text.includes(expectedStatus) &&
        amountCandidates.some((candidate) => text.includes(candidate))
      ) {
        return text;
      }
    }
    lastBody = await readBodyText(page);
    await page.waitForTimeout(500);
  }
  fail(
    `billing row for ${txHash} expected ${expectedStatus}/Deposit/${amountCandidates.join(
      " or "
    )}; body=${lastBody.slice(0, 1200)}`
  );
}

async function main() {
  assertLocalOnly();
  await fetch(`${config.gatewayBase}/health`).then((res) => {
    if (!res.ok) fail(`Gateway health failed: ${res.status}`);
  });
  await fetch(config.frontendUrl).then((res) => {
    if (!res.ok) fail(`User-front not reachable: ${res.status}`);
  });
  addStep("preflight:local-api-db-chain-ui", true);

  const auth = await authenticate(config.consumerKey);
  const accountId = `consumer_wallet::${auth.address.toLowerCase()}`;
  const beforeBalance = readBalanceRow(accountId);
  evidence.db.beforeBalance = beforeBalance;

  const chain = await chainDeposit(auth.address);
  evidence.chain = { ...chain, ownerAddress: auth.address, accountId };

  const intentResponse = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: {
      "X-Idempotency-Key": `ufd-deposit-${chain.txHash
        .replace(/^0x/, "")
        .slice(0, 80)}`,
    },
    body: { txHash: chain.txHash, amountUsdc: chain.amountUsdc },
  });
  const intent =
    intentResponse.payload.intent || intentResponse.payload.deposit || {};
  const depositId = intent.id || intent.depositId;
  if (!depositId)
    fail(
      `deposit intent response missing id: ${JSON.stringify(
        intentResponse.payload
      ).slice(0, 600)}`
    );

  const pendingDeposits = readDepositRows(chain.txHash);
  assertRow(
    "pending deposit row count",
    pendingDeposits.length === 1,
    JSON.stringify(pendingDeposits)
  );
  assertRow(
    "pending deposit status",
    pendingDeposits[0].status === "PENDING_CONFIRMATION",
    JSON.stringify(pendingDeposits[0])
  );
  assertMoneyEqual(
    "pending deposit amount",
    pendingDeposits[0].amount_usdc,
    chain.amountUsdc
  );
  const pendingBalance = readBalanceRow(accountId);
  assertMoneyEqual(
    "pending available unchanged",
    pendingBalance.available_balance,
    beforeBalance.available_balance
  );
  assertMoneyEqual(
    "pending balance increased",
    pendingBalance.pending_balance,
    addMoney(beforeBalance.pending_balance, chain.amountUsdc)
  );
  evidence.db.pending = { deposits: pendingDeposits, balance: pendingBalance };
  addStep("db:pending-deposit", true);

  activeBrowser = await chromium.launch({
    headless: config.headless,
    args: ["--no-sandbox"],
  });
  const context = await activeBrowser.newContext({
    viewport: { width: 1180, height: 820 },
  });
  await installAuth(context, auth);
  const page = await context.newPage();
  const pendingRowText = await assertBillingRowStatus(
    page,
    chain.txHash,
    "Pending",
    chain.amountUsdc
  );
  if (pendingRowText.includes("Completed"))
    fail(`pending billing row leaked Completed: ${pendingRowText}`);
  evidence.dom.billingPending = pendingRowText;
  await screenshot(page, "billing-deposit-pending.png", {
    expectedDom: "Pending",
    actualDom: pendingRowText,
    sqlStatus: pendingDeposits[0].status,
    txHash: chain.txHash,
    depositId,
  });

  await page.goto(`${config.frontendUrl}/dashboard/billing/credits`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const beforeMatched = await waitForAnyText(
    page,
    moneyCandidates(beforeBalance.available_balance),
    "credits before confirm balance"
  );
  evidence.dom.creditsBefore = beforeMatched;
  await screenshot(page, "credits-before-confirm.png", {
    expectedBalance: beforeBalance.available_balance,
    actualDom: beforeMatched,
    sqlAvailableBalance: pendingBalance.available_balance,
    depositId,
  });

  const minedDepositTxHash = await chain.broadcastDeposit();
  assertRow(
    "broadcast deposit tx hash",
    minedDepositTxHash === chain.txHash,
    `${minedDepositTxHash} !== ${chain.txHash}`
  );
  evidence.chain.depositBroadcastTxHash = minedDepositTxHash;
  addStep("chain:deposit", true, chain.txHash, {
    amountUsdc: chain.amountUsdc,
  });

  const confirmedResponse = await api(
    `/v1/balance/deposit/intents/${encodeURIComponent(depositId)}/confirm`,
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      body: {
        eventKey: `user-front-deposit-balance:${chain.txHash}`,
        confirmations: 1,
      },
    }
  );
  const confirmed =
    confirmedResponse.payload.intent || confirmedResponse.payload;
  if ((confirmed.status || "").toUpperCase() !== "CONFIRMED") {
    fail(
      `confirm response did not return CONFIRMED: ${JSON.stringify(
        confirmed
      ).slice(0, 600)}`
    );
  }

  const finalDeposits = readDepositRows(chain.txHash);
  const finalBalance = readBalanceRow(accountId);
  assertRow(
    "final deposit row count",
    finalDeposits.length === 1,
    JSON.stringify(finalDeposits)
  );
  assertRow(
    "final deposit status",
    finalDeposits[0].status === "CONFIRMED",
    JSON.stringify(finalDeposits[0])
  );
  assertMoneyEqual(
    "final available increased once",
    finalBalance.available_balance,
    addMoney(beforeBalance.available_balance, chain.amountUsdc)
  );
  assertMoneyEqual(
    "final pending restored",
    finalBalance.pending_balance,
    beforeBalance.pending_balance
  );

  const duplicateConfirmResponse = await api(
    `/v1/balance/deposit/intents/${encodeURIComponent(depositId)}/confirm`,
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      body: {
        eventKey: `user-front-deposit-balance-replay:${chain.txHash}`,
        confirmations: 1,
      },
    }
  );
  const duplicateIntentResponse = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: {
      "X-Idempotency-Key": `ufd-deposit-replay-${chain.txHash
        .replace(/^0x/, "")
        .slice(0, 75)}`,
    },
    body: { txHash: chain.txHash, amountUsdc: chain.amountUsdc },
    expectOk: false,
  });
  const replayDeposits = readDepositRows(chain.txHash);
  const replayBalance = readBalanceRow(accountId);
  assertRow(
    "replay deposit row count",
    replayDeposits.length === 1,
    JSON.stringify(replayDeposits)
  );
  assertMoneyEqual(
    "replay available unchanged",
    replayBalance.available_balance,
    finalBalance.available_balance
  );
  assertMoneyEqual(
    "replay pending unchanged",
    replayBalance.pending_balance,
    finalBalance.pending_balance
  );

  const auditRows = readAuditRows(`owner:${auth.address.toLowerCase()}`);
  assertRow(
    "deposit audit exists",
    auditRows.length > 0,
    "CONSUMER_DEPOSIT_CONFIRMED missing"
  );
  evidence.db.final = {
    deposits: finalDeposits,
    balance: finalBalance,
    auditRows,
  };
  evidence.db.replay = {
    duplicateConfirmStatus: duplicateConfirmResponse.response.status,
    duplicateIntentStatus: duplicateIntentResponse.response.status,
    deposits: replayDeposits,
    balance: replayBalance,
  };
  addStep("db:confirmed-deposit-and-replay-safe", true);

  const balanceResponse = await api("/v1/balance", {
    token: auth.token,
    address: auth.address,
  });
  const balancePayload =
    balanceResponse.payload.balance || balanceResponse.payload;
  assertMoneyEqual(
    "api consumer available after confirm",
    balancePayload.consumerAvailableBalance,
    finalBalance.available_balance
  );
  assertMoneyEqual(
    "api consumer withdrawable before T+7",
    balancePayload.consumerWithdrawableBalance,
    "0.000000"
  );
  assertRow(
    "api consumer maturity seconds",
    Number(balancePayload.consumerWithdrawMaturitySeconds) === 604800,
    JSON.stringify(balancePayload)
  );
  evidence.db.confirmedButNotMature = {
    balance: finalBalance,
    apiBalance: redactedObject(balancePayload),
  };
  addStep("api:confirmed-balance-not-mature", true, "", {
    consumerAvailableBalance: balancePayload.consumerAvailableBalance,
    consumerWithdrawableBalance: balancePayload.consumerWithdrawableBalance,
    consumerWithdrawMaturitySeconds:
      balancePayload.consumerWithdrawMaturitySeconds,
  });

  const completedRowText = await assertBillingRowStatus(
    page,
    chain.txHash,
    "Completed",
    chain.amountUsdc
  );
  evidence.dom.billingCompleted = completedRowText;
  await screenshot(page, "billing-deposit-completed.png", {
    expectedDom: "Completed",
    actualDom: completedRowText,
    sqlStatus: finalDeposits[0].status,
    txHash: chain.txHash,
    depositId,
  });

  await page.goto(`${config.frontendUrl}/dashboard/billing/credits`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const afterMatched = await waitForAnyText(
    page,
    moneyCandidates(finalBalance.available_balance),
    "credits after confirm balance"
  );
  evidence.dom.creditsAfter = afterMatched;
  await screenshot(page, "credits-after-confirm.png", {
    expectedBalance: finalBalance.available_balance,
    actualDom: afterMatched,
    sqlAvailableBalance: finalBalance.available_balance,
    depositId,
  });
  const notMatureDom = await assertCreditsSpendableWithdrawable(page, {
    spendable: finalBalance.available_balance,
    withdrawable: "0.000000",
  });
  evidence.dom.creditsConfirmedButNotMature = notMatureDom;
  await screenshot(page, "credits-after-confirm-withdrawable-zero.png", {
    expectedSpendableBalance: finalBalance.available_balance,
    expectedWithdrawableBalance: "0.000000",
    actualDom: notMatureDom.bodyText,
    tooltip: notMatureDom.tooltip,
    apiBalance: redactedObject(balancePayload),
    apiWithdrawableBalance: balancePayload.consumerWithdrawableBalance,
    sqlAvailableBalance: finalBalance.available_balance,
    sqlPendingBalance: finalBalance.pending_balance,
    depositId,
  });
  addStep("ui:credits-withdrawable-zero", true);

  const withdrawModalDom = await assertWithdrawModalT7Disabled(page);
  evidence.dom.withdrawModalT7Disabled = withdrawModalDom;
  await screenshot(page, "withdraw-modal-t7-disabled.png", {
    expectedWarning: withdrawModalDom.expectedWarning,
    expectedRule: withdrawModalDom.expectedRule,
    actualDom: withdrawModalDom.bodyText,
    submitDisabled: withdrawModalDom.submitDisabled,
    apiBalance: redactedObject(balancePayload),
    sqlBalance: finalBalance,
    depositId,
  });
  addStep("ui:withdraw-modal-t7-disabled", true);

  const withdrawalsBefore = readConsumerWithdrawalRows(auth.address);
  const immatureWithdrawResponse = await api("/v1/balance/consumer/withdraw", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: { "X-Idempotency-Key": `ufd-immature-withdraw-${RUN_ID}` },
    body: {
      amountUsdc: chain.amountUsdc,
      reason: `user-front-deposit-balance immature withdraw ${RUN_ID}`,
    },
    expectOk: false,
  });
  const immatureCode = errorCodeFromPayload(immatureWithdrawResponse.payload);
  assertRow(
    "immature withdraw status",
    immatureWithdrawResponse.response.status === 400,
    `${immatureWithdrawResponse.response.status} ${JSON.stringify(
      immatureWithdrawResponse.payload
    ).slice(0, 600)}`
  );
  assertRow(
    "immature withdraw error code",
    immatureCode === "INSUFFICIENT_MATURE_CONSUMER_BALANCE",
    JSON.stringify(immatureWithdrawResponse.payload)
  );
  const withdrawalsAfter = readConsumerWithdrawalRows(auth.address);
  const blockedBalance = readBalanceRow(accountId);
  assertRow(
    "immature withdraw created no row",
    withdrawalsAfter.length === withdrawalsBefore.length,
    JSON.stringify({ withdrawalsBefore, withdrawalsAfter })
  );
  assertMoneyEqual(
    "immature withdraw available unchanged",
    blockedBalance.available_balance,
    finalBalance.available_balance
  );
  assertMoneyEqual(
    "immature withdraw pending unchanged",
    blockedBalance.pending_balance,
    finalBalance.pending_balance
  );
  assertMoneyEqual(
    "immature withdraw frozen unchanged",
    blockedBalance.frozen_balance,
    finalBalance.frozen_balance
  );
  evidence.db.immatureWithdrawBlocked = {
    httpStatus: immatureWithdrawResponse.response.status,
    errorCode: immatureCode,
    withdrawalsBefore,
    withdrawalsAfter,
    balanceAfterBlocked: blockedBalance,
  };
  addStep("api:immature-withdraw-blocked-no-row", true, immatureCode);

  psqlExec(`
    UPDATE synapse_vault_deposits
    SET updated_at = NOW() - INTERVAL '8 days'
    WHERE deposit_id = ${sqlLiteral(depositId)}
      AND tx_hash = ${sqlLiteral(chain.txHash)}
      AND status = 'CONFIRMED';
  `);
  const matureBalanceResponse = await api("/v1/balance", {
    token: auth.token,
    address: auth.address,
  });
  const matureBalancePayload =
    matureBalanceResponse.payload.balance || matureBalanceResponse.payload;
  assertMoneyEqual(
    "api mature withdrawable after SQL aging",
    matureBalancePayload.consumerWithdrawableBalance,
    chain.amountUsdc
  );
  const matureDom = await assertCreditsSpendableWithdrawable(page, {
    spendable: finalBalance.available_balance,
    withdrawable: chain.amountUsdc,
  });
  evidence.dom.creditsAfterMature = matureDom;
  evidence.db.matureWithdrawable = {
    deposit: readDepositRows(chain.txHash)[0],
    balance: readBalanceRow(accountId),
    apiBalance: redactedObject(matureBalancePayload),
  };
  await screenshot(page, "credits-after-mature-withdrawable.png", {
    expectedSpendableBalance: finalBalance.available_balance,
    expectedWithdrawableBalance: chain.amountUsdc,
    actualDom: matureDom.bodyText,
    tooltip: matureDom.tooltip,
    apiBalance: redactedObject(matureBalancePayload),
    apiWithdrawableBalance: matureBalancePayload.consumerWithdrawableBalance,
    sqlAvailableBalance: finalBalance.available_balance,
    depositId,
  });
  addStep("db:mature-deposit-withdrawable", true, "", {
    consumerWithdrawableBalance:
      matureBalancePayload.consumerWithdrawableBalance,
  });
  await activeBrowser.close();
  activeBrowser = null;
  addStep("ui:screenshots-dom-sql-bound", true);

  writeEvidence("success");
}

function writeEvidence(status) {
  writeDepositBalanceEvidence({ evidence, config, outDir: OUT_DIR, status });
}

main().catch(async (error) => {
  if (activeBrowser) {
    await activeBrowser.close().catch(() => {});
    activeBrowser = null;
  }
  addStep(
    "fatal",
    false,
    error instanceof Error ? error.message : String(error)
  );
  writeEvidence("failed");
  process.exitCode = 1;
});
