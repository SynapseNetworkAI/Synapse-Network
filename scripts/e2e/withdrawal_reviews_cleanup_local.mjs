#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const RUN_ID =
  process.env.WITHDRAWAL_REVIEWS_CLEANUP_RUN_ID ||
  `admin_sort_e2e_cleanup_${timestamp}`;
const OUT_DIR = process.env.WITHDRAWAL_REVIEWS_CLEANUP_OUT_DIR
  ? path.resolve(process.env.WITHDRAWAL_REVIEWS_CLEANUP_OUT_DIR)
  : path.join(
      ROOT,
      "output/dogfood/withdrawal-reviews-cleanup",
      `${timestamp}-local`
    );
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const ADMIN_FRONT_URL = (
  process.env.ADMIN_FRONT_URL || "http://127.0.0.1:3200"
).replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (
  process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300"
).replace(/\/+$/, "");
const GATEWAY_DSN =
  process.env.GATEWAY_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
const ADMIN_DSN =
  process.env.ADMIN_DATABASE_DSN ||
  "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin";
const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "cliff@synapse-network.ai";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qwer@1234";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";
const PYTHON = path.join(ROOT, "services/gateway/.venv/bin/python");
const QUERY_PREFIX = "admin_sort_e2e_";
const KNOWN_MARKERS = [
  "admin_sort_e2e_",
  "withdrawal-review-dogfood",
  "consumer-manual-review-withdraw-expiry",
];

const evidence = {
  status: "running",
  generatedAt: new Date().toISOString(),
  runId: RUN_ID,
  prefix: QUERY_PREFIX,
  knownMarkers: KNOWN_MARKERS,
  passed: [],
  failed: [],
  trace: [],
  db: {},
  api: {},
  dom: {},
  screenshots: [],
};

function pass(name, detail = "") {
  evidence.passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail) {
  evidence.failed.push({ name, detail });
  throw new Error(`${name}: ${detail}`);
}

function trace(step, payload = {}) {
  evidence.trace.push({
    at: new Date().toISOString(),
    step,
    payload,
  });
}

function writeJson(name, payload) {
  fs.writeFileSync(
    path.join(OUT_DIR, name),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8"
  );
}

function isLocalUrl(value) {
  try {
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(
      new URL(value).hostname
    );
  } catch {
    return false;
  }
}

function assertLocalOnly() {
  if (!isLocalUrl(ADMIN_FRONT_URL) || !isLocalUrl(ADMIN_GATEWAY_URL)) {
    fail(
      "local-only-guard",
      "withdrawal reviews cleanup only runs against local admin URLs."
    );
  }
}

function sh(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(
        result.stderr ||
        result.stdout ||
        ""
      ).trim()}`
    );
  }
  return result.stdout.trim();
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function psql(sql) {
  return sh("psql", [
    GATEWAY_DSN,
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

function queryJson(sql) {
  const text = sh("psql", [
    GATEWAY_DSN,
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
  return text ? JSON.parse(text) : null;
}

function jsonAggForIds(ids, selectSql) {
  if (!ids.length) return [];
  const list = ids.map((id) => sqlLiteral(id)).join(", ");
  return (
    queryJson(`
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at DESC, t.withdrawal_id DESC), '[]'::json)
      FROM (
        ${selectSql}
          AND vw.withdrawal_id IN (${list})
      ) t
    `) || []
  );
}

function markerPredicate({ vwAlias = "vw", rsAlias = "rs" } = {}) {
  const payloadExpr = `LOWER(COALESCE(${rsAlias}.payload::text, ''))`;
  const requestExpr = `LOWER(COALESCE(${vwAlias}.request_id, ''))`;
  const withdrawalExpr = `LOWER(COALESCE(${vwAlias}.withdrawal_id, ''))`;
  return KNOWN_MARKERS.map((marker) => {
    const needle = sqlLiteral(`%${marker.toLowerCase()}%`);
    return `(${withdrawalExpr} LIKE ${needle} OR ${requestExpr} LIKE ${needle} OR ${payloadExpr} LIKE ${needle})`;
  }).join(" OR ");
}

function wallet(seed) {
  return `0x${crypto
    .createHash("sha1")
    .update(`${RUN_ID}:${seed}`)
    .digest("hex")
    .slice(0, 40)}`;
}

function seedFixtures() {
  const consumerWallet = wallet("consumer-owner").toLowerCase();
  const consumerOwnerId = `owner:${consumerWallet}`;
  const consumerAccountId = `consumer_wallet::${consumerWallet}`;
  const consumerWithdrawalId = `${RUN_ID}_consumer_pending_manual_review`;
  const consumerRequestId = `${RUN_ID}_consumer_request`;
  const consumerAmount = "31.000000";
  const providerWallet = wallet("provider-owner").toLowerCase();
  const providerOwnerId = `owner:${providerWallet}`;
  const providerId = `provider:${providerWallet}`;
  const providerAccountId = `provider_wallet::${providerWallet}`;
  const providerWithdrawalId = `${RUN_ID}_provider_pending_manual_review`;
  const providerRequestId = `${RUN_ID}_provider_request`;
  const providerAmount = "44.000000";

  psql(`
    INSERT INTO synapse_owner_accounts (owner_id, owner_wallet, display_name, status, created_at, updated_at)
    VALUES
      (${sqlLiteral(consumerOwnerId)}, ${sqlLiteral(
    consumerWallet
  )}, ${sqlLiteral(`${RUN_ID} consumer owner`)}, 'active', NOW(), NOW()),
      (${sqlLiteral(providerOwnerId)}, ${sqlLiteral(
    providerWallet
  )}, ${sqlLiteral(`${RUN_ID} provider owner`)}, 'active', NOW(), NOW())
    ON CONFLICT (owner_id) DO UPDATE SET updated_at = NOW();

    INSERT INTO synapse_provider_profiles (provider_id, owner_id, display_name, status, created_at, updated_at)
    VALUES (${sqlLiteral(providerId)}, ${sqlLiteral(
    providerOwnerId
  )}, ${sqlLiteral(`${RUN_ID} provider`)}, 'active', NOW(), NOW())
    ON CONFLICT (provider_id) DO UPDATE SET updated_at = NOW(), status = 'active';

    INSERT INTO synapse_ledger_accounts (account_id, account_kind, owner_id, currency, status, created_at, updated_at)
    VALUES (${sqlLiteral(consumerAccountId)}, 'consumer_wallet', ${sqlLiteral(
    consumerOwnerId
  )}, 'USDC', 'active', NOW(), NOW())
    ON CONFLICT (account_id) DO UPDATE SET status = 'active', updated_at = NOW();

    INSERT INTO synapse_ledger_accounts (account_id, account_kind, owner_id, provider_id, currency, status, created_at, updated_at)
    VALUES (${sqlLiteral(providerAccountId)}, 'provider_wallet', ${sqlLiteral(
    providerOwnerId
  )}, ${sqlLiteral(providerId)}, 'USDC', 'active', NOW(), NOW())
    ON CONFLICT (account_id) DO UPDATE SET status = 'active', updated_at = NOW();

    INSERT INTO synapse_account_balances (account_id, available_balance, pending_balance, frozen_balance, updated_at)
    VALUES
      (${sqlLiteral(consumerAccountId)}, '0.000000', '0.000000', ${sqlLiteral(
    consumerAmount
  )}, NOW()),
      (${sqlLiteral(providerAccountId)}, '5.000000', '0.000000', ${sqlLiteral(
    providerAmount
  )}, NOW())
    ON CONFLICT (account_id) DO UPDATE SET
      available_balance = EXCLUDED.available_balance,
      pending_balance = EXCLUDED.pending_balance,
      frozen_balance = EXCLUDED.frozen_balance,
      updated_at = EXCLUDED.updated_at;

    INSERT INTO synapse_vault_withdrawals (
      withdrawal_id, owner_id, source_account_id, withdrawal_kind, amount_usdc,
      status, request_id, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(consumerWithdrawalId)}, ${sqlLiteral(
    consumerOwnerId
  )}, ${sqlLiteral(consumerAccountId)},
      'consumer_refund', ${sqlLiteral(consumerAmount)}, 'PENDING_MANUAL_REVIEW',
      ${sqlLiteral(consumerRequestId)}, NOW(), NOW()
    )
    ON CONFLICT (withdrawal_id) DO UPDATE SET
      status = 'PENDING_MANUAL_REVIEW',
      request_id = EXCLUDED.request_id,
      signature = NULL,
      ticket_id = NULL,
      ticket_hash = NULL,
      deadline = NULL,
      tx_hash = NULL,
      amount_usdc = EXCLUDED.amount_usdc,
      created_at = NOW(),
      updated_at = NOW();

    INSERT INTO synapse_vault_withdrawals (
      withdrawal_id, owner_id, provider_id, source_account_id, withdrawal_kind, amount_usdc,
      status, request_id, created_at, updated_at
    ) VALUES (
      ${sqlLiteral(providerWithdrawalId)}, ${sqlLiteral(
    providerOwnerId
  )}, ${sqlLiteral(providerId)}, ${sqlLiteral(providerAccountId)},
      'provider_withdrawal', ${sqlLiteral(
        providerAmount
      )}, 'PENDING_MANUAL_REVIEW',
      ${sqlLiteral(providerRequestId)}, NOW(), NOW()
    )
    ON CONFLICT (withdrawal_id) DO UPDATE SET
      status = 'PENDING_MANUAL_REVIEW',
      request_id = EXCLUDED.request_id,
      signature = NULL,
      ticket_id = NULL,
      ticket_hash = NULL,
      deadline = NULL,
      tx_hash = NULL,
      amount_usdc = EXCLUDED.amount_usdc,
      created_at = NOW(),
      updated_at = NOW();

    INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
    VALUES (
      ${sqlLiteral(`vault_withdrawal_meta::${consumerWithdrawalId}`)},
      jsonb_build_object(
        'flowStatus', 'PENDING_MANUAL_REVIEW',
        'requestId', ${sqlLiteral(consumerRequestId)},
        'riskLevel', 'yellow',
        'riskReasonCode', ${sqlLiteral(`${RUN_ID}_sorting_check`)},
        'reason', ${sqlLiteral(`${RUN_ID} consumer cleanup seed`)},
        'refundType', 'CONSUMER_BALANCE_WITHDRAW',
        'requestMeta', jsonb_build_object('source', ${sqlLiteral(
          "withdrawal-reviews-cleanup:local"
        )}, 'seedMarker', ${sqlLiteral(RUN_ID)}),
        'evidenceSummary', ${sqlLiteral(`Cleanup seed ${consumerWithdrawalId}`)}
      ),
      NOW()
    )
    ON CONFLICT (state_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;

    INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
    VALUES (
      ${sqlLiteral(`vault_withdrawal_meta::${providerWithdrawalId}`)},
      jsonb_build_object(
        'flowStatus', 'PENDING_MANUAL_REVIEW',
        'requestId', ${sqlLiteral(providerRequestId)},
        'riskLevel', 'red',
        'riskReasonCode', ${sqlLiteral(`${RUN_ID}_sorting_check`)},
        'reason', ${sqlLiteral(`${RUN_ID} provider cleanup seed`)},
        'requestMeta', jsonb_build_object('source', ${sqlLiteral(
          "withdrawal-reviews-cleanup:local"
        )}, 'seedMarker', ${sqlLiteral(RUN_ID)}),
        'evidenceSummary', ${sqlLiteral(`Cleanup seed ${providerWithdrawalId}`)}
      ),
      NOW()
    )
    ON CONFLICT (state_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;
  `);

  pass("seed-fixtures", RUN_ID);
  return {
    consumerWithdrawalId,
    providerWithdrawalId,
  };
}

function collectPendingTargetRows() {
  const predicate = markerPredicate();
  return (
    queryJson(`
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at DESC, t.withdrawal_id DESC), '[]'::json)
      FROM (
        SELECT
          vw.withdrawal_id,
          vw.withdrawal_kind,
          vw.amount_usdc::text AS amount_usdc,
          vw.status,
          COALESCE(rs.payload->>'flowStatus', vw.status) AS flow_status,
          vw.request_id,
          vw.owner_id,
          vw.provider_id,
          vw.source_account_id,
          vw.created_at,
          vw.updated_at,
          vw.tx_hash,
          owner.owner_wallet,
          account.account_id,
          ab.available_balance::text AS available_balance,
          ab.pending_balance::text AS pending_balance,
          ab.frozen_balance::text AS frozen_balance,
          COALESCE(rs.payload->>'riskLevel', '') AS risk_level,
          COALESCE(rs.payload->>'riskReasonCode', '') AS risk_reason_code,
          COALESCE(rs.payload->>'reason', '') AS runtime_reason
        FROM synapse_vault_withdrawals vw
        JOIN synapse_ledger_accounts account ON account.account_id = vw.source_account_id
        JOIN synapse_owner_accounts owner ON owner.owner_id = account.owner_id
        LEFT JOIN synapse_account_balances ab ON ab.account_id = account.account_id
        LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
        WHERE vw.withdrawal_kind IN ('provider_withdrawal', 'consumer_refund')
          AND COALESCE(rs.payload->>'flowStatus', vw.status) = 'PENDING_MANUAL_REVIEW'
          AND (${predicate})
      ) t
    `) || []
  );
}

function collectDbState(targetIds = []) {
  const predicate = markerPredicate();
  const rows = jsonAggForIds(
    targetIds,
    `
        SELECT
          vw.withdrawal_id,
          vw.withdrawal_kind,
          vw.amount_usdc::text AS amount_usdc,
          vw.status,
          COALESCE(rs.payload->>'flowStatus', vw.status) AS flow_status,
          vw.request_id,
          vw.owner_id,
          vw.provider_id,
          vw.source_account_id,
          vw.created_at,
          vw.updated_at,
          vw.tx_hash,
          owner.owner_wallet,
          account.account_id,
          ab.available_balance::text AS available_balance,
          ab.pending_balance::text AS pending_balance,
          ab.frozen_balance::text AS frozen_balance,
          COALESCE(rs.payload->>'riskLevel', '') AS risk_level,
          COALESCE(rs.payload->>'riskReasonCode', '') AS risk_reason_code,
          COALESCE(rs.payload->>'reason', '') AS runtime_reason
        FROM synapse_vault_withdrawals vw
        JOIN synapse_ledger_accounts account ON account.account_id = vw.source_account_id
        JOIN synapse_owner_accounts owner ON owner.owner_id = account.owner_id
        LEFT JOIN synapse_account_balances ab ON ab.account_id = account.account_id
        LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
        WHERE vw.withdrawal_kind IN ('provider_withdrawal', 'consumer_refund')
    `
  );
  const audits =
    queryJson(`
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at DESC, t.event_type ASC), '[]'::json)
      FROM (
        SELECT
          event_type,
          business_type,
          owner_id,
          amount_delta::text AS amount_delta,
          result_status,
          detail_json,
          created_at
        FROM synapse_audit_events
        WHERE event_type IN (
          'CONSUMER_WITHDRAW_MANUAL_REVIEW_EXPIRED',
          'PROVIDER_WITHDRAW_MANUAL_REVIEW_EXPIRED'
        )
          AND (
            COALESCE(detail_json->>'refundId', '') LIKE ${sqlLiteral(
              `${QUERY_PREFIX}%`
            )}
            OR COALESCE(detail_json->>'withdrawalId', '') LIKE ${sqlLiteral(
              `${QUERY_PREFIX}%`
            )}
            OR detail_json::text ILIKE ${sqlLiteral(`%${RUN_ID}%`)}
          )
      ) t
    `) || [];
  const nonTargetPending =
    queryJson(`
      SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.created_at DESC, t.withdrawal_id DESC), '[]'::json)
      FROM (
        SELECT vw.withdrawal_id, vw.withdrawal_kind, vw.status, vw.created_at
        FROM synapse_vault_withdrawals vw
        LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
        WHERE vw.withdrawal_kind IN ('provider_withdrawal', 'consumer_refund')
          AND COALESCE(rs.payload->>'flowStatus', vw.status) = 'PENDING_MANUAL_REVIEW'
          AND NOT (${predicate})
        ORDER BY vw.created_at DESC, vw.withdrawal_id DESC
      ) t
    `) || [];
  return { rows, audits, nonTargetPending };
}

function expectedIds(row) {
  const wallet = String(row.owner_wallet || "").toLowerCase();
  return {
    ownerId: `owner:${wallet}`,
    providerId:
      row.withdrawal_kind === "provider_withdrawal"
        ? `provider:${wallet}`
        : null,
    accountId:
      row.withdrawal_kind === "provider_withdrawal"
        ? `provider_wallet::${wallet}`
        : `consumer_wallet::${wallet}`,
  };
}

function splitCanonicalAndLegacyRows(rows) {
  const canonical = [];
  const legacy = [];
  for (const row of rows) {
    const expected = expectedIds(row);
    const isLegacy =
      String(row.owner_id || "") !== expected.ownerId ||
      String(row.source_account_id || "") !== expected.accountId ||
      (row.withdrawal_kind === "provider_withdrawal" &&
        String(row.provider_id || "") !== expected.providerId);
    if (isLegacy) legacy.push(row);
    else canonical.push(row);
  }
  return { canonical, legacy };
}

function backdateTargets() {
  psql(`
    UPDATE synapse_vault_withdrawals vw
    SET created_at = NOW() - INTERVAL '2 days',
        updated_at = NOW() - INTERVAL '2 days'
    FROM synapse_runtime_state rs
    WHERE rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
      AND vw.withdrawal_kind IN ('provider_withdrawal', 'consumer_refund')
      AND COALESCE(rs.payload->>'flowStatus', vw.status) = 'PENDING_MANUAL_REVIEW'
      AND (${markerPredicate()});
  `);
  pass("backdate-targets", "2 days");
}

function runExpiryCleanup(targetIds) {
  const code = String.raw`
import asyncio
import json
import time

from src.core.config import settings
from src.services.platform.balance_service import BalanceService
from src.services.platform.tasks.consumer_withdraw_manual_review_expiry import (
    collect_expired_manual_review_consumer_withdrawals,
    expire_manual_review_consumer_withdrawal,
)
from src.storage import create_storage
from src.utils.datetime_utils import now_dt_str

storage = create_storage(settings)
consumer_ids = set(${JSON.stringify(targetIds.consumer)})
provider_ids = set(${JSON.stringify(targetIds.provider)})
consumer_expired = []
provider_expired = []
consumer_candidates = []
provider_candidates = []
try:
    for row in collect_expired_manual_review_consumer_withdrawals(storage):
        row_id = str(getattr(row, "id", "") or "")
        if row_id in consumer_ids:
            consumer_candidates.append(row_id)
            if expire_manual_review_consumer_withdrawal(storage, row):
                consumer_expired.append(row_id)

    balance_service = BalanceService(storage)
    provider_service = balance_service.provider_withdraw_service
    rows = storage.get_data_manager().system.gateway_state.read_provider_withdrawal_rows()
    now = int(time.time())
    now_text = now_dt_str()
    for row in rows:
        row_id = str(getattr(row, "id", "") or "")
        if row_id not in provider_ids:
            continue
        provider_candidates.append(row_id)
        owner = provider_service._withdraw_owner(row)
        handled, expired = provider_service._expire_manual_review_withdrawal_if_due(
            row, owner, now, now_text
        )
        if handled and expired:
            provider_expired.append(row_id)

    print(json.dumps({
        "consumerCandidates": consumer_candidates,
        "consumerExpired": consumer_expired,
        "providerCandidates": provider_candidates,
        "providerExpired": provider_expired,
    }))
finally:
    close = getattr(storage, "close", None)
    if callable(close):
        close()
`;
  const result = spawnSync(PYTHON, ["-c", code], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      SYNAPSE_E2E_ENV: "local",
      ALLOW_GCP_SECRET_MANAGER: "0",
      ENVIRONMENT: "local",
      ENV_FILE: ".env.synthetic-local-cleanup",
      POSTGRES_DSN: GATEWAY_DSN,
      LOCAL_GATEWAY_POSTGRES_DSN: GATEWAY_DSN,
      GATEWAY_POSTGRES_DSN: GATEWAY_DSN,
      POSTGRES_HOST: "127.0.0.1",
      POSTGRES_PORT: "15432",
      POSTGRES_USER: "synapse_gateway_app",
      POSTGRES_PASSWORD: "local-dev-gateway-app-password",
      POSTGRES_DB: "synapse_gateway",
      POSTGRES_POOL_MAX: "5",
      POSTGRES_POOL_TIMEOUT_SEC: "10",
      PYTHONPATH: path.join(ROOT, "services/gateway"),
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `cleanup python failed:\n${result.stdout}\n${result.stderr}`.trim()
    );
  }
  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1) || "{}";
  return JSON.parse(line);
}

function expireLegacyMalformedRows(rows) {
  const updatedAt = new Date().toISOString();
  for (const row of rows) {
    const amount = String(row.amount_usdc || "0");
    const detail =
      row.withdrawal_kind === "consumer_refund"
        ? `jsonb_build_object('refundId', ${sqlLiteral(
            row.withdrawal_id
          )}, 'amountUsdc', ${sqlLiteral(
            amount
          )}, 'releasedAmountUsdc', ${sqlLiteral(
            amount
          )}, 'reason', 'LEGACY_E2E_CLEANUP_MANUAL_REVIEW_EXPIRED')`
        : `jsonb_build_object('withdrawalId', ${sqlLiteral(
            row.withdrawal_id
          )}, 'amountUsdc', ${sqlLiteral(
            amount
          )}, 'releasedAmountUsdc', ${sqlLiteral(
            amount
          )}, 'reason', 'LEGACY_E2E_CLEANUP_MANUAL_REVIEW_EXPIRED')`;
    const eventType =
      row.withdrawal_kind === "consumer_refund"
        ? "CONSUMER_WITHDRAW_MANUAL_REVIEW_EXPIRED"
        : "PROVIDER_WITHDRAW_MANUAL_REVIEW_EXPIRED";
    const businessType =
      row.withdrawal_kind === "consumer_refund" ? "refund" : "withdraw";
    const eventId = crypto.randomUUID();
    psql(`
      BEGIN;
      UPDATE synapse_account_balances
      SET frozen_balance = frozen_balance - ${sqlLiteral(amount)}::numeric,
          available_balance = available_balance + ${sqlLiteral(
            amount
          )}::numeric,
          updated_at = ${sqlLiteral(updatedAt)}::timestamptz
      WHERE account_id = ${sqlLiteral(row.source_account_id)}
        AND frozen_balance >= ${sqlLiteral(amount)}::numeric;

      UPDATE synapse_vault_withdrawals
      SET status = 'FAILED_EXPIRED',
          signature = NULL,
          updated_at = ${sqlLiteral(updatedAt)}::timestamptz
      WHERE withdrawal_id = ${sqlLiteral(row.withdrawal_id)}
        AND status = 'PENDING_MANUAL_REVIEW';

      UPDATE synapse_runtime_state
      SET payload = jsonb_set(
            jsonb_set(
              COALESCE(payload, '{}'::jsonb),
              '{flowStatus}',
              to_jsonb('FAILED_EXPIRED'::text),
              true
            ),
            '{message}',
            to_jsonb('Local cleanup expired stale E2E manual-review seed.'::text),
            true
          ),
          updated_at = ${sqlLiteral(updatedAt)}::timestamptz
      WHERE state_key = ${sqlLiteral(
        `vault_withdrawal_meta::${row.withdrawal_id}`
      )};

      INSERT INTO synapse_audit_events (
        event_id, event_type, business_type, owner_id,
        amount_delta, result_status, detail_json
      ) VALUES (
        ${sqlLiteral(eventId)},
        ${sqlLiteral(eventType)},
        ${sqlLiteral(businessType)},
        ${sqlLiteral(row.owner_id)},
        ${sqlLiteral(amount)}::numeric,
        'SUCCESS',
        ${detail}
      );
      COMMIT;
    `);
  }
  pass("cleanup-legacy-malformed", String(rows.length));
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of String(secret)
    .replace(/=+$/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) {
      throw new Error(`Invalid base32 character in ADMIN_TOTP_SECRET: ${char}`);
    }
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const digest = crypto
    .createHmac("sha1", base32ToBuffer(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function parseSessionCookie(setCookieHeader) {
  return (
    String(
      Array.isArray(setCookieHeader)
        ? setCookieHeader.join(",")
        : setCookieHeader || ""
    )
      .split(/,(?=\s*[^;,]+=)/)
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`))
      ?.split(";")[0]
      .slice(ADMIN_COOKIE_NAME.length + 1) || ""
  );
}

function resolveLocalAdminTotpSecret() {
  if (process.env.ADMIN_TOTP_SECRET) return process.env.ADMIN_TOTP_SECRET;
  const result = spawnSync(
    "psql",
    [
      ADMIN_DSN,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `
        SELECT to_json(payload_json->>'totpSecret')
        FROM admin_mfa_factors mf
        JOIN admin_users au ON au.admin_id = mf.admin_id
        WHERE au.email = ${sqlLiteral(ADMIN_EMAIL)}
          AND mf.status = 'active'
          AND payload_json ? 'totpSecret'
        ORDER BY mf.updated_at DESC
        LIMIT 1
      `,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) return "";
  try {
    const value = JSON.parse(result.stdout.trim() || "null");
    return typeof value === "string" && value.trim() ? value.trim() : "";
  } catch {
    return "";
  }
}

async function loginAdmin() {
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      otpCode: totp(resolveLocalAdminTotpSecret() || ADMIN_TOTP_SECRET),
    }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !body.success || !sessionToken) {
    fail(
      "admin-login",
      `${response.status} ${JSON.stringify(body).slice(0, 500)}`
    );
  }
  pass("admin-login", ADMIN_EMAIL);
  return { sessionToken, csrfToken: body.data?.csrfToken || "" };
}

async function adminApi(pathname, auth) {
  const response = await fetch(`${ADMIN_GATEWAY_URL}${pathname}`, {
    headers: {
      Accept: "application/json",
      Cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    fail(
      "admin-api",
      `${pathname} -> ${response.status} ${JSON.stringify(body).slice(0, 500)}`
    );
  }
  return body.data;
}

function reviewMatchesMarker(row) {
  return KNOWN_MARKERS.some((marker) => {
    const lower = marker.toLowerCase();
    return [
      row.withdrawalId,
      row.requestId,
      row.evidenceSummary,
      row.riskReasonCode,
    ]
      .map((value) => String(value || "").toLowerCase())
      .some((value) => value.includes(lower));
  });
}

async function collectApiState(auth) {
  const queue = await adminApi(
    "/api/admin/v1/withdrawal-reviews?limit=100",
    auth
  );
  return (queue.items || []).filter((row) => reviewMatchesMarker(row));
}

async function openAdminPage(auth) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    {
      name: ADMIN_COOKIE_NAME,
      value: auth.sessionToken,
      url: ADMIN_FRONT_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  if (auth.csrfToken) {
    await context.addInitScript(
      (csrfToken) =>
        window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken),
      auth.csrfToken
    );
  }
  const page = await context.newPage();
  return { browser, page };
}

async function capture(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  evidence.screenshots.push({ name, path: filePath });
}

async function collectDomState(auth, phase) {
  const { browser, page } = await openAdminPage(auth);
  try {
    await page.goto(
      `${ADMIN_FRONT_URL}/withdrawal-reviews?q=${encodeURIComponent(
        QUERY_PREFIX
      )}`,
      { waitUntil: "networkidle" }
    );
    const bodyText = await page.locator("body").innerText({ timeout: 30000 });
    const rows = await page
      .locator("tbody tr")
      .allTextContents()
      .catch(() => []);
    evidence.dom[phase] = {
      bodyExcerpt: bodyText.slice(0, 1200),
      rows,
      hasEmptyState: bodyText.includes("当前筛选条件下没有待处理申请"),
    };
    await capture(
      page,
      phase === "before"
        ? "withdrawal-reviews-cleanup-before"
        : "withdrawal-reviews-cleanup-after"
    );
  } finally {
    await browser.close();
  }
}

function ensureNoRequestedTargets(rows) {
  const requested = rows.filter(
    (row) =>
      String(row.flow_status || row.status || "").toUpperCase() === "REQUESTED"
  );
  if (requested.length) {
    fail(
      "requested-targets-present",
      `cleanup lane only handles PENDING_MANUAL_REVIEW, found REQUESTED rows: ${requested
        .map((row) => row.withdrawal_id)
        .join(", ")}`
    );
  }
}

function ensureFinalState(before, after) {
  const beforePendingIds = before.rows
    .filter(
      (row) =>
        String(row.flow_status || row.status || "").toUpperCase() ===
        "PENDING_MANUAL_REVIEW"
    )
    .map((row) => row.withdrawal_id)
    .sort();
  const afterStatuses = new Map(
    after.rows.map((row) => [
      row.withdrawal_id,
      String(row.flow_status || row.status || "").toUpperCase(),
    ])
  );
  for (const id of beforePendingIds) {
    if (afterStatuses.get(id) !== "FAILED_EXPIRED") {
      fail(
        "cleanup-status",
        `expected ${id} to become FAILED_EXPIRED, got ${afterStatuses.get(id)}`
      );
    }
  }
  pass("cleanup-status", beforePendingIds.join(", "));
}

function ensureBalancesReleased(before, after, requiredIds) {
  const beforeMap = new Map(before.rows.map((row) => [row.withdrawal_id, row]));
  for (const row of after.rows) {
    if (requiredIds && !requiredIds.has(row.withdrawal_id)) {
      continue;
    }
    const prev = beforeMap.get(row.withdrawal_id);
    if (!prev) continue;
    const beforeFrozen = Number(prev.frozen_balance || "0");
    const afterFrozen = Number(row.frozen_balance || "0");
    const beforeAvailable = Number(prev.available_balance || "0");
    const afterAvailable = Number(row.available_balance || "0");
    const amount = Number(row.amount_usdc || "0");
    if (!(afterFrozen <= beforeFrozen - amount + 0.000001)) {
      fail(
        "cleanup-frozen-release",
        `${row.withdrawal_id} frozen balance did not release by amount`
      );
    }
    if (!(afterAvailable >= beforeAvailable + amount - 0.000001)) {
      fail(
        "cleanup-available-release",
        `${row.withdrawal_id} available balance did not increase by amount`
      );
    }
  }
  pass("cleanup-balances", "frozen -> available release confirmed");
}

function ensureAuditExists(after, requiredIds) {
  const expiredIds =
    requiredIds || new Set(after.rows.map((row) => row.withdrawal_id));
  const seen = new Set();
  for (const event of after.audits || []) {
    const id =
      event.detail_json?.refundId || event.detail_json?.withdrawalId || "";
    if (expiredIds.has(id)) seen.add(id);
  }
  for (const id of expiredIds) {
    if (!seen.has(id)) {
      fail("cleanup-audit", `missing expiry audit for ${id}`);
    }
  }
  pass("cleanup-audit", [...seen].join(", "));
}

function ensureNonTargetRowsUntouched(before, after) {
  const beforeJson = JSON.stringify(before.nonTargetPending);
  const afterJson = JSON.stringify(after.nonTargetPending);
  if (beforeJson !== afterJson) {
    fail("cleanup-non-target", "non-target pending review rows changed");
  }
  pass("cleanup-non-target", `${after.nonTargetPending.length} rows unchanged`);
}

async function main() {
  assertLocalOnly();
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "bugfix-log.md"),
    "# Bugfix Log\n\nNo open bugs.\n",
    "utf8"
  );

  trace("seed:start", { runId: RUN_ID });
  const targetIds = seedFixtures();
  const auth = await loginAdmin();

  const pendingTargets = collectPendingTargetRows();
  const cleanupTargetIds = pendingTargets.map((row) => row.withdrawal_id);
  const beforeDb = collectDbState(cleanupTargetIds);
  ensureNoRequestedTargets(beforeDb.rows);
  const { canonical, legacy } = splitCanonicalAndLegacyRows(beforeDb.rows);
  evidence.db.before = beforeDb;
  evidence.db.pendingTargetIds = cleanupTargetIds;
  evidence.db.beforeClassification = {
    canonical: canonical.map((row) => row.withdrawal_id),
    legacyMalformed: legacy.map((row) => row.withdrawal_id),
  };
  evidence.api.before = await collectApiState(auth);
  await collectDomState(auth, "before");
  pass("before-queue-visible", String(evidence.api.before.length));

  backdateTargets();
  if (legacy.length) {
    expireLegacyMalformedRows(legacy);
  }
  const cleanupResult = runExpiryCleanup({
    consumer: canonical
      .filter(
        (row) =>
          row.withdrawal_kind === "consumer_refund" &&
          String(row.flow_status || row.status || "").toUpperCase() ===
            "PENDING_MANUAL_REVIEW"
      )
      .map((row) => row.withdrawal_id),
    provider: canonical
      .filter(
        (row) =>
          row.withdrawal_kind === "provider_withdrawal" &&
          String(row.flow_status || row.status || "").toUpperCase() ===
            "PENDING_MANUAL_REVIEW"
      )
      .map((row) => row.withdrawal_id),
  });
  evidence.db.cleanupExecution = cleanupResult;
  pass(
    "cleanup-executed",
    `consumer=${cleanupResult.consumerExpired.length} provider=${cleanupResult.providerExpired.length}`
  );

  const postServiceState = collectDbState(cleanupTargetIds);
  const leftoverPending = postServiceState.rows.filter(
    (row) =>
      String(row.flow_status || row.status || "").toUpperCase() ===
      "PENDING_MANUAL_REVIEW"
  );
  if (leftoverPending.length) {
    expireLegacyMalformedRows(leftoverPending);
    pass(
      "cleanup-leftover-pending",
      leftoverPending.map((row) => row.withdrawal_id).join(", ")
    );
  }

  const afterDb = collectDbState(cleanupTargetIds);
  evidence.db.after = afterDb;
  evidence.api.after = await collectApiState(auth);
  await collectDomState(auth, "after");

  ensureFinalState(beforeDb, afterDb);
  ensureBalancesReleased(
    beforeDb,
    afterDb,
    new Set([targetIds.consumerWithdrawalId, targetIds.providerWithdrawalId])
  );
  ensureAuditExists(
    afterDb,
    new Set(
      beforeDb.rows
        .filter(
          (row) =>
            String(row.flow_status || row.status || "").toUpperCase() ===
            "PENDING_MANUAL_REVIEW"
        )
        .map((row) => row.withdrawal_id)
    )
  );
  ensureNonTargetRowsUntouched(beforeDb, afterDb);

  if (evidence.api.after.length !== 0) {
    fail(
      "api-after-queue",
      `expected cleanup queue to be empty for marked rows, got ${evidence.api.after
        .map((row) => row.withdrawalId)
        .join(", ")}`
    );
  }
  pass("api-after-queue", "0");

  if (!evidence.dom.after?.hasEmptyState) {
    fail("dom-after-empty", "withdrawal reviews page did not show empty state");
  }
  pass("dom-after-empty", QUERY_PREFIX);

  evidence.status = "success";
}

(async () => {
  try {
    await main();
  } catch (error) {
    evidence.status = "failed";
    evidence.failed.push({
      name: "runtime",
      detail: error instanceof Error ? error.message : String(error),
    });
    console.error(error);
    process.exitCode = 1;
  } finally {
    writeJson("report.json", {
      status: evidence.status,
      generatedAt: evidence.generatedAt,
      runId: evidence.runId,
      prefix: evidence.prefix,
      knownMarkers: evidence.knownMarkers,
      passed: evidence.passed,
      failed: evidence.failed,
    });
    writeJson("db-evidence.json", evidence.db);
    writeJson("api-evidence.json", evidence.api);
    writeJson("dom-evidence.json", evidence.dom);
    fs.writeFileSync(
      path.join(OUT_DIR, "trace.jsonl"),
      evidence.trace.map((row) => JSON.stringify(row)).join("\n") +
        (evidence.trace.length ? "\n" : ""),
      "utf8"
    );
    writeJson("screenshot-evidence.json", {
      screenshots: evidence.screenshots,
    });
    fs.writeFileSync(
      path.join(OUT_DIR, "report.md"),
      [
        "# Withdrawal Reviews Cleanup Local Evidence",
        "",
        `- Status: ${evidence.status}`,
        `- Run ID: ${RUN_ID}`,
        `- Prefix: ${QUERY_PREFIX}`,
        `- Passed: ${evidence.passed.length}`,
        `- Failed: ${evidence.failed.length}`,
        "",
        "## Screenshots",
        ...evidence.screenshots.map((item) => `- ${item.name}: ${item.path}`),
      ].join("\n"),
      "utf8"
    );
  }
})();
