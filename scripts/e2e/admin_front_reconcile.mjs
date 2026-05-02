#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ADMIN_GATEWAY_URL = (
  process.env.ADMIN_GATEWAY_URL || "http://localhost:8300"
).replace(/\/+$/, "");
const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const POSTGRES_DSN =
  process.env.GATEWAY_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
const FIXTURE_PATH = process.env.ADMIN_FRONT_FIXTURE
  ? path.resolve(process.env.ADMIN_FRONT_FIXTURE)
  : path.join(ROOT, "tmp/admin-front-dogfood/fixture.json");
const REPORT_PATH = process.env.ADMIN_FRONT_DOGFOOD_REPORT
  ? path.resolve(process.env.ADMIN_FRONT_DOGFOOD_REPORT)
  : findLatestReport();

const passed = [];

function findLatestReport() {
  const base = path.join(ROOT, "output/dogfood/admin-front");
  if (!fs.existsSync(base)) return "";
  const candidates = fs
    .readdirSync(base)
    .map((name) => path.join(base, name, "report.json"))
    .filter((filePath) => fs.existsSync(filePath))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || "";
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
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

function loadInputs() {
  assert(fs.existsSync(FIXTURE_PATH), `fixture not found: ${FIXTURE_PATH}`);
  assert(
    REPORT_PATH && fs.existsSync(REPORT_PATH),
    `dogfood report not found: ${REPORT_PATH || "(none)"}`
  );
  return {
    fixture: JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")),
    report: JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")),
  };
}

function verifyReport(report, fixture) {
  assert(
    Array.isArray(report.failed) && report.failed.length === 0,
    `dogfood report has failures: ${JSON.stringify(report.failed)}`
  );
  assert(
    Array.isArray(report.consoleErrors) && report.consoleErrors.length === 0,
    `dogfood report has console/API errors: ${JSON.stringify(
      report.consoleErrors
    )}`
  );
  const screenshotSet = new Set(report.screenshots || []);
  const requiredNames = [
    "forum-support-before-send.png",
    "forum-support-after-send.png",
    "provider-services.png",
    "finance.png",
    "analytics-overview.png",
  ];
  for (const name of requiredNames) {
    assert(
      [...screenshotSet].some((filePath) => filePath.endsWith(name)),
      `missing screenshot evidence: ${name}`
    );
  }
  const pageRoutes = new Set(
    (report.pageSummaries || []).map((item) => item.route)
  );
  for (const route of [
    "/forum-support",
    "/provider-services",
    "/finance",
    "/dashboard/analytics",
  ]) {
    assert(pageRoutes.has(route), `dogfood report did not visit ${route}`);
  }
  assert(
    report.fixturePath === FIXTURE_PATH || report.fixturePath,
    "dogfood report did not record fixture path"
  );
  assert(
    fixture.forum?.responseTaskId,
    "fixture missing forum response task id"
  );
  pass("report:dogfood-clean", `${report.passed.length} browser checks passed`);
}

function verifyDatabase(fixture) {
  const expectedReply = `Admin dogfood reviewed reply ${fixture.runId}`;
  const row = queryJson(`
    SELECT json_build_object(
      'taskId', task.response_task_id,
      'taskStatus', task.status,
      'replyId', task.reply_id,
      'respondedAt', task.responded_at,
      'topicId', topic.topic_id,
      'topicTitle', topic.title,
      'topicRepliesCount', topic.replies_count,
      'replyBody', reply.body,
      'replyAuthorDisplay', reply.author_display
    )
    FROM synapse_forum_response_tasks task
    JOIN synapse_forum_topics topic ON topic.topic_id = task.topic_id
    LEFT JOIN synapse_forum_replies reply ON reply.reply_id = task.reply_id
    WHERE task.response_task_id = ${sqlLiteral(fixture.forum.responseTaskId)}
  `);
  assert(row, `DB task not found: ${fixture.forum.responseTaskId}`);
  assert(
    row.taskStatus === "responded",
    `DB task status expected responded, got ${row.taskStatus}`
  );
  assert(row.replyId, "DB task reply_id is missing");
  assert(
    String(row.replyBody || "").includes(expectedReply),
    "DB reply body does not contain dogfood reply"
  );
  assert(
    Number(row.topicRepliesCount || 0) >= 1,
    `topic replies_count did not increment: ${row.topicRepliesCount}`
  );
  pass("db:forum-support-replied", `${row.taskId} -> ${row.replyId}`);
}

async function verifyAdminApi(fixture) {
  const auth = fixture.auth;
  assert(auth?.sessionToken, "fixture auth session token missing");
  const task = await adminApi(
    `/api/admin/v1/forum/response-tasks/${encodeURIComponent(
      fixture.forum.responseTaskId
    )}`,
    auth
  );
  assert(
    task.status === "responded",
    `Admin API task status expected responded, got ${task.status}`
  );
  assert(task.replyId, "Admin API task replyId missing");
  const providerServices = await adminApi(
    "/api/admin/v1/provider-services?page=1&pageSize=20",
    auth
  );
  assert(
    Array.isArray(providerServices.items),
    "provider services API did not return items array"
  );
  const financeOverview = await adminApi(
    "/api/admin/v1/dashboard/finance-overview",
    auth
  );
  assert(
    typeof financeOverview === "object" && financeOverview,
    "finance overview API did not return object"
  );
  const analyticsOverview = await adminApi(
    "/api/admin/v1/dashboard/analytics/overview?window=24h",
    auth
  );
  assert(
    Array.isArray(analyticsOverview.cards),
    "analytics overview API did not return cards"
  );
  pass(
    "api:admin-gateway-consistency",
    `task=${task.status}, providerServices=${providerServices.items.length}`
  );
}

async function main() {
  const { fixture, report } = loadInputs();
  verifyReport(report, fixture);
  verifyDatabase(fixture);
  await verifyAdminApi(fixture);
  console.log(
    `[admin-front-reconcile] verified ${passed.length} reconciliation checks`
  );
}

main().catch((error) => {
  console.error(
    `[admin-front-reconcile] failed: ${
      error instanceof Error ? error.stack || error.message : String(error)
    }`
  );
  process.exit(1);
});
