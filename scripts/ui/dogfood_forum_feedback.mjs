#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FORUM_BASE_URL = (process.env.FORUM_BASE_URL || process.env.USER_FRONT_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const GATEWAY_BASE_URL = (process.env.GATEWAY_BASE_URL || process.env.USER_FRONT_GATEWAY_BASE_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
const GATEWAY_ENV_PATH = path.join(ROOT, "services/gateway/.env.local");
function readGatewayEnvPostgresDsn() {
  if (!fs.existsSync(GATEWAY_ENV_PATH)) return "";
  const line = fs.readFileSync(GATEWAY_ENV_PATH, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("POSTGRES_DSN="));
  return line ? line.slice("POSTGRES_DSN=".length).trim() : "";
}
const POSTGRES_DSN = process.env.POSTGRES_DSN || readGatewayEnvPostgresDsn() || "postgresql://synapse:local-dev-postgres-password@127.0.0.1:5432/synapse_gateway";
const FIXTURE_PATH = process.env.FORUM_FEEDBACK_FIXTURE
  ? path.resolve(process.env.FORUM_FEEDBACK_FIXTURE)
  : path.join(ROOT, "tmp/forum-feedback-dogfood/fixture.json");
const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const OUT_DIR = path.join(ROOT, "output/dogfood/forum-feedback", timestamp);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
const runId = fixture.runId;
const expected = fixture.expected || {};
const uiState = {
  docsFeedbackId: "",
  dashboardFeedbackId: "",
  topicId: "",
  replyId: "",
};

const passed = [];
const failed = [];
const warnings = [];
const screenshots = [];
const consoleErrors = [];
const apiResponses = [];

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail) {
  failed.push({ name, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

function warn(name, detail) {
  warnings.push({ name, detail });
  console.warn(`WARN ${name} - ${detail}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

function pageUrl(href) {
  return `${FORUM_BASE_URL}${href}`;
}

async function goto(page, href) {
  await page.goto(pageUrl(href), { waitUntil: "commit", timeout: 60000 });
}

async function screenshot(page, name) {
  const out = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: out, fullPage: false });
  screenshots.push(out);
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
  ], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`psql failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

async function api(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${GATEWAY_BASE_URL}/api${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${fixture.author.token}`,
      "X-User-Address": fixture.author.address,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    payload = JSON.parse(text);
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed: ${response.status} ${JSON.stringify(payload).slice(0, 600)}`);
  }
  return payload;
}

function buildAuthSession() {
  return {
    token: fixture.author.token,
    wallet: String(fixture.author.address || "").toLowerCase(),
    expiresAt: fixture.author.expiresAt || Date.now() + 24 * 60 * 60 * 1000,
  };
}

async function createContext(browser, authenticated) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ authenticated: hasAuth, session }) => {
    localStorage.setItem("synapse_lang", "en");
    if (hasAuth) {
      localStorage.setItem("a2a_auth_session", JSON.stringify(session));
      localStorage.setItem("developer_session", JSON.stringify({ wallet: session.wallet }));
    } else {
      localStorage.removeItem("a2a_auth_session");
      localStorage.removeItem("developer_session");
    }
  }, { authenticated, session: buildAuthSession() });
  return context;
}

async function createPage(context, pageName) {
  const page = await context.newPage();
  let closed = false;
  page.on("close", () => {
    closed = true;
  });
  page.on("console", (message) => {
    if (closed || message.type() !== "error") return;
    const text = message.text();
    if (text.includes("Failed to fetch RSC payload") && text.includes("Falling back to browser navigation")) return;
    consoleErrors.push({ page: pageName, text });
  });
  page.on("pageerror", (error) => {
    if (!closed) consoleErrors.push({ page: pageName, text: error.message });
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/v1/") || url.includes("/marketplace/registry.json")) {
      apiResponses.push({
        page: pageName,
        method: response.request().method(),
        status: response.status(),
        ok: response.ok(),
        url,
      });
    }
  });
  return page;
}

async function extractFeedbackId(page) {
  const text = await page.getByTestId("feedback-id").innerText({ timeout: 20000 });
  const match = text.match(/fbk_[a-f0-9]+/i);
  if (!match) {
    throw new Error(`feedback id was not visible in "${text}"`);
  }
  return match[0];
}

async function submitFeedbackDrawer(page, message) {
  await page.getByPlaceholder(/Tell us what broke|告诉我们/i).fill(message);
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/v1/feedback") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: /Submit feedback/i }).click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`feedback POST failed: ${response.status()}`);
  }
  const payload = await response.json();
  const feedbackId = await extractFeedbackId(page);
  if (payload.feedbackId !== feedbackId) {
    throw new Error(`feedback id mismatch: api=${payload.feedbackId}, ui=${feedbackId}`);
  }
  return feedbackId;
}

async function assertBodyContains(page, text, label) {
  await page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 20000 })
    .catch(() => {
      throw new Error(`${label} not visible: ${text}`);
    });
}

async function verifyPublicForum(browser) {
  const context = await createContext(browser, false);
  const page = await createPage(context, "forum-public");
  try {
    await goto(page, "/forum");
    await assertBodyContains(page, "Developer Forum", "forum title");
    await assertBodyContains(page, "All categories", "category filter");
    await page.getByPlaceholder(/Search topics/i).waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("button", { name: "Latest", exact: true }).click();
    await page.getByRole("button", { name: "Top", exact: true }).click();
    await page.getByRole("button", { name: /New topic/i }).click();
    await assertBodyContains(page, "Connect wallet to post or reply.", "unauthenticated guard");
    const disabled = await page.getByRole("button", { name: /Post topic/i }).isDisabled();
    if (!disabled) {
      throw new Error("unauthenticated Post topic button should be disabled");
    }
    await screenshot(page, "forum-public.png");
    return "public forum browsing and unauthenticated guard verified";
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function createUiTopicAndReply(browser) {
  const context = await createContext(browser, true);
  const page = await createPage(context, "forum-authenticated");
  try {
    await goto(page, "/forum");
    await page.getByRole("button", { name: /New topic/i }).click();
    await page.getByPlaceholder(/^Title$/i).fill(expected.uiTopicTitle);
    await page.locator("select").selectOption({ label: "Bugs" });
    await page.getByPlaceholder(/Describe the question/i).fill(expected.uiTopicBody);
    await screenshot(page, "forum-create-topic.png");

    const topicResponsePromise = page.waitForResponse((response) =>
      response.url().includes("/api/v1/forum/topics") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /Post topic/i }).click();
    const topicResponse = await topicResponsePromise;
    if (!topicResponse.ok()) {
      throw new Error(`topic POST failed: ${topicResponse.status()}`);
    }
    const topicPayload = await topicResponse.json();
    uiState.topicId = topicPayload.topic?.topicId || "";
    if (!uiState.topicId) {
      throw new Error("topic POST did not return topicId");
    }
    await assertBodyContains(page, expected.uiTopicTitle, "created topic list row");
    await screenshot(page, "forum-list.png");

    await page.locator(`a[href="/forum/${uiState.topicId}"]`).first().click();
    await page.waitForURL(`**/forum/${uiState.topicId}`, { timeout: 20000 });
    await assertBodyContains(page, expected.uiTopicBody, "created topic body");
    await screenshot(page, "forum-topic-detail.png");

    await page.getByPlaceholder(/Add a helpful reply/i).fill(expected.uiReplyBody);
    const replyResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/forum/topics/${uiState.topicId}/replies`) && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /Post reply/i }).click();
    const replyResponse = await replyResponsePromise;
    if (!replyResponse.ok()) {
      throw new Error(`reply POST failed: ${replyResponse.status()}`);
    }
    const replyPayload = await replyResponse.json();
    uiState.replyId = replyPayload.reply?.replyId || "";
    if (!uiState.replyId) {
      throw new Error("reply POST did not return replyId");
    }
    await assertBodyContains(page, expected.uiReplyBody, "created reply body");

    const resolveResponsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/forum/topics/${uiState.topicId}/resolve`) && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: /Mark resolved/i }).click();
    const resolveResponse = await resolveResponsePromise;
    if (!resolveResponse.ok()) {
      throw new Error(`resolve POST failed: ${resolveResponse.status()}`);
    }
    await assertBodyContains(page, "Resolved", "resolved badge");
    await screenshot(page, "forum-reply-resolved.png");
    return `ui topic=${uiState.topicId}, reply=${uiState.replyId}`;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function verifyDocsSupport(browser) {
  const context = await createContext(browser, false);
  const page = await createPage(context, "docs-support");
  try {
    await goto(page, "/docs/support");
    await assertBodyContains(page, "Developer Support", "docs support heading");
    await screenshot(page, "docs-support.png");
    await page.getByRole("link", { name: /Developer Forum/i }).first().click();
    await page.waitForURL("**/forum", { timeout: 20000 });
    await assertBodyContains(page, "Developer Forum", "forum after docs support link");
    return "docs support forum link navigated";
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function submitDocsFeedback(browser) {
  const context = await createContext(browser, true);
  const page = await createPage(context, "docs-feedback");
  try {
    await goto(page, "/docs");
    await page.getByTestId("docs-page-feedback").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: /Not helpful/i }).click();
    await page.getByTestId("feedback-drawer").waitFor({ state: "visible", timeout: 10000 });
    uiState.docsFeedbackId = await submitFeedbackDrawer(page, expected.uiDocsFeedbackMessage);
    await screenshot(page, "docs-feedback-drawer.png");
    return `docs feedback=${uiState.docsFeedbackId}`;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function submitDashboardFeedback(browser) {
  const context = await createContext(browser, true);
  const page = await createPage(context, "dashboard-feedback");
  try {
    await goto(page, "/dashboard/discovery");
    await page.getByTestId("feedback-floating-button").click({ timeout: 20000 });
    await page.getByTestId("feedback-drawer").waitFor({ state: "visible", timeout: 10000 });
    uiState.dashboardFeedbackId = await submitFeedbackDrawer(page, expected.uiDashboardFeedbackMessage);
    await screenshot(page, "dashboard-feedback-drawer.png");
    return `dashboard feedback=${uiState.dashboardFeedbackId}`;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

function expectOne(rows, predicate, label) {
  const matches = rows.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${label}: expected 1 row, found ${matches.length}`);
  }
  return matches[0];
}

function assertNoSecrets(value, label) {
  const text = JSON.stringify(value);
  const forbidden = [
    "seed-secret-token",
    "seed-agent-token",
    "seed-provider-secret",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ];
  const leaked = forbidden.find((item) => text.includes(item));
  if (leaked) {
    throw new Error(`${label} leaked sensitive marker: ${leaked}`);
  }
}

function verifyDatabaseRows() {
  const feedbackIds = [
    fixture.seed.docsFeedbackId,
    fixture.seed.dashboardFeedbackId,
    uiState.docsFeedbackId,
    uiState.dashboardFeedbackId,
  ].map(sqlLiteral).join(", ");
  const feedbackRows = queryJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
    FROM (
      SELECT feedback_id, source, sentiment, category, message, route, page_title, language, owner_address, context_json, status
      FROM synapse_feedback_reports
      WHERE feedback_id IN (${feedbackIds})
      ORDER BY created_at ASC
    ) t
  `);
  if (!Array.isArray(feedbackRows) || feedbackRows.length !== 4) {
    throw new Error(`expected 4 feedback rows, found ${Array.isArray(feedbackRows) ? feedbackRows.length : "non-array"}`);
  }
  expectOne(feedbackRows, (row) => row.feedback_id === fixture.seed.docsFeedbackId && row.source === "docs" && row.route.includes("/docs"), "seed docs feedback");
  expectOne(feedbackRows, (row) => row.feedback_id === fixture.seed.dashboardFeedbackId && row.source === "dashboard" && row.route.includes("/dashboard/discovery"), "seed dashboard feedback");
  expectOne(feedbackRows, (row) => row.feedback_id === uiState.docsFeedbackId && row.source === "docs" && row.message.includes(runId), "ui docs feedback");
  expectOne(feedbackRows, (row) => row.feedback_id === uiState.dashboardFeedbackId && row.source === "dashboard" && row.route.includes("/dashboard/discovery"), "ui dashboard feedback");
  assertNoSecrets(feedbackRows, "feedback rows");

  const topicIds = [fixture.seed.topicId, uiState.topicId].map(sqlLiteral).join(", ");
  const topicRows = queryJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
    FROM (
      SELECT topic_id, title, body, category, author_address, status, resolved, replies_count
      FROM synapse_forum_topics
      WHERE topic_id IN (${topicIds})
      ORDER BY created_at ASC
    ) t
  `);
  if (!Array.isArray(topicRows) || topicRows.length !== 2) {
    throw new Error(`expected 2 topic rows, found ${Array.isArray(topicRows) ? topicRows.length : "non-array"}`);
  }
  expectOne(topicRows, (row) => row.topic_id === fixture.seed.topicId && row.title === expected.seedTopicTitle && row.resolved === true, "seed resolved topic");
  expectOne(topicRows, (row) => row.topic_id === uiState.topicId && row.title === expected.uiTopicTitle && row.category === "Bugs" && row.resolved === true, "ui resolved topic");

  const replyIds = [fixture.seed.replyId, uiState.replyId].map(sqlLiteral).join(", ");
  const replyRows = queryJson(`
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)::text
    FROM (
      SELECT reply_id, topic_id, body, author_address, status
      FROM synapse_forum_replies
      WHERE reply_id IN (${replyIds})
      ORDER BY created_at ASC
    ) t
  `);
  if (!Array.isArray(replyRows) || replyRows.length !== 2) {
    throw new Error(`expected 2 reply rows, found ${Array.isArray(replyRows) ? replyRows.length : "non-array"}`);
  }
  expectOne(replyRows, (row) => row.reply_id === fixture.seed.replyId && row.topic_id === fixture.seed.topicId && row.body === expected.seedReplyBody, "seed reply");
  expectOne(replyRows, (row) => row.reply_id === uiState.replyId && row.topic_id === uiState.topicId && row.body === expected.uiReplyBody, "ui reply");

  return {
    feedbackRows,
    topicRows,
    replyRows,
  };
}

function writeReport(dbEvidence = null) {
  const report = {
    baseUrl: FORUM_BASE_URL,
    gatewayBaseUrl: GATEWAY_BASE_URL,
    postgresDsn: POSTGRES_DSN.replace(/:[^:@/]+@/, ":***@"),
    generatedAt: new Date().toISOString(),
    runId,
    fixturePath: path.relative(ROOT, FIXTURE_PATH),
    seed: fixture.seed,
    ui: uiState,
    passed,
    failed,
    warnings,
    consoleErrors,
    apiResponses,
    screenshots: screenshots.map((item) => path.relative(ROOT, item)),
    dbEvidence,
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  const lines = [
    "# Forum Feedback Dogfood Verification",
    "",
    `- Base URL: ${FORUM_BASE_URL}`,
    `- Gateway: ${GATEWAY_BASE_URL}`,
    `- Generated at: ${report.generatedAt}`,
    `- Run ID: ${runId}`,
    `- Fixture: ${report.fixturePath}`,
    `- Passed: ${passed.length}`,
    `- Failed: ${failed.length}`,
    `- Warnings: ${warnings.length}`,
    "",
    "## Passed",
    "",
    ...(passed.length ? passed.map((item) => `- PASS ${item.name}${item.detail ? ` - ${item.detail}` : ""}`) : ["- None"]),
    "",
    "## Failed",
    "",
    ...(failed.length ? failed.map((item) => `- FAIL ${item.name} - ${item.detail}`) : ["- None"]),
    "",
    "## Warnings",
    "",
    ...(warnings.length ? warnings.map((item) => `- WARN ${item.name} - ${item.detail}`) : ["- None"]),
    "",
    "## Screenshots",
    "",
    ...(screenshots.length ? screenshots.map((item) => `- ${path.relative(ROOT, item)}`) : ["- None"]),
    "",
    "## Database Evidence",
    "",
    dbEvidence
      ? `- Feedback rows: ${dbEvidence.feedbackRows.length}`
      : "- DB evidence unavailable because DB assertions did not complete.",
    dbEvidence
      ? `- Topic rows: ${dbEvidence.topicRows.length}`
      : "",
    dbEvidence
      ? `- Reply rows: ${dbEvidence.replyRows.length}`
      : "",
    "",
    "## API Responses",
    "",
    ...(apiResponses.length ? apiResponses.map((item) => `- ${item.method} ${item.status} ${item.url} (page: ${item.page})`) : ["- None"]),
    "",
    "## Console Errors",
    "",
    ...(consoleErrors.length ? consoleErrors.map((item) => `- ${item.page}: ${item.text}`) : ["- None"]),
    "",
  ].filter((line) => line !== "");
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), lines.join("\n"));
  return report;
}

async function main() {
  await fetch(`${GATEWAY_BASE_URL}/health`).then((response) => {
    if (!response.ok) throw new Error(`gateway health failed: ${response.status}`);
  });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  let dbEvidence = null;
  try {
    await step("public:forum-browsing", () => verifyPublicForum(browser));
    await step("authenticated:forum-create-reply-resolve", () => createUiTopicAndReply(browser));
    await step("docs:support-link", () => verifyDocsSupport(browser));
    await step("feedback:docs-page", () => submitDocsFeedback(browser));
    await step("feedback:dashboard-discovery", () => submitDashboardFeedback(browser));
    await step("api:seeded-topic-readable", async () => {
      const payload = await api(`/v1/forum/topics/${encodeURIComponent(fixture.seed.topicId)}`);
      if (payload.topic?.topicId !== fixture.seed.topicId) {
        throw new Error("seeded topic API did not return expected topic");
      }
      if (!payload.topic?.resolved) {
        throw new Error("seeded topic should be resolved");
      }
      return `seeded topic ${fixture.seed.topicId} resolved`;
    });
    await step("db:reconciliation", async () => {
      dbEvidence = verifyDatabaseRows();
      return `feedback=${dbEvidence.feedbackRows.length}, topics=${dbEvidence.topicRows.length}, replies=${dbEvidence.replyRows.length}`;
    });
    if (consoleErrors.length > 0) {
      fail("browser:console-errors", consoleErrors.map((item) => `${item.page}: ${item.text}`).join("\n"));
    } else {
      pass("browser:console-errors", "no uncaught console errors");
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const report = writeReport(dbEvidence);
  console.log(`\nReport: ${path.join(OUT_DIR, "report.md")}`);
  if (report.failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  fail("dogfood:runner", error instanceof Error ? error.message : String(error));
  writeReport(null);
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
