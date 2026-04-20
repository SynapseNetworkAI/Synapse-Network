#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FIXTURE_PATH = process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE
  ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE)
  : path.join(ROOT, "tmp/admin-withdrawal-approval/fixture.json");
const DOGFOOD_REPORT_PATH = process.env.ADMIN_WITHDRAWAL_APPROVAL_DOGFOOD_REPORT
  ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_DOGFOOD_REPORT)
  : findLatestDogfoodReport();
const OUT_DIR = DOGFOOD_REPORT_PATH
  ? path.dirname(DOGFOOD_REPORT_PATH)
  : path.join(ROOT, "output/dogfood/admin-withdrawal-approval", new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z"));

const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300").replace(/\/+$/, "");
const API_BASE = `${GATEWAY_BASE_URL}/api`;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const ADMIN_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";
const POSTGRES_DSN = process.env.GATEWAY_POSTGRES_DSN
  || process.env.POSTGRES_DSN
  || "postgresql://synapse_gateway_app:local-dev-gateway-app-password@localhost:5432/synapse_gateway";

const passed = [];
const failed = [];
const comparisons = [];
const securityChecks = [];

function findLatestDogfoodReport() {
  const base = path.join(ROOT, "output/dogfood/admin-withdrawal-approval");
  if (!fs.existsSync(base)) return "";
  const candidates = fs.readdirSync(base)
    .map((name) => path.join(base, name, "report.json"))
    .filter((filePath) => fs.existsSync(filePath))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || "";
}

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function failCheck(name, detail) {
  failed.push({ name, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function queryJson(sql) {
  const result = spawnSync("psql", [
    POSTGRES_DSN,
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`psql query failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

async function api(pathname, { method = "GET", token, address, body, headers = {}, expectOk = true } = {}) {
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
    throw new Error(`${method} ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }
  return { response, payload };
}

async function adminApi(pathname, auth, { method = "GET", body, expectOk = true, otpCode } = {}) {
  const headers = {
    Accept: "application/json",
    Cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = auth.csrfToken || "";
  }
  if (otpCode) headers["X-Admin-OTP-Code"] = otpCode;
  const response = await fetch(`${ADMIN_GATEWAY_URL}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (expectOk && (!response.ok || payload.success === false)) {
    throw new Error(`Admin API failed ${method} ${pathname}: ${response.status} ${JSON.stringify(payload).slice(0, 800)}`);
  }
  return { response, payload };
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of String(secret).replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error(`Invalid base32 character in ADMIN_TOTP_SECRET: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTotpCode(secret, nowMs = Date.now()) {
  const counter = Math.floor(nowMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32ToBuffer(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function getChainContext() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contractConfig = readJson("services/user-front/src/contract-config.json");
  return {
    provider,
    coreAddress: ethers.getAddress(contractConfig.SynapseCore),
    usdcAddress: ethers.getAddress(contractConfig.MockUSDC),
    coreAbi: readJson("services/user-front/src/SynapseCoreABI.json"),
    usdcAbi: readJson("services/user-front/src/MockUSDCABI.json"),
  };
}

async function readChainBalances(address) {
  const { provider, coreAddress, usdcAddress, usdcAbi } = await getChainContext();
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, provider);
  const decimals = Number(await usdc.decimals());
  const providerAtomic = await usdc.balanceOf(address);
  const vaultAtomic = await usdc.balanceOf(coreAddress);
  return {
    decimals,
    providerUsdcAtomic: providerAtomic.toString(),
    providerUsdc: ethers.formatUnits(providerAtomic, decimals),
    vaultUsdcAtomic: vaultAtomic.toString(),
    vaultUsdc: ethers.formatUnits(vaultAtomic, decimals),
  };
}

async function sendWithRetry(label, makeTx, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await makeTx();
    } catch (error) {
      lastError = error;
      if (!/nonce|replacement|underpriced|already known|transaction underpriced/i.test(error.message || "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

async function expectContractRevert(label, fn) {
  try {
    await fn();
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    if (`${error.message || error}`.includes("unexpectedly succeeded")) throw error;
    securityChecks.push({ name: label, pass: true, detail: String(error.shortMessage || error.message || error).slice(0, 500) });
    pass(`security:${label}`, "contract rejected");
  }
}

function addComparison(stage, metricName, expected, actual, passValue, detail = "") {
  const row = {
    stage,
    metricName,
    expected: String(expected),
    actual: String(actual),
    pass: Boolean(passValue),
    detail,
  };
  comparisons.push(row);
  if (row.pass) {
    pass(`compare:${stage}:${metricName}`, `${row.actual}`);
  } else {
    failCheck(`compare:${stage}:${metricName}`, `expected=${row.expected} actual=${row.actual}${detail ? ` ${detail}` : ""}`);
  }
}

function getDbWithdrawal(withdrawalId) {
  return queryJson(`
    SELECT json_build_object(
      'withdrawalId', vw.withdrawal_id,
      'status', vw.status,
      'amountUsdc', vw.amount_usdc::text,
      'txHash', vw.tx_hash,
      'signature', vw.signature,
      'nonce', vw.nonce,
      'deadline', vw.deadline,
      'ownerAddress', owner.owner_wallet,
      'updatedAt', vw.updated_at::text
    )
    FROM synapse_vault_withdrawals vw
    JOIN synapse_ledger_accounts account ON account.account_id = vw.source_account_id
    JOIN synapse_owner_accounts owner ON owner.owner_id = account.owner_id
    WHERE vw.withdrawal_id = ${sqlLiteral(withdrawalId)}
  `);
}

function getDbProviderBalance(ownerAddress) {
  return queryJson(`
    SELECT json_build_object(
      'ownerAddress', owner.owner_wallet,
      'availableBalance', balance.available_balance::text,
      'pendingBalance', balance.pending_balance::text,
      'frozenBalance', balance.frozen_balance::text
    )
    FROM synapse_owner_accounts owner
    JOIN synapse_ledger_accounts account
      ON account.owner_id = owner.owner_id
     AND account.account_kind IN ('provider', 'provider_wallet')
    JOIN synapse_account_balances balance
      ON balance.account_id = account.account_id
    WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
  `);
}

async function loadApprovedWithdrawal(fixture) {
  const rows = (await api("/v1/providers/withdrawals?limit=50", fixture.provider)).payload.withdrawals || [];
  const row = rows.find((item) => item.id === fixture.withdrawal.withdrawalId || item.withdrawalId === fixture.withdrawal.withdrawalId);
  assert(row, `Provider withdrawal ${fixture.withdrawal.withdrawalId} not found in Gateway listing.`);
  const ticket = row.ticket || {};
  assert(row.status === "APPROVED_AUTO" || row.status === "COMPLETED", `Expected approved/completed withdrawal, got ${row.status}`);
  if (row.status !== "COMPLETED") {
    assert(ticket.signature, `Approved withdrawal is missing signed ticket: ${JSON.stringify(row).slice(0, 800)}`);
  }
  return { row, ticket };
}

async function runSecurityChecksBeforeClaim(fixture) {
  const withdrawalId = fixture.withdrawal.withdrawalId;
  const otp = generateTotpCode(ADMIN_TOTP_SECRET);
  const duplicateApprove = await adminApi(
    `/api/admin/v1/withdrawal-reviews/${encodeURIComponent(withdrawalId)}/decision`,
    fixture.auth,
    {
      method: "POST",
      body: { decision: "APPROVE", note: "Duplicate approval must fail." },
      otpCode: otp,
      expectOk: false,
    },
  );
  const duplicateApprovePassed = !duplicateApprove.response.ok;
  securityChecks.push({
    name: "duplicate approval rejected",
    pass: duplicateApprovePassed,
    status: duplicateApprove.response.status,
    payload: duplicateApprove.payload,
  });
  if (!duplicateApprovePassed) failCheck("security:duplicate-approval", "second approve unexpectedly succeeded");
  else pass("security:duplicate-approval", `status=${duplicateApprove.response.status}`);

  const crossReject = await adminApi(
    `/api/admin/v1/withdrawal-reviews/${encodeURIComponent(withdrawalId)}/decision`,
    fixture.auth,
    {
      method: "POST",
      body: { decision: "REJECT", note: "Reject after approve must fail." },
      otpCode: generateTotpCode(ADMIN_TOTP_SECRET),
      expectOk: false,
    },
  );
  const crossRejectPassed = !crossReject.response.ok;
  securityChecks.push({
    name: "cross decision after approve rejected",
    pass: crossRejectPassed,
    status: crossReject.response.status,
    payload: crossReject.payload,
  });
  if (!crossRejectPassed) failCheck("security:cross-reject", "reject after approve unexpectedly succeeded");
  else pass("security:cross-reject", `status=${crossReject.response.status}`);
}

async function claimOnChainAndComplete(fixture, ticket) {
  const { provider, coreAddress, coreAbi } = await getChainContext();
  const signer = new ethers.Wallet(fixture.provider.privateKey, provider);
  const core = new ethers.Contract(coreAddress, coreAbi, signer);
  const signature = String(ticket.signature || "").startsWith("0x") ? ticket.signature : `0x${ticket.signature}`;
  const amount = BigInt(ticket.amount);
  const fee = BigInt(ticket.fee || 0);
  const nonce = BigInt(ticket.nonce);
  const deadline = BigInt(ticket.deadline);

  await expectContractRevert("tampered ticket amount rejected", async () => {
    const badTx = await core.withdraw(amount + 1n, fee, nonce, deadline, signature, {
      nonce: await provider.getTransactionCount(signer.address, "pending"),
    });
    await badTx.wait();
  });

  const withdrawTx = await sendWithRetry("provider-on-chain-withdraw", async () =>
    core.withdraw(amount, fee, nonce, deadline, signature, {
      nonce: await provider.getTransactionCount(signer.address, "pending"),
    })
  );
  const receipt = await withdrawTx.wait();
  assert(receipt?.status === 1, `on-chain provider withdraw reverted: ${withdrawTx.hash}`);
  pass("chain:provider-claim", withdrawTx.hash);

  await expectContractRevert("withdraw ticket replay rejected", async () => {
    const replayTx = await core.withdraw(amount, fee, nonce, deadline, signature, {
      nonce: await provider.getTransactionCount(signer.address, "pending"),
    });
    await replayTx.wait();
  });

  const complete = await api(`/v1/providers/withdrawals/${encodeURIComponent(fixture.withdrawal.withdrawalId)}/complete`, {
    method: "POST",
    token: fixture.provider.token,
    address: fixture.provider.address,
    body: { txHash: withdrawTx.hash },
  });
  const completeData = complete.payload.data || complete.payload;
  assert(
    completeData.status === "COMPLETED" && completeData.withdrawalId === fixture.withdrawal.withdrawalId,
    `complete response mismatch: ${JSON.stringify(complete.payload)}`,
  );
  pass("gateway:complete-withdrawal", withdrawTx.hash);

  const duplicateComplete = await api(`/v1/providers/withdrawals/${encodeURIComponent(fixture.withdrawal.withdrawalId)}/complete`, {
    method: "POST",
    token: fixture.provider.token,
    address: fixture.provider.address,
    body: { txHash: withdrawTx.hash },
    expectOk: false,
  });
  const duplicateCompletePassed = !duplicateComplete.response.ok;
  securityChecks.push({
    name: "duplicate complete rejected",
    pass: duplicateCompletePassed,
    status: duplicateComplete.response.status,
    payload: duplicateComplete.payload,
  });
  if (!duplicateCompletePassed) failCheck("security:duplicate-complete", "duplicate complete unexpectedly succeeded");
  else pass("security:duplicate-complete", `status=${duplicateComplete.response.status}`);

  return { txHash: withdrawTx.hash, complete: completeData };
}

function verifyDogfoodReport(report, fixture) {
  assert(report.status === "success", `dogfood report status is ${report.status}`);
  assert(Array.isArray(report.failed) && report.failed.length === 0, `dogfood failures: ${JSON.stringify(report.failed)}`);
  assert(Array.isArray(report.consoleErrors) && report.consoleErrors.length === 0, `dogfood console errors: ${JSON.stringify(report.consoleErrors)}`);
  const screenshotNames = new Set((report.screenshots || []).map((filePath) => path.basename(filePath)));
  for (const name of [
    "01-withdrawal-review-queue.png",
    "02-withdrawal-review-detail.png",
    "04-after-approve.png",
    "05-review-history.png",
    "06-finance-reconciliation.png",
  ]) {
    assert(screenshotNames.has(name), `missing screenshot ${name}`);
  }
  assert(report.withdrawalId === fixture.withdrawal.withdrawalId, "dogfood report withdrawalId mismatch");
  pass("report:dogfood-clean", `${report.passed.length} browser checks passed`);
}

function writeReport({ fixture, dogfoodReport, beforeClaimChain, afterClaimChain, beforeClaimDbBalance, afterClaimDbBalance, dbBeforeComplete, dbAfterComplete, chainResult }) {
  const status = failed.length === 0 && comparisons.every((row) => row.pass) && securityChecks.every((row) => row.pass) ? "success" : "failed";
  const report = {
    status,
    generatedAt: new Date().toISOString(),
    fixturePath: FIXTURE_PATH,
    dogfoodReportPath: DOGFOOD_REPORT_PATH,
    runId: fixture.runId,
    withdrawalId: fixture.withdrawal.withdrawalId,
    expected: fixture.expected,
    comparisons,
    securityChecks,
    passed,
    failed,
    chain: {
      beforeClaim: beforeClaimChain,
      afterClaim: afterClaimChain,
      txHash: chainResult?.txHash || dbAfterComplete?.txHash || null,
    },
    db: {
      beforeClaimBalance: beforeClaimDbBalance,
      afterClaimBalance: afterClaimDbBalance,
      beforeCompleteWithdrawal: dbBeforeComplete,
      afterCompleteWithdrawal: dbAfterComplete,
    },
    screenshots: dogfoodReport.screenshots || [],
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "reconciliation-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  const comparisonRows = comparisons.map((row) =>
    `| ${row.stage} | ${row.metricName} | ${row.expected} | ${row.actual} | ${row.pass ? "PASS" : "FAIL"} |`
  );
  const securityRows = securityChecks.map((row) =>
    `| ${row.name} | ${row.pass ? "PASS" : "FAIL"} | ${row.status ?? ""} | ${String(row.detail || row.payload?.error?.code || row.payload?.detail?.code || "").replaceAll("|", "\\|")} |`
  );
  const lines = [
    "# Admin Withdrawal Approval Reconciliation Report",
    "",
    `- Status: ${status}`,
    `- Run ID: ${fixture.runId}`,
    `- Withdrawal ID: ${fixture.withdrawal.withdrawalId}`,
    `- Generated at: ${report.generatedAt}`,
    "",
    "## Expected vs Actual",
    "",
    "| Stage | Metric | Expected | Actual | Result |",
    "| --- | --- | --- | --- | --- |",
    ...comparisonRows,
    "",
    "## Security Checks",
    "",
    "| Check | Result | HTTP Status | Detail |",
    "| --- | --- | --- | --- |",
    ...securityRows,
    "",
    "## Chain Evidence",
    "",
    `- Claim txHash: ${report.chain.txHash || "n/a"}`,
    `- Provider USDC before: ${beforeClaimChain.providerUsdc}`,
    `- Provider USDC after: ${afterClaimChain.providerUsdc}`,
    `- Vault USDC before: ${beforeClaimChain.vaultUsdc}`,
    `- Vault USDC after: ${afterClaimChain.vaultUsdc}`,
    "",
    "## Screenshot Evidence",
    ...(report.screenshots || []).map((filePath) => `- ${filePath}`),
    "",
  ];
  fs.writeFileSync(path.join(OUT_DIR, "reconciliation-report.md"), `${lines.join("\n")}\n`);
  console.log(`[admin-withdrawal-reconcile] wrote ${path.join(OUT_DIR, "reconciliation-report.md")}`);
  return report;
}

async function main() {
  assert(fs.existsSync(FIXTURE_PATH), `fixture not found: ${FIXTURE_PATH}`);
  assert(DOGFOOD_REPORT_PATH && fs.existsSync(DOGFOOD_REPORT_PATH), `dogfood report not found: ${DOGFOOD_REPORT_PATH || "(none)"}`);
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const dogfoodReport = JSON.parse(fs.readFileSync(DOGFOOD_REPORT_PATH, "utf8"));
  verifyDogfoodReport(dogfoodReport, fixture);

  const { row: approvedRow, ticket } = await loadApprovedWithdrawal(fixture);
  const dbBeforeComplete = getDbWithdrawal(fixture.withdrawal.withdrawalId);
  const beforeClaimDbBalance = getDbProviderBalance(fixture.provider.address);
  addComparison("approve", "Gateway status", "APPROVED_AUTO", approvedRow.status, approvedRow.status === "APPROVED_AUTO" || approvedRow.status === "COMPLETED");
  addComparison("approve", "DB status", "APPROVED_AUTO", dbBeforeComplete?.status, dbBeforeComplete?.status === "APPROVED_AUTO" || dbBeforeComplete?.status === "COMPLETED");
  if (approvedRow.status !== "COMPLETED") {
    addComparison("approve", "Ticket amount atomic", ticket.amount, dbBeforeComplete?.signature ? ticket.amount : ticket.amount, String(ticket.amount) === String(fixture.expected.amountAtomic));
  }

  await runSecurityChecksBeforeClaim(fixture);

  const beforeClaimChain = await readChainBalances(fixture.provider.address);
  let chainResult = null;
  if (approvedRow.status === "COMPLETED") {
    pass("chain:claim-skipped", "withdrawal was already completed before reconciliation");
  } else {
    chainResult = await claimOnChainAndComplete(fixture, ticket);
  }
  const afterClaimChain = await readChainBalances(fixture.provider.address);
  const dbAfterComplete = getDbWithdrawal(fixture.withdrawal.withdrawalId);
  const afterClaimDbBalance = getDbProviderBalance(fixture.provider.address);

  const expectedAtomic = BigInt(fixture.expected.amountAtomic);
  const providerDelta = BigInt(afterClaimChain.providerUsdcAtomic) - BigInt(beforeClaimChain.providerUsdcAtomic);
  const vaultDelta = BigInt(beforeClaimChain.vaultUsdcAtomic) - BigInt(afterClaimChain.vaultUsdcAtomic);
  addComparison("chain", "Provider USDC delta atomic", expectedAtomic, providerDelta, providerDelta === expectedAtomic);
  addComparison("chain", "Vault USDC delta atomic", expectedAtomic, vaultDelta, vaultDelta === expectedAtomic);
  addComparison("complete", "DB status", "COMPLETED", dbAfterComplete?.status, dbAfterComplete?.status === "COMPLETED");
  addComparison("complete", "DB txHash", chainResult?.txHash || "existing", dbAfterComplete?.txHash, Boolean(dbAfterComplete?.txHash));
  addComparison("complete", "Provider pending balance", "0.000000", afterClaimDbBalance?.pendingBalance, String(afterClaimDbBalance?.pendingBalance || "") === "0.000000");
  addComparison("complete", "Provider frozen balance", "0.000000", afterClaimDbBalance?.frozenBalance, String(afterClaimDbBalance?.frozenBalance || "") === "0.000000");

  const history = await adminApi(`/api/admin/v1/withdrawal-reviews/history?query=${encodeURIComponent(fixture.withdrawal.withdrawalId)}&limit=10`, fixture.auth);
  const historyItems = history.payload.data?.items || history.payload.items || [];
  addComparison("admin-history", "Review history contains withdrawal", "present", historyItems.some((item) => item.withdrawalId === fixture.withdrawal.withdrawalId) ? "present" : "missing", historyItems.some((item) => item.withdrawalId === fixture.withdrawal.withdrawalId));

  const report = writeReport({
    fixture,
    dogfoodReport,
    beforeClaimChain,
    afterClaimChain,
    beforeClaimDbBalance,
    afterClaimDbBalance,
    dbBeforeComplete,
    dbAfterComplete,
    chainResult,
  });
  if (report.status !== "success") process.exit(1);
}

main().catch((error) => {
  console.error(`[admin-withdrawal-reconcile] fatal: ${error.stack || error.message || String(error)}`);
  process.exit(1);
});
