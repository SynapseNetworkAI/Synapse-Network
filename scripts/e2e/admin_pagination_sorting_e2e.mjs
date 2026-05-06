#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createAdminPaginationSortingFixture } from "./admin_pagination_sorting_fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
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
const RUN_ID =
  process.env.ADMIN_PAGINATION_SORTING_RUN_ID ||
  `admin_sort_e2e_${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
const OUT_DIR = path.resolve(
  process.env.ADMIN_PAGINATION_SORTING_OUT_DIR ||
    path.join(ROOT, "output/e2e/admin-pagination-sorting", RUN_ID)
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const PREFIX = RUN_ID.replace(/[^a-zA-Z0-9_]/g, "_");
const passed = [];
const failed = [];
const screenshots = [];
const apiEvidence = {};
const sqlEvidence = {};
const domEvidence = {};
let cachedLocalAdminTotpSecret;
const fixture = createAdminPaginationSortingFixture({
  prefix: PREFIX,
  runId: RUN_ID,
});
const { withdrawals, services, forumRows } = fixture;

function ok(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(message) {
  throw new Error(message);
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
      "admin pagination sorting E2E only runs against local Admin Front and Gateway-Admin URLs."
    );
  }
  if (
    (ADMIN_PASSWORD === "qwer@1234" ||
      ADMIN_TOTP_SECRET === "JBSWY3DPEHPK3PXP") &&
    !isLocalUrl(ADMIN_GATEWAY_URL)
  ) {
    fail(
      "Refusing to use default admin credentials against a non-local gateway-admin URL."
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
    fail(
      `${command} ${args.join(" ")} failed: ${(
        result.stderr ||
        result.stdout ||
        ""
      ).trim()}`
    );
  }
  return result.stdout.trim();
}

function runCreatedAtIndexGuard(label) {
  sh("npm", ["run", "ci:created-at-indexes"]);
  ok(`created-at-index-guard:${label}`, "npm run ci:created-at-indexes");
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

function resolveLocalAdminTotpSecret() {
  if (process.env.ADMIN_TOTP_SECRET) return process.env.ADMIN_TOTP_SECRET;
  if (cachedLocalAdminTotpSecret !== undefined) {
    return cachedLocalAdminTotpSecret;
  }
  cachedLocalAdminTotpSecret = "";
  if (!isLocalUrl(ADMIN_GATEWAY_URL)) return cachedLocalAdminTotpSecret;
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
  if (result.status !== 0) return cachedLocalAdminTotpSecret;
  try {
    const value = JSON.parse(result.stdout.trim() || "null");
    cachedLocalAdminTotpSecret =
      typeof value === "string" && value.trim() ? value.trim() : "";
  } catch {
    cachedLocalAdminTotpSecret = "";
  }
  return cachedLocalAdminTotpSecret;
}

function seedData() {
  fixture.seedData(psql);
  ok("seed", PREFIX);
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
      fail(`Invalid base32 character in ADMIN_TOTP_SECRET: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8)
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
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

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN)
    return {
      sessionToken: process.env.ADMIN_SESSION_TOKEN,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
    };
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      otpCode:
        process.env.ADMIN_OTP_CODE ||
        totp(resolveLocalAdminTotpSecret() || ADMIN_TOTP_SECRET),
    }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !body.success || !sessionToken)
    fail(
      `Admin login failed: ${response.status} ${JSON.stringify(body).slice(
        0,
        800
      )}`
    );
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
  if (!response.ok || !body.success)
    fail(
      `Admin API failed ${pathname}: ${response.status} ${JSON.stringify(
        body
      ).slice(0, 800)}`
    );
  return body.data;
}

function ids(rows, field) {
  return rows.map((row) => row[field]);
}

function unique(values) {
  return [...new Set(values)];
}

function assertOrder(name, actual, expected) {
  const left = actual.slice(0, expected.length);
  if (JSON.stringify(left) !== JSON.stringify(expected)) {
    fail(
      `${name} order mismatch: expected ${expected.join(", ")} got ${left.join(
        ", "
      )}`
    );
  }
  ok(name, expected.join(" > "));
}

function collectSqlEvidence() {
  sqlEvidence.withdrawals = queryJson(`
    SELECT json_agg(row_to_json(t))
    FROM (
      SELECT vw.withdrawal_id AS "withdrawalId", vw.amount_usdc::text AS "amountUsdc",
             vw.created_at AS "createdAt", rs.payload->>'riskLevel' AS "riskLevel"
      FROM synapse_vault_withdrawals vw
      LEFT JOIN synapse_runtime_state rs ON rs.state_key = CONCAT('vault_withdrawal_meta::', vw.withdrawal_id)
      WHERE vw.withdrawal_id LIKE ${sqlLiteral(`${PREFIX}_wd_%`)}
      ORDER BY vw.created_at DESC
    ) t
  `);
  sqlEvidence.services = queryJson(`
    SELECT json_agg(row_to_json(t))
    FROM (
      SELECT service_id AS "serviceId", service_name AS "serviceName",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM synapse_service_manifests
      WHERE service_id LIKE ${sqlLiteral(`${PREFIX}_svc_%`)}
      ORDER BY created_at DESC, service_id ASC
    ) t
  `);
  sqlEvidence.forumTopics = queryJson(`
    SELECT json_agg(row_to_json(t))
    FROM (
      SELECT topic_id AS "topicId", title, pinned, last_activity_at AS "lastActivityAt", created_at AS "createdAt"
      FROM synapse_forum_topics
      WHERE topic_id LIKE ${sqlLiteral(`${PREFIX}_topic_%`)}
      ORDER BY created_at DESC, topic_id ASC
    ) t
  `);
  sqlEvidence.forumTasks = queryJson(`
    SELECT json_agg(row_to_json(t))
    FROM (
      SELECT response_task_id AS "responseTaskId", priority, created_at AS "createdAt", updated_at AS "updatedAt"
      FROM synapse_forum_response_tasks
      WHERE response_task_id LIKE ${sqlLiteral(`${PREFIX}_task_%`)}
      ORDER BY created_at DESC, response_task_id ASC
    ) t
  `);
  sqlEvidence.createdAtIndexes =
    queryJson(`
    SELECT json_agg(row_to_json(t))
    FROM (
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (
          'synapse_vault_withdrawals', 'synapse_service_manifests',
          'synapse_forum_topics', 'synapse_forum_response_tasks'
        )
        AND indexdef ILIKE '%created_at%'
      ORDER BY tablename, indexname
    ) t
  `) || [];
}

async function capture(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
  return filePath;
}

async function createPage(auth) {
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

async function tableFirstCells(page) {
  return page.locator("tbody tr").first().textContent({ timeout: 30000 });
}

async function buttonTexts(page, needle) {
  return page.evaluate(
    (value) =>
      Array.from(document.querySelectorAll("button"))
        .map((button) => button.textContent || "")
        .filter((text) => text.includes(value)),
    needle
  );
}

async function verifyDom(auth) {
  const { browser, page } = await createPage(auth);
  try {
    await page.goto(
      `${ADMIN_FRONT_URL}/withdrawal-reviews?q=${encodeURIComponent(PREFIX)}`,
      { waitUntil: "networkidle" }
    );
    await page.waitForFunction(
      (prefix) =>
        document.body.innerText.includes(`${prefix}_wd_latest_yellow`),
      PREFIX
    );
    const withdrawalFirst = await tableFirstCells(page);
    domEvidence.withdrawals = { firstRowText: withdrawalFirst };
    if (
      !withdrawalFirst.includes(withdrawals[0].id) ||
      !withdrawalFirst.includes("YELLOW")
    )
      fail(
        "withdrawal-reviews DOM first row is not the latest seeded yellow withdrawal"
      );
    ok("dom:withdrawal-reviews", withdrawals[0].id);
    await capture(page, "withdrawal-reviews-created-desc");

    await page.goto(`${ADMIN_FRONT_URL}/provider-services`, {
      waitUntil: "networkidle",
    });
    await page
      .getByPlaceholder("搜索 serviceId、服务名、Provider 或 tag")
      .fill(PREFIX);
    await page.getByRole("button", { name: "搜索服务" }).click();
    await page.waitForFunction(
      (id) => document.body.innerText.includes(id),
      services[0].id
    );
    const serviceFirst = await tableFirstCells(page);
    domEvidence.services = { firstRowText: serviceFirst };
    if (!serviceFirst.includes(services[0].id))
      fail(
        "provider-services DOM first row is not the createdAt/serviceId sorted service"
      );
    ok("dom:provider-services", services[0].id);
    await capture(page, "provider-services-created-desc");

    await page.goto(`${ADMIN_FRONT_URL}/forum-support`, {
      waitUntil: "networkidle",
    });
    await page.waitForFunction(
      (title) => document.body.innerText.includes(title),
      forumRows[0].title
    );
    const topicButtons = await buttonTexts(page, PREFIX);
    domEvidence.forumTopics = { buttonTexts: topicButtons };
    assertOrder(
      "dom:forum-topics",
      unique(
        topicButtons
          .map(
            (text) =>
              forumRows.find(
                (row) => text.includes(row.topicId) || text.includes(row.title)
              )?.topicId
          )
          .filter(Boolean)
      ),
      forumRows.map((row) => row.topicId)
    );
    await capture(page, "forum-topics-created-desc");

    await page.getByRole("button", { name: "Response Queue" }).click();
    await page.waitForFunction(
      (taskId) => document.body.innerText.includes(taskId),
      forumRows[0].taskId
    );
    const taskButtons = await buttonTexts(page, PREFIX);
    domEvidence.forumTasks = { buttonTexts: taskButtons };
    assertOrder(
      "dom:forum-response-tasks",
      unique(
        taskButtons
          .map(
            (text) =>
              forumRows.find(
                (row) => text.includes(row.taskId) || text.includes(row.title)
              )?.taskId
          )
          .filter(Boolean)
      ),
      forumRows.map((row) => row.taskId)
    );
    await capture(page, "forum-response-tasks-created-desc");
  } finally {
    await browser.close();
  }
}

async function verifyApi(auth) {
  const withdrawalData = await adminApi(
    "/api/admin/v1/withdrawal-reviews?limit=20",
    auth
  );
  apiEvidence.withdrawals = withdrawalData.items.filter((row) =>
    row.withdrawalId.startsWith(`${PREFIX}_wd_`)
  );
  assertOrder(
    "api:withdrawals",
    ids(apiEvidence.withdrawals, "withdrawalId"),
    withdrawals.map((row) => row.id)
  );

  const serviceData = await adminApi(
    `/api/admin/v1/provider-services?query=${encodeURIComponent(
      PREFIX
    )}&pageSize=10`,
    auth
  );
  apiEvidence.services = serviceData.items;
  assertOrder(
    "api:services",
    ids(apiEvidence.services, "serviceId"),
    services.map((row) => row.id)
  );

  const topics = await adminApi(
    `/api/admin/v1/forum/topics?q=${encodeURIComponent(PREFIX)}&page_size=10`,
    auth
  );
  apiEvidence.forumTopics = topics.items;
  assertOrder(
    "api:forum-topics",
    ids(apiEvidence.forumTopics, "topicId"),
    forumRows.map((row) => row.topicId)
  );

  const tasks = await adminApi(
    "/api/admin/v1/forum/response-tasks?status=awaiting_response,draft_ready&page_size=20",
    auth
  );
  apiEvidence.forumTasks = tasks.items.filter((row) =>
    row.responseTaskId.startsWith(`${PREFIX}_task_`)
  );
  assertOrder(
    "api:forum-response-tasks",
    ids(apiEvidence.forumTasks, "responseTaskId"),
    forumRows.map((row) => row.taskId)
  );
}

function verifySql() {
  collectSqlEvidence();
  assertOrder(
    "sql:withdrawals",
    ids(sqlEvidence.withdrawals, "withdrawalId"),
    withdrawals.map((row) => row.id)
  );
  assertOrder(
    "sql:services",
    ids(sqlEvidence.services, "serviceId"),
    services.map((row) => row.id)
  );
  assertOrder(
    "sql:forum-topics",
    ids(sqlEvidence.forumTopics, "topicId"),
    forumRows.map((row) => row.topicId)
  );
  assertOrder(
    "sql:forum-response-tasks",
    ids(sqlEvidence.forumTasks, "responseTaskId"),
    forumRows.map((row) => row.taskId)
  );
  const indexedTables = new Set(
    sqlEvidence.createdAtIndexes.map((row) => row.tablename)
  );
  for (const table of [
    "synapse_vault_withdrawals",
    "synapse_service_manifests",
    "synapse_forum_topics",
    "synapse_forum_response_tasks",
  ]) {
    if (!indexedTables.has(table))
      fail(`local DB missing created_at index evidence for ${table}`);
  }
  ok("sql:created-at-indexes", [...indexedTables].join(", "));
}

function writeEvidence(status) {
  const report = {
    status,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    baseUrls: { adminFront: ADMIN_FRONT_URL, adminGateway: ADMIN_GATEWAY_URL },
    prefix: PREFIX,
    expected: {
      withdrawals: withdrawals.map((row) => row.id),
      services: services.map((row) => row.id),
      forumTopics: forumRows.map((row) => row.topicId),
      forumTasks: forumRows.map((row) => row.taskId),
    },
    passed,
    failed,
    screenshots,
    apiEvidence,
    sqlEvidence,
    domEvidence,
    createdAtIndexGuard: status === "success",
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "api-evidence.json"),
    `${JSON.stringify(apiEvidence, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "sql-evidence.json"),
    `${JSON.stringify(sqlEvidence, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "screenshot-evidence.json"),
    `${JSON.stringify({ screenshots, domEvidence }, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Admin Pagination Sorting E2E",
      "",
      `- Status: ${status}`,
      `- Run ID: ${RUN_ID}`,
      `- Output: ${OUT_DIR}`,
      `- Screenshots: ${screenshots.length}`,
      "",
      "## Passed",
      ...passed.map(
        (item) => `- ${item.name}${item.detail ? `: ${item.detail}` : ""}`
      ),
      "",
      "## Screenshots",
      ...screenshots.map((item) => `- ${item.name}: ${item.path}`),
    ].join("\n") + "\n"
  );
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  assertLocalOnly();
  runCreatedAtIndexGuard("before");
  seedData();
  const auth = await loginAdmin();
  await verifyApi(auth);
  verifySql();
  await verifyDom(auth);
  runCreatedAtIndexGuard("after");
  writeEvidence("success");
  console.log(`[admin-pagination-sorting] success: ${OUT_DIR}`);
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.stack || error.message : String(error);
  failed.push({ name: "fatal", detail: message });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  writeEvidence("failed");
  console.error(`[admin-pagination-sorting] failed: ${message}`);
  process.exit(1);
});
