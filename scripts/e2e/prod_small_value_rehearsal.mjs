#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { readProductionSecret } from "../lib/e2e_env_guard.mjs";
import {
  authHeaders,
  buildIdempotencyKey,
  collectProdLogs,
  createBrowserCaptureHelpers,
  createEvidenceRecorders,
  createHttpJsonHelpers,
  credentialHeaders,
  ensureHex32,
  moneyGt,
  moneyGte,
  moneyLt,
  moneyMin,
  normalizeMoneyString,
  runCloudRunJobAndWait,
  sleep,
} from "./lib/prod_small_value_rehearsal_support.mjs";

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
const REHEARSAL_MODE = process.env.PROD_SMALL_VALUE_REHEARSAL_MODE || "full";

const config = {
  gatewayBase:
    process.env.PROD_E2E_GATEWAY_BASE_URL || "https://api.synapse-network.ai",
  frontendBase:
    process.env.PROD_E2E_FRONTEND_BASE_URL || "https://synapse-network.ai",
  rpcUrl:
    process.env.PROD_E2E_RPC_URL ||
    readProductionSecret("synapse-prod-arbitrum-one-rpc-url"),
  chainId: 42161,
  consumerKey:
    process.env.PROD_E2E_CONSUMER_PRIVATE_KEY ||
    readProductionSecret("synapse-prod-e2e-consumer-private-key"),
  providerKey:
    process.env.PROD_E2E_PROVIDER_PRIVATE_KEY ||
    readProductionSecret("synapse-prod-e2e-provider-private-key") ||
    readProductionSecret("synapse-prod-provider-onboarding-owner-private-key"),
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
const usdc = new ethers.Contract(
  contractConfig.MockUSDC,
  usdcAbi,
  consumerWallet
);
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

const { getJson, postJson } = createHttpJsonHelpers({ traceRows, apiEvidence });
const { captureScreenshots, captureConsumerWithdrawalScreenshots } =
  createBrowserCaptureHelpers({ config, outDir: OUT_DIR, report });
const { recordSummary, recordFailure, finalize } = createEvidenceRecorders({
  outDir: OUT_DIR,
  report,
  traceRows,
  apiEvidence,
  sqlEvidence,
  txEvidence,
  logEvidence,
  reportMetadata: () => [
    { label: "Consumer wallet", value: consumerWallet.address.toLowerCase() },
    { label: "Provider wallet", value: providerWallet.address.toLowerCase() },
    { label: "Service", value: CANONICAL_SERVICE_ID },
    { label: "Frontend", value: config.frontendBase },
    { label: "Gateway", value: config.gatewayBase },
  ],
});

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
    matureReceivableUsdc: String(
      preflight.providerSummary.summary?.providerMatureReceivable ?? 0
    ),
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
    const consumerWithdrawOutcome = await maybeRunConsumerWithdraw(
      consumerAuth
    );
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
    await collectProdLogs({ root: ROOT, logEvidence, report, recordFailure });
    finalize(report.failures.length ? "failed" : "passed");
    return;
  }

  let consumerBalance = preflight.consumerBalance;
  if (
    moneyLt(
      consumerBalance.consumerAvailableBalance,
      TARGET_CONSUMER_AVAILABLE_USDC
    )
  ) {
    consumerBalance = await executeDeposit(consumerAuth, consumerBalance);
  } else {
    recordSummary(
      `consumer available balance already sufficient (${consumerBalance.consumerAvailableBalance} USDC)`
    );
  }

  const credential = await ensureAgentCredential(consumerAuth);
  const discovery = await searchCanonicalService(credential.token);
  const invokeResult = await invokePaidService(
    credential.token,
    discovery.service
  );

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
  await collectProdLogs({ root: ROOT, logEvidence, report, recordFailure });
  finalize(report.failures.length ? "failed" : "passed");
}

function ensureProdGuard() {
  if (process.env.PROD_E2E_CONFIRM !== PROD_CONFIRM) {
    throw new Error(
      `Set PROD_E2E_CONFIRM=${PROD_CONFIRM} before mutating production.`
    );
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
    const approveTx = await usdc.approve(
      contractConfig.SynapseCore,
      depositUnits
    );
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
  await runCloudRunJobAndWait({
    root: ROOT,
    jobName: "synapse-prod-deposit-indexer",
    recordSummary,
  });

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
  if (
    !syncResponse ||
    String(syncResponse.sync?.status || "").toUpperCase() !== "CONFIRMED"
  ) {
    throw new Error("deposit intent never reached confirmed status");
  }
  recordSummary(
    `deposit confirmed: ${depositUsdc} USDC -> available ${refreshedBalance.consumerAvailableBalance} USDC`
  );
  return refreshedBalance;
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
  let service = findServiceById(results, CANONICAL_SERVICE_ID);
  if (!service) {
    const catalog = await postJson(
      "agentDiscoveryCatalogFallback",
      `${config.gatewayBase}/api/v1/agent/discovery/search`,
      { query: "", pageSize: 100 },
      { headers: credentialHeaders(credentialToken) }
    );
    const catalogResults = Array.isArray(catalog.results)
      ? catalog.results
      : [];
    service = findServiceById(catalogResults, CANONICAL_SERVICE_ID);
    if (service) {
      report.warnings.push(
        `canonical paid service ${CANONICAL_SERVICE_ID} required catalog fallback after exact discovery miss`
      );
    }
  }
  if (!service) {
    throw new Error(
      `canonical paid service ${CANONICAL_SERVICE_ID} is not discoverable in production`
    );
  }
  return { discovery, service };
}

function findServiceById(results, serviceId) {
  return results.find((item) =>
    [item.serviceId, item.service_id, item.id, item.agentToolName]
      .map((value) => String(value || ""))
      .includes(serviceId)
  );
}

async function invokePaidService(credentialToken, service) {
  const costUsdc = normalizeMoneyString(
    service.basePriceUsdc ||
      service.priceUsdc ||
      service?.pricing?.amount ||
      "1"
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
  if (
    ![
      "completed",
      "success",
      "accepted",
      "billed",
      "fulfilled",
      "succeeded",
    ].includes(receiptStatus)
  ) {
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
  const mature =
    balanceResponse.balance?.consumerWithdrawableBalance || ZERO_USDC;
  if (moneyLt(mature, CONSUMER_WITHDRAW_MIN_USDC)) {
    const reason = `policy-blocked: mature consumer withdrawable ${mature} < ${CONSUMER_WITHDRAW_MIN_USDC}`;
    report.warnings.push(reason);
    return {
      status: "blocked-by-policy",
      reason,
      matureWithdrawableUsdc: mature,
    };
  }

  const withdrawResponse = await postJson(
    "consumerWithdrawIntent",
    `${config.gatewayBase}/api/v1/balance/consumer/withdraw`,
    {
      amountUsdc: CONSUMER_WITHDRAW_MIN_USDC,
      reason: "prod small-value rehearsal",
    },
    {
      headers: {
        ...authHeaders(consumerAuth),
        "X-Idempotency-Key": buildIdempotencyKey("consumer_withdraw"),
      },
    }
  );
  const normalized = withdrawResponse;
  const status = String(
    normalized.status || normalized.withdrawalStatus || ""
  ).toUpperCase();
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
    return {
      status: "blocked-by-policy",
      reason,
      matureReceivableUsdc: mature,
    };
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
  const status = String(
    intent.status || intent.withdrawalStatus || ""
  ).toUpperCase();
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
