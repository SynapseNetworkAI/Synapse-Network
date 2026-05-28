import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

import { chromium } from "playwright";

import {
  captureScreenshot,
  installAuth,
  moneyCandidates,
  readBodyText,
  waitForAnyText,
} from "./staging_webhook_deposit_helpers.mjs";

export async function capturePreCompleteUi(ctx, { auth, amountUsdc, expectedAvailable }) {
  const browser = await chromium.launch({ headless: ctx.config.headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("console", (message) => {
      ctx.evidence.browser.console.push({
        type: message.type(),
        text: ctx.redact(message.text()),
      });
    });
    page.on("pageerror", (error) => {
      ctx.evidence.browser.pageErrors.push(ctx.redact(error.message || String(error)));
    });
    await installAuth(context, auth, {
      chainId: ctx.config.chainId,
      rpcUrl: ctx.config.rpcUrl,
    });
    await page.goto(`${ctx.config.userFrontUrl}/dashboard/billing`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForAnyText(
      page,
      [...moneyCandidates(amountUsdc), "Withdraw", "Ready to claim"],
      "billing pre-complete withdraw"
    );
    const billingText = await readBodyText(page);
    await captureScreenshot(page, ctx.OUT_DIR, ctx.evidence, "billing-requested.png", {
      route: "/dashboard/billing",
      expectedStatus: "Ready to claim",
    });

    await page.goto(`${ctx.config.userFrontUrl}/dashboard/billing/credits`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForAnyText(
      page,
      moneyCandidates(expectedAvailable),
      "credits before complete"
    );
    const creditsText = await readBodyText(page);
    await captureScreenshot(page, ctx.OUT_DIR, ctx.evidence, "credits-before-complete.png", {
      route: "/dashboard/billing/credits",
      spendableCredits: expectedAvailable,
    });
    await context.close();
    await browser.close();
    return {
      phase: "before-complete",
      billingText: billingText.slice(0, 1600),
      creditsText: creditsText.slice(0, 1600),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function captureCompletedUi(
  ctx,
  {
    auth,
    amountUsdc,
    withdrawalId,
    txHash,
    expectedAvailable,
    expectedPending,
  }
) {
  const browser = await chromium.launch({ headless: ctx.config.headless });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installAuth(context, auth, {
      chainId: ctx.config.chainId,
      rpcUrl: ctx.config.rpcUrl,
    });
    await page.goto(`${ctx.config.userFrontUrl}/dashboard/billing`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const rowText = await waitForWithdrawalRow(page, {
      txHash,
      withdrawalId,
      amountUsdc,
      statusLabel: "Completed",
    });
    await captureScreenshot(page, ctx.OUT_DIR, ctx.evidence, "billing-completed.png", {
      route: "/dashboard/billing",
      txHash,
      expectedStatus: "Completed",
    });

    await page.goto(`${ctx.config.userFrontUrl}/dashboard/billing/credits`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForAnyText(
      page,
      moneyCandidates(expectedAvailable),
      "credits completed spendable"
    );
    const creditsText = await readBodyText(page);
    if (!moneyCandidates(expectedPending).some((candidate) => creditsText.includes(candidate))) {
      throw new Error(
        `credits page missing pending candidate for ${expectedPending}: ${creditsText.slice(0, 1200)}`
      );
    }
    await captureScreenshot(page, ctx.OUT_DIR, ctx.evidence, "credits-completed.png", {
      route: "/dashboard/billing/credits",
      spendableCredits: expectedAvailable,
      pendingCredits: expectedPending,
    });
    ctx.addCheck("withdraw:ui-completed", true, "billing + credits show completed withdrawal");
    await context.close();
    await browser.close();
    return {
      phase: "after-complete",
      billingRow: rowText,
      creditsText: creditsText.slice(0, 1600),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function waitForWithdrawalRow(
  page,
  { txHash, withdrawalId, amountUsdc, statusLabel }
) {
  const hashCandidates = [
    txHash.slice(0, 10),
    txHash.slice(-8),
    `${withdrawalId.slice(0, 2)}...${withdrawalId.slice(-4)}`,
    withdrawalId.slice(0, 8),
  ].filter(Boolean);
  const amountMatches = moneyCandidates(amountUsdc);
  const deadline = Date.now() + 30000;
  let lastBody = "";
  while (Date.now() < deadline) {
    const row = page
      .locator("tr")
      .filter({ hasText: "Withdraw" })
      .filter({ hasText: statusLabel })
      .first();
    if (await row.isVisible().catch(() => false)) {
      const text = await row.innerText();
      if (
        amountMatches.some((candidate) => text.includes(candidate)) &&
        hashCandidates.some((candidate) => text.includes(candidate))
      ) {
        return text;
      }
    }
    lastBody = await readBodyText(page);
    await page.waitForTimeout(500);
  }
  throw new Error(
    `withdrawal row missing status=${statusLabel} tx=${txHash}: ${lastBody.slice(0, 1200)}`
  );
}

export function queryWithdrawalLogs(ctx, startIso, withdrawalId, txHash) {
  const filter = [
    'resource.type="cloud_run_revision"',
    `resource.labels.service_name="${ctx.config.gatewayServiceName}"`,
    `timestamp>="${startIso}"`,
    `(textPayload:"${withdrawalId}" OR textPayload:"${txHash.toLowerCase()}")`,
    '(textPayload:"CONSUMER_WITHDRAW_COMPLETED" OR textPayload:"consumer_withdraw_processor: COMPLETED")',
  ].join(" AND ");
  const raw = execFileSync(
    "gcloud",
    [
      "logging",
      "read",
      filter,
      `--project=${ctx.config.projectId}`,
      "--format=json",
      "--limit=50",
    ],
    { cwd: ctx.ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const rows = JSON.parse(raw || "[]")
    .map((row) => ({
      timestamp: row.timestamp || row.receiveTimestamp || "",
      textPayload: row.textPayload || "",
      revision:
        row.resource?.labels?.revision_name ||
        row.labels?.revision_name ||
        "",
    }))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return { gateway: rows };
}

export function readWithdrawalDb(ctx, withdrawalId) {
  return selectSingleJson(
    ctx,
    `
    SELECT
      withdrawal_id AS "withdrawalId",
      status,
      amount_usdc::text AS "amountUsdc",
      tx_hash AS "txHash",
      created_at::text AS "createdAt",
      updated_at::text AS "updatedAt",
      CASE
        WHEN upper(status) = 'COMPLETED' THEN updated_at::text
        ELSE ''
      END AS "completedAt"
    FROM synapse_vault_withdrawals
    WHERE withdrawal_id = ${sqlLiteral(withdrawalId)}
    LIMIT 1
  `
  );
}

export function readBalanceDb(ctx, ownerAddress) {
  return selectSingleJson(
    ctx,
    `
    SELECT
      owner.owner_wallet AS "ownerAddress",
      balance.available_balance::text AS "availableBalance",
      balance.pending_balance::text AS "pendingBalance",
      balance.frozen_balance::text AS "frozenBalance"
    FROM synapse_owner_accounts owner
    JOIN synapse_ledger_accounts account
      ON account.owner_id = owner.owner_id
     AND account.account_kind = 'consumer_wallet'
    JOIN synapse_account_balances balance
      ON balance.account_id = account.account_id
    WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
    LIMIT 1
  `
  );
}

function selectSingleJson(ctx, sql) {
  return psqlJson(ctx, `SELECT COALESCE(row_to_json(t), '{}'::json) FROM (${sql}) AS t;`) || {};
}

function psqlJson(ctx, sql) {
  const result = spawnSync(
    "psql",
    [
      ctx.config.postgresDsn,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: ctx.ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`psql query failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return JSON.parse(result.stdout.trim() || "null");
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

export function writeEvidence(ctx, { status }) {
  const traceText =
    ctx.evidence.trace.map((row) => JSON.stringify(row)).join("\n") +
    (ctx.evidence.trace.length ? "\n" : "");
  const report = {
    generatedAt: ctx.GENERATED_AT.toISOString(),
    environment: "staging",
    status,
    runId: ctx.RUN_ID,
    checks: ctx.evidence.checks,
    failed: ctx.evidence.failed,
    screenshots: ctx.evidence.screenshots,
    traceDigest: crypto.createHash("sha256").update(traceText).digest("hex"),
    result: ctx.evidence.chain.result || {},
  };

  fs.writeFileSync(`${ctx.OUT_DIR}/trace.jsonl`, traceText, "utf8");
  fs.writeFileSync(
    `${ctx.OUT_DIR}/api-evidence.json`,
    JSON.stringify(ctx.sanitize(ctx.evidence.api), null, 2)
  );
  fs.writeFileSync(
    `${ctx.OUT_DIR}/db-evidence.json`,
    JSON.stringify(ctx.sanitize(ctx.evidence.db), null, 2)
  );
  fs.writeFileSync(
    `${ctx.OUT_DIR}/chain-evidence.json`,
    JSON.stringify(ctx.sanitize(ctx.evidence.chain), null, 2)
  );
  fs.writeFileSync(
    `${ctx.OUT_DIR}/log-evidence.json`,
    JSON.stringify(ctx.sanitize(ctx.evidence.logs), null, 2)
  );
  fs.writeFileSync(
    `${ctx.OUT_DIR}/screenshot-evidence.json`,
    JSON.stringify(
      ctx.sanitize({
        screenshots: ctx.evidence.screenshots,
        browser: ctx.evidence.browser,
        screenshotMetadata: ctx.evidence.screenshotEvidence,
      }),
      null,
      2
    )
  );
  fs.writeFileSync(`${ctx.OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    `${ctx.OUT_DIR}/report.md`,
    [
      "# Staging Consumer Withdraw Auto-Approve E2E",
      "",
      `- Status: ${status}`,
      `- Run ID: ${ctx.RUN_ID}`,
      `- Gateway: ${ctx.config.gatewayBase}`,
      `- Frontend: ${ctx.config.userFrontUrl}`,
      "",
      "## Checks",
      "",
      ...(ctx.evidence.checks.length
        ? ctx.evidence.checks.map(
            (row) => `- ${row.ok ? "PASS" : "FAIL"} \`${row.name}\`${row.detail ? ` - ${row.detail}` : ""}`
          )
        : ["- none"]),
      "",
      "## Result",
      "",
      `- withdrawalId: ${ctx.evidence.chain.result?.withdrawalId || ""}`,
      `- txHash: ${ctx.evidence.chain.result?.txHash || ""}`,
      `- amountUsdc: ${ctx.evidence.chain.result?.amountUsdc || ""}`,
      `- feeUsdc: ${ctx.evidence.chain.result?.feeUsdc || ""}`,
      `- netUsdc: ${ctx.evidence.chain.result?.netUsdc || ""}`,
      `- completedDelaySec: ${ctx.evidence.chain.result?.completedDelaySec ?? ""}`,
      "",
    ].join("\n"),
    "utf8"
  );
  console.log(`evidence written to ${ctx.OUT_DIR}`);
}
