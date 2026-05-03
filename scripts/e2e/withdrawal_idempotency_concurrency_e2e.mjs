#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { createWithdrawalE2eToolkit } from "./withdrawal_e2e_helpers.mjs";

// withdrawal status source: services/gateway consumer/provider withdrawal state machines and synapse_vault_withdrawals.status.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TIMESTAMP = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const OUT_DIR = process.env.WITHDRAWAL_IDEMPOTENCY_CONCURRENCY_OUT_DIR
  ? path.resolve(process.env.WITHDRAWAL_IDEMPOTENCY_CONCURRENCY_OUT_DIR)
  : path.join(
      ROOT,
      "output/dogfood/withdrawal-idempotency-concurrency",
      TIMESTAMP
    );

const GATEWAY_BASE_URL = (
  process.env.GATEWAY_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const POSTGRES_DSN = process.env.POSTGRES_DSN || "";
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CHAIN_ID = Number.parseInt(process.env.CHAIN_ID || "31337", 10);
const RUN_ID =
  process.env.WITHDRAWAL_IDEMPOTENCY_CONCURRENCY_RUN_ID ||
  `wic-${crypto.randomUUID().slice(0, 8)}`;

const INTERNAL = {
  adminWallet: (
    process.env.GATEWAY_INTERNAL_ADMIN_WALLET ||
    "0xA0f67a47D9eF18183Cd113eD85A654E2772c5901"
  ).toLowerCase(),
  jwtSecret:
    process.env.GATEWAY_INTERNAL_JWT_SECRET ||
    "pfazKmMdEZ8RCTB-8A_hH9AAknSXoP6y",
  issuer: process.env.GATEWAY_INTERNAL_TOKEN_ISSUER || "gateway-admin",
  audience: process.env.GATEWAY_INTERNAL_TOKEN_AUDIENCE || "gateway-internal",
  subject:
    process.env.GATEWAY_INTERNAL_SERVICE_SUBJECT || "service:gateway-admin",
};

const passed = [];
const failed = [];
const trace = [];
const dbEvidence = {};
const chainEvidence = {};
const scenarioResults = [];

fs.mkdirSync(OUT_DIR, { recursive: true });

function log(message) {
  console.log(`[withdrawal-idempotency-concurrency] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function redact(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9._~+/=-]+/g, "[REDACTED_JWT]")
    .replace(/"signature"\s*:\s*"[^"]+"/gi, '"signature":"[REDACTED]"');
}

function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redact(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value === "object") {
    const result = {};
    for (const [key, inner] of Object.entries(value)) {
      const sensitiveKey =
        /^(privateKey|private_key|signature|authorization|token|secret|password)$/i.test(
          key
        );
      if (sensitiveKey) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitize(inner);
      }
    }
    return result;
  }
  return redact(value);
}

function recordTrace(row) {
  trace.push({
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    scenario: row.scenario || "unknown",
    method: row.method || "",
    path: row.path || "",
    httpStatus: row.httpStatus || 0,
    requestId: row.requestId || "",
    expected: sanitize(row.expected || {}),
    actual: sanitize(row.actual || {}),
    withdrawalId: row.withdrawalId || "",
    ticketHash: row.ticketHash || "",
    txHash: row.txHash || "",
  });
}

async function step(name, fn) {
  try {
    const result = await fn();
    const detail = result?.detail || result || "";
    passed.push({ name, detail: String(detail || "") });
    scenarioResults.push({
      name,
      status: "passed",
      pass: true,
      detail: String(detail || ""),
    });
    log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    const detail =
      error instanceof Error ? error.stack || error.message : String(error);
    failed.push({ name, detail: redact(detail) });
    scenarioResults.push({
      name,
      status: "failed",
      pass: false,
      detail: redact(detail),
    });
    log(`FAIL ${name} - ${redact(detail)}`);
  }
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

function sha256Json(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

const {
  atomic: q6,
  claimOnChain,
  consumerAccount,
  ensureAccount,
  fundVaultLiquidity,
  insertDeposit,
  insertProviderIncome,
  isTicketConsumed,
  ownerId,
  providerAccount,
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
  onChainEvidence: (entry) => {
    if (entry.name === "fund-vault-liquidity") {
      chainEvidence.fundVaultLiquidity = {
        txHash: entry.txHash,
        amountUsdc: entry.amountUsdc,
      };
    }
  },
});

function createWallet(label) {
  const privateKey = `0x${crypto
    .createHash("sha256")
    .update(`${RUN_ID}:${label}`)
    .digest("hex")}`;
  return new ethers.Wallet(privateKey);
}

async function api(
  pathname,
  {
    method = "GET",
    token,
    address,
    body,
    headers = {},
    expectOk = true,
    scenario = "",
  } = {}
) {
  const requestHeaders = { Accept: "application/json", ...headers };
  let rawBody;
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    rawBody = JSON.stringify(body);
  }
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (address) requestHeaders["X-User-Address"] = address;
  const response = await fetch(`${GATEWAY_BASE_URL}/api${pathname}`, {
    method,
    headers: requestHeaders,
    body: rawBody,
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
  recordTrace({
    scenario,
    method,
    path: pathname,
    httpStatus: response.status,
    requestId: requestHeaders["X-Request-Id"] || "",
    actual: payload,
  });
  if (expectOk && !response.ok) {
    fail(
      `${method} ${pathname} failed ${response.status}: ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return { status: response.status, ok: response.ok, payload };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function internalToken({ scope, requestId, bodyText }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: INTERNAL.issuer,
    aud: INTERNAL.audience,
    sub: INTERNAL.subject,
    adminWallet: INTERNAL.adminWallet,
    scope,
    requestId,
    bodySha256: crypto
      .createHash("sha256")
      .update(bodyText || "")
      .digest("hex"),
    actorAdminId: "e2e-withdrawal-idempotency-concurrency",
    actorRole: "super_admin",
    iat: now,
    exp: now + 120,
    jti: crypto.randomUUID().replaceAll("-", ""),
  };
  const encoded = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const signature = crypto
    .createHmac("sha256", INTERNAL.jwtSecret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

async function internalApi(
  pathname,
  { scope, body, scenario, expectOk = true } = {}
) {
  const bodyText = JSON.stringify(body || {});
  const requestId = `${RUN_ID}:${scenario}:${crypto.randomUUID()}`;
  const response = await fetch(`${GATEWAY_BASE_URL}/api${pathname}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
      Authorization: `Bearer ${internalToken({ scope, requestId, bodyText })}`,
    },
    body: bodyText,
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
  recordTrace({
    scenario,
    method: "POST",
    path: pathname,
    httpStatus: response.status,
    requestId,
    actual: payload,
  });
  if (expectOk && !response.ok) {
    fail(
      `POST ${pathname} failed ${response.status}: ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return { status: response.status, ok: response.ok, payload };
}

async function authenticate(wallet, label) {
  const challenge = await api(
    `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`,
    { scenario: `${label}:auth-challenge` }
  );
  const message = challenge.payload.challenge || challenge.payload.message;
  if (!message) fail(`${label} auth challenge missing message`);
  const signature = await wallet.signMessage(message);
  const verified = await api("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: wallet.address, message, signature },
    scenario: `${label}:auth-verify`,
  });
  const token =
    verified.payload.access_token ||
    verified.payload.token ||
    verified.payload.accessToken;
  if (!token) fail(`${label} auth missing token`);
  return { address: wallet.address, token, privateKey: wallet.privateKey };
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
      'signaturePresent', signature IS NOT NULL,
      'createdAt', created_at::text
    ) ORDER BY created_at), '[]'::jsonb)
    FROM synapse_vault_withdrawals
    WHERE owner_id = ${sqlLiteral(ownerId(wallet))}
      AND withdrawal_kind = ${sqlLiteral(kind)}::synapse_withdrawal_kind;
  `) || []
  );
}

function withdrawalRow(withdrawalId) {
  return queryJson(`
    SELECT jsonb_build_object(
      'withdrawalId', withdrawal_id,
      'ownerId', owner_id,
      'kind', withdrawal_kind,
      'amount', amount_usdc::text,
      'status', status,
      'txHash', tx_hash,
      'ticketId', ticket_id,
      'ticketHash', ticket_hash,
      'signaturePresent', signature IS NOT NULL
    )
    FROM synapse_vault_withdrawals
    WHERE withdrawal_id = ${sqlLiteral(withdrawalId)}
    LIMIT 1;
  `);
}

function expectTuple(label, actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (q6(actual[key]) !== q6(value)) {
      fail(`${label} expected ${key}=${value}, got ${JSON.stringify(actual)}`);
    }
  }
}

function extractId(payload) {
  return (
    payload.withdrawalId ||
    payload.withdrawId ||
    payload.refundId ||
    payload.id ||
    ""
  );
}

function extractStatus(payload) {
  return String(
    payload.withdrawalStatus || payload.refundStatus || payload.status || ""
  ).toUpperCase();
}

function extractTicket(payload) {
  return payload.ticket || payload.ticketMetadata || {};
}

function expectError(result, status, code) {
  if (result.status !== status)
    fail(`expected HTTP ${status}, got ${result.status}`);
  const actual =
    result.payload?.detail?.code ||
    result.payload?.error?.code ||
    result.payload?.code ||
    "";
  if (actual !== code)
    fail(
      `expected error code ${code}, got ${
        actual || JSON.stringify(result.payload).slice(0, 500)
      }`
    );
}

async function consumerWithdraw(user, amount, idempotencyKey, scenario) {
  return api("/v1/balance/consumer/withdraw", {
    method: "POST",
    token: user.token,
    address: user.address,
    headers: { "X-Idempotency-Key": idempotencyKey },
    body: { amountUsdc: amount, reason: `${scenario} ${RUN_ID}` },
    expectOk: false,
    scenario,
  });
}

async function providerWithdraw(user, amount, idempotencyKey, scenario) {
  return api("/v1/providers/withdrawals/intent", {
    method: "POST",
    token: user.token,
    address: user.address,
    headers: { "X-Idempotency-Key": idempotencyKey },
    body: { amountUsdc: amount },
    expectOk: false,
    scenario,
  });
}

async function reviewWithdrawal(kind, user, withdrawalId, decision, scenario) {
  const isProvider = kind === "provider";
  const scope = isProvider ? "provider_withdraw.review" : "refund.review";
  const pathname = isProvider
    ? `/v1/admin/providers/withdrawals/${encodeURIComponent(
        withdrawalId
      )}/review`
    : `/v1/admin/refunds/${encodeURIComponent(withdrawalId)}/review`;
  return internalApi(pathname, {
    scope,
    scenario,
    expectOk: false,
    body: {
      ownerAddress: user.address,
      reviewDecision: decision,
      reviewerAddress: INTERNAL.adminWallet,
      reviewerNote: `${scenario} ${RUN_ID}`,
    },
  });
}

async function completeWithdrawal(kind, user, withdrawalId, txHash, scenario) {
  const pathname =
    kind === "provider"
      ? `/v1/providers/withdrawals/${encodeURIComponent(withdrawalId)}/complete`
      : `/v1/refunds/${encodeURIComponent(withdrawalId)}/complete`;
  return api(pathname, {
    method: "POST",
    token: user.token,
    address: user.address,
    body: { txHash },
    expectOk: false,
    scenario,
  });
}

async function expectClaimReplayRejected(privateKey, ticket) {
  try {
    await claimOnChain(privateKey, ticket);
    fail("ticket replay unexpectedly succeeded");
  } catch (error) {
    if (String(error.message || error).includes("unexpectedly succeeded"))
      throw error;
    return {
      rejected: true,
      message: redact(
        error.shortMessage || error.message || String(error)
      ).slice(0, 500),
    };
  }
}

function prepareConsumer(wallet, amount, label) {
  ensureAccount(wallet, "consumer", amount);
  insertDeposit(wallet, amount, 90000, label);
}

function prepareProvider(wallet, amount, label) {
  ensureAccount(wallet, "provider", amount);
  insertProviderIncome(wallet, amount, 8 * 86400, label);
}

function assertSingleWithdrawal(wallet, kind, amount, statusSet) {
  const rows = withdrawals(wallet.toLowerCase(), kind);
  if (rows.length !== 1)
    fail(
      `expected one ${kind} withdrawal row, got ${
        rows.length
      }: ${JSON.stringify(rows)}`
    );
  if (q6(rows[0].amount) !== q6(amount))
    fail(`expected amount ${amount}, got ${rows[0].amount}`);
  const status = String(rows[0].status || "").toUpperCase();
  if (!statusSet.includes(status))
    fail(`expected status ${statusSet.join("/")}, got ${status}`);
  return rows[0];
}

function collectSuccessfulIds(results) {
  return new Set(
    results
      .filter((row) => row.ok)
      .map((row) => extractId(row.payload))
      .filter(Boolean)
  );
}

async function runCreateConcurrency(kind, auth) {
  const amount = "20";
  if (kind === "provider")
    prepareProvider(auth.address, amount, `${kind}-create-concurrency`);
  else prepareConsumer(auth.address, amount, `${kind}-create-concurrency`);
  const make = kind === "provider" ? providerWithdraw : consumerWithdraw;
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      make(
        auth,
        amount,
        `${RUN_ID}:${kind}:create:${index}`,
        `${kind}-create-concurrency`
      )
    )
  );
  const ids = collectSuccessfulIds(results);
  if (ids.size !== 1)
    fail(`${kind} create concurrency expected one unique id, got ${ids.size}`);
  const row = assertSingleWithdrawal(
    auth.address,
    kind === "provider" ? "provider_withdrawal" : "consumer_refund",
    amount,
    ["APPROVED_AUTO", "REQUESTED", "SIGNED"]
  );
  const b = balance(auth.address.toLowerCase(), kind);
  expectTuple(`${kind} create concurrency balance`, b, {
    available: "0",
    pending: amount,
    frozen: "0",
  });
  if (!row.ticketHash)
    fail(`${kind} create concurrency row missing ticketHash`);
  dbEvidence[`${kind}CreateConcurrency`] = {
    row,
    balance: b,
    httpStatuses: results.map((item) => item.status),
  };
  return `uniqueId=${[...ids][0]}, ok=${
    results.filter((row) => row.ok).length
  }, rowStatus=${row.status}`;
}

async function runIdempotency(kind, auth) {
  const amount = "10";
  if (kind === "provider")
    prepareProvider(auth.address, "30", `${kind}-idempotency`);
  else prepareConsumer(auth.address, "30", `${kind}-idempotency`);
  const make = kind === "provider" ? providerWithdraw : consumerWithdraw;
  const key = `${RUN_ID}:${kind}:idempotency`;
  const replayScenario = `${kind}-idempotency:stable-payload`;
  const first = await make(auth, amount, key, replayScenario);
  if (!first.ok)
    fail(
      `${kind} first idempotency request failed ${
        first.status
      }: ${JSON.stringify(first.payload)}`
    );
  const second = await make(auth, amount, key, replayScenario);
  if (!second.ok)
    fail(
      `${kind} idempotent retry failed ${second.status}: ${JSON.stringify(
        second.payload
      )}`
    );
  const mismatch = await make(auth, "11", key, `${kind}-idempotency:mismatch`);
  expectError(mismatch, 409, "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
  const firstId = extractId(first.payload);
  const secondId = extractId(second.payload);
  if (firstId !== secondId)
    fail(
      `${kind} idempotent retry returned different ids ${firstId} vs ${secondId}`
    );
  const rows = withdrawals(
    auth.address.toLowerCase(),
    kind === "provider" ? "provider_withdrawal" : "consumer_refund"
  );
  const b = balance(auth.address.toLowerCase(), kind);
  if (rows.length !== 1)
    fail(`${kind} idempotency expected one row, got ${rows.length}`);
  expectTuple(`${kind} idempotency balance`, b, {
    available: "20",
    pending: "10",
    frozen: "0",
  });
  dbEvidence[`${kind}Idempotency`] = {
    firstId,
    secondId,
    rows,
    balance: b,
    mismatchStatus: mismatch.status,
  };
  return `id=${firstId}, mismatch=409, pending=10`;
}

async function createManualWithdrawal(kind, auth, amount, label) {
  if (kind === "provider") prepareProvider(auth.address, amount, label);
  else prepareConsumer(auth.address, amount, label);
  const result =
    kind === "provider"
      ? await providerWithdraw(auth, amount, `${RUN_ID}:${label}`, label)
      : await consumerWithdraw(auth, amount, `${RUN_ID}:${label}`, label);
  if (!result.ok)
    fail(
      `${label} create failed ${result.status}: ${JSON.stringify(
        result.payload
      )}`
    );
  if (extractStatus(result.payload) !== "PENDING_MANUAL_REVIEW") {
    fail(
      `${label} expected PENDING_MANUAL_REVIEW, got ${JSON.stringify(
        result.payload
      ).slice(0, 600)}`
    );
  }
  const id = extractId(result.payload);
  const b = balance(auth.address.toLowerCase(), kind);
  expectTuple(`${label} after create`, b, {
    available: "0",
    pending: "0",
    frozen: amount,
  });
  return { id, amount, createPayload: result.payload };
}

function successfulReviewPayloads(results) {
  return results
    .filter((row) => row.ok)
    .map((row) => row.payload?.data || row.payload);
}

function ticketFromReviewResults(results) {
  const ticket = successfulReviewPayloads(results)
    .map(extractTicket)
    .find((item) => item?.signature);
  if (!ticket?.signature)
    fail(
      `review results did not include a signed ticket: ${JSON.stringify(
        sanitize(results)
      ).slice(0, 1000)}`
    );
  return ticket;
}

async function runApproveAndCompleteConcurrency(kind, auth) {
  const amount = "60";
  const created = await createManualWithdrawal(
    kind,
    auth,
    amount,
    `${kind}-approve-complete-concurrency`
  );
  const approveResults = await Promise.all(
    Array.from({ length: 10 }, () =>
      reviewWithdrawal(
        kind,
        auth,
        created.id,
        "APPROVE",
        `${kind}-approve-concurrency`
      )
    )
  );
  const ticket = ticketFromReviewResults(approveResults);
  const uniqueTicketHashes = new Set(
    successfulReviewPayloads(approveResults)
      .map((payload) => extractTicket(payload)?.ticketHash)
      .filter(Boolean)
  );
  if (uniqueTicketHashes.size !== 1)
    fail(
      `${kind} approve expected one unique ticket hash, got ${uniqueTicketHashes.size}`
    );
  const afterApprove = balance(auth.address.toLowerCase(), kind);
  expectTuple(`${kind} approve balance`, afterApprove, {
    available: "0",
    pending: amount,
    frozen: "0",
  });
  const beforeChain = await readChainBalances(auth.address);
  const claim = await claimOnChain(auth.privateKey, ticket);
  const replay = await expectClaimReplayRejected(auth.privateKey, ticket);
  const consumed = await isTicketConsumed(ticket.ticketHash);
  if (!consumed || !replay.rejected)
    fail(`${kind} ticket replay/consumed mismatch`);
  const completeResults = await Promise.all(
    Array.from({ length: 10 }, () =>
      completeWithdrawal(
        kind,
        auth,
        created.id,
        claim.txHash,
        `${kind}-complete-concurrency`
      )
    )
  );
  const afterChain = await readChainBalances(auth.address);
  const walletDelta =
    BigInt(afterChain.walletAtomic) - BigInt(beforeChain.walletAtomic);
  if (walletDelta !== BigInt(ticket.amount))
    fail(`${kind} wallet delta expected ${ticket.amount}, got ${walletDelta}`);
  const row = withdrawalRow(created.id);
  const afterComplete = balance(auth.address.toLowerCase(), kind);
  if (String(row?.status || "").toUpperCase() !== "COMPLETED")
    fail(`${kind} expected completed row, got ${JSON.stringify(row)}`);
  if (String(row?.txHash || "").toLowerCase() !== claim.txHash.toLowerCase())
    fail(`${kind} DB txHash mismatch: ${JSON.stringify(row)}`);
  expectTuple(`${kind} complete balance`, afterComplete, {
    available: "0",
    pending: "0",
    frozen: "0",
  });
  const okCompletes = completeResults.filter((item) => item.ok).length;
  if (okCompletes !== 1)
    fail(
      `${kind} complete concurrency expected exactly one HTTP success, got ${okCompletes}`
    );
  chainEvidence[`${kind}ApproveCompleteConcurrency`] = {
    withdrawalId: created.id,
    ticketHash: ticket.ticketHash,
    txHash: claim.txHash,
    walletDeltaAtomic: walletDelta.toString(),
    consumed,
    replay,
  };
  dbEvidence[`${kind}ApproveCompleteConcurrency`] = {
    afterApprove,
    afterComplete,
    row,
    approveStatuses: approveResults.map((item) => item.status),
    completeStatuses: completeResults.map((item) => item.status),
  };
  return `withdrawalId=${created.id}, approveOk=${
    approveResults.filter((item) => item.ok).length
  }, completeOk=1, tx=${claim.txHash}`;
}

async function runRejectConcurrency(kind, auth) {
  const amount = "60";
  const created = await createManualWithdrawal(
    kind,
    auth,
    amount,
    `${kind}-reject-concurrency`
  );
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      reviewWithdrawal(
        kind,
        auth,
        created.id,
        "REJECT",
        `${kind}-reject-concurrency`
      )
    )
  );
  const row = withdrawalRow(created.id);
  const b = balance(auth.address.toLowerCase(), kind);
  if (String(row?.status || "").toUpperCase() !== "REJECTED")
    fail(`${kind} reject expected REJECTED, got ${JSON.stringify(row)}`);
  expectTuple(`${kind} reject balance`, b, {
    available: amount,
    pending: "0",
    frozen: "0",
  });
  if (row.ticketHash || row.signaturePresent)
    fail(
      `${kind} rejected withdrawal must not have ticket fields: ${JSON.stringify(
        row
      )}`
    );
  dbEvidence[`${kind}RejectConcurrency`] = {
    row,
    balance: b,
    httpStatuses: results.map((item) => item.status),
  };
  return `withdrawalId=${created.id}, ok=${
    results.filter((item) => item.ok).length
  }, status=REJECTED`;
}

async function runCrossDecisionConcurrency(kind, auth) {
  const amount = "60";
  const created = await createManualWithdrawal(
    kind,
    auth,
    amount,
    `${kind}-cross-decision`
  );
  const decisions = Array.from({ length: 10 }, (_, index) =>
    index % 2 === 0 ? "APPROVE" : "REJECT"
  );
  const results = await Promise.all(
    decisions.map((decision) =>
      reviewWithdrawal(
        kind,
        auth,
        created.id,
        decision,
        `${kind}-cross-${decision.toLowerCase()}`
      )
    )
  );
  const row = withdrawalRow(created.id);
  const b = balance(auth.address.toLowerCase(), kind);
  const status = String(row?.status || "").toUpperCase();
  if (status === "REJECTED") {
    expectTuple(`${kind} cross rejected balance`, b, {
      available: amount,
      pending: "0",
      frozen: "0",
    });
    if (row.ticketHash || row.signaturePresent)
      fail(
        `${kind} cross rejected row must not have ticket: ${JSON.stringify(
          row
        )}`
      );
  } else if (["REQUESTED", "APPROVED_AUTO", "SIGNED"].includes(status)) {
    expectTuple(`${kind} cross approved balance`, b, {
      available: "0",
      pending: amount,
      frozen: "0",
    });
    if (!row.ticketHash || !row.signaturePresent)
      fail(`${kind} cross approved row missing ticket: ${JSON.stringify(row)}`);
  } else {
    fail(
      `${kind} cross decision ended in illegal status ${status}: ${JSON.stringify(
        row
      )}`
    );
  }
  dbEvidence[`${kind}CrossDecisionConcurrency`] = {
    finalStatus: status,
    row,
    balance: b,
    httpStatuses: results.map((item) => item.status),
  };
  return `withdrawalId=${created.id}, final=${status}`;
}

async function main() {
  log(`runId=${RUN_ID}`);
  log(`out=${OUT_DIR}`);

  const health = await fetch(`${GATEWAY_BASE_URL}/health`);
  if (!health.ok) fail(`gateway health failed: ${health.status}`);
  await fundVaultLiquidity("1000");

  const users = {};
  for (const label of [
    "consumerCreate",
    "providerCreate",
    "consumerIdem",
    "providerIdem",
    "consumerApprove",
    "providerApprove",
    "consumerReject",
    "providerReject",
    "consumerCross",
    "providerCross",
  ]) {
    users[label] = await authenticate(createWallet(label), label);
  }

  await step("consumer-create-concurrency", () =>
    runCreateConcurrency("consumer", users.consumerCreate)
  );
  await step("provider-create-concurrency", () =>
    runCreateConcurrency("provider", users.providerCreate)
  );
  await step("consumer-idempotency", () =>
    runIdempotency("consumer", users.consumerIdem)
  );
  await step("provider-idempotency", () =>
    runIdempotency("provider", users.providerIdem)
  );
  await step("consumer-approve-complete-concurrency", () =>
    runApproveAndCompleteConcurrency("consumer", users.consumerApprove)
  );
  await step("provider-approve-complete-concurrency", () =>
    runApproveAndCompleteConcurrency("provider", users.providerApprove)
  );
  await step("consumer-reject-concurrency", () =>
    runRejectConcurrency("consumer", users.consumerReject)
  );
  await step("provider-reject-concurrency", () =>
    runRejectConcurrency("provider", users.providerReject)
  );
  await step("consumer-cross-decision", () =>
    runCrossDecisionConcurrency("consumer", users.consumerCross)
  );
  await step("provider-cross-decision", () =>
    runCrossDecisionConcurrency("provider", users.providerCross)
  );

  writeEvidence();
  if (failed.length > 0) {
    log(`FAILED report=${path.join(OUT_DIR, "report.md")}`);
    process.exit(1);
  }
  log(`PASSED report=${path.join(OUT_DIR, "report.md")}`);
}

function writeEvidence() {
  const report = {
    scriptVersion: "withdrawal-idempotency-concurrency-e2e:v1",
    status: failed.length === 0 ? "success" : "failed",
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    gatewayBaseUrl: GATEWAY_BASE_URL,
    scenarioResults,
    passed,
    failed,
    dbEvidenceFile: "db-evidence.json",
    chainEvidenceFile: "chain-evidence.json",
  };
  report.evidenceDigest = sha256Json({
    scriptVersion: report.scriptVersion,
    runId: report.runId,
    scenarioResults,
    dbEvidence,
    chainEvidence,
    failed,
  });

  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "db-evidence.json"),
    `${JSON.stringify(sanitize(dbEvidence), null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "chain-evidence.json"),
    `${JSON.stringify(sanitize(chainEvidence), null, 2)}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "trace.jsonl"),
    `${trace.map((row) => JSON.stringify(sanitize(row))).join("\n")}\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "bugfix-log.md"),
    [
      "# Withdrawal Idempotency Concurrency Bugfix Log",
      "",
      `- Status: ${report.status}`,
      `- Run ID: ${RUN_ID}`,
      "",
      "## Failures",
      ...(failed.length
        ? failed.map((item) => `- ${item.name}: ${item.detail}`)
        : ["- none"]),
      "",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Withdrawal Idempotency Concurrency E2E",
      "",
      `- Status: ${report.status}`,
      `- runId: ${RUN_ID}`,
      `- generatedAt: ${report.generatedAt}`,
      `- gateway: ${GATEWAY_BASE_URL}`,
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
      "- db-evidence.json",
      "- chain-evidence.json",
      "- trace.jsonl",
      "- bugfix-log.md",
      "",
    ].join("\n"),
    "utf8"
  );
}

main().catch((error) => {
  failed.push({
    name: "fatal",
    detail: redact(
      error instanceof Error ? error.stack || error.message : String(error)
    ),
  });
  writeEvidence();
  console.error(error);
  process.exit(1);
});
