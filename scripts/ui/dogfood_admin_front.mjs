#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { waitForSafeTotpWindow } from "../lib/totp_window.mjs";
import { verifyBackendConsistency } from "./admin_front_backend_consistency.mjs";

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
const FIXTURE_PATH = process.env.ADMIN_FRONT_FIXTURE
  ? path.resolve(process.env.ADMIN_FRONT_FIXTURE)
  : path.join(ROOT, "tmp/admin-front-dogfood/fixture.json");
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const OUT_DIR = process.env.ADMIN_FRONT_DOGFOOD_OUT_DIR
  ? path.resolve(process.env.ADMIN_FRONT_DOGFOOD_OUT_DIR)
  : path.join(ROOT, "output/dogfood/admin-front", timestamp);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";
const ADMIN_DATABASE_DSN =
  process.env.ADMIN_DATABASE_DSN ||
  process.env.LOCAL_GATEWAY_ADMIN_POSTGRES_DSN ||
  "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin";
const GATEWAY_ADMIN_PYTHON = path.join(
  ROOT,
  "services/gateway-admin/.venv/bin/python"
);

const fixture = fs.existsSync(FIXTURE_PATH)
  ? JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"))
  : null;
const passed = [];
const failed = [];
const warnings = [];
const screenshots = [];
const screenshotEvidence = [];
const modalDomEvidence = [];
const consoleErrors = [];
const apiResponses = [];
const pageSummaries = [];
const preflightChecks = [];
let backendConsistencyEvidence = null;

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

async function screenshot(page, name, metadata = {}) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push(filePath);
  screenshotEvidence.push({
    name,
    filePath,
    route: page.url(),
    ...metadata,
  });
  return filePath;
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

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function resolveLocalAdminTotpSecret() {
  if (
    process.env.ADMIN_TOTP_SECRET ||
    !isLocalUrl(ADMIN_FRONT_URL) ||
    !isLocalUrl(ADMIN_GATEWAY_URL)
  ) {
    return ADMIN_TOTP_SECRET;
  }
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
      `
      SELECT json_build_object(
        'totpSecret', f.payload_json->>'totpSecret',
        'secretRef', f.secret_ref
      )
      FROM admin_users u
      JOIN admin_mfa_factors f ON f.admin_id = u.admin_id
      WHERE u.email = ${sqlLiteral(process.env.ADMIN_EMAIL || "cliff@synapse-network.ai")}
        AND f.status = 'active'
      ORDER BY f.updated_at DESC
      LIMIT 1
      `,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    return ADMIN_TOTP_SECRET;
  }
  try {
    const parsed = JSON.parse(result.stdout.trim() || "null");
    const inlineSecret = String(parsed?.totpSecret || "").trim();
    if (inlineSecret) return inlineSecret;
    const secretRef = String(parsed?.secretRef || "").trim();
    if (
      secretRef &&
      secretRef.startsWith("inline-fernet:v1:") &&
      fs.existsSync(GATEWAY_ADMIN_PYTHON)
    ) {
      const decrypted = spawnSync(
        GATEWAY_ADMIN_PYTHON,
        [
          "-c",
          [
            "import sys",
            `sys.path.insert(0, ${JSON.stringify(
              path.join(ROOT, "services/gateway-admin")
            )})`,
            "from src.core.totp_secret_store import decrypt_inline_totp_secret_ref",
            "print(decrypt_inline_totp_secret_ref(sys.argv[1]))",
          ].join("; "),
          secretRef,
        ],
        { cwd: ROOT, encoding: "utf8" }
      );
      if (decrypted.status === 0 && String(decrypted.stdout || "").trim()) {
        return String(decrypted.stdout || "").trim();
      }
    }
  } catch {}
  return ADMIN_TOTP_SECRET;
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
  const resolvedTotpSecret = resolveLocalAdminTotpSecret();
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL || "cliff@synapse-network.ai",
      password: process.env.ADMIN_PASSWORD || "qwer@1234",
      otpCode:
        process.env.ADMIN_OTP_CODE ||
        (isLocalUrl(ADMIN_FRONT_URL) && isLocalUrl(ADMIN_GATEWAY_URL)
          ? generateTotpCode(resolvedTotpSecret)
          : undefined),
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
    throw new Error(
      `Admin API failed ${pathname}: ${response.status} ${JSON.stringify(
        body
      ).slice(0, 800)}`
    );
  }
  return body.data;
}

async function adminWrite(pathname, auth, { method, body, otpCode } = {}) {
  const response = await fetch(`${ADMIN_GATEWAY_URL}${pathname}`, {
    method: method || "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}`,
      "X-CSRF-Token": auth.csrfToken || "",
      ...(otpCode ? { "X-Admin-OTP-Code": otpCode } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(
      `Admin write failed ${pathname}: ${response.status} ${JSON.stringify(
        payload
      ).slice(0, 800)}`
    );
  }
  return payload.data;
}

async function createContext(browser, auth) {
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
      if (
        text.includes("Failed to fetch RSC payload") &&
        text.includes("Falling back to browser navigation")
      )
        return;
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
      consoleErrors.push({
        page: name,
        text: `API ${record.method} ${record.status} ${record.url}`,
      });
    }
  });
  return page;
}

async function assertText(page, candidates, label) {
  const forbiddenText = [
    "Internal server error",
    "Missing admin session",
    "Unauthorized",
    "Unhandled Runtime Error",
  ];
  await page.waitForFunction(
    ({ candidates: expected, forbidden }) => {
      const bodyText = document.body.innerText || "";
      return (
        expected.some((text) => bodyText.includes(text)) ||
        forbidden.some((text) => bodyText.includes(text))
      );
    },
    { candidates, forbidden: forbiddenText },
    { timeout: 30000 }
  );
  const bodyText = String((await page.textContent("body")) || "");
  const blocker = forbiddenText.find((text) => bodyText.includes(text));
  if (blocker) {
    throw new Error(`${label} rendered blocker text: ${blocker}`);
  }
  if (!candidates.some((text) => bodyText.includes(text))) {
    throw new Error(
      `${label} missing expected text: ${candidates.join(" | ")}`
    );
  }
  return bodyText;
}

async function expectUrlPath(page, expectedPath) {
  await page.waitForURL((url) => url.pathname === expectedPath, {
    timeout: 30000,
  });
  const current = new URL(page.url());
  if (current.pathname !== expectedPath) {
    throw new Error(
      `expected URL path ${expectedPath}, got ${current.pathname}`
    );
  }
}

async function expectUrlPathAndHash(page, expectedPath, expectedHash) {
  await page.waitForURL(
    (url) => url.pathname === expectedPath && url.hash === expectedHash,
    {
      timeout: 30000,
    }
  );
  const current = new URL(page.url());
  if (current.pathname !== expectedPath || current.hash !== expectedHash) {
    throw new Error(
      `expected URL ${expectedPath}${expectedHash}, got ${current.pathname}${current.hash}`
    );
  }
}

async function assertVisibleSection(page, selector, expectedText) {
  const section = page.locator(selector).first();
  if ((await section.count()) === 0) {
    throw new Error(`${selector} section not found`);
  }
  await section.scrollIntoViewIfNeeded();
  if (!(await section.isVisible())) {
    throw new Error(`${selector} section is not visible`);
  }
  const sectionText = String((await section.textContent()) || "");
  if (!sectionText.includes(expectedText)) {
    throw new Error(
      `${selector} missing expected text ${expectedText}; got ${sectionText.slice(
        0,
        240
      )}`
    );
  }
}

async function assertCenteredModal(page, expectedText, label, metadata = {}) {
  const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
  await dialog.waitFor({ state: "visible", timeout: 30000 });
  const dialogText = String((await dialog.textContent()) || "");
  const missing = expectedText.filter((text) => !dialogText.includes(text));
  if (missing.length > 0) {
    throw new Error(
      `${label} modal missing expected text: ${missing.join(" | ")}`
    );
  }
  const drawerCount = await page
    .locator(".crud-drawer--open, aside.crud-drawer, aside[role='dialog']")
    .count();
  if (drawerCount > 0) {
    throw new Error(`${label} opened a drawer instead of a modal`);
  }
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  let centered = true;
  if (box && viewport) {
    const modalCenter = box.x + box.width / 2;
    const viewportCenter = viewport.width / 2;
    centered = Math.abs(modalCenter - viewportCenter) <= viewport.width * 0.18;
    if (!centered) {
      throw new Error(
        `${label} modal is not centered: modalCenter=${modalCenter}, viewportCenter=${viewportCenter}`
      );
    }
  }
  modalDomEvidence.push({
    label,
    route: page.url(),
    action: metadata.action || label,
    screenshotName: metadata.screenshotName || null,
    expectedText,
    actualDialogText: dialogText.slice(0, 2000),
    boundingBox: box,
    viewport,
    drawerCount,
    centered,
    role: "dialog",
    ariaModal: "true",
  });
  return dialogText;
}

async function assertPreflight(auth) {
  const checks = [
    {
      name: "admin-front-root",
      url: ADMIN_FRONT_URL,
      headers: {},
      expect: (response) => response.ok,
    },
    {
      name: "admin-auth-me",
      url: `${ADMIN_GATEWAY_URL}/api/admin/v1/auth/me`,
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}` },
      expect: (response) => response.ok,
    },
    {
      name: "admin-visible-menu",
      url: `${ADMIN_GATEWAY_URL}/api/admin/v1/config/menu-items/visible`,
      headers: { Cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}` },
      expect: (response) => response.ok,
    },
  ];
  for (const check of checks) {
    const response = await fetch(check.url, {
      headers: { Accept: "application/json", ...check.headers },
    });
    preflightChecks.push({
      name: check.name,
      url: check.url,
      status: response.status,
      ok: response.ok,
    });
    if (!check.expect(response)) {
      throw new Error(
        `Admin E2E preflight failed: ${check.name} ${response.status} ${check.url}`
      );
    }
  }
}

async function closeTopModal(page) {
  const closeButton = page
    .locator('[role="dialog"][aria-modal="true"]')
    .first()
    .getByRole("button", { name: /关闭|Close/i })
    .last();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await page
    .locator('[role="dialog"][aria-modal="true"]')
    .first()
    .waitFor({ state: "detached", timeout: 10000 })
    .catch(() => null);
}

const authPageMatrix = [
  { route: "/login", name: "login", text: ["System Authorization"] },
  {
    route: "/login/mfa-enroll",
    name: "login-mfa-enroll",
    text: ["MFA", "Authenticator", "Google"],
  },
  {
    route: "/login/reset-success",
    name: "login-reset-success",
    text: ["Reset", "success", "成功"],
  },
];

const authenticatedPageMatrix = [
  {
    route: "/dashboard/overview",
    name: "dashboard-overview",
    text: ["控制台概览", "需要处理"],
  },
  { route: "/dashboard/runtime", name: "dashboard-runtime", text: ["运行态"] },
  {
    route: "/dashboard/analytics",
    name: "analytics-overview",
    text: ["Analytics 总览"],
  },
  {
    route: "/dashboard/analytics/consumer-funnel",
    name: "analytics-consumer-funnel",
    text: ["Consumer 激活漏斗"],
  },
  {
    route: "/dashboard/analytics/invocation-revenue",
    name: "analytics-invocation-revenue",
    text: ["调用与收入"],
  },
  {
    route: "/dashboard/analytics/provider-revenue",
    name: "analytics-provider-revenue",
    text: ["Provider 收益"],
  },
  {
    route: "/dashboard/analytics/money-flow",
    name: "analytics-money-flow",
    text: ["资金流"],
  },
  {
    route: "/dashboard/analytics/risk-health",
    name: "analytics-risk-health",
    text: ["风控健康"],
  },
  {
    route: "/dashboard/analytics/data-quality",
    name: "analytics-data-quality",
    text: ["埋点质量"],
  },
  { route: "/execution", name: "execution", text: ["执行队列"] },
  {
    route: "/provider-services",
    name: "provider-services",
    text: ["Provider 服务"],
  },
  { route: "/forum-support", name: "forum-support", text: ["社区回复"] },
  { route: "/system", name: "system", text: ["系统运维"] },
  { route: "/users", name: "users", text: ["后台用户"] },
  { route: "/role-permissions", name: "role-permissions", text: ["角色权限"] },
  { route: "/menu-config", name: "menu-config", text: ["菜单配置"] },
  {
    route: "/config",
    name: "config-overview",
    text: ["配置中心", "业务参数草稿"],
  },
  { route: "/approvals", name: "approvals", text: ["审批中心"] },
  {
    route: "/withdrawal-reviews",
    name: "withdrawal-reviews",
    text: ["提现审核工作台", "提现复核"],
  },
  { route: "/review-history", name: "review-history", text: ["审核历史"] },
  { route: "/finance", name: "finance", text: ["资金概览", "财务控制"] },
  {
    route: "/finance/reconciliation",
    name: "finance-reconciliation",
    text: ["Reconciliation", "对账"],
  },
  { route: "/risk", name: "risk", text: ["风险控制"] },
  { route: "/audit", name: "audit", text: ["审计追踪"] },
];

async function verifyPageMatrix(page, matrix) {
  for (const item of matrix) {
    await step(`page:${item.name}`, async () => {
      await page.goto(pageUrl(item.route), {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      const bodyText = await assertText(page, item.text, item.route);
      await screenshot(page, item.name);
      pageSummaries.push({
        route: item.route,
        name: item.name,
        matched:
          item.text.find((text) => bodyText.includes(text)) || item.text[0],
      });
      return item.route;
    });
  }
}

async function verifyNavigationClicks(page) {
  await step("redirect:dashboard-root", async () => {
    await page.goto(pageUrl("/dashboard"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    if (!page.url().includes("/dashboard/overview")) {
      throw new Error(
        `expected /dashboard to redirect to overview, got ${page.url()}`
      );
    }
    return page.url();
  });
  await step("click:sidebar-dashboard-parent-toggle", async () => {
    await page.goto(pageUrl("/dashboard/overview"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const beforeUrl = page.url();
    const dashboardParent = page
      .getByRole("button", { name: /控制台/ })
      .first();
    await dashboardParent.click();
    await page.waitForTimeout(300);
    if (page.url() !== beforeUrl) {
      throw new Error(
        `clicking dashboard parent should not navigate: before=${beforeUrl} after=${page.url()}`
      );
    }
    await screenshot(page, "click-sidebar-dashboard-parent-toggle");
    return page.url();
  });
  await step("click:sidebar-dashboard-leaf-pages", async () => {
    await page.goto(pageUrl("/dashboard/overview"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.locator('a[data-nav-path="/dashboard/runtime"]').first().click();
    await expectUrlPath(page, "/dashboard/runtime");
    await page
      .locator('a[data-nav-path="/dashboard/overview"]')
      .first()
      .click();
    await expectUrlPath(page, "/dashboard/overview");
    await screenshot(page, "click-sidebar-dashboard-leaf-pages");
    return page.url();
  });
  await step("click:sidebar-execution-leaf-page", async () => {
    await page.goto(pageUrl("/dashboard/overview"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.locator('a[data-nav-path="/execution"]').first().click();
    await expectUrlPath(page, "/execution");
    await screenshot(page, "click-sidebar-execution-leaf-page");
    return page.url();
  });
  await step("click:sidebar-forum-support", async () => {
    await page.goto(pageUrl("/dashboard/overview"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const link = page.locator('a[href="/forum-support"]').first();
    if ((await link.count()) === 0) {
      throw new Error("forum support sidebar link not found");
    }
    await link.click();
    await page.waitForURL("**/forum-support", { timeout: 30000 });
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Forum Support") ||
        document.body.innerText.includes("社区回复") ||
        document.body.innerText.includes("未回复队列"),
      { timeout: 30000 }
    );
    await assertText(
      page,
      ["Forum Support", "社区回复", "未回复队列"],
      "forum support after sidebar click"
    );
    await screenshot(page, "click-sidebar-forum-support");
    return page.url();
  });
  await step("click:sidebar-provider-services", async () => {
    await page.goto(pageUrl("/dashboard/overview"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const link = page.locator('a[href="/provider-services"]').first();
    if ((await link.count()) === 0) {
      throw new Error("provider services sidebar link not found");
    }
    await link.click();
    await page.waitForURL("**/provider-services", { timeout: 30000 });
    await assertText(
      page,
      ["Provider 服务"],
      "provider services after sidebar click"
    );
    await screenshot(page, "click-sidebar-provider-services");
    return page.url();
  });
  await step("click:sidebar-role-permissions-parent-page", async () => {
    await page.goto(pageUrl("/users"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const link = page.locator('a[data-nav-path="/role-permissions"]').first();
    if ((await link.count()) === 0) {
      throw new Error("role permissions sidebar link not found");
    }
    await link.click();
    await expectUrlPath(page, "/role-permissions");
    await assertText(page, ["角色权限管理"], "role permissions parent click");
    await screenshot(page, "click-sidebar-role-permissions-parent-page");
    return page.url();
  });
  const rbacPanelLinks = [
    {
      name: "permissions-matrix",
      hash: "#permissions-matrix",
      text: "权限矩阵",
    },
    {
      name: "module-boundaries",
      hash: "#module-boundaries",
      text: "模块边界",
    },
    {
      name: "reviewer-split",
      hash: "#reviewer-split",
      text: "Reviewer 分工",
    },
  ];
  for (const panel of rbacPanelLinks) {
    await step(`click:sidebar-role-permissions-${panel.name}`, async () => {
      await page.goto(pageUrl("/role-permissions"), {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      const navPath = `/role-permissions${panel.hash}`;
      const link = page.locator(`a[data-nav-path="${navPath}"]`).first();
      if ((await link.count()) === 0) {
        throw new Error(`${panel.name} sidebar link not found`);
      }
      await link.click();
      await expectUrlPathAndHash(page, "/role-permissions", panel.hash);
      await assertVisibleSection(page, panel.hash, panel.text);
      await screenshot(page, `click-sidebar-role-permissions-${panel.name}`);
      return page.url();
    });
  }
}

async function verifyOperationModals(page) {
  await step("modal:withdrawal-reviews-detail", async () => {
    const route = fixture?.operationModals?.withdrawalId
      ? `/withdrawal-reviews?q=${encodeURIComponent(
          fixture.operationModals.withdrawalId
        )}`
      : "/withdrawal-reviews";
    await page.goto(pageUrl(route), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const detailButton = page.getByRole("button", { name: "详情" }).first();
    await detailButton.waitFor({ state: "visible", timeout: 30000 });
    await detailButton.click();
    const screenshotName = "modal-withdrawal-review-detail";
    const text = await assertCenteredModal(
      page,
      ["Action Modal", "处理摘要", "确认放行", "驳回申请"],
      "withdrawal reviews detail",
      { action: "open withdrawal review detail", screenshotName }
    );
    await screenshot(page, screenshotName, {
      action: "open withdrawal review detail",
    });
    await closeTopModal(page);
    return text.slice(0, 160);
  });

  await step("modal:review-history-detail", async () => {
    const route = fixture?.operationModals?.withdrawalId
      ? `/review-history?q=${encodeURIComponent(
          fixture.operationModals.withdrawalId
        )}`
      : "/review-history";
    await page.goto(pageUrl(route), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const detailButton = page.getByRole("button", { name: "详情" }).first();
    await detailButton.waitFor({ state: "visible", timeout: 30000 });
    await detailButton.click();
    const screenshotName = "modal-review-history-detail";
    const text = await assertCenteredModal(
      page,
      ["Action Modal", "状态流转"],
      "review history detail",
      { action: "open review history detail", screenshotName }
    );
    await screenshot(page, screenshotName, {
      action: "open review history detail",
    });
    await closeTopModal(page);
    return text.slice(0, 160);
  });

  await step("modal:role-permissions-create", async () => {
    await page.goto(pageUrl("/role-permissions"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.getByRole("button", { name: "创建角色" }).click();
    const screenshotName = "modal-role-permissions-create";
    const text = await assertCenteredModal(
      page,
      ["Action Modal", "创建角色", "Permissions"],
      "role permissions create",
      { action: "open role create modal", screenshotName }
    );
    await screenshot(page, screenshotName, {
      action: "open role create modal",
    });
    await closeTopModal(page);
    return text.slice(0, 160);
  });

  await step("modal:menu-config-create", async () => {
    await page.goto(pageUrl("/menu-config"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.getByRole("button", { name: "创建菜单项" }).click();
    const screenshotName = "modal-menu-config-create";
    const text = await assertCenteredModal(
      page,
      ["Action Modal", "创建菜单项", "Item Id"],
      "menu config create",
      { action: "open menu item create modal", screenshotName }
    );
    await screenshot(page, screenshotName, {
      action: "open menu item create modal",
    });
    await closeTopModal(page);
    return text.slice(0, 160);
  });

  await step("modal:users-create", async () => {
    await page.goto(pageUrl("/users"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.getByRole("button", { name: /创建后台用户|新建管理员/ }).click();
    const screenshotName = "modal-users-create";
    const text = await assertCenteredModal(
      page,
      ["创建管理员", "Email", "Role Template"],
      "users create",
      { action: "open admin user create modal", screenshotName }
    );
    await screenshot(page, screenshotName, {
      action: "open admin user create modal",
    });
    await closeTopModal(page);
    return text.slice(0, 160);
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
    screenshotEvidence,
    modalDomEvidence,
    consoleErrors,
    apiResponses,
    pageSummaries,
    preflightChecks,
    backendConsistencyEvidence,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
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
    ...(failed.length === 0
      ? ["- None"]
      : failed.map((item) => `- FAIL ${item.name}: ${item.detail}`)),
    "",
    "## Warnings",
    ...(warnings.length === 0
      ? ["- None"]
      : warnings.map((item) => `- WARN ${item.name}: ${item.detail}`)),
    "",
    "## Passed",
    ...passed.map(
      (item) => `- PASS ${item.name}${item.detail ? `: ${item.detail}` : ""}`
    ),
    "",
    "## Screenshots",
    ...screenshots.map((item) => `- ${item}`),
  ];
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), `${lines.join("\n")}\n`);
  console.log(
    `[admin-front-dogfood] report: ${path.join(OUT_DIR, "report.md")}`
  );
  if (failed.length > 0 || consoleErrors.length > 0) {
    process.exitCode = 1;
  }
}

async function main() {
  const auth = await loginAdmin();
  const totpSecret = resolveLocalAdminTotpSecret();
  await assertPreflight(auth);
  const browser = await chromium.launch({ headless: true });
  let publicContext;
  let context;
  try {
    publicContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const publicPage = await createPage(publicContext, "admin-front-public");
    await verifyPageMatrix(publicPage, authPageMatrix);
    await publicContext.close();
    publicContext = null;

    context = await createContext(browser, auth);
    const page = await createPage(context, "admin-front");
    await verifyPageMatrix(page, authenticatedPageMatrix);
    await verifyNavigationClicks(page);
    await verifyOperationModals(page);
    backendConsistencyEvidence = await verifyBackendConsistency({
      adminApi,
      adminWrite,
      assertText,
      auth,
      fixture,
      generateTotpCode,
      page,
      pageUrl,
      screenshot,
      step,
      totpSecret,
      warn,
      waitForSafeTotpWindow,
    });
    await step("browser:console-errors", async () => {
      if (consoleErrors.length > 0) {
        throw new Error(
          consoleErrors.map((item) => `${item.page}: ${item.text}`).join("; ")
        );
      }
      return "no uncaught console errors or hidden 5xx admin API responses";
    });
  } finally {
    writeReport();
    await Promise.allSettled([
      publicContext?.close?.(),
      context?.close?.(),
      Promise.race([
        browser.close(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]),
    ]);
    setImmediate(() => process.exit(process.exitCode || 0));
  }
}

main().catch((error) => {
  fail(
    "runner",
    error instanceof Error ? error.stack || error.message : String(error)
  );
  writeReport();
  process.exit(1);
});
