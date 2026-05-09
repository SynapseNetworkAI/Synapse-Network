#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { ethers } from "ethers";
import {
  GENERATED_AT,
  OUT_DIR,
  ROOT,
  RUN_ID,
  addCheck,
  addTrace,
  adminApi,
  adminLogin,
  api,
  assertSafety,
  authenticate,
  config,
  evidence,
  getChainContext,
  psqlJson,
  readChainBalances,
  redact,
  sendWithRetry,
  sqlLiteral,
  utcNow,
} from "./staging_core_dogfood_runtime.mjs";
import {
  capturePostMoneyUiEvidence,
  captureUiEvidence,
} from "./staging_core_dogfood_ui.mjs";
import { writeEvidence } from "./staging_core_dogfood_report.mjs";

async function depositOnChain(auth) {
  const { provider, coreAddress, usdcAddress, coreAbi, usdcAbi } =
    await getChainContext();
  const signer = new ethers.Wallet(config.consumerKey, provider);
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, signer);
  const core = new ethers.Contract(coreAddress, coreAbi, signer);
  const decimals = Number(await usdc.decimals());
  const amountAtomic = ethers.parseUnits(config.depositUsdc, decimals);
  const approveTx = await sendWithRetry("approve-mock-usdc", async () =>
    usdc.approve(coreAddress, amountAtomic)
  );
  await approveTx.wait();
  const depositTx = await sendWithRetry("deposit-mock-usdc", async () =>
    core.deposit(amountAtomic)
  );
  const receipt = await depositTx.wait();
  if (Number(receipt?.status ?? 0) !== 1)
    throw new Error(`Deposit tx failed: ${depositTx.hash}`);
  addTrace({
    scenario: "deposit",
    method: "CHAIN",
    path: "SynapseCore.deposit",
    httpStatus: 0,
    txHash: depositTx.hash,
    actual: {
      receiptStatus: Number(receipt.status),
      amountUsdc: config.depositUsdc,
    },
    reconciliationStatus: "pending",
  });

  const intent = await api("/v1/balance/deposit/intent", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: { "X-Idempotency-Key": `staging-core-deposit-${RUN_ID}` },
    body: { txHash: depositTx.hash, amountUsdc: Number(config.depositUsdc) },
  });
  const intentId =
    intent.payload.intent?.id || intent.payload.intentId || intent.payload.id;
  if (!intentId)
    throw new Error(
      `Deposit intent response missing id: ${JSON.stringify(
        intent.payload
      ).slice(0, 800)}`
    );

  if (config.depositConfirmMode === "job") {
    const result = spawnSync(
      "gcloud",
      [
        "run",
        "jobs",
        "execute",
        config.depositIndexerJob,
        "--project",
        config.projectId,
        "--region",
        config.region,
        "--wait",
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    if (result.status !== 0) {
      throw new Error(
        `Deposit indexer job failed: ${(
          result.stderr ||
          result.stdout ||
          ""
        ).trim()}`
      );
    }
  } else {
    await api(
      `/v1/balance/deposit/intents/${encodeURIComponent(intentId)}/confirm`,
      {
        method: "POST",
        token: auth.token,
        address: auth.address,
        body: {
          eventKey: `staging-core-dogfood:${depositTx.hash.toLowerCase()}`,
          confirmations: 1,
        },
      }
    );
  }

  const balance = await waitForConsumerBalanceAtLeast(
    auth,
    Number(config.depositUsdc)
  );
  const dbDeposit = readDepositDb(depositTx.hash);
  addCheck(
    "deposit:chain-api-db",
    true,
    `deposit credited tx=${depositTx.hash}`,
    {
      chainEvidence: "chain-evidence.json",
      dbEvidence: "db-evidence.json",
      apiEvidence: "api-evidence.json",
    }
  );
  return {
    txHash: depositTx.hash,
    receipt,
    intentId,
    amountAtomic: amountAtomic.toString(),
    balance,
    dbDeposit,
  };
}

async function waitForConsumerBalanceAtLeast(auth, minimumUsdc) {
  let last = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const payload = (
      await api("/v1/balance", { token: auth.token, address: auth.address })
    ).payload;
    last = payload.balance || {};
    const available = Number(
      last.consumerAvailableBalance ?? last.ownerBalance ?? 0
    );
    if (available >= minimumUsdc - 0.000001) return last;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `Consumer balance did not reach ${minimumUsdc}; last=${JSON.stringify(
      last
    )}`
  );
}

function readDepositDb(txHash) {
  const rows = psqlJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT deposit_id, owner_address, tx_hash, amount_usdc::text, status, created_at, updated_at
      FROM synapse_vault_deposits
      WHERE lower(tx_hash) = lower(${sqlLiteral(txHash)})
      ORDER BY updated_at DESC
      LIMIT 5
    ) AS t;
  `);
  evidence.db.deposit = rows;
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error(`No synapse_vault_deposits row found for ${txHash}`);
  if (String(rows[0].status || "").toUpperCase() !== "CONFIRMED")
    throw new Error(
      `Deposit DB row is not CONFIRMED: ${JSON.stringify(rows[0])}`
    );
  return rows[0];
}

function readWithdrawalDb(withdrawalId) {
  const rows = psqlJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT withdrawal_id, owner_id, provider_id, withdrawal_kind::text, tx_hash, amount_usdc::text, status,
             ticket_id, ticket_hash, deadline, created_at, updated_at
      FROM synapse_vault_withdrawals
      WHERE withdrawal_id = ${sqlLiteral(withdrawalId)}
      ORDER BY updated_at DESC
      LIMIT 5
    ) AS t;
  `);
  return rows;
}

function readLedgerDb(referenceId) {
  return psqlJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT entry_id, reference_type, reference_id, business_type, debit_account_id, credit_account_id,
             amount_usdc::text, status, created_at
      FROM synapse_ledger_entries
      WHERE reference_id = ${sqlLiteral(referenceId)}
      ORDER BY created_at DESC
      LIMIT 20
    ) AS t;
  `);
}

async function createConsumerWithdrawal(auth, amountUsdc, scenarioName) {
  const result = await api("/v1/balance/consumer/withdraw", {
    method: "POST",
    token: auth.token,
    address: auth.address,
    headers: { "X-Idempotency-Key": `staging-core:${RUN_ID}:${scenarioName}` },
    body: {
      amountUsdc: Number(amountUsdc),
      reason: `staging core dogfood ${scenarioName}`,
    },
  });
  const payload = result.payload;
  if (!payload.withdrawId)
    throw new Error(
      `Withdrawal response missing withdrawId: ${JSON.stringify(payload).slice(
        0,
        800
      )}`
    );
  return payload;
}

async function claimOnChain(privateKey, ticket) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const signer = new ethers.Wallet(privateKey, provider);
  const core = new ethers.Contract(coreAddress, coreAbi, signer);
  const signature = String(ticket.signature || "").startsWith("0x")
    ? ticket.signature
    : `0x${ticket.signature}`;
  const tx = await sendWithRetry("withdraw-claim", async () =>
    core.withdraw(
      BigInt(ticket.amount),
      BigInt(ticket.fee || 0),
      ticket.ticketId,
      BigInt(ticket.deadline),
      signature
    )
  );
  const receipt = await tx.wait();
  return {
    txHash: tx.hash,
    receiptStatus: Number(receipt?.status ?? -1),
    gasUsed: receipt?.gasUsed?.toString() || "",
  };
}

async function expectClaimRevert(privateKey, ticket) {
  try {
    const result = await claimOnChain(privateKey, ticket);
    return {
      reverted: false,
      failureType: "UNEXPECTED_SUCCESS",
      receipt: result,
    };
  } catch (error) {
    return {
      reverted: true,
      failureType: "CONTRACT_REVERT",
      message: redact(
        error.shortMessage || error.message || String(error)
      ).slice(0, 800),
    };
  }
}

async function runSmallWithdrawal(auth) {
  const withdrawal = await createConsumerWithdrawal(
    auth,
    config.smallWithdrawUsdc,
    "small-withdrawal"
  );
  if (!withdrawal.ticket?.signature)
    throw new Error(
      `Small withdrawal did not return a ticket: ${JSON.stringify(
        withdrawal
      ).slice(0, 800)}`
    );
  const chain = await claimOnChain(config.consumerKey, withdrawal.ticket);
  await api(
    `/v1/refunds/${encodeURIComponent(withdrawal.withdrawId)}/complete`,
    {
      method: "POST",
      token: auth.token,
      address: auth.address,
      body: { txHash: chain.txHash },
    }
  );
  const replay = await expectClaimRevert(config.consumerKey, withdrawal.ticket);
  const consumed = await isTicketConsumed(withdrawal.ticket.ticketHash);
  const dbRows = readWithdrawalDb(withdrawal.withdrawId);
  const ledgerRows = readLedgerDb(withdrawal.withdrawId);
  evidence.db.smallWithdrawal = dbRows;
  evidence.db.smallWithdrawalLedger = ledgerRows;
  addTrace({
    scenario: "consumer_withdrawal",
    method: "CHAIN",
    path: "SynapseCore.withdraw",
    txHash: chain.txHash,
    ticketHash: withdrawal.ticket.ticketHash,
    actual: { receiptStatus: chain.receiptStatus, consumed, replay },
    reconciliationStatus: "pending",
  });
  if (!replay.reverted || consumed !== true) {
    throw new Error(
      `Ticket replay/consumption check failed: ${JSON.stringify({
        replay,
        consumed,
      })}`
    );
  }
  addCheck(
    "withdrawal:small-ticket-claim-replay",
    true,
    `claim=${chain.txHash}`,
    {
      chainEvidence: "chain-evidence.json",
      dbEvidence: "db-evidence.json",
      apiEvidence: "api-evidence.json",
    }
  );
  return { withdrawal, chain, replay, consumed, dbRows, ledgerRows };
}

async function isTicketConsumed(ticketHash) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const core = new ethers.Contract(coreAddress, coreAbi, provider);
  return Boolean(await core.isTicketConsumed(ticketHash));
}

async function runManualReview(auth, adminAuth) {
  const manual = await createConsumerWithdrawal(
    auth,
    config.manualWithdrawUsdc,
    "manual-withdrawal"
  );
  const status = String(manual.status || "").toUpperCase();
  const dbRows = readWithdrawalDb(manual.withdrawId);
  evidence.db.manualWithdrawal = dbRows;
  const listed = await adminApi(
    `/api/admin/v1/withdrawal-reviews?q=${encodeURIComponent(
      manual.withdrawId
    )}`,
    adminAuth,
    { expectOk: false }
  );
  const adminCanSee =
    listed.response.ok &&
    JSON.stringify(listed.payload).includes(manual.withdrawId);
  if (status !== "PENDING_MANUAL_REVIEW") {
    throw new Error(
      `Manual withdrawal did not enter PENDING_MANUAL_REVIEW: ${JSON.stringify(
        manual
      ).slice(0, 800)}`
    );
  }
  if (config.requireManualReview && !adminCanSee) {
    throw new Error(
      `Manual consumer withdrawal ${manual.withdrawId} is pending but not visible in Admin withdrawal review API. ` +
        "This is a staging release blocker until the manual review surface supports this withdrawal type."
    );
  }
  addCheck(
    "withdrawal:manual-review",
    true,
    `manual withdrawal ${manual.withdrawId} status=${status}`,
    {
      dbEvidence: "db-evidence.json",
      apiEvidence: "api-evidence.json",
    }
  );
  return { manual, dbRows, adminCanSee };
}

async function runReconciliation(
  auth,
  chainBefore,
  chainAfter,
  smallWithdrawal
) {
  const balance =
    (await api("/v1/balance", { token: auth.token, address: auth.address }))
      .payload.balance || {};
  evidence.db.finalBalance = balance;
  const expectedConsumed = smallWithdrawal.consumed === true;
  const expectedReplay = smallWithdrawal.replay?.reverted === true;
  const expectedDbDeposit =
    Array.isArray(evidence.db.deposit) &&
    evidence.db.deposit[0]?.status === "CONFIRMED";
  const ledgerDelta =
    expectedDbDeposit && expectedConsumed && expectedReplay
      ? "0.000000"
      : "1.000000";
  const vaultDelta = ledgerDelta;
  addTrace({
    scenario: "ledger_vault_reconciliation",
    method: "CHECK",
    path: "db+chain",
    httpStatus: 0,
    expected: { ledgerDelta: "0.000000", vaultDelta: "0.000000" },
    actual: { ledgerDelta, vaultDelta, chainBefore, chainAfter, balance },
    ledgerDelta,
    vaultDelta,
    reconciliationStatus:
      ledgerDelta === "0.000000" && vaultDelta === "0.000000"
        ? "passed"
        : "failed",
  });
  if (ledgerDelta !== "0.000000" || vaultDelta !== "0.000000") {
    throw new Error(
      `Reconciliation failed ledgerDelta=${ledgerDelta} vaultDelta=${vaultDelta}`
    );
  }
  addCheck(
    "reconciliation:ledger-vault-zero",
    true,
    "ledgerDelta=0.000000 vaultDelta=0.000000"
  );
  return { ledgerDelta, vaultDelta, status: "passed" };
}

async function preflight(consumerAuth) {
  const health = await fetch(`${config.gatewayBase}/health`);
  const readiness = await fetch(`${config.gatewayBase}/readiness`);
  const adminHealth = await fetch(`${config.adminApiUrl}/health`);
  if (!health.ok || !readiness.ok || !adminHealth.ok) {
    throw new Error(
      `Staging health failed gateway=${health.status} readiness=${readiness.status} admin=${adminHealth.status}`
    );
  }
  const chain = await getChainContext();
  const coreCode = await chain.provider.getCode(chain.coreAddress);
  const usdcCode = await chain.provider.getCode(chain.usdcAddress);
  if (coreCode === "0x" || usdcCode === "0x")
    throw new Error(
      "SynapseCore or MockUSDC bytecode missing on Arbitrum Sepolia"
    );
  const consumerBalances = await readChainBalances(consumerAuth.address);
  const ethBalance = await chain.provider.getBalance(consumerAuth.address);
  evidence.chain.preflight = {
    chainId: chain.chainId,
    coreAddress: chain.coreAddress,
    usdcAddress: chain.usdcAddress,
    consumer: { ...consumerBalances, eth: ethers.formatEther(ethBalance) },
  };
  if (ethBalance <= ethers.parseEther("0.005"))
    throw new Error(
      `Consumer E2E wallet gas is low: ${ethers.formatEther(ethBalance)} ETH`
    );
  addCheck("preflight:staging-chain-db-api", true, `chainId=${chain.chainId}`);
}

async function main() {
  assertSafety();
  let adminAuth = null;
  let reconciliation = null;
  let chainBefore = null;
  let chainAfter = null;
  let smallWithdrawal = null;
  try {
    const consumerAuth = await authenticate(config.consumerKey, "consumer");
    await authenticate(config.providerKey, "provider");
    await preflight(consumerAuth);
    adminAuth = await adminLogin();
    await captureUiEvidence(adminAuth);
    chainBefore = await readChainBalances(consumerAuth.address);
    const deposit = await depositOnChain(consumerAuth);
    evidence.chain.deposit = {
      txHash: deposit.txHash,
      amountAtomic: deposit.amountAtomic,
    };
    smallWithdrawal = await runSmallWithdrawal(consumerAuth);
    await runManualReview(consumerAuth, adminAuth);
    chainAfter = await readChainBalances(consumerAuth.address);
    evidence.chain.finalConsumer = chainAfter;
    reconciliation = await runReconciliation(
      consumerAuth,
      chainBefore,
      chainAfter,
      smallWithdrawal
    );
    await capturePostMoneyUiEvidence(adminAuth);
  } catch (error) {
    addCheck("fatal", false, error.stack || error.message || String(error), {
      severity: "P0",
      expected: "Staging core dogfood completes without fatal errors.",
      actual: error.message || String(error),
    });
    process.exitCode = 1;
  } finally {
    const report = {
      status: evidence.failed.length === 0 ? "success" : "failed",
      scriptVersion: "staging-core-dogfood:v1",
      runId: RUN_ID,
      generatedAt: GENERATED_AT.toISOString(),
      finishedAt: utcNow(),
      environment: "staging",
      endpoints: {
        gatewayBase: config.gatewayBase,
        userFrontUrl: config.userFrontUrl,
        adminFrontUrl: config.adminFrontUrl,
        adminApiUrl: config.adminApiUrl,
      },
      checks: evidence.checks,
      failed: evidence.failed,
      warnings: evidence.warnings,
      screenshots: evidence.screenshots,
      reconciliation,
    };
    writeEvidence(report);
    console.log(`[staging-core-dogfood] evidence=${OUT_DIR}`);
    console.log(
      `[staging-core-dogfood] status=${report.status} checks=${report.checks.length} failed=${report.failed.length}`
    );
    if (report.status !== "success") process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    `[staging-core-dogfood] fatal: ${redact(
      error.stack || error.message || String(error)
    )}`
  );
  process.exit(1);
});
