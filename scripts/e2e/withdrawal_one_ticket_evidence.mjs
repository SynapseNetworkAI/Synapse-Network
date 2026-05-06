#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import {
  assertProviderOwnsCanonicalService,
  configuredCanonicalServiceId,
  discoverCanonicalProviderService,
} from "./lib/canonical_provider_service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SCRIPT_VERSION = "withdrawal-one-ticket-evidence:v1";
const RUN_ID =
  process.env.WITHDRAWAL_ONE_TICKET_RUN_ID ||
  `wot-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
const ENVIRONMENT = process.env.WITHDRAWAL_ONE_TICKET_ENV || "local";
const TIMESTAMP =
  process.env.WITHDRAWAL_ONE_TICKET_TIMESTAMP ||
  new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const OUT_DIR = process.env.WITHDRAWAL_ONE_TICKET_OUT_DIR
  ? path.resolve(process.env.WITHDRAWAL_ONE_TICKET_OUT_DIR)
  : path.join(
      ROOT,
      "docs/evidence/release/withdrawal-one-ticket",
      `${TIMESTAMP}-${ENVIRONMENT}`
    );

const GATEWAY_BASE_URL = (
  process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const API_BASE = `${GATEWAY_BASE_URL}/api`;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const CANONICAL_SERVICE_ID = configuredCanonicalServiceId();
const CONSUMER_DEPOSIT_USDC =
  process.env.WITHDRAWAL_ONE_TICKET_CONSUMER_DEPOSIT_USDC || "25.000000";
const CONSUMER_WITHDRAW_USDC =
  process.env.WITHDRAWAL_ONE_TICKET_CONSUMER_WITHDRAW_USDC || "2.000000";
const PROVIDER_WITHDRAW_USDC =
  process.env.WITHDRAWAL_ONE_TICKET_PROVIDER_WITHDRAW_USDC || "1.000000";

const TICKET_TTL_SEC = Number.parseInt(
  process.env.PROVIDER_WITHDRAW_DEADLINE_SEC || "60",
  10
);
const EXPIRY_BUFFER_SEC = Number.parseInt(
  process.env.WITHDRAW_TICKET_EXPIRY_BUFFER_SEC || "3",
  10
);
const RPC_FINALITY_MARGIN_SEC = Number.parseInt(
  process.env.WITHDRAW_RPC_FINALITY_MARGIN_SEC || "3",
  10
);
const FRONTEND_CLAIM_CUTOFF_SEC = Number.parseInt(
  process.env.WITHDRAW_FRONTEND_CLAIM_CUTOFF_SEC || "120",
  10
);
const LOW_GAS_REVERT_GAS_LIMIT = Number.parseInt(
  process.env.WITHDRAW_LOW_GAS_REVERT_GAS_LIMIT || "30000",
  10
);

const DEFAULT_KEYS = {
  deployer:
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  consumer:
    "0x7c852118294f1a460a80c7c33d7409ea91c8436518e91e202d1f5f9e3544eb07",
  provider:
    "0x47e179ec197488bf6f785afa0fc15f4dee1a74f3f44fffedce27f84d349a926a",
};

const DEPLOYER_KEY = process.env.DEPLOYER_KEY || DEFAULT_KEYS.deployer;
const CONSUMER_KEY = process.env.CONSUMER_KEY || DEFAULT_KEYS.consumer;
const PROVIDER_KEY = process.env.PROVIDER_KEY || DEFAULT_KEYS.provider;

const SCENARIOS = [
  "consumer-normal-claim",
  "consumer-expired-reaper",
  "consumer-soft-revoke-race-claim",
  "consumer-soft-revoke-expire",
  "provider-normal-claim",
  "provider-expired-reaper",
  "provider-soft-revoke-race-claim",
  "provider-soft-revoke-expire",
  "consumer-replay-attack",
  "provider-onchain-revert-retry",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const passed = [];
const failed = [];
const scenarios = [];

function log(message) {
  console.log(`[withdrawal-one-ticket] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function pass(name, detail = "") {
  passed.push({ name, detail });
  log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function scenarioPath(name) {
  return path.join(OUT_DIR, `${name}.json`);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  }
  return value;
}

function redactWithdrawalRow(row) {
  if (!row || typeof row !== "object") return row;
  const redacted = { ...row };
  if (redacted.signature) redacted.signature = "[redacted]";
  if (redacted.ticket && typeof redacted.ticket === "object") {
    redacted.ticket = {
      ...redacted.ticket,
      signature: redacted.ticket.signature
        ? "[redacted]"
        : redacted.ticket.signature,
    };
  }
  return redacted;
}

function digestFor(report) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        stable({
          scriptVersion: report.scriptVersion,
          environment: report.environment,
          chain: report.chain,
          scenarioFiles: report.scenarioFiles,
          scenarioResults: report.scenarioResults,
          negativeScenarios: report.negativeScenarios,
          comparisons: report.comparisons,
          failed: report.failed,
        })
      )
    )
    .digest("hex");
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
    (!isLocalUrl(RPC_URL) || !isLocalUrl(GATEWAY_BASE_URL))
  ) {
    fail(
      "Refusing to use default local test keys against non-local endpoints."
    );
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
  return { address, token, privateKey };
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

async function topUpEthIfNeeded({
  targetAddress,
  targetEth,
  deployer,
  provider,
  label,
}) {
  const current = await provider.getBalance(targetAddress);
  const target = ethers.parseEther(targetEth);
  if (current >= target) return "";
  const tx = await sendWithRetry(`${label}-eth-topup`, async () =>
    deployer.sendTransaction({ to: targetAddress, value: target - current })
  );
  await tx.wait();
  return tx.hash;
}

async function fundAndDeposit({ consumerAddress }) {
  const { provider, coreAbi, usdcAbi, usdcAddress, coreAddress } =
    await getChainContext();
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const consumer = new ethers.Wallet(CONSUMER_KEY, provider);
  const usdcDeployer = new ethers.Contract(usdcAddress, usdcAbi, deployer);
  const usdcConsumer = new ethers.Contract(usdcAddress, usdcAbi, consumer);
  const coreConsumer = new ethers.Contract(coreAddress, coreAbi, consumer);
  const decimals = Number(await usdcDeployer.decimals());
  const amountAtomic = ethers.parseUnits(CONSUMER_DEPOSIT_USDC, decimals);
  const ethTopupTx = await topUpEthIfNeeded({
    targetAddress: consumerAddress,
    targetEth: "3.0",
    deployer,
    provider,
    label: "consumer",
  });
  await topUpEthIfNeeded({
    targetAddress: new ethers.Wallet(PROVIDER_KEY).address,
    targetEth: "3.0",
    deployer,
    provider,
    label: "provider",
  });
  const mintTx = await sendWithRetry("mint-consumer-usdc", async () =>
    usdcDeployer.mint(consumerAddress, amountAtomic)
  );
  await mintTx.wait();
  const approveTx = await sendWithRetry("approve-consumer-usdc", async () =>
    usdcConsumer.approve(coreAddress, amountAtomic)
  );
  await approveTx.wait();
  const depositTx = await sendWithRetry("consumer-deposit", async () =>
    coreConsumer.deposit(amountAtomic)
  );
  const receipt = await depositTx.wait();
  if (receipt?.status !== 1)
    fail(`consumer deposit transaction failed: ${depositTx.hash}`);
  return {
    txHash: depositTx.hash,
    amountUsdc: CONSUMER_DEPOSIT_USDC,
    decimals,
    ethTopupTx,
  };
}

async function registerDepositIntent({ token, address, txHash, amountUsdc }) {
  const result = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token,
    address,
    headers: {
      "X-Idempotency-Key": `wot-deposit-${txHash
        .replace(/^0x/, "")
        .slice(0, 80)}`,
    },
    body: { txHash, amountUsdc },
  });
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
  return (
    await api(
      `/v1/balance/deposit/intents/${encodeURIComponent(
        depositIntentId
      )}/confirm`,
      {
        method: "POST",
        token,
        address,
        body: {
          eventKey: `withdrawal-one-ticket:${String(txHash).toLowerCase()}`,
          confirmations: 1,
        },
      }
    )
  ).payload;
}

async function waitForConsumerBalanceAtLeast(auth, expectedUsdc) {
  const expected = Number(expectedUsdc);
  let last = 0;
  for (let i = 0; i < 40; i += 1) {
    const payload = (await api("/v1/balance", auth)).payload;
    last = Number(payload.balance?.consumerAvailableBalance ?? 0);
    if (last >= expected - 0.000001) return payload.balance;
    await sleep(1000);
  }
  fail(`consumer balance did not reach ${expectedUsdc}; last=${last}`);
}

async function readConsumerBalance(auth) {
  return (await api("/v1/balance", auth)).payload.balance || {};
}

async function issueAgentCredential({ token, address }) {
  const payload = (
    await api("/v1/credentials/agent/issue", {
      method: "POST",
      token,
      address,
      body: {
        name: `wot-agent-${RUN_ID}`,
        rpm: 60,
        maxCalls: 20,
        creditLimit: "50",
        resetInterval: "daily",
      },
    })
  ).payload;
  const credential = payload.credential || payload;
  const credentialToken =
    credential.token || credential.secretKey || credential.agentToken;
  if (!credential?.id || !credentialToken)
    fail("agent credential issue response missing id or token");
  return { id: credential.id, token: credentialToken };
}

async function invokeService({ credentialToken, service, sequence = 1 }) {
  const requestId = `wot-invoke-${RUN_ID}-${sequence}`;
  let lastFailure = "";
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await api("/v1/agent/invoke", {
      method: "POST",
      headers: {
        "X-Credential": credentialToken,
        "X-Service-Id": service.id,
        "X-Request-Id": requestId,
      },
      body: {
        serviceId: service.id,
        idempotencyKey: requestId,
        costUsdc: service.priceUsdc,
        payload: { body: service.invokePayload || { prompt: RUN_ID } },
        responseMode: "sync",
      },
      expectOk: false,
    });
    if (result.response.ok) {
      const receipt =
        result.payload.payload?.receipt || result.payload.receipt || {};
      if (!receipt.invocationId)
        fail(
          `invoke response missing invocationId: ${JSON.stringify(
            result.payload
          ).slice(0, 800)}`
        );
      return receipt;
    }
    const code = result.payload?.detail?.code || result.payload?.code || "";
    lastFailure = `${result.response.status} ${JSON.stringify(
      result.payload
    ).slice(0, 400)}`;
    if (
      !["SERVICE_UNAVAILABLE", "SERVICE_BUSY", "SERVICE_CIRCUIT_OPEN"].includes(
        code
      )
    ) {
      fail(`POST /v1/agent/invoke failed: ${lastFailure}`);
    }
    await sleep(2500);
  }
  fail(`POST /v1/agent/invoke failed after retries: ${lastFailure}`);
}

async function createConsumerWithdrawal(auth, scenarioName) {
  const result = await api("/v1/balance/consumer/withdraw", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: {
      "X-Idempotency-Key": `wot:${RUN_ID}:${scenarioName}:${Date.now()}`,
    },
    body: { amountUsdc: CONSUMER_WITHDRAW_USDC, reason: scenarioName },
  });
  const payload = result.payload;
  if (!payload.withdrawId || !payload.ticket?.signature) {
    fail(
      `consumer withdrawal did not return signed ticket: ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return {
    role: "consumer",
    id: payload.withdrawId,
    status: payload.status,
    grossUsdc: String(payload.amountUsdc),
    feeUsdc: String(payload.feeUsdc),
    netUsdc: String(payload.netUsdc),
    ticket: payload.ticket,
  };
}

async function createProviderWithdrawal(auth, scenarioName) {
  const result = await api("/v1/providers/withdrawals/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: {
      "X-Idempotency-Key": `wot:${RUN_ID}:${scenarioName}:${Date.now()}`,
    },
    body: { amountUsdc: PROVIDER_WITHDRAW_USDC },
  });
  const payload = result.payload;
  if (!payload.withdrawalId || !payload.ticket?.signature) {
    fail(
      `provider withdrawal did not return signed ticket: ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return {
    role: "provider",
    id: payload.withdrawalId,
    status: payload.status,
    amountUsdc: String(payload.amountUsdc),
    ticket: payload.ticket,
  };
}

async function readProviderCapability(auth) {
  return (await api("/v1/providers/withdrawals/capability", auth)).payload;
}

function decimalToAtomic(value, decimals = 6) {
  const normalized = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  return (
    BigInt(whole || "0") * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0").slice(0, decimals))
  );
}

async function waitForProviderReceivableAtLeast(auth, expectedUsdc) {
  const expected = decimalToAtomic(expectedUsdc);
  let last = "0";
  for (let i = 0; i < 40; i += 1) {
    const { payload, receivable } = await readProviderReceivable(auth);
    last = receivable;
    if (decimalToAtomic(last) >= expected) return payload;
    await sleep(1000);
  }
  fail(`provider receivable did not reach ${expectedUsdc}; last=${last}`);
}

async function readProviderReceivable(auth) {
  const payload = (await api("/v1/balance", auth)).payload;
  const receivable = String(
    payload.balance?.providerReceivableBalance ??
      payload.balance?.providerReceivable ??
      0
  );
  return { payload, receivable };
}

async function generateProviderReceivable({
  credentialToken,
  providerAuth,
  service,
  targetUsdc,
}) {
  const targetAtomic = decimalToAtomic(targetUsdc);
  const receipts = [];
  for (let index = 1; index <= 40; index += 1) {
    const receipt = await invokeService({
      credentialToken,
      service,
      sequence: index,
    });
    receipts.push(receipt);
    const { receivable } = await readProviderReceivable(providerAuth);
    log(`provider receivable after invoke ${index}: ${receivable} USDC`);
    if (decimalToAtomic(receivable) >= targetAtomic) return receipts;
  }
  await waitForProviderReceivableAtLeast(providerAuth, targetUsdc);
  return receipts;
}

async function readConsumerWithdrawal(auth, id) {
  const rows =
    (await api("/v1/balance/consumer/withdrawals?limit=200", auth)).payload
      .withdrawals || [];
  return (
    rows.find(
      (row) => row.id === id || row.withdrawId === id || row.refundId === id
    ) || null
  );
}

async function readProviderWithdrawal(auth, id) {
  const rows =
    (await api("/v1/providers/withdrawals?limit=200", auth)).payload
      .withdrawals || [];
  return rows.find((row) => row.id === id || row.withdrawalId === id) || null;
}

async function completeWithdrawal(auth, withdrawal, txHash) {
  if (withdrawal.role === "consumer") {
    const payload = (
      await api(`/v1/refunds/${encodeURIComponent(withdrawal.id)}/complete`, {
        method: "POST",
        token: auth.token,
        address: auth.address,
        body: { txHash },
      })
    ).payload;
    return payload;
  }
  const payload = (
    await api(
      `/v1/providers/withdrawals/${encodeURIComponent(withdrawal.id)}/complete`,
      {
        method: "POST",
        token: auth.token,
        address: auth.address,
        body: { txHash },
      }
    )
  ).payload;
  return payload;
}

async function waitForStatus(auth, withdrawal, expected, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last =
      withdrawal.role === "consumer"
        ? await readConsumerWithdrawal(auth, withdrawal.id)
        : await readProviderWithdrawal(auth, withdrawal.id);
    if (String(last?.status || "").toUpperCase() === expected) return last;
    await sleep(1500);
  }
  fail(
    `${withdrawal.role} withdrawal ${
      withdrawal.id
    } did not reach ${expected}; last=${JSON.stringify(last).slice(0, 800)}`
  );
}

async function readChainBalances(address) {
  const { provider, coreAddress, usdcAddress, usdcAbi } =
    await getChainContext();
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);
  const decimals = Number(await usdc.decimals());
  const walletAtomic = await usdc.balanceOf(address);
  const vaultAtomic = await usdc.balanceOf(coreAddress);
  return {
    decimals,
    walletAtomic: walletAtomic.toString(),
    walletUsdc: ethers.formatUnits(walletAtomic, decimals),
    vaultAtomic: vaultAtomic.toString(),
    vaultUsdc: ethers.formatUnits(vaultAtomic, decimals),
  };
}

async function isTicketConsumed(ticketHash) {
  const { provider, coreAbi, coreAddress } = await getChainContext();
  const core = new ethers.Contract(coreAddress, coreAbi, provider);
  return Boolean(await core.isTicketConsumed(ticketHash));
}

async function claimOnChain(privateKey, ticket, { gasLimit } = {}) {
  const { provider, coreAbi, coreAddress } = await getChainContext();
  const signer = new ethers.Wallet(privateKey, provider);
  const core = new ethers.Contract(coreAddress, coreAbi, signer);
  const signature = String(ticket.signature || "").startsWith("0x")
    ? ticket.signature
    : `0x${ticket.signature}`;
  const overrides = {};
  if (gasLimit) overrides.gasLimit = BigInt(gasLimit);
  const tx = await sendWithRetry("withdraw-claim", async () =>
    core.withdraw(
      BigInt(ticket.amount),
      BigInt(ticket.fee || 0),
      ticket.ticketId,
      BigInt(ticket.deadline),
      signature,
      overrides
    )
  );
  const receipt = await tx.wait();
  return {
    txHash: tx.hash,
    receiptStatus: Number(receipt?.status ?? -1),
    blockNumber: Number(receipt?.blockNumber ?? 0),
    gasUsed: receipt?.gasUsed?.toString() || "",
  };
}

async function expectClaimRevert(privateKey, ticket, { gasLimit } = {}) {
  try {
    const result = await claimOnChain(privateKey, ticket, { gasLimit });
    if (result.receiptStatus === 0) {
      return {
        reverted: true,
        failureType: "RECEIPT_STATUS_0",
        receipt: result,
      };
    }
    return {
      reverted: false,
      failureType: "UNEXPECTED_SUCCESS",
      receipt: result,
    };
  } catch (error) {
    const receipt = error.receipt || error.info?.receipt || null;
    return {
      reverted: true,
      failureType: gasLimit ? "OUT_OF_GAS_REVERT" : "CONTRACT_REVERT",
      message: String(error.shortMessage || error.message || error).slice(
        0,
        600
      ),
      receipt: receipt
        ? {
            status: Number(receipt.status ?? 0),
            transactionHash: receipt.hash || receipt.transactionHash || "",
            gasUsed: receipt.gasUsed?.toString?.() || "",
          }
        : null,
    };
  }
}

async function latestBlockTimestamp() {
  const { provider } = await getChainContext();
  const block = await provider.getBlock("latest");
  return Number(block?.timestamp || 0);
}

async function rpcCall(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = await response.json().catch(() => ({}));
  if (payload.error)
    throw new Error(`${method} failed: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function minePastRpcDeadline(targetTimestamp) {
  const current = await latestBlockTimestamp();
  if (current <= targetTimestamp && isLocalUrl(RPC_URL)) {
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

async function waitForExpiryWindow(ticket) {
  const target =
    Number(ticket.deadline) + EXPIRY_BUFFER_SEC + RPC_FINALITY_MARGIN_SEC + 2;
  while (
    Math.floor(Date.now() / 1000) <=
    Number(ticket.deadline) + EXPIRY_BUFFER_SEC + 1
  ) {
    await sleep(1500);
  }
  await minePastRpcDeadline(target);
  while ((await latestBlockTimestamp()) <= target) {
    await rpcCall("evm_mine").catch(() => null);
    await sleep(1500);
  }
}

async function writeScenario(name, payload) {
  const status = payload.pass === false ? "failed" : "passed";
  const scenario = {
    name,
    status,
    pass: status === "passed",
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    ...payload,
  };
  writeJson(scenarioPath(name), scenario);
  scenarios.push(scenario);
  if (scenario.pass) pass(`scenario:${name}`, scenario.summary || "");
  else failed.push({ name, detail: scenario.summary || "scenario failed" });
  return scenario;
}

async function runClaimScenario(
  name,
  role,
  auth,
  privateKey,
  { softRevoke = false } = {}
) {
  const withdrawal =
    role === "consumer"
      ? await createConsumerWithdrawal(auth, name)
      : await createProviderWithdrawal(auth, name);
  const before = await readChainBalances(auth.address);
  const softRevokeEvidence = softRevoke
    ? {
        requestedAt: new Date().toISOString(),
        mode: "SOFT_REVOKE_WAIT_EXPIRY_ONLY",
        note: "No hard revoke/broadcaster; claim before deadline remains valid by design.",
      }
    : null;
  const chain = await claimOnChain(privateKey, withdrawal.ticket);
  if (chain.receiptStatus !== 1) fail(`${name} claim reverted unexpectedly`);
  const complete = await completeWithdrawal(auth, withdrawal, chain.txHash);
  const row = await waitForStatus(auth, withdrawal, "COMPLETED", 30000);
  const after = await readChainBalances(auth.address);
  return writeScenario(name, {
    summary: `${role} ticket claimed and completed`,
    role,
    withdrawalId: withdrawal.id,
    ticketHash: withdrawal.ticket.ticketHash,
    deadline: withdrawal.ticket.deadline,
    softRevoke: softRevokeEvidence,
    expected: { dbStatus: "COMPLETED", receiptStatus: 1 },
    actual: {
      dbStatus: row.status,
      txHash: chain.txHash,
      receiptStatus: chain.receiptStatus,
      completeStatus:
        complete.status || complete.withdrawalStatus || complete.refundStatus,
      walletDeltaAtomic: (
        BigInt(after.walletAtomic) - BigInt(before.walletAtomic)
      ).toString(),
      vaultDeltaAtomic: (
        BigInt(after.vaultAtomic) - BigInt(before.vaultAtomic)
      ).toString(),
    },
    comparisons: [
      {
        metric: "dbStatus",
        expected: "COMPLETED",
        actual: row.status,
        pass: String(row.status).toUpperCase() === "COMPLETED",
      },
      {
        metric: "receiptStatus",
        expected: "1",
        actual: String(chain.receiptStatus),
        pass: chain.receiptStatus === 1,
      },
      {
        metric: "ticketConsumed",
        expected: "true",
        actual: String(await isTicketConsumed(withdrawal.ticket.ticketHash)),
        pass: (await isTicketConsumed(withdrawal.ticket.ticketHash)) === true,
      },
    ],
  });
}

async function runExpiredScenario(
  name,
  role,
  auth,
  { softRevoke = false } = {}
) {
  const withdrawal =
    role === "consumer"
      ? await createConsumerWithdrawal(auth, name)
      : await createProviderWithdrawal(auth, name);
  const balanceBefore =
    role === "consumer"
      ? await readConsumerBalance(auth)
      : await readProviderWithdrawal(auth, withdrawal.id);
  const softRevokeEvidence = softRevoke
    ? {
        requestedAt: new Date().toISOString(),
        mode: "SOFT_REVOKE_WAIT_EXPIRY_ONLY",
        note: "Operator blocks refresh/new ticket; one-ticket model waits for physical deadline before release.",
      }
    : null;
  await waitForExpiryWindow(withdrawal.ticket);
  const row = await waitForStatus(auth, withdrawal, "FAILED_EXPIRED", 90000);
  const consumed = await isTicketConsumed(withdrawal.ticket.ticketHash);
  const rpcBlockTimestamp = await latestBlockTimestamp();
  return writeScenario(name, {
    summary: `${role} ticket expired and reaper released funds`,
    role,
    withdrawalId: withdrawal.id,
    ticketHash: withdrawal.ticket.ticketHash,
    deadline: withdrawal.ticket.deadline,
    softRevoke: softRevokeEvidence,
    expected: {
      dbStatus: "FAILED_EXPIRED",
      ticketConsumed: false,
      localPastDeadlineBuffer: true,
      rpcPastDeadlineMargin: true,
    },
    actual: {
      dbStatus: row.status,
      ticketConsumed: consumed,
      rpcBlockTimestamp,
      localNow: Math.floor(Date.now() / 1000),
      balanceBefore: redactWithdrawalRow(balanceBefore),
      row: redactWithdrawalRow(row),
    },
    comparisons: [
      {
        metric: "dbStatus",
        expected: "FAILED_EXPIRED",
        actual: row.status,
        pass: String(row.status).toUpperCase() === "FAILED_EXPIRED",
      },
      {
        metric: "ticketConsumed",
        expected: "false",
        actual: String(consumed),
        pass: consumed === false,
      },
      {
        metric: "rpcBlockTimestamp",
        expected: `>${
          Number(withdrawal.ticket.deadline) + RPC_FINALITY_MARGIN_SEC
        }`,
        actual: String(rpcBlockTimestamp),
        pass:
          rpcBlockTimestamp >
          Number(withdrawal.ticket.deadline) + RPC_FINALITY_MARGIN_SEC,
      },
    ],
  });
}

async function runReplayScenario(auth, privateKey) {
  const name = "consumer-replay-attack";
  const withdrawal = await createConsumerWithdrawal(auth, name);
  const before = await readChainBalances(auth.address);
  const first = await claimOnChain(privateKey, withdrawal.ticket);
  if (first.receiptStatus !== 1) fail("replay scenario first claim failed");
  await completeWithdrawal(auth, withdrawal, first.txHash);
  const rowAfterFirst = await waitForStatus(
    auth,
    withdrawal,
    "COMPLETED",
    30000
  );
  const afterFirst = await readChainBalances(auth.address);
  const replay = await expectClaimRevert(privateKey, withdrawal.ticket);
  const rowAfterReplay = await readConsumerWithdrawal(auth, withdrawal.id);
  const afterReplay = await readChainBalances(auth.address);
  const consumed = await isTicketConsumed(withdrawal.ticket.ticketHash);
  return writeScenario(name, {
    summary:
      "Replay of consumed consumer ticket reverts and Gateway remains COMPLETED",
    role: "consumer",
    withdrawalId: withdrawal.id,
    ticketHash: withdrawal.ticket.ticketHash,
    deadline: withdrawal.ticket.deadline,
    expected: {
      firstReceiptStatus: 1,
      replayReverted: true,
      gatewayStatusAfterReplay: "COMPLETED",
      noSecondWalletDelta: "0",
      ticketConsumed: true,
    },
    actual: {
      firstTxHash: first.txHash,
      replay,
      statusAfterFirst: rowAfterFirst.status,
      statusAfterReplay: rowAfterReplay?.status,
      walletDeltaFirstAtomic: (
        BigInt(afterFirst.walletAtomic) - BigInt(before.walletAtomic)
      ).toString(),
      walletDeltaReplayAtomic: (
        BigInt(afterReplay.walletAtomic) - BigInt(afterFirst.walletAtomic)
      ).toString(),
      vaultDeltaReplayAtomic: (
        BigInt(afterReplay.vaultAtomic) - BigInt(afterFirst.vaultAtomic)
      ).toString(),
      ticketConsumed: consumed,
    },
    comparisons: [
      {
        metric: "replayReverted",
        expected: "true",
        actual: String(replay.reverted),
        pass: replay.reverted === true,
      },
      {
        metric: "gatewayStatusAfterReplay",
        expected: "COMPLETED",
        actual: rowAfterReplay?.status || "",
        pass:
          String(rowAfterReplay?.status || "").toUpperCase() === "COMPLETED",
      },
      {
        metric: "noSecondWalletDelta",
        expected: "0",
        actual: (
          BigInt(afterReplay.walletAtomic) - BigInt(afterFirst.walletAtomic)
        ).toString(),
        pass:
          BigInt(afterReplay.walletAtomic) === BigInt(afterFirst.walletAtomic),
      },
      {
        metric: "ticketConsumed",
        expected: "true",
        actual: String(consumed),
        pass: consumed === true,
      },
    ],
  });
}

async function runLowGasRetryScenario(auth, privateKey) {
  const name = "provider-onchain-revert-retry";
  const withdrawal = await createProviderWithdrawal(auth, name);
  const before = await readChainBalances(auth.address);
  const lowGas = await expectClaimRevert(privateKey, withdrawal.ticket, {
    gasLimit: LOW_GAS_REVERT_GAS_LIMIT,
  });
  const consumedAfterLowGas = await isTicketConsumed(
    withdrawal.ticket.ticketHash
  );
  const rowAfterLowGas = await readProviderWithdrawal(auth, withdrawal.id);
  const afterLowGas = await readChainBalances(auth.address);
  const retry = await claimOnChain(privateKey, withdrawal.ticket);
  if (retry.receiptStatus !== 1)
    fail("low-gas retry scenario normal-gas claim failed");
  await completeWithdrawal(auth, withdrawal, retry.txHash);
  const finalRow = await waitForStatus(auth, withdrawal, "COMPLETED", 30000);
  const afterRetry = await readChainBalances(auth.address);
  return writeScenario(name, {
    summary:
      "Low-gas claim reverts without consuming ticket; same ticket retries successfully before deadline",
    role: "provider",
    withdrawalId: withdrawal.id,
    ticketHash: withdrawal.ticket.ticketHash,
    deadline: withdrawal.ticket.deadline,
    expected: {
      lowGasFailureType: "OUT_OF_GAS_REVERT",
      consumedAfterLowGas: false,
      gatewayStatusAfterLowGas: withdrawal.status,
      retryReceiptStatus: 1,
      finalGatewayStatus: "COMPLETED",
    },
    actual: {
      lowGas,
      consumedAfterLowGas,
      gatewayStatusAfterLowGas: rowAfterLowGas?.status,
      lowGasWalletDeltaAtomic: (
        BigInt(afterLowGas.walletAtomic) - BigInt(before.walletAtomic)
      ).toString(),
      retryTxHash: retry.txHash,
      retryReceiptStatus: retry.receiptStatus,
      finalGatewayStatus: finalRow.status,
      retryWalletDeltaAtomic: (
        BigInt(afterRetry.walletAtomic) - BigInt(afterLowGas.walletAtomic)
      ).toString(),
      retryVaultDeltaAtomic: (
        BigInt(afterRetry.vaultAtomic) - BigInt(afterLowGas.vaultAtomic)
      ).toString(),
    },
    comparisons: [
      {
        metric: "lowGasReverted",
        expected: "true",
        actual: String(lowGas.reverted),
        pass: lowGas.reverted === true,
      },
      {
        metric: "consumedAfterLowGas",
        expected: "false",
        actual: String(consumedAfterLowGas),
        pass: consumedAfterLowGas === false,
      },
      {
        metric: "gatewayNotFailedAfterLowGas",
        expected: "not FAILED/FAILED_EXPIRED",
        actual: rowAfterLowGas?.status || "",
        pass: !["FAILED", "FAILED_EXPIRED"].includes(
          String(rowAfterLowGas?.status || "").toUpperCase()
        ),
      },
      {
        metric: "retryReceiptStatus",
        expected: "1",
        actual: String(retry.receiptStatus),
        pass: retry.receiptStatus === 1,
      },
      {
        metric: "finalGatewayStatus",
        expected: "COMPLETED",
        actual: finalRow.status,
        pass: String(finalRow.status).toUpperCase() === "COMPLETED",
      },
    ],
  });
}

function collectComparisons() {
  return scenarios.flatMap((scenario) =>
    (scenario.comparisons || []).map((comparison) => ({
      scenario: scenario.name,
      ...comparison,
    }))
  );
}

function writeMarkdown(report) {
  const lines = [
    "# Withdrawal One-Ticket Release Evidence",
    "",
    `- Status: ${report.status}`,
    `- Environment: ${report.environment.environment}`,
    `- Run ID: ${report.runId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Gateway: ${report.environment.gatewayBaseUrl}`,
    `- RPC: ${report.environment.rpcUrl}`,
    `- Chain ID: ${report.chain.chainId}`,
    `- SynapseCore: ${report.chain.synapseCore}`,
    `- MockUSDC: ${report.chain.mockUSDC}`,
    `- Ticket TTL: ${report.config.ticketTtlSec}s`,
    `- Reaper buffer: ${report.config.expiryBufferSec}s`,
    `- RPC finality margin: ${report.config.rpcFinalityMarginSec}s`,
    "",
    "## Scenario Results",
    "",
    "| Scenario | Status | Ticket Hash | Key Result |",
    "| --- | --- | --- | --- |",
    ...report.scenarioResults.map(
      (scenario) =>
        `| ${scenario.name} | ${scenario.status} | ${
          scenario.ticketHash || ""
        } | ${scenario.summary || ""} |`
    ),
    "",
    "## Expected vs Actual",
    "",
    "| Scenario | Metric | Expected | Actual | Pass |",
    "| --- | --- | --- | --- | --- |",
    ...report.comparisons.map(
      (row) =>
        `| ${row.scenario} | ${row.metric} | ${row.expected} | ${
          row.actual
        } | ${row.pass ? "PASS" : "FAIL"} |`
    ),
    "",
    "## Negative Scenarios",
    "",
    "- Consumer replay attack: second claim reverts, Gateway remains COMPLETED, no second balance delta.",
    "- Provider low-gas revert retry: first low-gas claim fails without consuming ticket; same ticket succeeds with normal gas before deadline.",
    "",
    "## Failures",
    "",
    report.failed.length ? JSON.stringify(report.failed, null, 2) : "None.",
    "",
  ];
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    `${lines.join("\n")}\n`,
    "utf8"
  );
}

async function writeManifests(chain, service) {
  writeJson(path.join(OUT_DIR, "environment-manifest.json"), {
    environment: ENVIRONMENT,
    runId: RUN_ID,
    gatewayBaseUrl: GATEWAY_BASE_URL,
    rpcUrl: RPC_URL,
    canonicalProviderService: service,
    localOnly: true,
    generatedAt: new Date().toISOString(),
  });
  const code = await chain.provider.getCode(chain.coreAddress);
  writeJson(path.join(OUT_DIR, "contract-manifest.json"), {
    chainId: chain.chainId,
    synapseCore: chain.coreAddress,
    mockUSDC: chain.usdcAddress,
    synapseCoreCodeHash: ethers.keccak256(code),
    generatedAt: new Date().toISOString(),
  });
}

async function main() {
  assertLocalOnly();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const health = await fetch(`${GATEWAY_BASE_URL}/health`).catch(() => null);
  if (!health?.ok) fail(`gateway unavailable at ${GATEWAY_BASE_URL}/health`);
  const chain = await getChainContext();

  const consumerAuth = await authenticate(CONSUMER_KEY, "consumer");
  const providerAuth = await authenticate(PROVIDER_KEY, "provider");
  const service = await discoverCanonicalProviderService({
    api,
    serviceId: CANONICAL_SERVICE_ID,
    fail,
    log,
    sleep,
  });
  await assertProviderOwnsCanonicalService({
    api,
    auth: providerAuth,
    serviceId: service.id,
    fail,
    log,
  });
  await writeManifests(chain, service);

  const deposit = await fundAndDeposit({
    consumerAddress: consumerAuth.address,
  });
  const depositIntent = await registerDepositIntent({
    ...consumerAuth,
    txHash: deposit.txHash,
    amountUsdc: deposit.amountUsdc,
  });
  await confirmLocalDepositIntent({
    ...consumerAuth,
    depositIntent,
    txHash: deposit.txHash,
  });
  await waitForConsumerBalanceAtLeast(consumerAuth, "20.000000");

  const credential = await issueAgentCredential(consumerAuth);
  await generateProviderReceivable({
    credentialToken: credential.token,
    providerAuth,
    service,
    targetUsdc: PROVIDER_WITHDRAW_USDC,
  });
  await waitForProviderReceivableAtLeast(providerAuth, PROVIDER_WITHDRAW_USDC);

  await runClaimScenario(
    "consumer-normal-claim",
    "consumer",
    consumerAuth,
    CONSUMER_KEY
  );
  await runClaimScenario(
    "consumer-soft-revoke-race-claim",
    "consumer",
    consumerAuth,
    CONSUMER_KEY,
    { softRevoke: true }
  );
  await runReplayScenario(consumerAuth, CONSUMER_KEY);
  await runClaimScenario(
    "provider-normal-claim",
    "provider",
    providerAuth,
    PROVIDER_KEY
  );
  await runClaimScenario(
    "provider-soft-revoke-race-claim",
    "provider",
    providerAuth,
    PROVIDER_KEY,
    { softRevoke: true }
  );
  await runLowGasRetryScenario(providerAuth, PROVIDER_KEY);
  await runExpiredScenario("consumer-expired-reaper", "consumer", consumerAuth);
  await runExpiredScenario(
    "consumer-soft-revoke-expire",
    "consumer",
    consumerAuth,
    { softRevoke: true }
  );
  await runExpiredScenario("provider-expired-reaper", "provider", providerAuth);
  await runExpiredScenario(
    "provider-soft-revoke-expire",
    "provider",
    providerAuth,
    { softRevoke: true }
  );

  const comparisons = collectComparisons();
  for (const scenario of scenarios) {
    if (
      scenario.pass !== true ||
      (scenario.comparisons || []).some(
        (comparison) => comparison.pass !== true
      )
    ) {
      failed.push({
        name: scenario.name,
        detail: "scenario comparison failed",
      });
    }
  }
  const scenarioFiles = SCENARIOS.map((name) => `${name}.json`);
  const report = {
    scriptVersion: SCRIPT_VERSION,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? "success" : "failed",
    environment: {
      environment: ENVIRONMENT,
      gatewayBaseUrl: GATEWAY_BASE_URL,
      rpcUrl: RPC_URL,
    },
    chain: {
      chainId: chain.chainId,
      synapseCore: chain.coreAddress,
      mockUSDC: chain.usdcAddress,
    },
    config: {
      ticketTtlSec: TICKET_TTL_SEC,
      expiryBufferSec: EXPIRY_BUFFER_SEC,
      rpcFinalityMarginSec: RPC_FINALITY_MARGIN_SEC,
      frontendClaimCutoffSec: FRONTEND_CLAIM_CUTOFF_SEC,
      lowGasRevertGasLimit: LOW_GAS_REVERT_GAS_LIMIT,
    },
    scenarioFiles,
    scenarioResults: scenarios.map((scenario) => ({
      name: scenario.name,
      status: scenario.status,
      pass: scenario.pass,
      role: scenario.role,
      withdrawalId: scenario.withdrawalId,
      ticketHash: scenario.ticketHash,
      summary: scenario.summary,
    })),
    negativeScenarios: {
      "consumer-replay-attack":
        scenarios.find((scenario) => scenario.name === "consumer-replay-attack")
          ?.actual || null,
      "provider-onchain-revert-retry":
        scenarios.find(
          (scenario) => scenario.name === "provider-onchain-revert-retry"
        )?.actual || null,
    },
    comparisons,
    passed,
    failed,
  };
  report.evidenceDigest = digestFor(report);
  writeJson(path.join(OUT_DIR, "report.json"), report);
  writeMarkdown(report);
  log(`report=${path.join(OUT_DIR, "report.md")}`);
  if (report.status !== "success") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const detail = error.stack || error.message || String(error);
  failed.push({ name: "fatal", detail });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    scriptVersion: SCRIPT_VERSION,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    status: "failed",
    failed,
    scenarioResults: scenarios.map((scenario) => ({
      name: scenario.name,
      status: scenario.status,
      pass: scenario.pass,
    })),
    negativeScenarios: {},
    comparisons: collectComparisons(),
  };
  report.evidenceDigest = digestFor(report);
  writeJson(path.join(OUT_DIR, "report.json"), report);
  console.error(`[withdrawal-one-ticket] fatal: ${detail}`);
  process.exitCode = 1;
});
