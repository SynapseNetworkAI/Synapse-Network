#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { verifyPaymentsDom } from "./user_front_payments_gateway_truth_dom.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const timestamp = generatedAt
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const outDir = path.resolve(
  process.env.USER_FRONT_PAYMENTS_GATEWAY_TRUTH_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "output/dogfood/user-front-payments-gateway-truth",
      `${timestamp}-local`
    )
);
const screenshotsDir = path.join(outDir, "screenshots");

const config = {
  runId: process.env.USER_FRONT_PAYMENTS_GATEWAY_TRUTH_RUN_ID || timestamp,
  frontendUrl: stripSlash(
    process.env.USER_FRONT_BASE_URL || "http://127.0.0.1:3000"
  ),
  gatewayBase: stripSlash(
    process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
  ),
  rpcUrl: stripSlash(process.env.RPC_URL || "http://127.0.0.1:8545"),
  postgresDsn:
    process.env.USER_FRONT_PAYMENTS_GATEWAY_TRUTH_POSTGRES_DSN ||
    process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
    "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
  headless: process.env.USER_FRONT_PAYMENTS_GATEWAY_TRUTH_HEADLESS !== "0",
  chainId: Number.parseInt(process.env.CHAIN_ID || "31337", 10),
  privateKey:
    process.env.USER_FRONT_PAYMENTS_GATEWAY_TRUTH_PRIVATE_KEY ||
    privateKeyFromSeed(`payments-gateway-truth:${timestamp}`),
};

const ownerAddress = new ethers.Wallet(config.privateKey).address.toLowerCase();
const ownerId = `owner:${ownerAddress}`;
const consumerAccountId = `consumer_wallet::${ownerAddress}`;
const fixtureBaseTime = generatedAt.getTime();
const paymentFetchLimit = 100;
const paymentRenderLimit = 50;

const evidence = {
  environment: "local",
  generatedAt: generatedAt.toISOString(),
  frontendUrl: config.frontendUrl,
  gatewayBase: config.gatewayBase,
  ownerAddress,
  checks: [],
  failed: [],
  api: [],
  db: {},
  dom: [],
  screenshots: [],
  trace: [],
};

fs.mkdirSync(screenshotsDir, { recursive: true });

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function privateKeyFromSeed(seed) {
  return `0x${crypto.createHash("sha256").update(seed).digest("hex")}`;
}

function assertLocalUrl(name, value) {
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) {
    throw new Error(`Refusing ${name}=${value}; this E2E is local-only.`);
  }
}

function assertLocalOnly() {
  assertLocalUrl("frontendUrl", config.frontendUrl);
  assertLocalUrl("gatewayBase", config.gatewayBase);
  assertLocalUrl("rpcUrl", config.rpcUrl);
  if (
    !config.postgresDsn.includes("127.0.0.1") &&
    !config.postgresDsn.includes("localhost")
  ) {
    throw new Error("Refusing non-local Postgres DSN");
  }
  const dbName = new URL(config.postgresDsn).pathname.replace(/^\/+/, "");
  if (!dbName.startsWith("synapse_") || dbName === "synapse_gateway_admin") {
    throw new Error("Postgres DSN must point at a local Gateway database");
  }
  if (config.chainId !== 31337) {
    throw new Error(`Refusing non-local chainId=${config.chainId}`);
  }
}

function redact(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi,
      "postgresql://[REDACTED]@"
    )
    .replace(
      /"((?:password|privateKey|signature|jwt|token|secret|authorization)[^"]*)"\s*:\s*"[^"]+"/gi,
      '"$1":"[REDACTED]"'
    )
    .replace(config.privateKey, "[REDACTED_PRIVATE_KEY]");
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [
        key,
        /password|privateKey|authorization|bearer|jwt|token|secret/i.test(key)
          ? "[REDACTED]"
          : sanitize(next),
      ])
    );
  }
  return typeof value === "string" ? redact(value) : value;
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function txHash(seed) {
  return `0x${crypto.createHash("sha256").update(seed).digest("hex")}`;
}

function isoSeconds(offsetSeconds) {
  return new Date(fixtureBaseTime - offsetSeconds * 1000).toISOString();
}

function epochSeconds(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function money(value) {
  return Number.parseFloat(String(value || "0")).toFixed(6);
}

function moneyDisplay(value) {
  const next = Number.parseFloat(String(value || "0"));
  if (!Number.isFinite(next) || next < 0) return "$0.00";
  return `$${next.toFixed(2)}`;
}

function shortenTransactionId(id) {
  const normalized = String(id || "");
  if (normalized.length <= 8) return normalized;
  return `${normalized.slice(0, 2)}...${normalized.slice(-4)}`;
}

function addTrace(name, detail = {}) {
  evidence.trace.push(
    sanitize({
      timestamp: new Date().toISOString(),
      name,
      ...detail,
    })
  );
}

function addCheck(name, ok, detail = "", extra = {}) {
  const row = sanitize({ name, ok: Boolean(ok), detail, ...extra });
  evidence.checks.push(row);
  if (!row.ok) evidence.failed.push(row);
  console.log(
    `[payments-gateway-truth] ${row.ok ? "PASS" : "FAIL"} ${name}${
      detail ? ` - ${redact(detail)}` : ""
    }`
  );
}

function psql(args, input = "") {
  const result = spawnSync(
    "psql",
    [config.postgresDsn, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args],
    { cwd: ROOT, encoding: "utf8", input }
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

function execSql(sql) {
  psql(["-c", sql]);
}

function selectJson(sql) {
  const output = psql([
    "-t",
    "-A",
    "-c",
    `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (${sql}) AS t;`,
  ]).trim();
  return output ? JSON.parse(output) : [];
}

function fixtureDeposits() {
  const rows = [
    {
      id: `${config.runId}:deposit:pending`,
      txHash: txHash(`${config.runId}:deposit:pending`),
      amountUsdc: "88.880000",
      status: "PENDING_CONFIRMATION",
      createdAt: isoSeconds(120),
      updatedAt: isoSeconds(120),
    },
  ];
  for (let index = 0; index < 50; index += 1) {
    const amount = (1 + index / 100).toFixed(6);
    rows.push({
      id: `${config.runId}:deposit:${String(index).padStart(2, "0")}`,
      txHash: txHash(`${config.runId}:deposit:${index}`),
      amountUsdc: amount,
      status: "CONFIRMED",
      createdAt: isoSeconds(240 + index * 60),
      updatedAt: isoSeconds(240 + index * 60),
    });
  }
  return rows;
}

function fixtureWithdrawal() {
  return {
    id: `${config.runId}:withdraw:consumer`,
    txHash: txHash(`${config.runId}:withdraw:consumer`),
    amountUsdc: "185.990000",
    status: "COMPLETED",
    createdAt: isoSeconds(60),
    updatedAt: isoSeconds(60),
    completedAt: isoSeconds(60),
    refundType: "CONSUMER_BALANCE_WITHDRAW",
  };
}

function fixtureRefund() {
  return {
    id: `${config.runId}:refund:system`,
    txHash: txHash(`${config.runId}:refund:system`),
    amountUsdc: "7.770000",
    status: "COMPLETED",
    createdAt: isoSeconds(90),
    updatedAt: isoSeconds(90),
    completedAt: isoSeconds(90),
    refundType: "SYSTEM_FAILURE",
  };
}

function seedDatabase() {
  const deposits = fixtureDeposits();
  const withdrawal = fixtureWithdrawal();
  const refund = fixtureRefund();
  const values = [];

  values.push(`
    INSERT INTO synapse_owner_accounts (
      owner_id, owner_wallet, display_name, email_verified, status, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(ownerId)}, ${sqlLiteral(
    ownerAddress
  )}, 'Payments Gateway Truth E2E', TRUE, 'active', NOW(), NOW()
    )
    ON CONFLICT (owner_id)
    DO UPDATE SET owner_wallet = EXCLUDED.owner_wallet, updated_at = NOW();
  `);
  values.push(`
    INSERT INTO synapse_ledger_accounts (
      account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(consumerAccountId)}, 'consumer_wallet', ${sqlLiteral(
    ownerId
  )}, NULL, 'USDC', 'active', NOW(), NOW()
    )
    ON CONFLICT (account_id)
    DO UPDATE SET owner_id = EXCLUDED.owner_id, updated_at = NOW();
  `);
  values.push(`
    INSERT INTO synapse_account_balances (
      account_id, available_balance, pending_balance, frozen_balance, updated_at
    ) VALUES (
      ${sqlLiteral(consumerAccountId)}, 321.000000, 88.880000, 0.000000, NOW()
    )
    ON CONFLICT (account_id)
    DO UPDATE SET
      available_balance = EXCLUDED.available_balance,
      pending_balance = EXCLUDED.pending_balance,
      frozen_balance = EXCLUDED.frozen_balance,
      updated_at = NOW();
  `);

  for (const row of deposits) {
    values.push(`
      INSERT INTO synapse_vault_deposits (
        deposit_id, owner_id, owner_address, target_account_id, tx_hash, amount_usdc,
        status, request_id, created_at, updated_at
      ) VALUES (
        ${sqlLiteral(row.id)}, ${sqlLiteral(ownerId)}, ${sqlLiteral(
      ownerAddress
    )},
        ${sqlLiteral(consumerAccountId)}, ${sqlLiteral(
      row.txHash
    )}, ${sqlLiteral(row.amountUsdc)},
        ${sqlLiteral(row.status)}, ${sqlLiteral(`${row.id}:request`)},
        ${sqlLiteral(row.createdAt)}::timestamptz, ${sqlLiteral(
      row.updatedAt
    )}::timestamptz
      )
      ON CONFLICT (deposit_id)
      DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        owner_address = EXCLUDED.owner_address,
        target_account_id = EXCLUDED.target_account_id,
        tx_hash = EXCLUDED.tx_hash,
        amount_usdc = EXCLUDED.amount_usdc,
        status = EXCLUDED.status,
        request_id = EXCLUDED.request_id,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at;
    `);
  }

  for (const row of [withdrawal, refund]) {
    const meta = {
      flowStatus: row.status,
      businessType:
        row.refundType === "CONSUMER_BALANCE_WITHDRAW" ? "withdraw" : "refund",
      requestId: `${row.id}:request`,
      idempotencyKey: `${row.id}:idempotency`,
      consumerAddress: ownerAddress,
      amountWei: String(BigInt(Math.round(Number(row.amountUsdc) * 1_000_000))),
      feeWei: "0",
      chainId: 31337,
      contractAddress: "0x0000000000000000000000000000000000000001",
      refundType: row.refundType,
      destinationAddress: ownerAddress,
      message:
        row.refundType === "CONSUMER_BALANCE_WITHDRAW"
          ? "Withdrawal completed"
          : "Refund completed",
      completedAt: epochSeconds(row.completedAt),
    };
    values.push(`
      INSERT INTO synapse_vault_withdrawals (
        withdrawal_id, owner_id, provider_id, source_account_id, withdrawal_kind,
        tx_hash, amount_usdc, status, request_id, ticket_id, ticket_hash, nonce, deadline,
        created_at, updated_at
      ) VALUES (
        ${sqlLiteral(row.id)}, ${sqlLiteral(ownerId)}, NULL, ${sqlLiteral(
      consumerAccountId
    )},
        'consumer_refund', ${sqlLiteral(row.txHash)}, ${sqlLiteral(
      row.amountUsdc
    )},
        ${sqlLiteral(row.status)}, ${sqlLiteral(`${row.id}:request`)},
        ${sqlLiteral(`${row.id}:ticket`)}, ${sqlLiteral(
      txHash(`${row.id}:ticketHash`)
    )},
        1, ${Math.floor(Date.now() / 1000) + 3600},
        ${sqlLiteral(row.createdAt)}::timestamptz, ${sqlLiteral(
      row.updatedAt
    )}::timestamptz
      )
      ON CONFLICT (withdrawal_id)
      DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        source_account_id = EXCLUDED.source_account_id,
        tx_hash = EXCLUDED.tx_hash,
        amount_usdc = EXCLUDED.amount_usdc,
        status = EXCLUDED.status,
        request_id = EXCLUDED.request_id,
        ticket_id = EXCLUDED.ticket_id,
        ticket_hash = EXCLUDED.ticket_hash,
        nonce = EXCLUDED.nonce,
        deadline = EXCLUDED.deadline,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at;

      INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
      VALUES (
        ${sqlLiteral(`vault_withdrawal_meta::${row.id}`)},
        ${sqlLiteral(JSON.stringify(meta))}::jsonb,
        ${sqlLiteral(row.updatedAt)}::timestamptz
      )
      ON CONFLICT (state_key)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;
    `);
  }

  execSql(`BEGIN;${values.join("\n")}COMMIT;`);
  evidence.db.seeded = {
    ownerAddress,
    depositRows: deposits.length,
    withdrawalRows: 1,
    refundRows: 1,
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  return { response, payload };
}

async function authenticate() {
  const wallet = new ethers.Wallet(config.privateKey);
  const challenge = await fetchJson(
    `${config.gatewayBase}/api/v1/auth/challenge?address=${encodeURIComponent(
      wallet.address
    )}`
  );
  if (!challenge.response.ok) {
    throw new Error(`auth challenge failed: ${challenge.response.status}`);
  }
  const message = challenge.payload.challenge || challenge.payload.message;
  const signature = await wallet.signMessage(message);
  const verified = await fetchJson(`${config.gatewayBase}/api/v1/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet_address: wallet.address,
      message,
      signature,
    }),
  });
  if (!verified.response.ok) {
    throw new Error(`auth verify failed: ${verified.response.status}`);
  }
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  if (!token) throw new Error("auth verify response missing token");
  return { token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
}

async function gatewayApi(pathname, token) {
  const result = await fetchJson(`${config.gatewayBase}/api${pathname}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-User-Address": ownerAddress,
    },
  });
  evidence.api.push(
    sanitize({
      method: "GET",
      pathname,
      httpStatus: result.response.status,
      response: result.payload,
    })
  );
  if (!result.response.ok) {
    throw new Error(`GET ${pathname} failed: ${result.response.status}`);
  }
  return result.payload;
}

function readSqlEvidence() {
  const deposits = selectJson(`
    SELECT
      vd.deposit_id,
      vd.owner_address,
      vd.tx_hash,
      vd.amount_usdc::text AS amount_usdc,
      vd.status,
      vd.created_at,
      vd.updated_at,
      NULL::timestamptz AS confirmed_at
    FROM synapse_vault_deposits AS vd
    WHERE lower(vd.owner_address) = lower(${sqlLiteral(ownerAddress)})
    ORDER BY COALESCE(vd.updated_at, vd.created_at) DESC
    LIMIT 120
  `);
  const withdrawals = selectJson(`
    SELECT
      vw.withdrawal_id,
      owner.owner_wallet,
      vw.tx_hash,
      vw.amount_usdc::text AS amount_usdc,
      vw.status,
      vw.withdrawal_kind::text AS withdrawal_kind,
      vw.ticket_hash,
      vw.created_at,
      vw.updated_at,
      rs.payload->>'refundType' AS refund_type,
      rs.payload->>'completedAt' AS completed_at
    FROM synapse_vault_withdrawals AS vw
    JOIN synapse_ledger_accounts AS account ON account.account_id = vw.source_account_id
    JOIN synapse_owner_accounts AS owner ON owner.owner_id = account.owner_id
    LEFT JOIN synapse_runtime_state AS rs
      ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
    WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
      AND vw.withdrawal_kind = 'consumer_refund'
    ORDER BY COALESCE(vw.updated_at, vw.created_at) DESC
    LIMIT 120
  `);
  const balances = selectJson(`
    SELECT
      la.account_id,
      ab.available_balance::text AS consumer_available_usdc,
      ab.pending_balance::text AS consumer_pending_usdc,
      ab.frozen_balance::text AS consumer_frozen_usdc,
      ab.updated_at
    FROM synapse_account_balances AS ab
    JOIN synapse_ledger_accounts AS la ON la.account_id = ab.account_id
    JOIN synapse_owner_accounts AS owner ON owner.owner_id = la.owner_id
    WHERE lower(owner.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
      AND la.account_kind = 'consumer_wallet'
  `);
  evidence.db.sql = { deposits, withdrawals, balances };
}

function normalizeDeposit(row) {
  const status = String(row.status || "").toUpperCase();
  const timestamp = new Date(row.updatedAt || row.createdAt || 0).getTime();
  return {
    id: row.id || row.deposit_id,
    type: "Deposit",
    status:
      status === "CONFIRMED"
        ? "COMPLETED"
        : status === "FAILED"
        ? "FAILED"
        : "PENDING",
    amount: Number.parseFloat(String(row.amountUsdc || row.amount_usdc || "0")),
    txHash: row.txHash || row.tx_hash || null,
    timestamp,
  };
}

function normalizeWithdrawal(row) {
  return {
    id: row.id || row.withdrawal_id,
    type: "Withdraw",
    status:
      String(row.status || "").toUpperCase() === "COMPLETED"
        ? "COMPLETED"
        : "PENDING",
    amount: Number.parseFloat(String(row.amountUsdc || row.amount_usdc || "0")),
    txHash: row.txHash || row.tx_hash || null,
    timestamp: new Date(
      row.updatedAt || row.updated_at || row.createdAt || row.created_at || 0
    ).getTime(),
  };
}

function normalizeRefund(row) {
  return {
    id: row.id || row.withdrawal_id,
    type: "Refund",
    status:
      String(row.status || "").toUpperCase() === "COMPLETED"
        ? "COMPLETED"
        : "PENDING",
    amount: Number.parseFloat(String(row.amountUsdc || row.amount_usdc || "0")),
    txHash: row.txHash || row.tx_hash || null,
    timestamp:
      (row.timestamp ? Number(row.timestamp) * 1000 : 0) ||
      new Date(row.createdAt || row.created_at || 0).getTime(),
  };
}

function buildExpectedFromApi(apiPayloads) {
  const deposits = (apiPayloads.depositIntents.intents || []).map(
    normalizeDeposit
  );
  const withdrawals = (apiPayloads.withdrawals.withdrawals || []).map(
    normalizeWithdrawal
  );
  const refunds = (apiPayloads.refunds.refunds || [])
    .filter(
      (row) =>
        String(row.refundType || row.refund_type || "").toUpperCase() !==
        "CONSUMER_BALANCE_WITHDRAW"
    )
    .map(normalizeRefund);
  return [...deposits, ...withdrawals, ...refunds].sort(
    (a, b) => b.timestamp - a.timestamp
  );
}

function recordApiDbComparison(apiPayloads) {
  const apiDepositIds = new Set(
    (apiPayloads.depositIntents.intents || []).map((row) => row.id)
  );
  const dbDepositIds = new Set(
    (evidence.db.sql.deposits || []).map((row) => row.deposit_id)
  );
  const apiWithdrawalIds = new Set([
    ...(apiPayloads.withdrawals.withdrawals || []).map((row) => row.id),
    ...(apiPayloads.refunds.refunds || []).map((row) => row.id),
  ]);
  const dbWithdrawalIds = new Set(
    (evidence.db.sql.withdrawals || []).map((row) => row.withdrawal_id)
  );
  const missingDeposits = [...apiDepositIds].filter(
    (id) => !dbDepositIds.has(id)
  );
  const missingWithdrawals = [...apiWithdrawalIds].filter(
    (id) => !dbWithdrawalIds.has(id)
  );
  addCheck("api-db:deposit-rows", missingDeposits.length === 0, "", {
    apiRows: apiDepositIds.size,
    dbRows: dbDepositIds.size,
    missingDeposits,
  });
  addCheck(
    "api-db:withdrawal-refund-rows",
    missingWithdrawals.length === 0,
    "",
    {
      apiRows: apiWithdrawalIds.size,
      dbRows: dbWithdrawalIds.size,
      missingWithdrawals,
    }
  );
  const balance = evidence.db.sql.balances?.[0];
  addCheck("db:balance-buckets", Boolean(balance), "", { balance });
}

function writeEvidence(status) {
  const trace =
    evidence.trace.map((row) => JSON.stringify(sanitize(row))).join("\n") +
    "\n";
  const traceDigest = crypto.createHash("sha256").update(trace).digest("hex");
  const report = {
    environment: evidence.environment,
    status,
    generatedAt: evidence.generatedAt,
    runId: config.runId,
    ownerAddress,
    failed: evidence.failed,
    checks: evidence.checks,
    traceDigest,
    apiEndpoints: evidence.api.map((row) => row.pathname),
    screenshots: evidence.screenshots.map((row) => row.file),
  };
  fs.writeFileSync(path.join(outDir, "trace.jsonl"), trace);
  fs.writeFileSync(
    path.join(outDir, "api-evidence.json"),
    JSON.stringify(evidence.api, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "db-evidence.json"),
    JSON.stringify(evidence.db, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "dom-evidence.json"),
    JSON.stringify(evidence.dom, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "screenshot-evidence.json"),
    JSON.stringify(evidence.screenshots, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "bugfix-log.md"),
    evidence.failed.length
      ? "# Bugfix Log\n\n- OPEN: Payments Gateway-truth E2E has failing checkpoints.\n"
      : "# Bugfix Log\n\nNo bugs found in this run.\n"
  );
  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "report.md"),
    [
      "# User-front Payments Gateway Truth E2E",
      "",
      `- Status: ${status}`,
      `- Failed: ${evidence.failed.length}`,
      `- Owner: ${ownerAddress}`,
      "",
      "## Checks",
      "",
      ...evidence.checks.map(
        (row) => `- ${row.ok ? "PASS" : "FAIL"} ${row.name}`
      ),
      "",
    ].join("\n")
  );
  console.log(
    `[payments-gateway-truth] Report: ${path.join(outDir, "report.md")}`
  );
}

async function main() {
  assertLocalOnly();
  addTrace("preflight", { config: { ...config, privateKey: "[REDACTED]" } });
  seedDatabase();
  addCheck("db:seed", true, "", evidence.db.seeded);

  const { token } = await authenticate();
  addCheck("gateway:auth", true);
  const apiPayloads = {
    balance: await gatewayApi("/v1/balance", token),
    depositIntents: await gatewayApi(
      `/v1/balance/deposit/intents?limit=${paymentFetchLimit}`,
      token
    ),
    withdrawals: await gatewayApi(
      `/v1/balance/consumer/withdrawals?limit=${paymentFetchLimit}`,
      token
    ),
    refunds: await gatewayApi(`/v1/refunds?limit=${paymentFetchLimit}`, token),
  };
  readSqlEvidence();
  recordApiDbComparison(apiPayloads);
  const expectedRecords = buildExpectedFromApi(apiPayloads);
  evidence.db.expectedPayments = {
    totalRecords: expectedRecords.length,
    renderedRecords: expectedRecords.slice(0, paymentRenderLimit),
    truncated: expectedRecords.length > paymentRenderLimit,
  };
  addCheck(
    "projection:sort-render-limit",
    expectedRecords.length === 53 &&
      evidence.db.expectedPayments.renderedRecords.length ===
        paymentRenderLimit,
    "",
    evidence.db.expectedPayments
  );
  await verifyPaymentsDom({
    addCheck,
    config,
    evidence,
    expectedRecords,
    moneyDisplay,
    outDir,
    ownerAddress,
    paymentRenderLimit,
    shortenTransactionId,
    token,
  });
}

main()
  .then(() => {
    const status = evidence.failed.length ? "failed" : "success";
    writeEvidence(status);
    if (evidence.failed.length) process.exitCode = 1;
  })
  .catch((error) => {
    addCheck("fatal", false, error?.message || String(error));
    writeEvidence("failed");
    process.exitCode = 1;
  });
