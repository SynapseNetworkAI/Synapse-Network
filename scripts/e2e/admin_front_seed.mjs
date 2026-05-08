#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitForSafeTotpWindow } from "../lib/totp_window.mjs";
import { createAdminPaginationSortingFixture } from "./admin_pagination_sorting_fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ADMIN_FRONT_URL = (
  process.env.ADMIN_FRONT_URL || "http://localhost:3200"
).replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (
  process.env.ADMIN_GATEWAY_URL || "http://localhost:8300"
).replace(/\/+$/, "");
const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "cliff@synapse-network.ai";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qwer@1234";
const DEFAULT_ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const ADMIN_TOTP_SECRET =
  process.env.ADMIN_TOTP_SECRET || DEFAULT_ADMIN_TOTP_SECRET;
const ADMIN_DATABASE_DSN =
  process.env.ADMIN_DATABASE_DSN ||
  process.env.LOCAL_GATEWAY_ADMIN_POSTGRES_DSN ||
  "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin";
const POSTGRES_DSN =
  process.env.GATEWAY_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
const OUT_DIR = path.join(ROOT, "tmp/admin-front-dogfood");
const FIXTURE_PATH = process.env.ADMIN_FRONT_FIXTURE
  ? path.resolve(process.env.ADMIN_FRONT_FIXTURE)
  : path.join(OUT_DIR, "fixture.json");
const RUN_ID =
  process.env.ADMIN_FRONT_RUN_ID ||
  `admin-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
const SAFE_RUN_ID = RUN_ID.replace(/[^a-zA-Z0-9_]/g, "_");
const TOPIC_ID = `topic_${SAFE_RUN_ID}`;
const RESPONSE_TASK_ID = `frt_${SAFE_RUN_ID}`;
const OPERATION_MODAL_PREFIX = `${SAFE_RUN_ID}_modal`;
const operationModalFixture = createAdminPaginationSortingFixture({
  prefix: OPERATION_MODAL_PREFIX,
  runId: RUN_ID,
});

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertLocalDefaults() {
  if (
    ADMIN_PASSWORD === "qwer@1234" &&
    (!isLocalUrl(ADMIN_FRONT_URL) || !isLocalUrl(ADMIN_GATEWAY_URL))
  ) {
    throw new Error(
      "Refusing to use the default admin dogfood password against non-local URLs."
    );
  }
  if (
    ADMIN_TOTP_SECRET === "JBSWY3DPEHPK3PXP" &&
    (!isLocalUrl(ADMIN_FRONT_URL) || !isLocalUrl(ADMIN_GATEWAY_URL))
  ) {
    throw new Error(
      "Refusing to use the default admin dogfood TOTP secret against non-local URLs."
    );
  }
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of String(secret)
    .replace(/=+$/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0)
      throw new Error(`Invalid base32 character in ADMIN_TOTP_SECRET: ${char}`);
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

function queryAdminTotpSecretFromLocalDb() {
  if (
    process.env.ADMIN_TOTP_SECRET ||
    !isLocalUrl(ADMIN_FRONT_URL) ||
    !isLocalUrl(ADMIN_GATEWAY_URL)
  ) {
    return null;
  }
  const sql = `
    SELECT f.payload_json ->> 'totpSecret'
    FROM admin_users u
    JOIN admin_mfa_factors f ON f.admin_id = u.admin_id
    WHERE u.email = ${sqlLiteral(ADMIN_EMAIL)}
      AND f.status = 'active'
      AND f.payload_json ? 'totpSecret'
    ORDER BY f.created_at DESC
    LIMIT 1;
  `;
  const result = spawnSync(
    "psql",
    [
      ADMIN_DATABASE_DSN,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function parseSessionCookie(setCookieHeader) {
  const header = Array.isArray(setCookieHeader)
    ? setCookieHeader.join(",")
    : String(setCookieHeader || "");
  const match = header
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`));
  return match ? match.split(";")[0].slice(ADMIN_COOKIE_NAME.length + 1) : "";
}

async function assertReachable(name, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${name} not reachable: ${response.status} ${url}`);
  }
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return {
      sessionToken: process.env.ADMIN_SESSION_TOKEN,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
      admin: null,
    };
  }

  const totpSecret = queryAdminTotpSecretFromLocalDb() || ADMIN_TOTP_SECRET;
  await waitForSafeTotpWindow({ guardSeconds: 10 });
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      otpCode: process.env.ADMIN_OTP_CODE || generateTotpCode(totpSecret),
    }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !body.success || !sessionToken) {
    throw new Error(
      `Admin login failed: ${response.status} ${JSON.stringify(body).slice(
        0,
        800
      )}`
    );
  }
  return {
    sessionToken,
    csrfToken: body.data?.csrfToken || "",
    admin: body.data?.admin || null,
  };
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function runPsql(sql) {
  const result = spawnSync(
    "psql",
    [POSTGRES_DSN, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `psql failed: ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  return result.stdout;
}

function runAdminPsql(sql) {
  const result = spawnSync(
    "psql",
    [ADMIN_DATABASE_DSN, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `admin psql failed: ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  return result.stdout;
}

function queryJson(sql) {
  const result = spawnSync(
    "psql",
    [POSTGRES_DSN, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      cwd: ROOT,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `psql query failed: ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
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
    throw new Error(
      `Admin API failed ${pathname}: ${response.status} ${JSON.stringify(
        body
      ).slice(0, 800)}`
    );
  }
  return body.data;
}

function seedForumSupportRows() {
  const topicTitle = `Admin dogfood forum support ${RUN_ID}`;
  const topicBody = `Admin dogfood seeded topic ${RUN_ID}. This proves forum support queue, human reply, and DB reconciliation.`;
  const suggestedReply = `Thanks for the clear report. We captured ${RUN_ID} as a support signal and will route it through the reviewed admin workflow.`;
  runPsql(`
    INSERT INTO synapse_forum_topics (
      topic_id, title, body, excerpt, category, author_address, author_display,
      author_roles, status, resolved, locked, pinned, views_count, replies_count,
      reactions_count, last_activity_at, created_at, updated_at
    )
    VALUES (
      ${sqlLiteral(TOPIC_ID)},
      ${sqlLiteral(topicTitle)},
      ${sqlLiteral(topicBody)},
      ${sqlLiteral(topicBody)},
      'Bugs',
      '0xadminfrontdogfood0000000000000000000000000000',
      'Admin Dogfood User',
      ARRAY['Builder'],
      'open',
      FALSE,
      FALSE,
      FALSE,
      0,
      0,
      0,
      NOW() + INTERVAL '20 years',
      NOW() + INTERVAL '20 years',
      NOW() + INTERVAL '20 years'
    )
    ON CONFLICT (topic_id) DO UPDATE SET
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      excerpt = EXCLUDED.excerpt,
      status = 'open',
      resolved = FALSE,
      locked = FALSE,
      replies_count = 0,
      last_activity_at = NOW() + INTERVAL '20 years',
      updated_at = NOW() + INTERVAL '20 years';

    INSERT INTO synapse_forum_response_tasks (
      response_task_id, topic_id, status, source, priority, classification,
      suggested_reply, suggested_reply_source, suggested_reply_updated_at,
      linked_requirement_candidate_id, linked_requirement_id, linked_workflow_run_id,
      metadata_json, created_at, updated_at
    )
    VALUES (
      ${sqlLiteral(RESPONSE_TASK_ID)},
      ${sqlLiteral(TOPIC_ID)},
      'draft_ready',
      'growing_agent',
      'high',
      'bug',
      ${sqlLiteral(suggestedReply)},
      'growing',
      NOW() + INTERVAL '20 years',
      ${sqlLiteral(`cand_${SAFE_RUN_ID}`)},
      ${sqlLiteral(`req_${SAFE_RUN_ID}`)},
      ${sqlLiteral(`wf_${SAFE_RUN_ID}`)},
      jsonb_build_object('runId', ${sqlLiteral(
        RUN_ID
      )}, 'seededBy', 'admin_front_seed'),
      NOW() + INTERVAL '20 years',
      NOW() + INTERVAL '20 years'
    )
    ON CONFLICT (response_task_id) DO UPDATE SET
      status = 'draft_ready',
      source = 'growing_agent',
      priority = 'high',
      classification = 'bug',
      suggested_reply = EXCLUDED.suggested_reply,
      suggested_reply_source = 'growing',
      suggested_reply_updated_at = NOW() + INTERVAL '20 years',
      reply_id = NULL,
      responded_at = NULL,
      updated_at = NOW() + INTERVAL '20 years';
  `);
  return { topicTitle, topicBody, suggestedReply };
}

function seedOperationModalRows() {
  operationModalFixture.seedData(runPsql);
  const historyWithdrawal = operationModalFixture.withdrawals[0];
  runAdminPsql(`
    INSERT INTO admin_action_audit (
      action_type, operator_id, operator_email, operator_role,
      session_id, request_id, resource_type, resource_id,
      result_status, before_json, after_json, detail_json, created_at
    )
    VALUES (
      'withdrawal_review.decide',
      'adm_super_admin',
      ${sqlLiteral(ADMIN_EMAIL)},
      'super_admin',
      ${sqlLiteral(`admin-front-dogfood:${RUN_ID}`)},
      ${sqlLiteral(`${historyWithdrawal.id}_audit_request`)},
      'withdrawal',
      ${sqlLiteral(historyWithdrawal.id)},
      'success',
      jsonb_build_object(
        'withdrawalKind', 'consumer_withdrawal',
        'reviewType', 'consumer_withdraw_review',
        'amountUsdc', ${sqlLiteral(historyWithdrawal.amount)},
        'ownerAddress', '0xadminfrontmodal000000000000000000000000000001'
      ),
      jsonb_build_object('status', 'APPROVED_AUTO'),
      jsonb_build_object(
        'decision', 'APPROVE',
        'reviewerNote', ${sqlLiteral(
          `Admin front modal history seed ${RUN_ID}`
        )}
      ),
      NOW() + INTERVAL '10 years'
    )
  `);
  return {
    prefix: OPERATION_MODAL_PREFIX,
    withdrawalId: historyWithdrawal.id,
  };
}

async function main() {
  assertLocalDefaults();
  await assertReachable("admin-front", ADMIN_FRONT_URL);
  await assertReachable("gateway-admin", `${ADMIN_GATEWAY_URL}/health`);
  const auth = await loginAdmin();
  const expected = seedForumSupportRows();
  const operationModalRows = seedOperationModalRows();
  const forumApi = await adminApi(
    `/api/admin/v1/forum/response-tasks/${encodeURIComponent(
      RESPONSE_TASK_ID
    )}`,
    auth
  );
  const providerServices = await adminApi(
    "/api/admin/v1/provider-services?page=1&pageSize=20",
    auth
  ).catch((error) => ({ error: String(error) }));
  const financeOverview = await adminApi(
    "/api/admin/v1/dashboard/finance-overview",
    auth
  ).catch((error) => ({ error: String(error) }));
  const analyticsOverview = await adminApi(
    "/api/admin/v1/dashboard/analytics/overview?window=24h",
    auth
  ).catch((error) => ({ error: String(error) }));
  const dbForum = queryJson(`
    SELECT json_build_object(
      'topicId', topic.topic_id,
      'responseTaskId', task.response_task_id,
      'taskStatus', task.status,
      'replyId', task.reply_id,
      'title', topic.title
    )
    FROM synapse_forum_response_tasks task
    JOIN synapse_forum_topics topic ON topic.topic_id = task.topic_id
    WHERE task.response_task_id = ${sqlLiteral(RESPONSE_TASK_ID)}
  `);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fixture = {
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    baseUrls: {
      adminFront: ADMIN_FRONT_URL,
      adminGateway: ADMIN_GATEWAY_URL,
    },
    auth,
    forum: {
      topicId: TOPIC_ID,
      responseTaskId: RESPONSE_TASK_ID,
      ...expected,
    },
    operationModals: operationModalRows,
    snapshots: {
      forumApi,
      dbForum,
      providerServices,
      financeOverview,
      analyticsOverview,
    },
  };
  fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`[admin-front-seed] fixture written: ${FIXTURE_PATH}`);
  console.log(`[admin-front-seed] forum task: ${RESPONSE_TASK_ID}`);
}

main().catch((error) => {
  console.error(
    `[admin-front-seed] failed: ${
      error instanceof Error ? error.stack || error.message : String(error)
    }`
  );
  process.exit(1);
});
