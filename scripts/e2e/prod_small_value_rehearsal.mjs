#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_DIR = path.join(
  ROOT,
  "docs/evidence/prod/small-value-rehearsal",
  `${timestamp}-prod-small-value`
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const PROD_CONFIRM = "I_UNDERSTAND_THIS_MUTATES_PRODUCTION";
const CANONICAL_SERVICE_ID = "svc_synapse_mock_cost_1usdc";
const CONSUMER_WITHDRAW_MIN_USDC = "10.000000";
const PROVIDER_WITHDRAW_MIN_USDC = "10.000000";
const TARGET_CONSUMER_AVAILABLE_USDC = "12.000000";
const SMALL_VALUE_PROVIDER_WITHDRAW_MAX_USDC = "20.000000";
const ZERO_USDC = "0.000000";
const REHEARSAL_MODE =
  process.env.PROD_SMALL_VALUE_REHEARSAL_MODE || "full";

const config = {
  gatewayBase:
    process.env.PROD_E2E_GATEWAY_BASE_URL || "https://api.synapse-network.ai",
  frontendBase:
    process.env.PROD_E2E_FRONTEND_BASE_URL || "https://synapse-network.ai",
  rpcUrl:
    process.env.PROD_E2E_RPC_URL ||
    readSecret("synapse-prod-arbitrum-one-rpc-url"),
  chainId: 42161,
  consumerKey:
    process.env.PROD_E2E_CONSUMER_PRIVATE_KEY ||
    readSecret("synapse-prod-e2e-consumer-private-key"),
  providerKey:
    process.env.PROD_E2E_PROVIDER_PRIVATE_KEY ||
    readSecret("synapse-prod-e2e-provider-private-key") ||
    readSecret("synapse-prod-provider-onboarding-owner-private-key"),
  consumerDepositUsdc:
    process.env.PROD_E2E_DEPOSIT_USDC || TARGET_CONSUMER_AVAILABLE_USDC,
};

const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
const consumerWallet = new ethers.Wallet(config.consumerKey, provider);
const providerWallet = new ethers.Wallet(config.providerKey, provider);
const contractConfig = JSON.parse(
  fs.readFileSync(
    path.join(
      ROOT,
      "services/user-front/src/contract-config.arbitrum-one.prod.json"
    ),
    "utf8"
  )
);
const synapseCoreAbi = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "services/user-front/src/SynapseCoreABI.json"),
    "utf8"
  )
);
const usdcAbi = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "services/user-front/src/MockUSDCABI.json"),
    "utf8"
  )
);
const usdc = new ethers.Contract(contractConfig.MockUSDC, usdcAbi, consumerWallet);
const synapseCore = new ethers.Contract(
  contractConfig.SynapseCore,
  synapseCoreAbi,
  consumerWallet
);
const providerSynapseCore = new ethers.Contract(
  contractConfig.SynapseCore,
  synapseCoreAbi,
  providerWallet
);

const traceRows = [];
const apiEvidence = {};
const sqlEvidence = {
  status: "blocked",
  reason:
    "Cloud SQL read-only evidence is blocked from the local runner because the production instance does not expose a public IP and Cloud SQL Auth Proxy cannot reach it from this machine.",
};
const txEvidence = {
  network: "arbitrum-one",
  chainId: config.chainId,
  consumerWallet: consumerWallet.address.toLowerCase(),
  providerWallet: providerWallet.address.toLowerCase(),
  contractConfig: {
    mockUsdc: contractConfig.MockUSDC,
    synapseCore: contractConfig.SynapseCore,
  },
  transactions: [],
};
const logEvidence = {
  services: {},
  errors: [],
};
const report = {
  generatedAt: new Date().toISOString(),
  environment: "prod",
  status: "running",
  summary: [],
  warnings: [],
  failures: [],
  screenshots: [],
  lanes: {
    consumerDepositInvoke: {},
    consumerWithdraw: {},
    providerWithdraw: {},
  },
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

main().catch((error) => {
  recordFailure("unhandled", error);
  finalize("failed");
  process.exitCode = 1;
});

async function main() {
  ensureProdGuard();
  recordSummary(`prod small-value rehearsal started (mode=${REHEARSAL_MODE})`);

  const consumerAuth = await walletAuth(consumerWallet, "consumer");
  const providerAuth = await walletAuth(providerWallet, "provider");

  const preflight = await runPreflight(consumerAuth, providerAuth);
  report.lanes.consumerWithdraw.preflight = {
    matureWithdrawableUsdc:
      preflight.consumerBalance.consumerWithdrawableBalance || ZERO_USDC,
    activeWithdrawals: preflight.consumerWithdrawals.withdrawals?.length || 0,
  };
  report.lanes.providerWithdraw.preflight = {
    matureReceivableUsdc:
      String(preflight.providerSummary.summary?.providerMatureReceivable ?? 0),
    activeWithdrawals: preflight.providerWithdrawals.withdrawals?.length || 0,
    capability: preflight.providerCapability,
  };

  const beforeChain = await readChainState();
  txEvidence.beforeChain = beforeChain;

  if (REHEARSAL_MODE === "consumer-withdraw-auto-approve") {
    report.summary.push(
      "consumer-withdraw-auto-approve mode skips deposit/invoke/provider flows and fails closed unless mature consumer withdrawable balance is already available."
    );
    await captureConsumerWithdrawalScreenshots(consumerAuth);
    const consumerWithdrawOutcome = await maybeRunConsumerWithdraw(consumerAuth);
    report.lanes.consumerWithdraw = {
      ...report.lanes.consumerWithdraw,
      ...consumerWithdrawOutcome,
    };
    if (consumerWithdrawOutcome.status !== "completed") {
      recordFailure(
        "consumerWithdrawAutoApprove",
        new Error(
          consumerWithdrawOutcome.reason ||
            `consumer withdraw auto-approve rehearsal ended in status=${consumerWithdrawOutcome.status}`
        )
      );
    }
    txEvidence.afterChain = await readChainState();
    await collectLogs();
    finalize(report.failures.length ? "failed" : "passed");
    return;
  }

  let consumerBalance = preflight.consumerBalance;
  if (moneyLt(consumerBalance.consumerAvailableBalance, TARGET_CONSUMER_AVAILABLE_USDC)) {
    consumerBalance = await executeDeposit(consumerAuth, consumerBalance);
  } else {
    recordSummary(
      `consumer available balance already sufficient (${consumerBalance.consumerAvailableBalance} USDC)`
    );
  }

  const credential = await ensureAgentCredential(consumerAuth);
  const discovery = await searchCanonicalService(credential.token);
  const invokeResult = await invokePaidService(credential.token, discovery.service);

  const afterInvokeConsumerBalance = await getJson(
    "consumerBalanceAfterInvoke",
    `${config.gatewayBase}/api/v1/balance`,
    {
      headers: authHeaders(consumerAuth),
    }
  );
  const afterInvokeProviderSummary = await getJson(
    "providerSummaryAfterInvoke",
    `${config.gatewayBase}/api/v1/providers/earnings/summary?limit=5`,
    {
      headers: authHeaders(providerAuth),
    }
  );
  const receipt = await getJson(
    "invokeReceipt",
    `${config.gatewayBase}/api/v1/agent/invocations/${invokeResult.invocationId}`,
    {
      headers: credentialHeaders(credential.token),
    }
  );

  report.lanes.consumerDepositInvoke = {
    depositPerformed: Boolean(txEvidence.deposit),
    chargedUsdc: invokeResult.chargedUsdc,
    invocationId: invokeResult.invocationId,
    serviceId: discovery.service.serviceId,
    consumerAvailableBefore: preflight.consumerBalance.consumerAvailableBalance,
    consumerAvailableAfter:
      afterInvokeConsumerBalance.balance?.consumerAvailableBalance || ZERO_USDC,
    providerReceivableBefore: String(
      preflight.providerSummary.summary?.providerReceivable ?? 0
    ),
    providerReceivableAfter: String(
      afterInvokeProviderSummary.summary?.providerReceivable ?? 0
    ),
  };

  assertPhaseAPassed({
    preflight,
    afterInvokeConsumerBalance,
    afterInvokeProviderSummary,
    invokeResult,
    receipt,
  });

  await captureScreenshots(consumerAuth, providerAuth);

  const consumerWithdrawOutcome = await maybeRunConsumerWithdraw(consumerAuth);
  const providerWithdrawOutcome = await maybeRunProviderWithdraw(providerAuth);
  report.lanes.consumerWithdraw = {
    ...report.lanes.consumerWithdraw,
    ...consumerWithdrawOutcome,
  };
  report.lanes.providerWithdraw = {
    ...report.lanes.providerWithdraw,
    ...providerWithdrawOutcome,
  };

  txEvidence.afterChain = await readChainState();
  await collectLogs();
  finalize(report.failures.length ? "failed" : "passed");
}

function ensureProdGuard() {
  if (process.env.PROD_E2E_CONFIRM !== PROD_CONFIRM) {
    throw new Error(
      `Set PROD_E2E_CONFIRM=${PROD_CONFIRM} before mutating production.`
    );
  }
}

function readSecret(secretName) {
  try {
    return execFileSync(
      "gcloud",
      [
        "secrets",
        "versions",
        "access",
        "latest",
        "--secret",
        secretName,
        "--project",
        "synapse-network-prod",
      ],
      { cwd: ROOT, encoding: "utf8" }
    ).trim();
  } catch {
    return "";
  }
}

async function walletAuth(wallet, label) {
  const address = wallet.address.toLowerCase();
  const challenge = await getJson(
    `${label}AuthChallenge`,
    `${config.gatewayBase}/api/v1/auth/challenge?address=${address}&chainId=${config.chainId}`,
    {}
  );
  const signature = await wallet.signMessage(challenge.challenge);
  const verified = await postJson(
    `${label}AuthVerify`,
    `${config.gatewayBase}/api/v1/auth/verify`,
    {
      wallet_address: address,
      message: challenge.challenge,
      signature,
    }
  );
  return {
    address,
    token: verified.access_token,
    expiresAt: Date.now() + Number(verified.expires_in || 86400) * 1000,
  };
}

async function runPreflight(consumerAuth, providerAuth) {
  const consumerBalanceResponse = await getJson(
    "consumerBalancePreflight",
    `${config.gatewayBase}/api/v1/balance`,
    { headers: authHeaders(consumerAuth) }
  );
  const consumerWithdrawals = await getJson(
    "consumerWithdrawalsPreflight",
    `${config.gatewayBase}/api/v1/balance/consumer/withdrawals`,
    { headers: authHeaders(consumerAuth) }
  );
  const providerSummary = await getJson(
    "providerSummaryPreflight",
    `${config.gatewayBase}/api/v1/providers/earnings/summary?limit=5`,
    { headers: authHeaders(providerAuth) }
  );
  const providerCapability = await getJson(
    "providerWithdrawCapabilityPreflight",
    `${config.gatewayBase}/api/v1/providers/withdrawals/capability`,
    { headers: authHeaders(providerAuth) }
  );
  const providerWithdrawals = await getJson(
    "providerWithdrawalsPreflight",
    `${config.gatewayBase}/api/v1/providers/withdrawals`,
    { headers: authHeaders(providerAuth) }
  );
  return {
    consumerBalance: consumerBalanceResponse.balance,
    consumerWithdrawals,
    providerSummary,
    providerCapability,
    providerWithdrawals,
  };
}

async function readChainState() {
  return {
    consumerEth: ethers.formatEther(
      await provider.getBalance(consumerWallet.address)
    ),
    providerEth: ethers.formatEther(
      await provider.getBalance(providerWallet.address)
    ),
    consumerUsdc: await readUsdcBalance(consumerWallet.address),
    providerUsdc: await readUsdcBalance(providerWallet.address),
    consumerUsdcAllowance: ethers.formatUnits(
      await usdc.allowance(consumerWallet.address, contractConfig.SynapseCore),
      6
    ),
  };
}

async function readUsdcBalance(address) {
  return ethers.formatUnits(await usdc.balanceOf(address), 6);
}

async function executeDeposit(consumerAuth, currentBalance) {
  const depositUsdc = config.consumerDepositUsdc;
  const depositUnits = ethers.parseUnits(depositUsdc, 6);
  const allowance = await usdc.allowance(
    consumerWallet.address,
    contractConfig.SynapseCore
  );
  if (allowance < depositUnits) {
    const approveTx = await usdc.approve(contractConfig.SynapseCore, depositUnits);
    const approveReceipt = await approveTx.wait();
    txEvidence.transactions.push({
      kind: "approve",
      txHash: approveReceipt.hash,
      amountUsdc: depositUsdc,
    });
  }

  const depositTx = await synapseCore.deposit(depositUnits);
  const depositReceipt = await depositTx.wait();
  txEvidence.deposit = {
    txHash: depositReceipt.hash,
    amountUsdc: depositUsdc,
    blockNumber: depositReceipt.blockNumber,
  };
  txEvidence.transactions.push({
    kind: "deposit",
    txHash: depositReceipt.hash,
    amountUsdc: depositUsdc,
  });

  await postJson(
    "depositIntent",
    `${config.gatewayBase}/api/v1/balance/deposit/intent`,
    {
      txHash: depositReceipt.hash,
      amountUsdc: depositUsdc,
    },
    {
      headers: {
        ...authHeaders(consumerAuth),
        "X-Idempotency-Key": buildIdempotencyKey("prod_deposit"),
      },
    }
  );
  await runJobAndWait("synapse-prod-deposit-indexer");

  let syncResponse = null;
  let refreshedBalance = currentBalance;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    await sleep(5000);
    syncResponse = await getJson(
      `depositSyncAttempt${attempt + 1}`,
      `${config.gatewayBase}/api/v1/balance/deposit/sync?txHash=${depositReceipt.hash}`,
      { headers: authHeaders(consumerAuth) }
    );
    const balanceResponse = await getJson(
      `consumerBalanceAfterDepositAttempt${attempt + 1}`,
      `${config.gatewayBase}/api/v1/balance`,
      { headers: authHeaders(consumerAuth) }
    );
    refreshedBalance = balanceResponse.balance;
    if (
      String(syncResponse.sync?.status || "").toUpperCase() === "CONFIRMED" &&
      moneyGte(refreshedBalance.consumerAvailableBalance, depositUsdc)
    ) {
      break;
    }
  }
  if (!syncResponse || String(syncResponse.sync?.status || "").toUpperCase() !== "CONFIRMED") {
    throw new Error("deposit intent never reached confirmed status");
  }
  recordSummary(
    `deposit confirmed: ${depositUsdc} USDC -> available ${refreshedBalance.consumerAvailableBalance} USDC`
  );
  return refreshedBalance;
}

async function runJobAndWait(jobName) {
  const executionName = execFileSync(
    "gcloud",
    [
      "run",
      "jobs",
      "execute",
      jobName,
      "--project",
      "synapse-network-prod",
      "--region",
      "us-central1",
      "--format=value(metadata.name)",
    ],
    { cwd: ROOT, encoding: "utf8" }
  )
    .trim()
    .split(/\s+/)
    .at(-1);
  if (!executionName) {
    throw new Error(`failed to start Cloud Run job ${jobName}`);
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(5000);
    const execution = JSON.parse(
      execFileSync(
        "gcloud",
        [
          "run",
          "jobs",
          "executions",
          "describe",
          executionName,
          "--project",
          "synapse-network-prod",
          "--region",
          "us-central1",
          "--format=json",
        ],
        { cwd: ROOT, encoding: "utf8" }
      ) || "{}"
    );
    const completed = Array.isArray(execution.status?.conditions)
      ? execution.status.conditions.find((item) => item.type === "Completed")
      : null;
    if (completed?.status === "True") {
      recordSummary(`${jobName} completed via ${executionName}`);
      return execution;
    }
    if (completed?.status === "False") {
      throw new Error(
        `${jobName} execution ${executionName} failed: ${completed.message || completed.reason || "unknown"}`
      );
    }
  }
  throw new Error(`${jobName} execution did not complete within timeout`);
}

async function ensureAgentCredential(consumerAuth) {
  const listed = await getJson(
    "agentCredentialList",
    `${config.gatewayBase}/api/v1/credentials/agent/list?active_only=true`,
    { headers: authHeaders(consumerAuth) }
  );
  const active = Array.isArray(listed.credentials) ? listed.credentials : [];
  if (active.length < 5) {
    const issued = await postJson(
      "agentCredentialIssue",
      `${config.gatewayBase}/api/v1/credentials/agent/issue`,
      { name: "prod-small-value-rehearsal", creditLimit: "5.000000" },
      { headers: authHeaders(consumerAuth) }
    );
    const credential = issued.credential || {};
    return {
      id: credential.credentialId || credential.id,
      token: credential.token,
    };
  }
  const rotated = await postJson(
    "agentCredentialRotate",
    `${config.gatewayBase}/api/v1/credentials/agent/${active[0].credentialId}/rotate`,
    {},
    { headers: authHeaders(consumerAuth) }
  );
  return {
    id: active[0].credentialId,
    token: rotated.credential?.token,
  };
}

async function searchCanonicalService(credentialToken) {
  const discovery = await postJson(
    "agentDiscoverySearch",
    `${config.gatewayBase}/api/v1/agent/discovery/search`,
    { query: CANONICAL_SERVICE_ID, pageSize: 10 },
    { headers: credentialHeaders(credentialToken) }
  );
  const results = Array.isArray(discovery.results) ? discovery.results : [];
  const service = results.find((item) => item.serviceId === CANONICAL_SERVICE_ID);
  if (!service) {
    throw new Error(
      `canonical paid service ${CANONICAL_SERVICE_ID} is not discoverable in production`
    );
  }
  return { discovery, service };
}

async function invokePaidService(credentialToken, service) {
  const costUsdc = normalizeMoneyString(
    service.basePriceUsdc || service.priceUsdc || service?.pricing?.amount || "1"
  );
  const invokeResponse = await postJson(
    "agentInvoke",
    `${config.gatewayBase}/api/v1/agent/invoke`,
    {
      serviceId: CANONICAL_SERVICE_ID,
      idempotencyKey: buildIdempotencyKey("prod_invoke"),
      costUsdc,
      payload: {
        body: {
          message: "prod small-value rehearsal",
          metadata: { scenario: "prod-small-value-rehearsal" },
        },
      },
      responseMode: "sync",
    },
    { headers: credentialHeaders(credentialToken) }
  );
  return {
    invocationId:
      invokeResponse.invocationId ||
      invokeResponse.id ||
      invokeResponse.invocation_id,
    chargedUsdc: normalizeMoneyString(invokeResponse.chargedUsdc || costUsdc),
  };
}

function assertPhaseAPassed({
  preflight,
  afterInvokeConsumerBalance,
  afterInvokeProviderSummary,
  invokeResult,
  receipt,
}) {
  const consumerBefore = preflight.consumerBalance.consumerAvailableBalance;
  const consumerAfter =
    afterInvokeConsumerBalance.balance?.consumerAvailableBalance || ZERO_USDC;
  const providerBefore = String(
    preflight.providerSummary.summary?.providerReceivable ?? 0
  );
  const providerAfter = String(
    afterInvokeProviderSummary.summary?.providerReceivable ?? 0
  );

  if (!moneyLt(consumerAfter, consumerBefore)) {
    throw new Error(
      `consumer balance did not decrease after invoke: before=${consumerBefore} after=${consumerAfter}`
    );
  }
  if (!moneyGt(providerAfter, providerBefore)) {
    throw new Error(
      `provider receivable did not increase after invoke: before=${providerBefore} after=${providerAfter}`
    );
  }
  const receiptStatus = String(
    receipt.status || receipt.invocationStatus || receipt.finalStatus || ""
  ).toLowerCase();
  if (!["completed", "success", "accepted", "billed", "fulfilled", "succeeded"].includes(receiptStatus)) {
    throw new Error(`unexpected invocation receipt status ${receiptStatus}`);
  }
  recordSummary(
    `phase A passed: charged ${invokeResult.chargedUsdc} USDC, consumer debited, provider receivable increased`
  );
}

async function maybeRunConsumerWithdraw(consumerAuth) {
  const balanceResponse = await getJson(
    "consumerBalanceBeforeWithdrawDecision",
    `${config.gatewayBase}/api/v1/balance`,
    { headers: authHeaders(consumerAuth) }
  );
  const mature = balanceResponse.balance?.consumerWithdrawableBalance || ZERO_USDC;
  if (moneyLt(mature, CONSUMER_WITHDRAW_MIN_USDC)) {
    const reason = `policy-blocked: mature consumer withdrawable ${mature} < ${CONSUMER_WITHDRAW_MIN_USDC}`;
    report.warnings.push(reason);
    return { status: "blocked-by-policy", reason, matureWithdrawableUsdc: mature };
  }

  const withdrawResponse = await postJson(
    "consumerWithdrawIntent",
    `${config.gatewayBase}/api/v1/balance/consumer/withdraw`,
    { amountUsdc: CONSUMER_WITHDRAW_MIN_USDC, reason: "prod small-value rehearsal" },
    {
      headers: {
        ...authHeaders(consumerAuth),
        "X-Idempotency-Key": buildIdempotencyKey("consumer_withdraw"),
      },
    }
  );
  const normalized = withdrawResponse;
  const status = String(normalized.status || normalized.withdrawalStatus || "").toUpperCase();
  if (status === "PENDING_MANUAL_REVIEW") {
    return {
      status: "blocked-manual-review",
      withdrawalId: normalized.withdrawalId,
      reason:
        "consumer withdrawal reached manual review in production; this harness does not auto-approve admin review.",
    };
  }
  const ticket = normalizeTicket(normalized.ticket || normalized);
  const txHash = await submitWithdrawClaim({
    kind: "consumerWithdrawClaim",
    contract: synapseCore,
    ticket,
  });
  const completed = await postJson(
    "consumerWithdrawComplete",
    `${config.gatewayBase}/api/v1/refunds/${normalized.withdrawalId}/complete`,
    { txHash },
    { headers: authHeaders(consumerAuth) }
  );
  return {
    status: "completed",
    withdrawalId: normalized.withdrawalId,
    txHash,
    completeStatus: completed.status,
  };
}

async function maybeRunProviderWithdraw(providerAuth) {
  const summary = await getJson(
    "providerSummaryBeforeWithdrawDecision",
    `${config.gatewayBase}/api/v1/providers/earnings/summary?limit=5`,
    { headers: authHeaders(providerAuth) }
  );
  const capability = await getJson(
    "providerCapabilityBeforeWithdrawDecision",
    `${config.gatewayBase}/api/v1/providers/withdrawals/capability`,
    { headers: authHeaders(providerAuth) }
  );
  const mature = normalizeMoneyString(
    String(summary.summary?.providerMatureReceivable ?? 0)
  );
  if (moneyLt(mature, PROVIDER_WITHDRAW_MIN_USDC)) {
    const reason = `policy-blocked: mature provider receivable ${mature} < ${PROVIDER_WITHDRAW_MIN_USDC}`;
    report.warnings.push(reason);
    return { status: "blocked-by-policy", reason, matureReceivableUsdc: mature };
  }
  const requestedAmount = moneyMin(
    mature,
    SMALL_VALUE_PROVIDER_WITHDRAW_MAX_USDC
  );
  const intent = await postJson(
    "providerWithdrawIntent",
    `${config.gatewayBase}/api/v1/providers/withdrawals/intent`,
    { amountUsdc: requestedAmount },
    {
      headers: {
        ...authHeaders(providerAuth),
        "X-Idempotency-Key": buildIdempotencyKey("provider_withdraw"),
      },
    }
  );
  const status = String(intent.status || intent.withdrawalStatus || "").toUpperCase();
  if (status === "PENDING_MANUAL_REVIEW") {
    return {
      status: "blocked-manual-review",
      withdrawalId: intent.withdrawalId,
      reason:
        "provider withdrawal reached manual review in production; this harness does not auto-approve admin review.",
    };
  }
  const ticket = normalizeTicket(intent.ticket || intent);
  const txHash = await submitWithdrawClaim({
    kind: "providerWithdrawClaim",
    contract: providerSynapseCore,
    ticket,
  });
  const completed = await postJson(
    "providerWithdrawComplete",
    `${config.gatewayBase}/api/v1/providers/withdrawals/${intent.withdrawalId}/complete`,
    { txHash },
    { headers: authHeaders(providerAuth) }
  );
  return {
    status: "completed",
    withdrawalId: intent.withdrawalId,
    txHash,
    completeStatus: completed.status,
    signerAddress: capability.signerAddress || null,
  };
}

function normalizeTicket(raw) {
  const source = raw || {};
  return {
    ticketId: ensureHex32(source.ticketId),
    amount: normalizeMoneyString(source.amount || source.amountUsdc),
    fee: normalizeMoneyString(source.fee || ZERO_USDC),
    deadline: Number(source.deadline),
    signature: String(source.signature || ""),
  };
}

async function submitWithdrawClaim({ kind, contract, ticket }) {
  const tx = await contract.withdraw(
    ethers.parseUnits(ticket.amount, 6),
    ethers.parseUnits(ticket.fee, 6),
    ticket.ticketId,
    BigInt(ticket.deadline),
    ticket.signature
  );
  const receipt = await tx.wait();
  txEvidence.transactions.push({
    kind,
    txHash: receipt.hash,
    amountUsdc: ticket.amount,
    feeUsdc: ticket.fee,
    ticketId: ticket.ticketId,
  });
  return receipt.hash;
}

async function captureScreenshots(consumerAuth, providerAuth) {
  const browser = await chromium.launch({ headless: true });
  try {
    const consumerContext = await browser.newContext();
    await installBrowserAuth(consumerContext, consumerAuth, "CONSUMER");
    const consumerPage = await consumerContext.newPage();
    await capturePage(consumerPage, {
      name: "consumer-billing-credits",
      url: `${config.frontendBase}/dashboard/billing/credits`,
      expectedTexts: ["Billing", "Credits"],
    });
    await consumerContext.close();

    const providerContext = await browser.newContext();
    await installBrowserAuth(providerContext, providerAuth, "PROVIDER");
    const providerPage = await providerContext.newPage();
    await capturePage(providerPage, {
      name: "provider-withdraw",
      url: `${config.frontendBase}/provider/withdraw`,
      expectedTexts: ["Withdraw", "USDC"],
    });
    await providerContext.close();
  } finally {
    await browser.close();
  }
}

async function captureConsumerWithdrawalScreenshots(consumerAuth) {
  const browser = await chromium.launch({ headless: true });
  try {
    const consumerContext = await browser.newContext();
    await installBrowserAuth(consumerContext, consumerAuth, "CONSUMER");
    const consumerPage = await consumerContext.newPage();
    await capturePage(consumerPage, {
      name: "consumer-billing-credits",
      url: `${config.frontendBase}/dashboard/billing/credits`,
      expectedTexts: ["Billing", "Credits"],
    });
    await capturePage(consumerPage, {
      name: "consumer-billing-payments",
      url: `${config.frontendBase}/dashboard/billing`,
      expectedTexts: ["Billing", "Payments"],
    });
    await consumerContext.close();
  } finally {
    await browser.close();
  }
}

async function installBrowserAuth(context, auth, role) {
  await context.addInitScript(
    ({ address, token, expiresAt, chainId, rpcUrl, role }) => {
      const store = {
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
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_selected_role", role);
      localStorage.setItem(`a2a_role_${String(address).toLowerCase()}`, role);
      localStorage.setItem(
        "a2a_auth_session",
        JSON.stringify({
          wallet: String(address).toLowerCase(),
          token,
          expiresAt,
        })
      );
      localStorage.setItem("wagmi.store", JSON.stringify(store));
      localStorage.setItem("wagmi.recentConnectorId", JSON.stringify("injected"));
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      const chainHex = `0x${Number(chainId).toString(16)}`;
      window.ethereum = {
        isMetaMask: true,
        chainId: chainHex,
        selectedAddress: address,
        isConnected: () => true,
        request: async (args) => {
          const method = args?.method;
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
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
          if (payload.error) throw new Error(payload.error.message || "RPC failed");
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
      role,
    }
  );
}

async function capturePage(page, item) {
  const response = await page.goto(item.url, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  const body = await page.locator("body").innerText({ timeout: 10000 });
  for (const text of item.expectedTexts) {
    if (!body.includes(text)) {
      throw new Error(
        `${item.name} missing expected text ${text}; body excerpt=${body.slice(0, 500)}`
      );
    }
  }
  const relativePath = `screenshots/${item.name}.png`;
  await page.screenshot({
    path: path.join(OUT_DIR, relativePath),
    fullPage: true,
  });
  report.screenshots.push({
    name: item.name,
    url: item.url,
    status: response?.status() || 0,
    path: relativePath,
  });
}

async function collectLogs() {
  const services = [
    "synapse-prod-gateway",
    "synapse-prod-user-front",
    "synapse-prod-gateway-admin",
  ];
  for (const service of services) {
    try {
      logEvidence.services[service] = {
        latestReadyRevisionName: execFileSync(
          "gcloud",
          [
            "run",
            "services",
            "describe",
            service,
            "--project",
            "synapse-network-prod",
            "--region",
            "us-central1",
            "--format=value(status.latestReadyRevisionName)",
          ],
          { cwd: ROOT, encoding: "utf8" }
        ).trim(),
      };
    } catch {
      logEvidence.services[service] = {
        latestReadyRevisionName: "",
      };
    }
  }
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const filter =
    `resource.type="cloud_run_revision" severity>=ERROR timestamp>="${since}" ` +
    `(resource.labels.service_name="synapse-prod-gateway" OR ` +
    `resource.labels.service_name="synapse-prod-user-front" OR ` +
    `resource.labels.service_name="synapse-prod-gateway-admin")`;
  try {
    const raw = execFileSync(
      "gcloud",
      [
        "logging",
        "read",
        filter,
        "--project",
        "synapse-network-prod",
        "--limit",
        "50",
        "--format=json",
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    logEvidence.errors = JSON.parse(raw || "[]");
    if (logEvidence.errors.length > 0) {
      recordFailure(
        "prodLogs",
        new Error(`found ${logEvidence.errors.length} ERROR log entries`)
      );
    }
  } catch (error) {
    report.warnings.push(`log query failed: ${String(error.message || error)}`);
  }
}

async function getJson(name, url, options) {
  const startedAt = Date.now();
  const response = await fetch(url, { method: "GET", ...(options || {}) });
  const text = await response.text();
  const payload = parseJson(text);
  traceRows.push({
    name,
    method: "GET",
    url,
    status: response.status,
    durationMs: Date.now() - startedAt,
    response: payload,
  });
  apiEvidence[name] = { status: response.status, payload };
  if (!response.ok) {
    throw new Error(`${name} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return payload;
}

async function postJson(name, url, body, options = {}) {
  const startedAt = Date.now();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    method: "POST",
    ...options,
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = parseJson(text);
  traceRows.push({
    name,
    method: "POST",
    url,
    status: response.status,
    durationMs: Date.now() - startedAt,
    request: body,
    response: payload,
  });
  apiEvidence[name] = { status: response.status, request: body, payload };
  if (!response.ok) {
    throw new Error(`${name} failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return payload;
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function authHeaders(auth) {
  return {
    Authorization: `Bearer ${auth.token}`,
    "X-User-Address": auth.address,
  };
}

function credentialHeaders(token) {
  return {
    "X-Credential": token,
    "Content-Type": "application/json",
  };
}

function buildIdempotencyKey(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "")}`.slice(
    0,
    120
  );
}

function moneyToMicros(value) {
  return ethers.parseUnits(normalizeMoneyString(value), 6);
}

function moneyLt(left, right) {
  return moneyToMicros(left) < moneyToMicros(right);
}

function moneyGt(left, right) {
  return moneyToMicros(left) > moneyToMicros(right);
}

function moneyGte(left, right) {
  return moneyToMicros(left) >= moneyToMicros(right);
}

function moneyMin(left, right) {
  return moneyLt(left, right) ? normalizeMoneyString(left) : normalizeMoneyString(right);
}

function normalizeMoneyString(value) {
  return ethers.formatUnits(ethers.parseUnits(String(value || "0"), 6), 6);
}

function ensureHex32(value) {
  const raw = String(value || "");
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordSummary(message) {
  report.summary.push(message);
  console.log(message);
}

function recordFailure(name, error) {
  const detail = error instanceof Error ? error.message : String(error);
  report.failures.push({ name, detail });
  console.error(`FAIL ${name}: ${detail}`);
}

function finalize(status) {
  report.status = report.failures.length ? "failed" : status;
  const traceJsonl =
    traceRows.map((row) => JSON.stringify(row)).join("\n") +
    (traceRows.length ? "\n" : "");
  fs.writeFileSync(path.join(OUT_DIR, "trace.jsonl"), traceJsonl, "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "api-evidence.json"),
    JSON.stringify(apiEvidence, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "sql-evidence.json"),
    JSON.stringify(sqlEvidence, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "tx-evidence.json"),
    JSON.stringify(txEvidence, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "log-evidence.json"),
    JSON.stringify(logEvidence, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Prod Small-Value E2E Rehearsal",
      "",
      `- Status: ${report.status}`,
      `- Consumer wallet: ${consumerWallet.address.toLowerCase()}`,
      `- Provider wallet: ${providerWallet.address.toLowerCase()}`,
      `- Service: ${CANONICAL_SERVICE_ID}`,
      `- Frontend: ${config.frontendBase}`,
      `- Gateway: ${config.gatewayBase}`,
      "",
      "## Summary",
      "",
      ...report.summary.map((item) => `- ${item}`),
      "",
      "## Warnings",
      "",
      ...(report.warnings.length
        ? report.warnings.map((item) => `- ${item}`)
        : ["- none"]),
      "",
      "## Failures",
      "",
      ...(report.failures.length
        ? report.failures.map((item) => `- ${item.name}: ${item.detail}`)
        : ["- none"]),
      "",
      "## Screenshots",
      "",
      ...(report.screenshots.length
        ? report.screenshots.map((item) => `- ${item.path}`)
        : ["- none"]),
      "",
    ].join("\n"),
    "utf8"
  );
  console.log(`evidence written to ${OUT_DIR}`);
}
