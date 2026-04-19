#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ADMIN_FRONT_URL = (process.env.ADMIN_FRONT_URL || "http://localhost:4000").replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (process.env.ADMIN_GATEWAY_URL || "http://localhost:8300").replace(/\/+$/, "");
const ADMIN_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const FIXTURE_PATH = process.env.ADMIN_FRONT_FIXTURE
  ? path.resolve(process.env.ADMIN_FRONT_FIXTURE)
  : path.join(ROOT, "tmp/admin-front-dogfood/fixture.json");
const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const OUT_DIR = process.env.ADMIN_FRONT_DOGFOOD_OUT_DIR
  ? path.resolve(process.env.ADMIN_FRONT_DOGFOOD_OUT_DIR)
  : path.join(ROOT, "output/dogfood/admin-front", timestamp);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";

const fixture = fs.existsSync(FIXTURE_PATH) ? JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) : null;
const passed = [];
const failed = [];
const warnings = [];
const screenshots = [];
const consoleErrors = [];
const apiResponses = [];
const pageSummaries = [];

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

function pageUrl(route) {
  return `${ADMIN_FRONT_URL}${route}`;
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push(filePath);
  return filePath;
}

function parseSessionCookie(setCookieHeader) {
  const header = Array.isArray(setCookieHeader) ? setCookieHeader.join(",") : String(setCookieHeader || "");
  const match = header.split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`));
  return match ? match.split(";")[0].slice(ADMIN_COOKIE_NAME.length + 1) : "";
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
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

async function loginAdmin() {
  if (fixture?.auth?.sessionToken) {
    return fixture.auth;
  }
  if (process.env.ADMIN_SESSION_TOKEN) {
    return {
      sessionToken: process.env.ADMIN_SESSION_TOKEN,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
    };
  }
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL || "super@synapse.network",
      password: process.env.ADMIN_PASSWORD || "qwer@1234",
      otpCode: process.env.ADMIN_OTP_CODE || (
        isLocalUrl(ADMIN_FRONT_URL) && isLocalUrl(ADMIN_GATEWAY_URL) ? generateTotpCode(ADMIN_TOTP_SECRET) : undefined
      ),
    }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !body.success || !sessionToken) {
    throw new Error(`Admin login failed: ${response.status} ${JSON.stringify(body).slice(0, 800)}`);
  }
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
    throw new Error(`Admin API failed ${pathname}: ${response.status} ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body.data;
}

async function createContext(browser, auth) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
    await context.addInitScript((csrfToken) => {
      window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
    }, auth.csrfToken);
  }
  return context;
}

async function createPage(context, name) {
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (text.includes("Failed to fetch RSC payload") && text.includes("Falling back to browser navigation")) return;
      if (text.includes("401 (Unauthorized)")) return;
      consoleErrors.push({ page: name, text });
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push({ page: name, text: error.message });
  });
  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("/api/admin/")) return;
    const record = {
      page: name,
      method: response.request().method(),
      status: response.status(),
      ok: response.ok(),
      url,
    };
    apiResponses.push(record);
    if (response.status() >= 500) {
      consoleErrors.push({ page: name, text: `API ${record.method} ${record.status} ${record.url}` });
    }
  });
  return page;
}

async function assertText(page, candidates, label) {
  const bodyText = String(await page.textContent("body") || "");
  if (!candidates.some((text) => bodyText.includes(text))) {
    throw new Error(`${label} missing expected text: ${candidates.join(" | ")}`);
  }
  return bodyText;
}

async function expectUrlPath(page, expectedPath) {
  await page.waitForURL((url) => url.pathname === expectedPath, { timeout: 30000 });
  const current = new URL(page.url());
  if (current.pathname !== expectedPath) {
    throw new Error(`expected URL path ${expectedPath}, got ${current.pathname}`);
  }
}

const authPageMatrix = [
  { route: "/login", name: "login", text: ["System Authorization"] },
  { route: "/login/mfa-enroll", name: "login-mfa-enroll", text: ["MFA", "Authenticator", "Google"] },
  { route: "/login/reset-success", name: "login-reset-success", text: ["Reset", "success", "成功"] },
];

const authenticatedPageMatrix = [
  { route: "/dashboard/overview", name: "dashboard-overview", text: ["控制台概览", "需要处理"] },
  { route: "/dashboard/runtime", name: "dashboard-runtime", text: ["运行态"] },
  { route: "/dashboard/analytics", name: "analytics-overview", text: ["Analytics 总览"] },
  { route: "/dashboard/analytics/consumer-funnel", name: "analytics-consumer-funnel", text: ["Consumer 激活漏斗"] },
  { route: "/dashboard/analytics/invocation-revenue", name: "analytics-invocation-revenue", text: ["调用与收入"] },
  { route: "/dashboard/analytics/provider-revenue", name: "analytics-provider-revenue", text: ["Provider 收益"] },
  { route: "/dashboard/analytics/money-flow", name: "analytics-money-flow", text: ["资金流"] },
  { route: "/dashboard/analytics/risk-health", name: "analytics-risk-health", text: ["风控健康"] },
  { route: "/dashboard/analytics/data-quality", name: "analytics-data-quality", text: ["埋点质量"] },
  { route: "/execution", name: "execution", text: ["执行队列"] },
  { route: "/provider-services", name: "provider-services", text: ["Provider 服务"] },
  { route: "/forum-support", name: "forum-support", text: ["社区回复"] },
  { route: "/system", name: "system", text: ["系统运维"] },
  { route: "/users", name: "users", text: ["后台用户"] },
  { route: "/role-permissions", name: "role-permissions", text: ["角色权限"] },
  { route: "/menu-config", name: "menu-config", text: ["菜单配置"] },
  { route: "/approvals", name: "approvals", text: ["审批中心"] },
  { route: "/withdrawal-reviews", name: "withdrawal-reviews", text: ["提现审核工作台", "提现复核"] },
  { route: "/review-history", name: "review-history", text: ["审核历史"] },
  { route: "/finance", name: "finance", text: ["资金概览", "财务控制"] },
  { route: "/finance/reconciliation", name: "finance-reconciliation", text: ["Reconciliation", "对账"] },
  { route: "/risk", name: "risk", text: ["风险控制"] },
  { route: "/audit", name: "audit", text: ["审计追踪"] },
];

async function verifyPageMatrix(page, matrix) {
  for (const item of matrix) {
    await step(`page:${item.name}`, async () => {
      await page.goto(pageUrl(item.route), { waitUntil: "networkidle", timeout: 60000 });
      const bodyText = await assertText(page, item.text, item.route);
      await screenshot(page, item.name);
      pageSummaries.push({ route: item.route, name: item.name, matched: item.text.find((text) => bodyText.includes(text)) || item.text[0] });
      return item.route;
    });
  }
}

async function verifyNavigationClicks(page) {
  await step("redirect:dashboard-root", async () => {
    await page.goto(pageUrl("/dashboard"), { waitUntil: "networkidle", timeout: 60000 });
    if (!page.url().includes("/dashboard/overview")) {
      throw new Error(`expected /dashboard to redirect to overview, got ${page.url()}`);
    }
    return page.url();
  });
  await step("click:sidebar-dashboard-parent-toggle", async () => {
    await page.goto(pageUrl("/dashboard/overview"), { waitUntil: "networkidle", timeout: 60000 });
    const beforeUrl = page.url();
    const dashboardParent = page.getByRole("button", { name: /控制台/ }).first();
    await dashboardParent.click();
    await page.waitForTimeout(300);
    if (page.url() !== beforeUrl) {
      throw new Error(`clicking dashboard parent should not navigate: before=${beforeUrl} after=${page.url()}`);
    }
    await screenshot(page, "click-sidebar-dashboard-parent-toggle");
    return page.url();
  });
  await step("click:sidebar-dashboard-leaf-pages", async () => {
    await page.goto(pageUrl("/dashboard/overview"), { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('a[data-nav-path="/dashboard/runtime"]').first().click();
    await expectUrlPath(page, "/dashboard/runtime");
    await page.locator('a[data-nav-path="/dashboard/overview"]').first().click();
    await expectUrlPath(page, "/dashboard/overview");
    await screenshot(page, "click-sidebar-dashboard-leaf-pages");
    return page.url();
  });
  await step("click:sidebar-execution-leaf-page", async () => {
    await page.goto(pageUrl("/dashboard/overview"), { waitUntil: "networkidle", timeout: 60000 });
    await page.locator('a[data-nav-path="/execution"]').first().click();
    await expectUrlPath(page, "/execution");
    await screenshot(page, "click-sidebar-execution-leaf-page");
    return page.url();
  });
  await step("click:sidebar-forum-support", async () => {
    await page.goto(pageUrl("/dashboard/overview"), { waitUntil: "networkidle", timeout: 60000 });
    await page.getByText("社区回复", { exact: true }).first().click();
    await page.waitForURL("**/forum-support", { timeout: 30000 });
    await assertText(page, ["社区回复"], "forum support after sidebar click");
    await screenshot(page, "click-sidebar-forum-support");
    return page.url();
  });
  await step("click:sidebar-provider-services", async () => {
    await page.goto(pageUrl("/dashboard/overview"), { waitUntil: "networkidle", timeout: 60000 });
    const link = page.locator('a[href="/provider-services"]').first();
    if (await link.count() === 0) {
      throw new Error("provider services sidebar link not found");
    }
    await link.click();
    await page.waitForURL("**/provider-services", { timeout: 30000 });
    await assertText(page, ["Provider 服务"], "provider services after sidebar click");
    await screenshot(page, "click-sidebar-provider-services");
    return page.url();
  });
}

async function verifyBackendConsistency(page, auth) {
  const forumTaskId = fixture?.forum?.responseTaskId;
  if (!forumTaskId) {
    warn("forum-support:seed", "fixture has no forum response task id; skipping send-reply flow");
    return;
  }

  await step("data:forum-support-api-visible", async () => {
    const task = await adminApi(`/api/admin/v1/forum/response-tasks/${encodeURIComponent(forumTaskId)}`, auth);
    if (task.responseTaskId !== forumTaskId) {
      throw new Error(`forum task id mismatch: ${task.responseTaskId}`);
    }
    if (!["awaiting_response", "draft_ready"].includes(task.status)) {
      throw new Error(`forum task must be active before dogfood send, got ${task.status}`);
    }
    return task.status;
  });

  await step("flow:forum-support-send-reply", async () => {
    await page.goto(pageUrl("/forum-support"), { waitUntil: "networkidle", timeout: 60000 });
    await assertText(page, [fixture.forum.topicTitle], "seeded forum topic");
    await screenshot(page, "forum-support-before-send");
    const replyBody = `Admin dogfood reviewed reply ${fixture.runId}`;
    await page.locator("textarea").first().fill(replyBody);
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/admin/v1/forum/response-tasks/${forumTaskId}/send-reply`)
      && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "发送回复" }).click();
    const response = await responsePromise;
    if (!response.ok()) {
      const text = await response.text().catch(() => "");
      throw new Error(`send reply failed: ${response.status()} ${text.slice(0, 400)}`);
    }
    await assertText(page, ["回复已发送"], "send success notice");
    await screenshot(page, "forum-support-after-send");
    return forumTaskId;
  });

  await step("data:provider-services-api-page-consistency", async () => {
    const data = await adminApi("/api/admin/v1/provider-services?page=1&pageSize=20", auth);
    await page.goto(pageUrl("/provider-services"), { waitUntil: "networkidle", timeout: 60000 });
    const body = String(await page.textContent("body") || "");
    if (data.items?.[0]) {
      const first = data.items[0].serviceName || data.items[0].serviceId;
      if (!body.includes(first)) {
        throw new Error(`provider service API item not visible in UI: ${first}`);
      }
      return first;
    }
    if (!body.includes("Provider 服务")) {
      throw new Error("provider services page did not render while API returned empty list");
    }
    return "empty provider list rendered";
  });

  await step("data:finance-api-page-consistency", async () => {
    const data = await adminApi("/api/admin/v1/dashboard/finance-overview", auth);
    await page.goto(pageUrl("/finance"), { waitUntil: "networkidle", timeout: 60000 });
    const body = String(await page.textContent("body") || "").replaceAll(",", "");
    const candidates = [
      data.todayChargeUsdc,
      data.ownerLiabilityUsdc,
      data.providerPayableUsdc,
      data.platformFeeBalanceUsdc,
    ].filter(Boolean);
    if (!candidates.some((value) => body.includes(String(value).replace(/\.000000$/, "")) || body.includes(String(value)))) {
      throw new Error(`finance page did not show any API money value: ${candidates.join(", ")}`);
    }
    return candidates[0];
  });

  await step("data:analytics-api-page-consistency", async () => {
    const data = await adminApi("/api/admin/v1/dashboard/analytics/overview?window=24h", auth);
    await page.goto(pageUrl("/dashboard/analytics"), { waitUntil: "networkidle", timeout: 60000 });
    const body = String(await page.textContent("body") || "").replaceAll(",", "");
    const values = (data.cards || []).map((card) => String(card.value)).filter(Boolean);
    if (values.length > 0 && !values.some((value) => body.includes(value))) {
      throw new Error(`analytics overview did not show any card value: ${values.join(", ")}`);
    }
    return `${values.length} card values checked`;
  });
}

function writeReport() {
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrls: {
      adminFront: ADMIN_FRONT_URL,
      adminGateway: ADMIN_GATEWAY_URL,
    },
    fixturePath: fs.existsSync(FIXTURE_PATH) ? FIXTURE_PATH : null,
    passed,
    failed,
    warnings,
    screenshots,
    consoleErrors,
    apiResponses,
    pageSummaries,
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Admin Front Dogfood Report",
    "",
    `- Base URL: ${ADMIN_FRONT_URL}`,
    `- Generated at: ${report.generatedAt}`,
    `- Passed: ${passed.length}`,
    `- Failed: ${failed.length}`,
    `- Warnings: ${warnings.length}`,
    `- Screenshots: ${screenshots.length}`,
    "",
    "## Failed",
    ...(
      failed.length === 0
        ? ["- None"]
        : failed.map((item) => `- FAIL ${item.name}: ${item.detail}`)
    ),
    "",
    "## Warnings",
    ...(
      warnings.length === 0
        ? ["- None"]
        : warnings.map((item) => `- WARN ${item.name}: ${item.detail}`)
    ),
    "",
    "## Passed",
    ...passed.map((item) => `- PASS ${item.name}${item.detail ? `: ${item.detail}` : ""}`),
    "",
    "## Screenshots",
    ...screenshots.map((item) => `- ${item}`),
  ];
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), `${lines.join("\n")}\n`);
  console.log(`[admin-front-dogfood] report: ${path.join(OUT_DIR, "report.md")}`);
  if (failed.length > 0 || consoleErrors.length > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const auth = await loginAdmin();
  const browser = await chromium.launch({ headless: true });
  try {
    const publicContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const publicPage = await createPage(publicContext, "admin-front-public");
    await verifyPageMatrix(publicPage, authPageMatrix);
    await publicContext.close();

    const context = await createContext(browser, auth);
    const page = await createPage(context, "admin-front");
    await verifyPageMatrix(page, authenticatedPageMatrix);
    await verifyNavigationClicks(page);
    await verifyBackendConsistency(page, auth);
    await step("browser:console-errors", async () => {
      if (consoleErrors.length > 0) {
        throw new Error(consoleErrors.map((item) => `${item.page}: ${item.text}`).join("; "));
      }
      return "no uncaught console errors or hidden 5xx admin API responses";
    });
  } finally {
    await browser.close();
    writeReport();
  }
}

main().catch((error) => {
  fail("runner", error instanceof Error ? error.stack || error.message : String(error));
  writeReport();
  process.exit(1);
});
