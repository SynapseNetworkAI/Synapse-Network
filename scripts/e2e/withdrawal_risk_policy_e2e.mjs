#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { chromium } from "playwright";
import { createWithdrawalE2eToolkit } from "./withdrawal_e2e_helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TIMESTAMP = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const OUT_DIR = process.env.WITHDRAWAL_RISK_POLICY_OUT_DIR
  ? path.resolve(process.env.WITHDRAWAL_RISK_POLICY_OUT_DIR)
  : path.join(ROOT, "output/dogfood/withdrawal-risk-policy", TIMESTAMP);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const GATEWAY_BASE_URL = (
  process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const USER_FRONT_BASE_URL = (
  process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000"
).replace(/\/+$/, "");
const POSTGRES_DSN = process.env.POSTGRES_DSN || "";
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const RUN_ID =
  process.env.WITHDRAWAL_RISK_POLICY_RUN_ID ||
  `wrp-${crypto.randomUUID().slice(0, 8)}`;
const CONSUMER_MATURE_AGE_SECONDS = 8 * 86400;

const passed = [];
const failed = [];
const evidence = [];

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function log(message) {
  console.log(`[withdrawal-risk-policy] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

const {
  atomic,
  claimOnChain,
  consumerAccount,
  decimal,
  ensureAccount,
  execSql,
  fundVaultLiquidity,
  insertConsumerSpend,
  insertDeposit,
  insertProviderIncome,
  isTicketConsumed,
  ownerId,
  providerAccount,
  providerId,
  queryJson,
  readChainBalances,
  sqlLiteral,
} = createWithdrawalE2eToolkit({
  root: ROOT,
  postgresDsn: POSTGRES_DSN,
  rpcUrl: RPC_URL,
  chainId: CHAIN_ID,
  runId: RUN_ID,
  fail,
  onChainEvidence: (entry) => evidence.push({ type: "chain", ...entry }),
});

async function step(name, fn) {
  try {
    const detail = await fn();
    passed.push({ name, detail: detail || "" });
    log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    failed.push({ name, detail });
    log(`FAIL ${name} - ${detail}`);
  }
}

async function api(
  pathname,
  { method = "GET", token, address, body, headers = {}, expectOk = true } = {}
) {
  const requestHeaders = { Accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;
  const response = await fetch(`${GATEWAY_BASE_URL}/api${pathname}`, {
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
      `${method} ${pathname} failed ${response.status}: ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return { status: response.status, ok: response.ok, payload };
}

async function authenticate(wallet, label) {
  const challenge = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`
  );
  const message = challenge.payload.challenge || challenge.payload.message;
  if (!message) fail(`${label} auth challenge missing message`);
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: wallet.address, message, signature },
  });
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  if (!token) fail(`${label} auth missing token`);
  return { address: wallet.address, token, privateKey: wallet.privateKey };
}

function expectError(result, status, code) {
  if (result.status !== status)
    fail(`expected HTTP ${status}, got ${result.status}`);
  const actual = result.payload?.detail?.code || result.payload?.code || "";
  if (actual !== code)
    fail(
      `expected error code ${code}, got ${
        actual || JSON.stringify(result.payload)
      }`
    );
}

function createWallet(label) {
  const privateKey = `0x${crypto
    .createHash("sha256")
    .update(`${RUN_ID}:${label}`)
    .digest("hex")}`;
  return new ethers.Wallet(privateKey);
}

function insertWithdrawal(wallet, kind, amount, status, ageSeconds, label) {
  const lower = String(wallet).toLowerCase();
  const withdrawalId = `${RUN_ID}:seed-wd:${label}`;
  const isProvider = kind === "provider_withdrawal";
  execSql(`
    INSERT INTO synapse_vault_withdrawals (
      withdrawal_id, owner_id, provider_id, source_account_id, withdrawal_kind, amount_usdc, status, request_id, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(withdrawalId)}, ${sqlLiteral(ownerId(lower))}, ${
    isProvider ? sqlLiteral(providerId(lower)) : "NULL"
  },
      ${sqlLiteral(
        isProvider ? providerAccount(lower) : consumerAccount(lower)
      )},
      ${sqlLiteral(kind)}::synapse_withdrawal_kind, ${sqlLiteral(
    decimal(amount)
  )}, ${sqlLiteral(status)}, ${sqlLiteral(withdrawalId)},
      NOW() - (${Number(ageSeconds)} * INTERVAL '1 second'),
      NOW() - (${Number(ageSeconds)} * INTERVAL '1 second')
    )
    ON CONFLICT (withdrawal_id) DO NOTHING;
  `);
}

function balance(wallet, kind) {
  const accountId =
    kind === "provider" ? providerAccount(wallet) : consumerAccount(wallet);
  return (
    queryJson(`
    SELECT jsonb_build_object(
      'available', COALESCE(available_balance, 0)::text,
      'pending', COALESCE(pending_balance, 0)::text,
      'frozen', COALESCE(frozen_balance, 0)::text
    )
    FROM synapse_account_balances
    WHERE account_id = ${sqlLiteral(accountId)};
  `) || { available: "0", pending: "0", frozen: "0" }
  );
}

function withdrawals(wallet, kind) {
  return (
    queryJson(`
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'withdrawalId', withdrawal_id,
      'amount', amount_usdc::text,
      'status', status,
      'txHash', tx_hash,
      'ticketId', ticket_id,
      'ticketHash', ticket_hash,
      'createdAt', created_at::text
    ) ORDER BY created_at), '[]'::jsonb)
    FROM synapse_vault_withdrawals
    WHERE owner_id = ${sqlLiteral(ownerId(wallet))}
      AND withdrawal_kind = ${sqlLiteral(kind)}::synapse_withdrawal_kind;
  `) || []
  );
}

function countWithdrawals(wallet, kind) {
  return withdrawals(wallet, kind).length;
}

function dbWithdrawalRow(wallet, role, withdrawalId) {
  const kind = role === "provider" ? "provider_withdrawal" : "consumer_refund";
  return queryJson(`
    SELECT jsonb_build_object(
      'withdrawalId', withdrawal_id,
      'status', status,
      'txHash', tx_hash,
      'amount', amount_usdc::text,
      'ticketHash', ticket_hash
    )
    FROM synapse_vault_withdrawals
    WHERE owner_id = ${sqlLiteral(ownerId(wallet))}
      AND withdrawal_kind = ${sqlLiteral(kind)}::synapse_withdrawal_kind
      AND withdrawal_id = ${sqlLiteral(withdrawalId)}
    LIMIT 1;
  `);
}

async function consumerWithdraw(user, amount, idempotencyKey) {
  return api("/v1/balance/consumer/withdraw", {
    method: "POST",
    token: user.token,
    address: user.address,
    headers: { "X-Idempotency-Key": idempotencyKey },
    body: { amountUsdc: amount, reason: `e2e ${RUN_ID}` },
    expectOk: false,
  });
}

async function providerWithdraw(user, amount, idempotencyKey) {
  const body = amount === null ? {} : { amountUsdc: amount };
  return api("/v1/providers/withdrawals/intent", {
    method: "POST",
    token: user.token,
    address: user.address,
    headers: { "X-Idempotency-Key": idempotencyKey },
    body,
    expectOk: false,
  });
}

function assertSuccess(result) {
  if (!result.ok)
    fail(
      `expected success, got ${result.status}: ${JSON.stringify(
        result.payload
      )}`
    );
}

function assertTicketReady(result) {
  assertSuccess(result);
  const status = String(
    result.payload.withdrawalStatus || result.payload.status || ""
  ).toUpperCase();
  if (!["SUCCESS", "REQUESTED", "SIGNED", "APPROVED_AUTO"].includes(status)) {
    fail(`expected auto-approved/ticket-ready status, got ${status}`);
  }
  if (!result.payload.ticket && !result.payload.ticketHash) {
    fail(
      `expected ticket data in auto-approved withdrawal: ${JSON.stringify(
        result.payload
      ).slice(0, 500)}`
    );
  }
}

function normalizeWithdrawalResult(result, role) {
  assertTicketReady(result);
  const id = result.payload.withdrawalId || result.payload.withdrawId;
  if (!id)
    fail(
      `withdrawal response missing id: ${JSON.stringify(result.payload).slice(
        0,
        500
      )}`
    );
  return {
    role,
    id,
    status: result.payload.withdrawalStatus || result.payload.status,
    amountUsdc: String(
      result.payload.amountUsdc || result.payload.amount || ""
    ),
    feeUsdc: String(result.payload.feeUsdc || result.payload.fee || "0"),
    netUsdc: String(
      result.payload.netUsdc ||
        result.payload.amountUsdc ||
        result.payload.amount ||
        ""
    ),
    ticket: result.payload.ticket,
  };
}

async function readWithdrawalRow(auth, withdrawal) {
  const pathname =
    withdrawal.role === "consumer"
      ? "/v1/balance/consumer/withdrawals?limit=200"
      : "/v1/providers/withdrawals?limit=200";
  const rows =
    (
      await api(pathname, {
        token: auth.token,
        address: auth.address,
      })
    ).payload.withdrawals || [];
  return (
    rows.find(
      (row) =>
        row.id === withdrawal.id ||
        row.withdrawId === withdrawal.id ||
        row.refundId === withdrawal.id ||
        row.withdrawalId === withdrawal.id
    ) || null
  );
}

async function waitForCompletedStatus(auth, withdrawal, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await readWithdrawalRow(auth, withdrawal);
    if (String(last?.status || "").toUpperCase() === "COMPLETED") return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(
    `${withdrawal.role} withdrawal ${
      withdrawal.id
    } did not reach COMPLETED; last=${JSON.stringify(last).slice(0, 800)}`
  );
}

async function completeWithdrawal(auth, withdrawal, txHash) {
  const pathname =
    withdrawal.role === "consumer"
      ? `/v1/refunds/${encodeURIComponent(withdrawal.id)}/complete`
      : `/v1/providers/withdrawals/${encodeURIComponent(
          withdrawal.id
        )}/complete`;
  const result = await api(pathname, {
    method: "POST",
    token: auth.token,
    address: auth.address,
    body: { txHash },
  });
  return result.payload;
}

async function claimAndCompleteWithdrawal(auth, withdrawal, kind) {
  const before = await readChainBalances(auth.address);
  const chain = await claimOnChain(auth.privateKey, withdrawal.ticket);
  if (chain.receiptStatus !== 1)
    fail(`${withdrawal.role} claim did not succeed: ${JSON.stringify(chain)}`);
  const complete = await completeWithdrawal(auth, withdrawal, chain.txHash);
  const row = await waitForCompletedStatus(auth, withdrawal);
  const after = await readChainBalances(auth.address);
  const b = balance(auth.address.toLowerCase(), kind);
  const walletDelta = BigInt(after.walletAtomic) - BigInt(before.walletAtomic);
  const vaultDelta = BigInt(after.vaultAtomic) - BigInt(before.vaultAtomic);
  const ticketAmount = BigInt(withdrawal.ticket.amount);
  const consumed = await isTicketConsumed(withdrawal.ticket.ticketHash);
  if (walletDelta !== ticketAmount) {
    fail(`expected wallet delta ${ticketAmount}, got ${walletDelta}`);
  }
  if (vaultDelta !== -ticketAmount) {
    fail(`expected vault delta -${ticketAmount}, got ${vaultDelta}`);
  }
  if (atomic(b.pending) !== 0n)
    fail(`expected pending=0 after completion, got ${JSON.stringify(b)}`);
  if (
    String(row.txHash || row.tx_hash || "").toLowerCase() !==
    chain.txHash.toLowerCase()
  ) {
    fail(
      `completed row txHash mismatch: row=${JSON.stringify(row)} tx=${
        chain.txHash
      }`
    );
  }
  if (String(row.status || "").toUpperCase() !== "COMPLETED") {
    fail(`expected completed row, got ${JSON.stringify(row)}`);
  }
  const dbRow = dbWithdrawalRow(
    auth.address.toLowerCase(),
    withdrawal.role,
    withdrawal.id
  );
  if (String(dbRow?.status || "").toUpperCase() !== "COMPLETED") {
    fail(`expected DB status COMPLETED, got ${JSON.stringify(dbRow)}`);
  }
  if (
    String(dbRow?.txHash || "").toLowerCase() !== chain.txHash.toLowerCase()
  ) {
    fail(`expected DB txHash ${chain.txHash}, got ${JSON.stringify(dbRow)}`);
  }
  if (consumed !== true)
    fail(`expected ticket consumed for ${withdrawal.ticket.ticketHash}`);
  evidence.push({
    type: "chain",
    name: `${withdrawal.role}-claim-completed`,
    txHash: chain.txHash,
    withdrawalId: withdrawal.id,
    walletDeltaAtomic: walletDelta.toString(),
    completeStatus:
      complete.status || complete.withdrawalStatus || complete.refundStatus,
  });
  return {
    chain,
    complete,
    row,
    dbRow,
    balance: b,
    walletDeltaAtomic: walletDelta.toString(),
  };
}

function assertManualReview(result) {
  assertSuccess(result);
  const status = String(
    result.payload.withdrawalStatus || result.payload.status || ""
  ).toUpperCase();
  if (status !== "PENDING_MANUAL_REVIEW") {
    fail(
      `expected PENDING_MANUAL_REVIEW, got ${status}: ${JSON.stringify(
        result.payload
      ).slice(0, 500)}`
    );
  }
  if (result.payload.ticket || result.payload.ticketHash) {
    fail("manual review response must not expose a claim ticket");
  }
}

function buildWagmiStore(address) {
  return {
    state: {
      connections: {
        __type: "Map",
        value: [
          [
            "injected",
            {
              accounts: [address],
              chainId: CHAIN_ID,
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
      chainId: CHAIN_ID,
      current: "injected",
      status: "connected",
    },
    version: 2,
  };
}

async function installAuth(context, user, role) {
  const session = {
    token: user.token,
    wallet: String(user.address).toLowerCase(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  await context.addInitScript(
    ({ address, chainId, rpcUrl, roleName, sessionPayload, wagmiStore }) => {
      const chainHex = `0x${Number(chainId).toString(16)}`;
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_selected_role", roleName);
      localStorage.setItem(
        `a2a_role_${String(address).toLowerCase()}`,
        roleName
      );
      localStorage.setItem("a2a_auth_session", JSON.stringify(sessionPayload));
      localStorage.setItem("wagmi.store", JSON.stringify(wagmiStore));
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      localStorage.removeItem("wagmi.injected.disconnected");
      window.ethereum = {
        isMetaMask: true,
        chainId: chainHex,
        networkVersion: String(chainId),
        selectedAddress: address,
        _metamask: { isUnlocked: () => Promise.resolve(true) },
        isConnected: () => true,
        request: async (args) => {
          const method = args?.method;
          const params = args?.params || [];
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [address];
          if (method === "eth_chainId") return chainHex;
          if (method === "net_version") return String(chainId);
          if (method === "wallet_switchEthereumChain") return null;
          const response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Date.now(),
              method,
              params,
            }),
          });
          const payload = await response.json();
          if (payload.error)
            throw new Error(payload.error.message || "RPC request failed");
          return payload.result;
        },
        on: () => {},
        removeListener: () => {},
        removeAllListeners: () => {},
      };
    },
    {
      address: user.address,
      chainId: CHAIN_ID,
      rpcUrl: RPC_URL,
      roleName: role,
      sessionPayload: session,
      wagmiStore: buildWagmiStore(user.address),
    }
  );
}

async function screenshotPage({ user, role, href, name, expectedFragments }) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    await installAuth(context, user, role);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto(`${USER_FRONT_BASE_URL}${href}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(2500);
    const file = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const bodyText = await page.locator("body").innerText({ timeout: 30000 });
    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, `${name}.dom.txt`),
      bodyText,
      "utf8"
    );
    if (!bodyText || bodyText.trim().length < 80)
      fail(`${href} rendered too little DOM text`);
    if (
      /connect wallet to continue|please connect your wallet/i.test(bodyText)
    ) {
      fail(`${href} rendered auth/connect mask despite injected session`);
    }
    const matched = expectedFragments.find((fragment) =>
      bodyText.toLowerCase().includes(String(fragment).toLowerCase())
    );
    if (!matched) {
      fail(
        `${href} missing expected fragments: ${expectedFragments.join(", ")}`
      );
    }
    evidence.push({
      type: "screenshot",
      name,
      href,
      file,
      matched,
      consoleErrors: consoleErrors.slice(0, 5),
    });
    return `${href} DOM matched ${matched}`;
  } finally {
    await browser.close();
  }
}

async function main() {
  log(`runId=${RUN_ID}`);
  log(`out=${OUT_DIR}`);

  const health = await fetch(`${GATEWAY_BASE_URL}/health`);
  if (!health.ok) fail(`gateway health failed: ${health.status}`);
  await fundVaultLiquidity("500");

  const users = {};
  for (const label of [
    "consumerDust",
    "consumerImmature",
    "consumerFifo",
    "consumerNormal",
    "consumerIdem",
    "consumerWindow",
    "consumerConcurrent",
    "providerDust",
    "providerImmature",
    "providerMature30",
    "providerMature10",
    "providerFullLow",
  ]) {
    users[label] = await authenticate(createWallet(label), label);
  }

  await step(
    "consumer dust 9.99 hard-fails without withdrawal row",
    async () => {
      ensureAccount(users.consumerDust.address, "consumer", "100");
      insertDeposit(
        users.consumerDust.address,
        "100",
        CONSUMER_MATURE_AGE_SECONDS,
        "consumer-dust"
      );
      const before = countWithdrawals(
        users.consumerDust.address.toLowerCase(),
        "consumer_refund"
      );
      const result = await consumerWithdraw(
        users.consumerDust,
        "9.99",
        `${RUN_ID}:consumer-dust`
      );
      expectError(result, 400, "MIN_WITHDRAWAL_AMOUNT_NOT_MET");
      const after = countWithdrawals(
        users.consumerDust.address.toLowerCase(),
        "consumer_refund"
      );
      if (before !== after)
        fail(`dust created withdrawal rows: before=${before} after=${after}`);
      return "400 MIN_WITHDRAWAL_AMOUNT_NOT_MET, no DB row";
    }
  );

  await step(
    "consumer recent deposit T+7 blocks withdrawal without row",
    async () => {
      ensureAccount(users.consumerImmature.address, "consumer", "100");
      insertDeposit(
        users.consumerImmature.address,
        "100",
        60,
        "consumer-immature"
      );
      const result = await consumerWithdraw(
        users.consumerImmature,
        "100",
        `${RUN_ID}:consumer-immature`
      );
      expectError(result, 400, "INSUFFICIENT_MATURE_CONSUMER_BALANCE");
      const rows = withdrawals(
        users.consumerImmature.address.toLowerCase(),
        "consumer_refund"
      );
      if (rows.length !== 0)
        fail(
          `immature consumer withdrawal created rows: ${JSON.stringify(rows)}`
        );
      return "400 INSUFFICIENT_MATURE_CONSUMER_BALANCE, no DB row";
    }
  );

  await step(
    "consumer aggregate FIFO rejects 120 when mature max is 50",
    async () => {
      ensureAccount(users.consumerFifo.address, "consumer", "150");
      insertDeposit(
        users.consumerFifo.address,
        "100",
        CONSUMER_MATURE_AGE_SECONDS,
        "consumer-fifo-old"
      );
      insertDeposit(
        users.consumerFifo.address,
        "100",
        60,
        "consumer-fifo-recent"
      );
      insertConsumerSpend(
        users.consumerFifo.address,
        "50",
        "consumer-fifo-spend"
      );
      const rejected = await consumerWithdraw(
        users.consumerFifo,
        "120",
        `${RUN_ID}:consumer-fifo-reject`
      );
      expectError(rejected, 400, "INSUFFICIENT_MATURE_CONSUMER_BALANCE");
      const accepted = await consumerWithdraw(
        users.consumerFifo,
        "50",
        `${RUN_ID}:consumer-fifo-accept`
      );
      assertTicketReady(accepted);
      const b = balance(users.consumerFifo.address.toLowerCase(), "consumer");
      if (atomic(b.pending) !== atomic("50"))
        fail(
          `expected pending=50 after FIFO accepted, got ${JSON.stringify(b)}`
        );
      return "rejected 120, accepted 50, pending locked";
    }
  );

  await step(
    "consumer matured 100 spend 20 withdraw 80 claims on-chain and completes",
    async () => {
      ensureAccount(users.consumerNormal.address, "consumer", "80");
      insertDeposit(
        users.consumerNormal.address,
        "100",
        CONSUMER_MATURE_AGE_SECONDS,
        "consumer-normal-old"
      );
      insertConsumerSpend(
        users.consumerNormal.address,
        "20",
        "consumer-normal-spend"
      );
      const result = await consumerWithdraw(
        users.consumerNormal,
        "80",
        `${RUN_ID}:consumer-normal`
      );
      const withdrawal = normalizeWithdrawalResult(result, "consumer");
      const b = balance(users.consumerNormal.address.toLowerCase(), "consumer");
      if (atomic(b.available) !== 0n || atomic(b.pending) !== atomic("80")) {
        fail(`expected available=0 pending=80, got ${JSON.stringify(b)}`);
      }
      const completed = await claimAndCompleteWithdrawal(
        users.consumerNormal,
        withdrawal,
        "consumer"
      );
      return `withdrawalId=${withdrawal.id}, tx=${completed.chain.txHash}`;
    }
  );

  await step(
    "consumer idempotency returns same response and prevents double lock",
    async () => {
      ensureAccount(users.consumerIdem.address, "consumer", "100");
      insertDeposit(
        users.consumerIdem.address,
        "100",
        CONSUMER_MATURE_AGE_SECONDS,
        "consumer-idem-old"
      );
      const key = `${RUN_ID}:consumer-idem`;
      const first = await consumerWithdraw(users.consumerIdem, "10", key);
      assertTicketReady(first);
      const second = await consumerWithdraw(users.consumerIdem, "10", key);
      assertTicketReady(second);
      const firstId = first.payload.withdrawalId || first.payload.withdrawId;
      const secondId = second.payload.withdrawalId || second.payload.withdrawId;
      if (firstId !== secondId)
        fail(
          `idempotent retry returned different ids: ${firstId} vs ${secondId}`
        );
      const mismatch = await consumerWithdraw(users.consumerIdem, "11", key);
      expectError(
        mismatch,
        409,
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"
      );
      const rows = withdrawals(
        users.consumerIdem.address.toLowerCase(),
        "consumer_refund"
      );
      const b = balance(users.consumerIdem.address.toLowerCase(), "consumer");
      if (rows.length !== 1 || atomic(b.pending) !== atomic("10")) {
        fail(
          `expected one row and pending=10 after idempotency retry, rows=${
            rows.length
          }, balance=${JSON.stringify(b)}`
        );
      }
      return "same key replay stable; mismatched payload 409";
    }
  );

  await step(
    "consumer 24h DB sliding window forces manual review",
    async () => {
      ensureAccount(users.consumerWindow.address, "consumer", "200");
      insertDeposit(
        users.consumerWindow.address,
        "240",
        CONSUMER_MATURE_AGE_SECONDS,
        "consumer-window-old"
      );
      insertWithdrawal(
        users.consumerWindow.address,
        "consumer_refund",
        "10",
        "COMPLETED",
        3600,
        "window-1h"
      );
      insertWithdrawal(
        users.consumerWindow.address,
        "consumer_refund",
        "10",
        "COMPLETED",
        7200,
        "window-2h"
      );
      insertWithdrawal(
        users.consumerWindow.address,
        "consumer_refund",
        "10",
        "COMPLETED",
        86300,
        "window-23h58m"
      );
      const result = await consumerWithdraw(
        users.consumerWindow,
        "10",
        `${RUN_ID}:consumer-window`
      );
      assertManualReview(result);
      const b = balance(users.consumerWindow.address.toLowerCase(), "consumer");
      if (atomic(b.frozen) !== atomic("10"))
        fail(`manual review should freeze 10, got ${JSON.stringify(b)}`);
      return "created PENDING_MANUAL_REVIEW using created_at >= NOW()-24h";
    }
  );

  await step(
    "consumer concurrent double-spend allows only one lock",
    async () => {
      ensureAccount(users.consumerConcurrent.address, "consumer", "80");
      insertDeposit(
        users.consumerConcurrent.address,
        "80",
        CONSUMER_MATURE_AGE_SECONDS,
        "consumer-concurrent-old"
      );
      const requests = Array.from({ length: 10 }, (_, index) =>
        consumerWithdraw(
          users.consumerConcurrent,
          "80",
          `${RUN_ID}:consumer-concurrent:${index}`
        )
      );
      const results = await Promise.all(requests);
      const ok = results.filter((row) => row.ok);
      const rejected = results.filter((row) => !row.ok);
      const uniqueIds = new Set(
        ok
          .map((row) => row.payload.withdrawalId || row.payload.withdrawId)
          .filter(Boolean)
      );
      if (uniqueIds.size !== 1) {
        fail(
          `expected one unique successful withdrawal id, got ${uniqueIds.size} from ${ok.length} HTTP 2xx responses`
        );
      }
      const rows = withdrawals(
        users.consumerConcurrent.address.toLowerCase(),
        "consumer_refund"
      );
      const b = balance(
        users.consumerConcurrent.address.toLowerCase(),
        "consumer"
      );
      if (
        rows.length !== 1 ||
        atomic(b.pending) !== atomic("80") ||
        atomic(b.available) !== 0n
      ) {
        fail(
          `expected one DB row and available=0 pending=80, rows=${
            rows.length
          }, balance=${JSON.stringify(b)}`
        );
      }
      return `10 parallel requests -> 1 unique ticket, ${rejected.length} rejected/replayed responses`;
    }
  );

  await step(
    "provider dust 9.99 hard-fails without withdrawal row",
    async () => {
      ensureAccount(users.providerDust.address, "provider", "30");
      insertProviderIncome(
        users.providerDust.address,
        "30",
        8 * 86400,
        "provider-dust-old"
      );
      const result = await providerWithdraw(
        users.providerDust,
        "9.99",
        `${RUN_ID}:provider-dust`
      );
      expectError(result, 400, "MIN_WITHDRAWAL_AMOUNT_NOT_MET");
      const rows = withdrawals(
        users.providerDust.address.toLowerCase(),
        "provider_withdrawal"
      );
      if (rows.length !== 0)
        fail(`provider dust created rows: ${JSON.stringify(rows)}`);
      return "400 MIN_WITHDRAWAL_AMOUNT_NOT_MET, no DB row";
    }
  );

  await step(
    "provider T+7 blocks fresh earnings without withdrawal row",
    async () => {
      ensureAccount(users.providerImmature.address, "provider", "30");
      insertProviderIncome(
        users.providerImmature.address,
        "30",
        60,
        "provider-immature-now"
      );
      const result = await providerWithdraw(
        users.providerImmature,
        "30",
        `${RUN_ID}:provider-immature`
      );
      expectError(result, 400, "PROVIDER_RECEIVABLE_NOT_MATURED");
      const rows = withdrawals(
        users.providerImmature.address.toLowerCase(),
        "provider_withdrawal"
      );
      if (rows.length !== 0)
        fail(
          `immature provider withdrawal created rows: ${JSON.stringify(rows)}`
        );
      return "400 PROVIDER_RECEIVABLE_NOT_MATURED, no DB row";
    }
  );

  await step("provider matured 30 claims on-chain and completes", async () => {
    ensureAccount(users.providerMature30.address, "provider", "30");
    insertProviderIncome(
      users.providerMature30.address,
      "30",
      8 * 86400,
      "provider-mature30-old"
    );
    const result = await providerWithdraw(
      users.providerMature30,
      "30",
      `${RUN_ID}:provider-mature30`
    );
    const withdrawal = normalizeWithdrawalResult(result, "provider");
    const b = balance(users.providerMature30.address.toLowerCase(), "provider");
    if (atomic(b.available) !== 0n || atomic(b.pending) !== atomic("30")) {
      fail(
        `expected provider available=0 pending=30, got ${JSON.stringify(b)}`
      );
    }
    const completed = await claimAndCompleteWithdrawal(
      users.providerMature30,
      withdrawal,
      "provider"
    );
    return `withdrawalId=${withdrawal.id}, tx=${completed.chain.txHash}`;
  });

  await step("provider matured 10 claims on-chain and completes", async () => {
    ensureAccount(users.providerMature10.address, "provider", "10");
    insertProviderIncome(
      users.providerMature10.address,
      "10",
      8 * 86400,
      "provider-mature10-old"
    );
    const result = await providerWithdraw(
      users.providerMature10,
      "10",
      `${RUN_ID}:provider-mature10`
    );
    const withdrawal = normalizeWithdrawalResult(result, "provider");
    const completed = await claimAndCompleteWithdrawal(
      users.providerMature10,
      withdrawal,
      "provider"
    );
    return `withdrawalId=${withdrawal.id}, tx=${completed.chain.txHash}`;
  });

  await step("provider full-withdraw under minimum hard-fails", async () => {
    ensureAccount(users.providerFullLow.address, "provider", "8");
    insertProviderIncome(
      users.providerFullLow.address,
      "8",
      8 * 86400,
      "provider-full-low-old"
    );
    const result = await providerWithdraw(
      users.providerFullLow,
      null,
      `${RUN_ID}:provider-full-low`
    );
    expectError(result, 400, "MIN_WITHDRAWAL_AMOUNT_NOT_MET");
    const rows = withdrawals(
      users.providerFullLow.address.toLowerCase(),
      "provider_withdrawal"
    );
    if (rows.length !== 0)
      fail(
        `provider full-withdraw under min created rows: ${JSON.stringify(rows)}`
      );
    return "omitted amount with mature=8 rejects before ticket/row";
  });

  await step(
    "user-front consumer billing completed screenshot and DOM verify",
    async () => {
      return screenshotPage({
        user: users.consumerNormal,
        role: "CONSUMER",
        href: "/dashboard/billing",
        name: "billing-withdraw-completed",
        expectedFragments: ["Completed"],
      });
    }
  );

  await step(
    "user-front provider withdraw completed screenshot and DOM verify",
    async () => {
      return screenshotPage({
        user: users.providerMature30,
        role: "PROVIDER",
        href: "/provider/withdraw",
        name: "provider-withdraw-completed",
        expectedFragments: ["Completed"],
      });
    }
  );

  const report = {
    scriptVersion: "withdrawal-risk-policy-e2e:v1",
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    gatewayBaseUrl: GATEWAY_BASE_URL,
    userFrontBaseUrl: USER_FRONT_BASE_URL,
    passed,
    failed,
    evidence,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Withdrawal Risk Policy E2E",
      "",
      `- runId: ${RUN_ID}`,
      `- generatedAt: ${report.generatedAt}`,
      `- gateway: ${GATEWAY_BASE_URL}`,
      `- userFront: ${USER_FRONT_BASE_URL}`,
      `- passed: ${passed.length}`,
      `- failed: ${failed.length}`,
      "",
      "## Passed",
      ...passed.map(
        (row) => `- ${row.name}${row.detail ? `: ${row.detail}` : ""}`
      ),
      "",
      "## Failed",
      ...(failed.length
        ? failed.map((row) => `- ${row.name}: ${row.detail}`)
        : ["- none"]),
      "",
      "## Evidence",
      ...evidence.map((row) => {
        if (row.file) {
          return `- ${row.name}: ${path.relative(ROOT, row.file)} (${
            row.href
          }, matched=${row.matched})`;
        }
        return `- ${row.name}: ${row.txHash || row.type}`;
      }),
      "",
    ].join("\n"),
    "utf8"
  );

  if (failed.length > 0) {
    log(`FAILED report=${path.join(OUT_DIR, "report.md")}`);
    process.exit(1);
  }
  log(`PASSED report=${path.join(OUT_DIR, "report.md")}`);
}

main().catch((error) => {
  failed.push({
    name: "fatal",
    detail:
      error instanceof Error ? error.stack || error.message : String(error),
  });
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify({ runId: RUN_ID, passed, failed, evidence }, null, 2)}\n`,
    "utf8"
  );
  console.error(error);
  process.exit(1);
});
