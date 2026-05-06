#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");

const envName = (process.env.SYNAPSE_E2E_ENV || "local").trim().toLowerCase();
const isStaging = envName === "staging";
const gatewayLocalEnv =
  envName === "local"
    ? readEnvFile(path.join(ROOT, "services/gateway/.env.local"))
    : {};
const providerWallet = normalizeWallet(
  process.env.PROVIDER_WITHDRAW_PROVIDER_WALLET ||
    "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8"
);
const gatewayBase = stripSlash(
  process.env.PROVIDER_WITHDRAW_GATEWAY_BASE_URL ||
    (isStaging
      ? "https://api-staging.synapse-network.ai"
      : "http://127.0.0.1:8000")
);
const postgresDsn =
  process.env.PROVIDER_WITHDRAW_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
const maturitySeconds = Number.parseInt(
  process.env.PROVIDER_WITHDRAW_MATURITY_SECONDS || "604800",
  10
);
const withdrawalId = (process.env.PROVIDER_WITHDRAW_WITHDRAWAL_ID || "").trim();
const expectedWithdrawalAmount = (
  process.env.PROVIDER_WITHDRAW_EXPECT_AMOUNT_USDC || ""
).trim();
const requireWithdrawal =
  process.env.PROVIDER_WITHDRAW_REQUIRE_WITHDRAWAL === "1" ||
  Boolean(withdrawalId);
const outputDir = path.resolve(
  process.env.PROVIDER_WITHDRAW_MATURE_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "output/e2e/provider-withdraw-mature",
      `${timestamp}-${envName}`
    )
);

const evidence = {
  environment: envName,
  generatedAt: new Date().toISOString(),
  gatewayBase,
  providerWallet,
  maturitySeconds,
  outputDir,
  steps: [],
  failed: [],
  warnings: [],
  api: {},
  sql: {},
};

fs.mkdirSync(outputDir, { recursive: true });

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function normalizeWallet(value) {
  const wallet = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    throw new Error(`Invalid provider wallet: ${value || "[empty]"}`);
  }
  return wallet;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const rows = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    rows[key] = value;
  }
  return rows;
}

function addStep(name, ok, detail = "", extra = {}) {
  const row = { name, ok, detail, ...extra };
  evidence.steps.push(row);
  if (!ok) evidence.failed.push(row);
  console.log(
    `[provider-withdraw-mature] ${ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${detail}` : ""
    }`
  );
}

function addWarning(name, detail = "") {
  evidence.warnings.push({ name, detail });
  console.warn(
    `[provider-withdraw-mature] WARN ${name}${detail ? ` - ${detail}` : ""}`
  );
}

function fail(message) {
  throw new Error(message);
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function psqlJson(sql) {
  if (
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/i.test(
      sql
    )
  ) {
    fail("SQL evidence runner only allows read-only SELECT statements");
  }
  const pgOptions = [
    process.env.PGOPTIONS,
    "-c default_transaction_read_only=on",
  ]
    .filter(Boolean)
    .join(" ");
  const result = spawnSync(
    "psql",
    [postgresDsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, PGOPTIONS: pgOptions },
    }
  );
  if (result.status !== 0) {
    fail(`psql query failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function selectJson(sql) {
  return psqlJson(
    `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (${sql}) AS t;`
  );
}

function selectOne(sql, label) {
  const rows = selectJson(sql);
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(`${label} returned no rows`);
  }
  return rows[0];
}

function moneyToUnits(value) {
  const normalized = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    fail(`invalid money value: ${value}`);
  }
  const sign = normalized.startsWith("-") ? -1n : 1n;
  const unsigned = normalized.replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  return (
    sign *
    (BigInt(whole || "0") * 1_000_000n +
      BigInt(fraction.padEnd(6, "0").slice(0, 6)))
  );
}

function moneyEq(left, right) {
  return moneyToUnits(left) === moneyToUnits(right);
}

function moneyNonNegative(value) {
  return moneyToUnits(value) >= 0n;
}

function requireMoneyField(record, field, label) {
  if (record[field] === undefined || record[field] === null) {
    fail(`${label} missing required money field ${field}`);
  }
  moneyToUnits(record[field]);
  return record[field];
}

function base64urlJson(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function signJwt(wallet) {
  if (process.env.PROVIDER_WITHDRAW_OWNER_JWT) {
    return process.env.PROVIDER_WITHDRAW_OWNER_JWT;
  }
  const secret =
    process.env.JWT_SECRET ||
    gatewayLocalEnv.JWT_SECRET ||
    "replace-this-with-a-32-byte-minimum-jwt-secret";
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { sub: wallet, iat: now, exp: now + 3600 };
  const encoded = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

async function fetchProviderSummary() {
  const response = await fetch(
    `${gatewayBase}/api/v1/providers/earnings/summary?limit=1`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${signJwt(providerWallet)}`,
        "X-User-Address": providerWallet,
      },
    }
  );
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  evidence.api.providerSummary = { status: response.status, payload };
  if (!response.ok) {
    fail(
      `provider summary API failed: ${response.status} ${text.slice(0, 500)}`
    );
  }
  if (!payload?.summary) {
    fail("provider summary API response missing summary");
  }
  return payload.summary;
}

function assertStagingGuard() {
  if (!isStaging) return;
  if (
    process.env.PROVIDER_WITHDRAW_MATURE_CONFIRM !==
    "I_UNDERSTAND_THIS_MUTATES_STAGING"
  ) {
    fail(
      "Staging provider withdraw mature evidence requires PROVIDER_WITHDRAW_MATURE_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING"
    );
  }
  if (
    postgresDsn.includes("synapse_gateway_app") ||
    postgresDsn.includes("postgresql://synapse:")
  ) {
    fail(
      "Staging SQL evidence must use a read-only DSN/IAM user, not app or superuser credentials"
    );
  }
}

function queryOwnerAndAccount() {
  const owner = selectOne(
    `
      SELECT owner_id, owner_wallet
      FROM synapse_owner_accounts
      WHERE lower(owner_wallet) = lower(${sqlLiteral(providerWallet)})
    `,
    "provider owner"
  );
  const account = selectOne(
    `
      SELECT account_id, account_kind, owner_id
      FROM synapse_ledger_accounts
      WHERE account_id = 'provider_wallet::' || lower(${sqlLiteral(
        providerWallet
      )})
    `,
    "provider ledger account"
  );
  evidence.sql.owner = owner;
  evidence.sql.providerAccount = account;
  if (String(account.account_kind) !== "provider_wallet") {
    fail(`expected provider_wallet account, got ${account.account_kind}`);
  }
  addStep("sql:provider-account", true, account.account_id);
  return { owner, account };
}

function queryBalances(accountId) {
  const balance = selectOne(
    `
      SELECT account_id, available_balance, pending_balance, frozen_balance, updated_at
      FROM synapse_account_balances
      WHERE account_id = ${sqlLiteral(accountId)}
    `,
    "provider account balance"
  );
  evidence.sql.balance = balance;
  for (const field of [
    "available_balance",
    "pending_balance",
    "frozen_balance",
  ]) {
    if (!moneyNonNegative(balance[field])) {
      fail(`provider ${field} is negative: ${balance[field]}`);
    }
  }
  addStep("sql:provider-buckets-non-negative", true);
  return balance;
}

function queryMatureFormula() {
  const formula = selectOne(
    `
      WITH params AS (
        SELECT
          lower(${sqlLiteral(providerWallet)}) AS provider_wallet,
          'provider_wallet::' || lower(${sqlLiteral(
            providerWallet
          )}) AS provider_account_id,
          ${
            Number.isFinite(maturitySeconds) ? maturitySeconds : 604800
          }::integer AS maturity_seconds
      ),
      matured_income AS (
        SELECT COALESCE(SUM(amount_usdc), 0) AS amount
        FROM synapse_ledger_entries, params
        WHERE credit_account_id = params.provider_account_id
          AND business_type = 'charge'
          AND status = 'posted'
          AND created_at <= NOW() - (params.maturity_seconds * INTERVAL '1 second')
      ),
      active_withdrawals AS (
        SELECT COALESCE(SUM(amount_usdc), 0) AS amount
        FROM synapse_vault_withdrawals vw
        JOIN synapse_owner_accounts oa ON oa.owner_id = vw.owner_id
        JOIN params ON lower(oa.owner_wallet) = params.provider_wallet
        WHERE vw.withdrawal_kind = 'provider_withdrawal'
          AND vw.status NOT IN ('FAILED', 'FAILED_EXPIRED', 'REJECTED', 'CANCELLED')
      )
      SELECT
        matured_income.amount AS matured_income_usdc,
        active_withdrawals.amount AS active_withdraw_or_locked_usdc,
        GREATEST(matured_income.amount - active_withdrawals.amount, 0) AS provider_mature_receivable
      FROM matured_income, active_withdrawals
    `,
    "provider mature receivable formula"
  );
  evidence.sql.matureFormula = formula;
  addStep(
    "sql:provider-mature-formula",
    true,
    `mature=${formula.provider_mature_receivable}`
  );
  return formula;
}

function queryWithdrawals(ownerId) {
  const predicate = withdrawalId
    ? `AND withdrawal_id = ${sqlLiteral(withdrawalId)}`
    : "";
  const rows = selectJson(`
    SELECT withdrawal_id, owner_id, provider_id, source_account_id,
           withdrawal_kind, amount_usdc, status, ticket_id, ticket_hash,
           tx_hash, created_at, updated_at
    FROM synapse_vault_withdrawals
    WHERE withdrawal_kind = 'provider_withdrawal'
      AND owner_id = ${sqlLiteral(ownerId)}
      ${predicate}
    ORDER BY created_at DESC
    LIMIT 5
  `);
  evidence.sql.withdrawals = rows;
  if (requireWithdrawal && rows.length === 0) {
    fail("required provider withdrawal evidence row was not found");
  }
  if (
    expectedWithdrawalAmount &&
    rows[0] &&
    !moneyEq(rows[0].amount_usdc, expectedWithdrawalAmount)
  ) {
    fail(
      `withdrawal amount ${rows[0].amount_usdc} does not match expected ${expectedWithdrawalAmount}`
    );
  }
  if (rows.length > 0) {
    addStep("sql:provider-withdrawal-row", true, rows[0].withdrawal_id);
  } else {
    addWarning(
      "sql:provider-withdrawal-row",
      "no withdrawal row requested/found; summary and bucket evidence still captured"
    );
  }
  return rows;
}

function queryAudit(ownerId, latestWithdrawalId) {
  if (!latestWithdrawalId) {
    evidence.sql.audit = [];
    return [];
  }
  const rows = selectJson(`
    SELECT event_type, business_type, owner_id, provider_id,
           amount_delta, result_status, error_code, detail_json, created_at
    FROM synapse_audit_events
    WHERE owner_id = ${sqlLiteral(ownerId)}
      AND detail_json::text LIKE '%' || ${sqlLiteral(latestWithdrawalId)} || '%'
    ORDER BY created_at DESC
  `);
  evidence.sql.audit = rows;
  if (requireWithdrawal && rows.length === 0) {
    fail(`required audit row missing for withdrawal ${latestWithdrawalId}`);
  }
  if (rows.length > 0)
    addStep("sql:provider-withdrawal-audit", true, `${rows.length} row(s)`);
  return rows;
}

async function main() {
  assertStagingGuard();
  const summary = await fetchProviderSummary();
  const apiProviderReceivable = requireMoneyField(
    summary,
    "providerReceivable",
    "provider summary API"
  );
  const apiProviderMatureReceivable = requireMoneyField(
    summary,
    "providerMatureReceivable",
    "provider summary API"
  );
  addStep(
    "api:provider-summary",
    true,
    `mature=${apiProviderMatureReceivable}`
  );

  const { owner, account } = queryOwnerAndAccount();
  const balance = queryBalances(account.account_id);
  const formula = queryMatureFormula();

  if (
    !moneyEq(apiProviderMatureReceivable, formula.provider_mature_receivable)
  ) {
    fail(
      `API providerMatureReceivable=${apiProviderMatureReceivable} does not match SQL=${formula.provider_mature_receivable}`
    );
  }
  addStep("api-sql:mature-receivable-match", true);

  if (!moneyEq(apiProviderReceivable, balance.available_balance)) {
    fail(
      `API providerReceivable=${apiProviderReceivable} does not match SQL available_balance=${balance.available_balance}`
    );
  }
  addStep("api-sql:receivable-balance-match", true);

  const withdrawals = queryWithdrawals(owner.owner_id);
  queryAudit(owner.owner_id, withdrawals[0]?.withdrawal_id);
}

try {
  await main();
} catch (error) {
  addStep(
    "provider-withdraw-mature:e2e",
    false,
    error instanceof Error ? error.message : String(error)
  );
}

const reportPath = path.join(outputDir, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(evidence, null, 2));
console.log(`[provider-withdraw-mature] report=${reportPath}`);

if (evidence.failed.length > 0) {
  process.exitCode = 1;
}
