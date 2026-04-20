#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ADMIN_FRONT_URL = (process.env.ADMIN_FRONT_URL || "http://localhost:4000").replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (process.env.ADMIN_GATEWAY_URL || "http://localhost:8300").replace(/\/+$/, "");
const ADMIN_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";
const FIXTURE_PATH = process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE
  ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE)
  : path.join(ROOT, "tmp/admin-withdrawal-approval/fixture.json");
const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const OUT_DIR = process.env.ADMIN_WITHDRAWAL_APPROVAL_OUT_DIR
  ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_OUT_DIR)
  : path.join(ROOT, "output/dogfood/admin-withdrawal-approval", timestamp);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const passed = [];
const failed = [];
const warnings = [];
const screenshots = [];
const consoleErrors = [];
const apiResponses = [];
const resourceErrors = [];
let approvalResult = null;

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

function getTotpRemainingSeconds(nowMs = Date.now()) {
  const elapsed = Math.floor(nowMs / 1000) % 30;
  return 30 - elapsed;
}

async function waitForFreshTotpWindow(page) {
  let remaining = getTotpRemainingSeconds();
  if (remaining > 7) {
    return remaining;
  }
  await page.waitForTimeout((remaining + 1) * 1000);
  remaining = getTotpRemainingSeconds();
  return remaining;
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push(filePath);
  return filePath;
}

async function captureDiagnostics(page, name) {
  const filePath = await screenshot(page, name);
  const bodyText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const diagnosticPath = path.join(OUT_DIR, `${name}.txt`);
  fs.writeFileSync(diagnosticPath, [
    `url=${page.url()}`,
    "",
    bodyText.slice(0, 5000),
  ].join("\n"));
  return { filePath, diagnosticPath, bodyText };
}

function loadFixture() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(`Fixture not found: ${FIXTURE_PATH}. Run npm run e2e:admin-withdrawal-approval:seed first.`);
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  if (!fixture.auth?.sessionToken) throw new Error("Fixture is missing admin session token.");
  if (!fixture.withdrawal?.withdrawalId) throw new Error("Fixture is missing withdrawalId.");
  return fixture;
}

async function createContext(browser, fixture) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    {
      name: ADMIN_COOKIE_NAME,
      value: fixture.auth.sessionToken,
      url: ADMIN_FRONT_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  if (fixture.auth.csrfToken) {
    await context.addInitScript((csrfToken) => {
      window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
    }, fixture.auth.csrfToken);
  }
  return context;
}

async function createPage(context) {
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (text.includes("Failed to fetch RSC payload") && text.includes("Falling back to browser navigation")) return;
      if (text.includes("Failed to load resource: the server responded with a status of 404")) return;
      consoleErrors.push({ page: "withdrawal-approval", text });
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push({ page: "withdrawal-approval", text: error.message });
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (response.status() >= 400 && url.includes("/_next/static/")) {
      resourceErrors.push({
        status: response.status(),
        method: response.request().method(),
        url,
      });
      return;
    }
    if (!url.includes("/api/admin/")) return;
    const record = {
      method: response.request().method(),
      status: response.status(),
      ok: response.ok(),
      url,
    };
    apiResponses.push(record);
    if (response.status() >= 500) {
      consoleErrors.push({ page: "withdrawal-approval", text: `API ${record.method} ${record.status} ${record.url}` });
    }
    if (url.includes("/withdrawal-reviews/") && url.includes("/decision") && response.request().method() === "POST") {
      try {
        approvalResult = await response.json();
      } catch {
        approvalResult = { raw: await response.text().catch(() => "") };
      }
    }
  });
  return page;
}

async function maybeSubmitStepUp(page) {
  const stepUp = page.getByText(/Step-up Verification|Google Authenticator 验证码/).first();
  if (!(await stepUp.isVisible({ timeout: 2500 }).catch(() => false))) {
    return false;
  }
  await screenshot(page, "03-step-up-verification");
  await waitForFreshTotpWindow(page);
  await page.locator('input[placeholder="123456"]').fill(generateTotpCode(ADMIN_TOTP_SECRET));
  const confirmButton = page.getByRole("button", { name: /确认放行|确认|Approve|Submit/ }).last();
  await confirmButton.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.reverse().find((button) => /确认放行|确认|Approve|Submit/.test(button.textContent || ""));
    return Boolean(target && !target.disabled);
  }, null, { timeout: 10000 });
  await confirmButton.click();
  return true;
}

async function waitForWithdrawalReviewPage(page, withdrawalId) {
  const titleLocator = page.getByText(/提现审核工作台|提现审核队列|Withdrawal/i).first();
  await titleLocator.waitFor({ state: "visible", timeout: 30000 }).catch(async (error) => {
    const diagnostics = await captureDiagnostics(page, "00-withdrawal-review-load-failed");
    if (page.url().includes("/login")) {
      throw new Error(`Admin session was not accepted; redirected to login. Diagnostics: ${diagnostics.diagnosticPath}`);
    }
    if (resourceErrors.length > 0) {
      throw new Error(`Admin front static assets failed to load (${resourceErrors.length} resource errors). Restart admin-front and retry. Diagnostics: ${diagnostics.diagnosticPath}`);
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)}. Diagnostics: ${diagnostics.diagnosticPath}`);
  });
  await page.getByText(withdrawalId).waitFor({ state: "visible", timeout: 30000 }).catch(async (error) => {
    const diagnostics = await captureDiagnostics(page, "00-withdrawal-review-id-missing");
    throw new Error(`Withdrawal ${withdrawalId} was not visible on the review page: ${error instanceof Error ? error.message : String(error)}. Diagnostics: ${diagnostics.diagnosticPath}`);
  });
}

async function verifyApprovalFlow(page, fixture) {
  const withdrawalId = fixture.withdrawal.withdrawalId;
  await page.goto(`${ADMIN_FRONT_URL}/withdrawal-reviews?q=${encodeURIComponent(withdrawalId)}`, { waitUntil: "networkidle" });
  await waitForWithdrawalReviewPage(page, withdrawalId);
  await screenshot(page, "01-withdrawal-review-queue");

  const row = page.locator("tr", { hasText: withdrawalId }).first();
  if (await row.count()) {
    await row.getByRole("button", { name: "详情" }).click();
  } else {
    await page.getByText(withdrawalId).click();
  }
  await page.getByText("审核详情").waitFor({ state: "visible", timeout: 30000 }).catch(() => null);
  await screenshot(page, "02-withdrawal-review-detail");

  const note = `Admin withdrawal approval dogfood ${fixture.runId}`;
  await page.locator("textarea").last().fill(note);
  const approvalPromise = page.waitForResponse((response) =>
    response.url().includes(`/withdrawal-reviews/${encodeURIComponent(withdrawalId)}/decision`)
      && response.request().method() === "POST",
    { timeout: 60000 },
  );
  await page.getByRole("button", { name: /Approve & Issue Ticket|确认放行|放行|批准/ }).last().click();
  await maybeSubmitStepUp(page);
  const approvalResponse = await approvalPromise;
  const body = await approvalResponse.json().catch(() => ({}));
  approvalResult = body;
  if (!approvalResponse.ok()) {
    throw new Error(`Approval request failed: ${approvalResponse.status()} ${JSON.stringify(body).slice(0, 800)}`);
  }
  const data = body.data || body;
  if (data.status !== "APPROVED_AUTO" || data.reviewDecision !== "APPROVE") {
    throw new Error(`Unexpected approval result: ${JSON.stringify(data).slice(0, 800)}`);
  }
  await page.getByText(/放行|approved|签发|成功|ticket/i).first().waitFor({ state: "visible", timeout: 30000 }).catch(() => null);
  await screenshot(page, "04-after-approve");

  await page.goto(`${ADMIN_FRONT_URL}/review-history`, { waitUntil: "networkidle" });
  await page.getByText(/审核历史|review/i).first().waitFor({ state: "visible", timeout: 30000 });
  await page.getByText(withdrawalId).waitFor({ state: "visible", timeout: 30000 });
  await screenshot(page, "05-review-history");

  await page.goto(`${ADMIN_FRONT_URL}/finance/reconciliation`, { waitUntil: "networkidle" });
  await page.getByText(/Reconciliation|对账/).first().waitFor({ state: "visible", timeout: 30000 });
  await screenshot(page, "06-finance-reconciliation");

  return `approved ${withdrawalId}`;
}

function writeReport(fixture) {
  const report = {
    status: failed.length === 0 && consoleErrors.length === 0 ? "success" : "failed",
    generatedAt: new Date().toISOString(),
    fixturePath: FIXTURE_PATH,
    runId: fixture.runId,
    withdrawalId: fixture.withdrawal.withdrawalId,
    adminFrontUrl: ADMIN_FRONT_URL,
    adminGatewayUrl: ADMIN_GATEWAY_URL,
    passed,
    failed,
    warnings,
    consoleErrors,
    apiResponses,
    resourceErrors,
    screenshots,
    approvalResult,
  };
  const reportJsonPath = path.join(OUT_DIR, "report.json");
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Admin Withdrawal Approval Dogfood Report",
    "",
    `- Status: ${report.status}`,
    `- Run ID: ${fixture.runId}`,
    `- Withdrawal ID: ${fixture.withdrawal.withdrawalId}`,
    `- Generated at: ${report.generatedAt}`,
    `- Fixture: ${FIXTURE_PATH}`,
    "",
    "## Passed",
    ...passed.map((item) => `- PASS ${item.name}${item.detail ? ` - ${item.detail}` : ""}`),
    "",
    "## Failed",
    ...(failed.length ? failed.map((item) => `- FAIL ${item.name} - ${item.detail}`) : ["- None"]),
    "",
    "## Console / API Errors",
    ...(consoleErrors.length ? consoleErrors.map((item) => `- ${item.page}: ${item.text}`) : ["- None"]),
    "",
    "## Screenshots",
    ...screenshots.map((filePath) => `- ${filePath}`),
    "",
    "## Approval Response",
    "```json",
    JSON.stringify(approvalResult, null, 2),
    "```",
    "",
  ];
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), `${lines.join("\n")}\n`);
  console.log(`[admin-withdrawal-dogfood] wrote ${reportJsonPath}`);
  return report;
}

async function main() {
  const fixture = loadFixture();
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0" });
  try {
    const context = await createContext(browser, fixture);
    const page = await createPage(context);
    await step("browser:approve-provider-withdrawal", () => verifyApprovalFlow(page, fixture));
    if (consoleErrors.length) {
      fail("browser:console-errors", `${consoleErrors.length} console/API errors`);
    } else {
      pass("browser:console-errors", "no uncaught console errors or hidden 500s");
    }
    const report = writeReport(fixture);
    if (report.status !== "success") process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[admin-withdrawal-dogfood] fatal: ${error.stack || error.message || String(error)}`);
  process.exit(1);
});
