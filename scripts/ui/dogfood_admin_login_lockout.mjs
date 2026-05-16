#!/usr/bin/env node

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
  process.env.ADMIN_LOCKOUT_DOGFOOD_RUN_ID ||
  `admin-lockout-${Date.now().toString(36)}`;
const SAFE_RUN_ID = RUN_ID.replace(/[^a-zA-Z0-9_-]/g, "_");
const OUT_DIR = process.env.ADMIN_LOCKOUT_DOGFOOD_OUT_DIR
  ? path.resolve(process.env.ADMIN_LOCKOUT_DOGFOOD_OUT_DIR)
  : path.join(ROOT, "output/dogfood/admin-login-lockout", timestamp);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const VIDEO_DIR = path.join(OUT_DIR, "videos");
const ADMIN_FRONT_URL = (
  process.env.ADMIN_FRONT_URL || "http://localhost:3200"
).replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (
  process.env.ADMIN_GATEWAY_URL || "http://localhost:8300"
).replace(/\/+$/, "");
const ADMIN_DSN =
  process.env.ADMIN_LOCKOUT_DOGFOOD_DSN ||
  process.env.ADMIN_DATABASE_DSN ||
  "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin";
const PYTHON_BIN =
  process.env.SYNAPSE_PYTHON_BIN ||
  path.join(ROOT, "services/gateway-admin/.venv/bin/python");
const USER_HELPER = path.join(
  ROOT,
  "services/gateway-admin/scripts/dogfood_admin_login_lockout_user.py"
);
const EMAIL =
  process.env.ADMIN_LOCKOUT_DOGFOOD_EMAIL ||
  `lockout-dogfood-${SAFE_RUN_ID}@synapse-network.ai`;
const PASSWORD =
  process.env.ADMIN_LOCKOUT_DOGFOOD_PASSWORD || "LockoutDogfood#2026!";
const WRONG_PASSWORD =
  process.env.ADMIN_LOCKOUT_DOGFOOD_WRONG_PASSWORD || "wrong-password";
const LOCKED_MESSAGE =
  "账号因连续登录失败已临时锁定，请 24 小时后重试或联系 Owner。";
const GENERIC_FAILURE_MESSAGE = "邮箱或密码不正确，请检查后重试。";

const passed = [];
const failed = [];
const warnings = [];
const screenshots = [];
const apiResponses = [];
const consoleErrors = [];
const bugfixItems = [];
let cleanupResult = null;
let dbAssertion = null;

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR, { recursive: true });

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail, extra = {}) {
  const item = { name, detail, ...extra };
  failed.push(item);
  bugfixItems.push({
    id: `BUG-${String(bugfixItems.length + 1).padStart(3, "0")}`,
    severity: extra.severity || "P1",
    scenario: name,
    screenshot: extra.screenshot || "",
    apiEvidence: extra.apiEvidence || "",
    reproSteps:
      extra.reproSteps || "Run npm run e2e:admin-login-lockout:dogfood",
    expected: extra.expected || "",
    actual: detail,
    status: "Open",
  });
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

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertLocalOnly() {
  if (!isLocalUrl(ADMIN_FRONT_URL) || !isLocalUrl(ADMIN_GATEWAY_URL)) {
    throw new Error(
      "Refusing to run admin login lockout dogfood against non-local admin-front/gateway-admin URLs."
    );
  }
  if (!/localhost|127\.0\.0\.1|::1/.test(ADMIN_DSN)) {
    throw new Error(
      "Refusing to run admin login lockout dogfood against non-local admin database DSN."
    );
  }
}

function runUserHelper(action, extraArgs = []) {
  const result = spawnSync(
    PYTHON_BIN,
    [
      USER_HELPER,
      action,
      "--dsn",
      ADMIN_DSN,
      "--email",
      EMAIL,
      "--password",
      PASSWORD,
      ...extraArgs,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, ADMIN_LOCKOUT_DOGFOOD_DSN: ADMIN_DSN },
    }
  );
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || `${action} failed`).trim()
    );
  }
  return JSON.parse(result.stdout);
}

async function checkHealth() {
  const response = await fetch(`${ADMIN_GATEWAY_URL}/health`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status !== "ok") {
    throw new Error(
      `gateway-admin health failed: ${response.status} ${JSON.stringify(body)}`
    );
  }
  return `${ADMIN_GATEWAY_URL}/health ok`;
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push(filePath);
  return filePath;
}

async function submitLogin(page, password) {
  await page.getByPlaceholder("EMAIL_UID").fill(EMAIL);
  await page.getByPlaceholder("PASSWORD").fill(password);
  const [response] = await Promise.all([
    page.waitForResponse(
      (item) =>
        item.url().includes("/api/admin/v1/auth/login") &&
        item.request().method() === "POST",
      { timeout: 15000 }
    ),
    page.getByRole("button", { name: /Continue Secure Sign-In/i }).click(),
  ]);
  const body = await response.json().catch(() => ({}));
  apiResponses.push({
    method: response.request().method(),
    url: response.url(),
    status: response.status(),
    code: body?.error?.code || null,
    message: body?.error?.message || null,
  });
  return { response, body };
}

async function expectBodyText(page, expected, label) {
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text),
    expected,
    { timeout: 10000 }
  );
  const bodyText = await page.locator("body").innerText({ timeout: 5000 });
  if (!bodyText.includes(expected)) {
    throw new Error(`${label} missing expected text: ${expected}`);
  }
  return bodyText;
}

async function runBrowserDogfood() {
  const browser = await chromium.launch({
    headless: process.env.ADMIN_LOCKOUT_DOGFOOD_HEADFUL !== "1",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 1000 } },
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.includes("401")) return;
    if (text.includes("423")) return;
    consoleErrors.push(text);
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(`${ADMIN_FRONT_URL}/login`, { waitUntil: "networkidle" });
    await screenshot(page, "01-login-initial");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const { response, body } = await submitLogin(page, WRONG_PASSWORD);
      if (response.status() !== 401 || body?.error?.code !== "UNAUTHORIZED") {
        throw new Error(
          `wrong password attempt ${attempt} expected 401 UNAUTHORIZED, got ${response.status()} ${JSON.stringify(
            body
          )}`
        );
      }
      await expectBodyText(
        page,
        GENERIC_FAILURE_MESSAGE,
        `wrong password attempt ${attempt}`
      );
      await screenshot(page, `0${attempt + 1}-wrong-password-${attempt}`);
    }

    const fifth = await submitLogin(page, WRONG_PASSWORD);
    if (
      fifth.response.status() !== 401 ||
      fifth.body?.error?.code !== "UNAUTHORIZED"
    ) {
      throw new Error(
        `fifth wrong password expected 401 UNAUTHORIZED, got ${fifth.response.status()} ${JSON.stringify(
          fifth.body
        )}`
      );
    }
    await expectBodyText(page, GENERIC_FAILURE_MESSAGE, "fifth wrong password");
    await screenshot(page, "06-fifth-failure-lock-triggered");

    const locked = await submitLogin(page, PASSWORD);
    if (
      locked.response.status() !== 423 ||
      locked.body?.error?.code !== "ADMIN_ACCOUNT_LOCKED"
    ) {
      throw new Error(
        `locked login expected 423 ADMIN_ACCOUNT_LOCKED, got ${locked.response.status()} ${JSON.stringify(
          locked.body
        )}`
      );
    }
    await expectBodyText(page, LOCKED_MESSAGE, "locked account");
    await screenshot(page, "07-locked-message");
  } finally {
    await context.close();
    await browser.close();
  }
}

function writeReports() {
  const status = failed.length === 0 ? "success" : "failed";
  const report = {
    status,
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    adminFrontUrl: ADMIN_FRONT_URL,
    adminGatewayUrl: ADMIN_GATEWAY_URL,
    testEmail: EMAIL,
    passed,
    failed,
    warnings,
    screenshots: screenshots.map((item) => path.relative(OUT_DIR, item)),
    videos: fs.existsSync(VIDEO_DIR)
      ? fs
          .readdirSync(VIDEO_DIR)
          .filter((item) => item.endsWith(".webm"))
          .map((item) => path.join("videos", item))
      : [],
    apiResponses,
    consoleErrors,
    dbAssertion,
    cleanupResult,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      `# Admin Login Lockout Dogfood ${RUN_ID}`,
      "",
      `Status: ${status}`,
      `Generated: ${report.generatedAt}`,
      `Admin-front: ${ADMIN_FRONT_URL}`,
      `Gateway-admin: ${ADMIN_GATEWAY_URL}`,
      `Test account: ${EMAIL}`,
      "",
      "## Passed",
      ...passed.map(
        (item) => `- ${item.name}${item.detail ? `: ${item.detail}` : ""}`
      ),
      "",
      "## Failed",
      ...(failed.length
        ? failed.map((item) => `- ${item.name}: ${item.detail}`)
        : ["- None"]),
      "",
      "## Screenshots",
      ...report.screenshots.map((item) => `- ${item}`),
      "",
      "## Videos",
      ...(report.videos.length
        ? report.videos.map((item) => `- ${item}`)
        : ["- None"]),
      "",
      "## API Evidence",
      "```json",
      JSON.stringify(apiResponses, null, 2),
      "```",
      "",
      "## DB Assertion",
      "```json",
      JSON.stringify(dbAssertion, null, 2),
      "```",
      "",
      "## Cleanup",
      "```json",
      JSON.stringify(cleanupResult, null, 2),
      "```",
      "",
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "bugfix-log.md"),
    [
      `# Bugfix Log ${RUN_ID}`,
      "",
      ...(bugfixItems.length
        ? bugfixItems.flatMap((item) => [
            `## ${item.id}: ${item.scenario}`,
            "",
            `Severity: ${item.severity}`,
            `Status: ${item.status}`,
            `Screenshot: ${item.screenshot || "N/A"}`,
            `API Evidence: ${item.apiEvidence || "N/A"}`,
            "",
            `Expected: ${item.expected || "N/A"}`,
            "",
            `Actual: ${item.actual}`,
            "",
            `Repro Steps: ${item.reproSteps}`,
            "",
          ])
        : ["No open bugs."]),
      "",
    ].join("\n")
  );
  console.log(
    `[admin-login-lockout-dogfood] report: ${path.join(OUT_DIR, "report.md")}`
  );
}

async function main() {
  assertLocalOnly();
  await step("gateway-admin health ready", checkHealth);
  if (failed.length) return;

  await step("create disposable admin lockout account", () => {
    const result = runUserHelper("create");
    return `${result.email} (${result.adminId})`;
  });
  if (failed.length) return;

  try {
    await step("browser login lockout lifecycle", runBrowserDogfood);
    await step("database lockout assertion", () => {
      dbAssertion = runUserHelper("assert-locked");
      return `attempts=${dbAssertion.failedLoginAttempts}`;
    });
  } finally {
    try {
      cleanupResult = runUserHelper("delete");
      pass(
        "cleanup disposable admin lockout account",
        cleanupResult.deleted ? cleanupResult.adminId : "already absent"
      );
    } catch (error) {
      warn(
        "cleanup disposable admin lockout account",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

main()
  .catch((error) => {
    fail(
      "dogfood:runner",
      error instanceof Error ? error.stack || error.message : String(error)
    );
  })
  .finally(() => {
    writeReports();
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  });
