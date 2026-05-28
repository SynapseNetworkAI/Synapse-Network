#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  projectIdFromEnv,
  readDotenvFile,
  readStagingSecret,
  requireStagingConfirmation,
} from "../lib/e2e_env_guard.mjs";
import {
  captureCompletedUi,
  capturePreCompleteUi,
  queryWithdrawalLogs,
  readBalanceDb,
  readWithdrawalDb,
  writeEvidence,
} from "./staging_consumer_withdraw_auto_approve_artifacts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const TIMESTAMP = GENERATED_AT.toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const RUN_ID =
  process.env.STAGING_CONSUMER_WITHDRAW_RUN_ID ||
  `staging-consumer-withdraw-${Date.now().toString(36)}`;
const OUT_DIR = path.resolve(
  process.env.STAGING_CONSUMER_WITHDRAW_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "docs/evidence/staging/consumer-withdraw-auto-approve",
      `${TIMESTAMP}-staging-consumer-withdraw-auto-approve`
    )
);
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
  consumerKey: normalizePrivateKey(
    envOrSecret(
      "GATEWAY_E2E_OWNER_KEY",
      "synapse-staging-e2e-consumer-private-key",
      { invalidSubstrings: ["YourStagingE2EOwnerPrivateKey"] }
    )
  ),
  withdrawUsdc: env("STAGING_CONSUMER_WITHDRAW_USDC", "10.000000"),
  consumerWithdrawMinUsdc: env("CONSUMER_WITHDRAW_MIN_USDC", "10.000000"),
  manualReviewThresholdUsdc: env(
    "CONSUMER_WITHDRAW_MANUAL_REVIEW_THRESHOLD_USDC",
    "500.000000"
  ),
  chainId: Number(env("CHAIN_ID", "421614")),
  completionSloSec: Number(env("STAGING_CONSUMER_WITHDRAW_SLO_SEC", "120")),
  logLookbackSec: Number(env("STAGING_CONSUMER_WITHDRAW_LOG_LOOKBACK_SEC", "180")),
  contractConfigPath: path.resolve(
    env("GATEWAY_E2E_CONTRACT_CONFIG_PATH", DEFAULT_CONTRACT_CONFIG)
  ),
  headless: env("STAGING_CONSUMER_WITHDRAW_HEADLESS", "1") !== "0",
};

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

fs.mkdirSync(path.join(OUT_DIR, "screenshots"), { recursive: true });

const ctx = {
  GENERATED_AT,
  OUT_DIR,
  ROOT,
  RUN_ID,
  addCheck,
  config,
  evidence,
  redact,
  sanitize,
};

main().catch((error) => {
  addCheck("withdraw:unhandled", false, error.message || String(error));
  writeEvidence(ctx, { status: "failed" });
  process.exitCode = 1;
});

async function main() {
  assertSafety();
  const auth = await authenticate(config.consumerKey, "consumer");
  const chainContext = await getChainContext();
  const balanceBefore = await getBalance(auth);
  const availableBefore = normalizeMoneyString(balanceBefore.consumerAvailableBalance);
  const withdrawableBefore = normalizeMoneyString(
    balanceBefore.consumerWithdrawableBalance
  );
  const amountUsdc = chooseWithdrawalAmount(balanceBefore);
  const chainBefore = await readChainBalances(chainContext, auth.address);
  const startedAt = new Date().toISOString();

  const create = await api("/v1/balance/consumer/withdraw", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: { "X-Idempotency-Key": `staging-consumer-withdraw-${RUN_ID}` },
    body: {
      amountUsdc,
      reason: `staging consumer withdraw auto approve ${RUN_ID}`,
    },
  });
  const created = normalizeWithdrawIntent(create.payload);
  if (created.status !== "REQUESTED") {
    throw new Error(
      `expected REQUESTED auto-approve status, got ${created.status}: ${JSON.stringify(
        create.payload
      ).slice(0, 800)}`
    );
  }
  if (!created.ticket) {
    throw new Error(`withdrawal ${created.withdrawalId} missing signed ticket`);
  }
  addCheck(
    "withdraw:auto-approved-requested",
    true,
    `withdrawal ${created.withdrawalId} entered REQUESTED with claim ticket`
  );

  const dbBefore = {
    withdrawal: readWithdrawalDb(ctx, created.withdrawalId),
    balance: readBalanceDb(ctx, auth.address),
  };
  evidence.db.before = dbBefore;
  if (String(dbBefore.withdrawal?.status || "").toUpperCase() !== "REQUESTED") {
    throw new Error(
      `withdrawal row ${created.withdrawalId} not REQUESTED before claim: ${JSON.stringify(
        dbBefore.withdrawal
      )}`
    );
  }

  const browserBefore = await capturePreCompleteUi(ctx, {
    auth,
    amountUsdc,
    expectedAvailable: dbBefore.balance.availableBalance,
  });
  evidence.browser.stateSnapshots.push(browserBefore);

  const claim = await submitWithdrawClaim(chainContext, created.ticket);
  const completeCalledAt = new Date().toISOString();
  await api(`/v1/refunds/${encodeURIComponent(created.withdrawalId)}/complete`, {
    method: "POST",
    token: auth.token,
    address: auth.address,
    body: { txHash: claim.txHash },
  });

  const completion = await waitForCompleted({
    auth,
    withdrawalId: created.withdrawalId,
    txHash: claim.txHash,
    startedMs: Date.now(),
  });
  addCheck(
    "withdraw:client-complete-slo",
    completion.completedDelaySec <= config.completionSloSec,
    `completed in ${completion.completedDelaySec}s`,
    { completedDelaySec: completion.completedDelaySec }
  );
  if (completion.completedDelaySec > config.completionSloSec) {
    throw new Error(
      `consumer withdraw completion exceeded ${config.completionSloSec}s`
    );
  }

  const chainAfter = await readChainBalances(chainContext, auth.address);
  const browserAfter = await captureCompletedUi(ctx, {
    auth,
    amountUsdc,
    withdrawalId: created.withdrawalId,
    txHash: claim.txHash,
    expectedAvailable: completion.balance.consumerAvailableBalance,
    expectedPending: completion.balance.consumerPendingBalance,
  });
  evidence.browser.stateSnapshots.push(browserAfter);

  const logs = queryWithdrawalLogs(
    ctx,
    new Date(
      Math.min(
        new Date(startedAt).getTime(),
        Date.now() - config.logLookbackSec * 1000
      )
    ).toISOString(),
    created.withdrawalId,
    claim.txHash
  );
  evidence.logs = logs;
  const completionLog = logs.gateway.find(
    (row) =>
      String(row.textPayload || "").includes("event=CONSUMER_WITHDRAW_COMPLETED") &&
      String(row.textPayload || "").includes("completion_source=client_complete")
  );
  if (!completionLog) {
    throw new Error(
      `missing CONSUMER_WITHDRAW_COMPLETED client_complete log for ${created.withdrawalId}`
    );
  }

  evidence.apiSummary = {
    withdrawalId: created.withdrawalId,
    amountUsdc,
    feeUsdc: created.feeUsdc,
    netUsdc: created.netUsdc,
    txHash: claim.txHash,
  };
  evidence.chain.result = {
    withdrawalId: created.withdrawalId,
    ownerAddress: auth.address.toLowerCase(),
    amountUsdc,
    feeUsdc: created.feeUsdc,
    netUsdc: created.netUsdc,
    txHash: claim.txHash,
    intentCreatedAt: dbBefore.withdrawal.createdAt || "",
    walletMinedAt: claim.minedAt,
    completeCalledAt,
    completedAt: completion.withdrawal.completedAt || completion.withdrawal.updatedAt || "",
    completedDelaySec: completion.completedDelaySec,
    sqlStatusBefore: dbBefore.withdrawal.status || "",
    sqlStatusAfter: completion.withdrawal.status || "",
  };
  evidence.db.final = {
    withdrawal: completion.withdrawal,
    balance: completion.balance,
  };
  evidence.chain.before = chainBefore;
  evidence.chain.after = chainAfter;

  writeEvidence(ctx, { status: "success" });
}

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

function loadEnvFile(filePath) {
  const values = readDotenvFile(filePath);
  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

function readSecret(secretId) {
  return readStagingSecret(secretId, {
    projectId: BASE_PROJECT_ID,
    required: true,
  });
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

function addTrace(row) {
  evidence.trace.push(
    sanitize({
      runId: RUN_ID,
      timestamp: new Date().toISOString(),
      ...row,
    })
  );
}

function addCheck(name, ok, detail = "", extra = {}) {
  const row = sanitize({ name, ok: Boolean(ok), detail, ...extra });
  evidence.checks.push(row);
  if (!row.ok) evidence.failed.push(row);
  console.log(
    `[staging-consumer-withdraw] ${row.ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${detail}` : ""
    }`
  );
}

function assertSafety() {
  requireStagingConfirmation(
    "STAGING_CONSUMER_WITHDRAW_CONFIRM",
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

async function authenticate(privateKey, label) {
  const wallet = new ethers.Wallet(privateKey);
  const address = wallet.address;
  const challenge = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(address)}`
  );
  const message = challenge.payload.challenge || challenge.payload.message;
  if (!message) throw new Error(`${label} auth challenge missing message`);
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: address, message, signature },
  });
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  const expiresAt =
    verified.payload.expiresAt ||
    verified.payload.exp ||
    new Date(Date.now() + 60 * 60 * 1000).toISOString();
  if (!token) throw new Error(`${label} auth verification missing token`);
  addCheck(`${label}:auth`, true, address.toLowerCase());
  return { address, token, expiresAt };
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
  const record = sanitize({
    method,
    path: `/api${pathname}`,
    httpStatus: response.status,
    durationMs: Date.now() - started,
    request: { headers: requestHeaders, body },
    response: payload,
  });
  evidence.api.push(record);
  addTrace({ scenario: `api:${method}:${pathname}`, ...record });
  if (expectOk && !response.ok) {
    throw new Error(
      `${method} ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`
    );
  }
  return { response, payload };
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    throw new Error(
      `RPC chainId mismatch. expected=${config.chainId} actual=${network.chainId}`
    );
  }
  const contractConfig = JSON.parse(
    fs.readFileSync(config.contractConfigPath, "utf8")
  );
  return {
    provider,
    coreAddress: ethers.getAddress(contractConfig.SynapseCore),
    usdcAddress: ethers.getAddress(contractConfig.MockUSDC),
    coreAbi: JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "services/user-front/src/SynapseCoreABI.json"),
        "utf8"
      )
    ),
    usdcAbi: JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "services/user-front/src/MockUSDCABI.json"),
        "utf8"
      )
    ),
  };
}

async function readChainBalances(chainContext, address) {
  const usdc = new ethers.Contract(
    chainContext.usdcAddress,
    chainContext.usdcAbi,
    chainContext.provider
  );
  const decimals = Number(await usdc.decimals());
  const walletAtomic = await usdc.balanceOf(address);
  const vaultAtomic = await usdc.balanceOf(chainContext.coreAddress);
  return {
    address: address.toLowerCase(),
    decimals,
    walletAtomic: walletAtomic.toString(),
    walletUsdc: ethers.formatUnits(walletAtomic, decimals),
    vaultAtomic: vaultAtomic.toString(),
    vaultUsdc: ethers.formatUnits(vaultAtomic, decimals),
  };
}

async function getBalance(auth) {
  const result = await api("/v1/balance", {
    token: auth.token,
    address: auth.address,
  });
  return result.payload.balance || result.payload;
}

function chooseWithdrawalAmount(balance) {
  const requested = normalizeMoneyString(config.withdrawUsdc);
  const minAmount = normalizeMoneyString(config.consumerWithdrawMinUsdc);
  const manualThreshold = normalizeMoneyString(config.manualReviewThresholdUsdc);
  const available = normalizeMoneyString(balance.consumerAvailableBalance);
  const withdrawable = normalizeMoneyString(balance.consumerWithdrawableBalance);
  if (moneyLt(requested, minAmount)) {
    throw new Error(`configured withdraw amount ${requested} is below minimum ${minAmount}`);
  }
  if (moneyGte(requested, manualThreshold)) {
    throw new Error(
      `configured withdraw amount ${requested} must stay below manual review threshold ${manualThreshold}`
    );
  }
  if (moneyLt(available, requested)) {
    throw new Error(`available balance ${available} is below requested amount ${requested}`);
  }
  if (moneyLt(withdrawable, requested)) {
    throw new Error(`mature withdrawable ${withdrawable} is below requested amount ${requested}`);
  }
  return requested;
}

function normalizeWithdrawIntent(payload) {
  const rawTicket = payload.ticket || {};
  return {
    withdrawalId:
      payload.withdrawId || payload.withdrawalId || payload.refundId || payload.id || "",
    status: String(payload.status || payload.withdrawalStatus || "").toUpperCase(),
    amountUsdc: normalizeMoneyString(payload.amountUsdc || payload.amountRefunded || "0"),
    feeUsdc: normalizeMoneyString(payload.feeUsdc || "0"),
    netUsdc: normalizeMoneyString(payload.netUsdc || payload.amountUsdc || "0"),
    ticket:
      rawTicket && Object.keys(rawTicket).length > 0
        ? {
            ticketId: ensureHex32(rawTicket.ticketId),
            ticketHash: rawTicket.ticketHash ? ensureHex32(rawTicket.ticketHash) : "",
            amount: String(rawTicket.amount || "0"),
            fee: String(rawTicket.fee || "0"),
            deadline: Number(rawTicket.deadline || 0),
            signature: ensureHex(rawTicket.signature),
          }
        : null,
  };
}

async function submitWithdrawClaim(chainContext, ticket) {
  const signer = new ethers.Wallet(config.consumerKey, chainContext.provider);
  const core = new ethers.Contract(
    chainContext.coreAddress,
    chainContext.coreAbi,
    signer
  );
  const tx = await core.withdraw(
    BigInt(ticket.amount),
    BigInt(ticket.fee || "0"),
    ticket.ticketId,
    BigInt(ticket.deadline),
    ticket.signature
  );
  const receipt = await tx.wait();
  if (Number(receipt?.status ?? 0) !== 1) {
    throw new Error(`withdraw claim failed: ${tx.hash}`);
  }
  addTrace({
    scenario: "chain:consumer-withdraw-claim",
    txHash: tx.hash,
    receiptStatus: Number(receipt.status),
  });
  return {
    txHash: tx.hash,
    minedAt: new Date().toISOString(),
    blockNumber: Number(receipt.blockNumber || 0),
  };
}

async function waitForCompleted({ auth, withdrawalId, txHash, startedMs }) {
  let lastBalance = null;
  let lastWithdrawal = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const balance = await getBalance(auth);
    const withdrawals = await api("/v1/balance/consumer/withdrawals?limit=20", {
      token: auth.token,
      address: auth.address,
    });
    const list = Array.isArray(withdrawals.payload)
      ? withdrawals.payload
      : withdrawals.payload.withdrawals || [];
    const row = list.find(
      (item) =>
        String(
          item.withdrawId || item.withdrawalId || item.refundId || item.id || ""
        ) === withdrawalId
    );
    lastBalance = balance;
    lastWithdrawal = row || null;
    if (String(row?.status || "").toUpperCase() === "COMPLETED") {
      const dbRow = readWithdrawalDb(withdrawalId);
      const dbBalance = readBalanceDb(auth.address);
      if (String(dbRow.status || "").toUpperCase() === "COMPLETED") {
        return {
          balance,
          withdrawal: dbRow,
          dbBalance,
          completedDelaySec: Math.round((Date.now() - startedMs) / 1000),
          txHash,
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `withdrawal ${withdrawalId} did not reach COMPLETED. lastBalance=${JSON.stringify(
      lastBalance
    )} lastWithdrawal=${JSON.stringify(lastWithdrawal)}`
  );
}

function normalizeMoneyString(value) {
  return ethers.formatUnits(ethers.parseUnits(String(value || "0"), 6), 6);
}

function moneyToMicros(value) {
  return ethers.parseUnits(normalizeMoneyString(value), 6);
}

function moneyLt(left, right) {
  return moneyToMicros(left) < moneyToMicros(right);
}

function moneyGte(left, right) {
  return moneyToMicros(left) >= moneyToMicros(right);
}

function ensureHex32(value) {
  const raw = String(value || "");
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function ensureHex(value) {
  const raw = String(value || "");
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}
