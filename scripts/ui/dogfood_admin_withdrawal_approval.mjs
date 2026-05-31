#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  generateTotpCode,
  waitForSafeTotpWindow,
} from "../lib/totp_window.mjs";

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
const ADMIN_DATABASE_DSN =
  process.env.ADMIN_DATABASE_DSN ||
  process.env.LOCAL_GATEWAY_ADMIN_POSTGRES_DSN ||
  "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin";
const GATEWAY_ADMIN_PYTHON = path.join(
  ROOT,
  "services/gateway-admin/.venv/bin/python"
);
const ADMIN_TOTP_SECRET =
  process.env.ADMIN_TOTP_SECRET ||
  queryAdminTotpSecretFromLocalDb() ||
  "JBSWY3DPEHPK3PXP";
// withdrawal status source: services/gateway provider withdrawal state machine and gateway-admin review projection.
const FIXTURE_PATH = process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE
  ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_FIXTURE)
  : path.join(ROOT, "tmp/admin-withdrawal-approval/fixture.json");
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const OUT_DIR = process.env.ADMIN_WITHDRAWAL_APPROVAL_OUT_DIR
  ? path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_OUT_DIR)
  : path.join(ROOT, "output/dogfood/admin-withdrawal-approval", timestamp);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const passed = [];
const failed = [];
const warnings = [];
const screenshots = [];
const screenshotEvidence = [];
const modalDomEvidence = [];
const consoleErrors = [];
const apiResponses = [];
const resourceErrors = [];
const preflightChecks = [];
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

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function queryAdminTotpSecretFromLocalDb() {
  if (
    process.env.ADMIN_TOTP_SECRET ||
    !isLocalUrl(ADMIN_FRONT_URL) ||
    !isLocalUrl(ADMIN_GATEWAY_URL)
  ) {
    return null;
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
          'totpSecret', f.payload_json ->> 'totpSecret',
          'secretRef', f.secret_ref
        )
        FROM admin_users u
        JOIN admin_mfa_factors f ON f.admin_id = u.admin_id
        WHERE u.email = ${sqlLiteral(ADMIN_EMAIL)}
          AND f.status = 'active'
        ORDER BY f.created_at DESC
        LIMIT 1;
      `,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout.trim() || "null");
    const inlineSecret = String(parsed?.totpSecret || "").trim();
    if (inlineSecret) {
      return inlineSecret;
    }
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
      if (decrypted.status === 0) {
        const value = decrypted.stdout.trim();
        if (value) {
          return value;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function step(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
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

async function captureDiagnostics(page, name) {
  const filePath = await screenshot(page, name);
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 3000 })
    .catch(() => "");
  const diagnosticPath = path.join(OUT_DIR, `${name}.txt`);
  fs.writeFileSync(
    diagnosticPath,
    [`url=${page.url()}`, "", bodyText.slice(0, 5000)].join("\n")
  );
  return { filePath, diagnosticPath, bodyText };
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
      throw new Error(`${label} modal is not centered`);
    }
  }
  modalDomEvidence.push({
    label,
    route: page.url(),
    action: metadata.action || label,
    screenshotName: metadata.screenshotName || null,
    withdrawalId: metadata.withdrawalId || null,
    expectedText,
    actualDialogText: dialogText.slice(0, 2000),
    boundingBox: box,
    viewport,
    drawerCount,
    centered,
    role: "dialog",
    ariaModal: "true",
    buttonStates: metadata.buttonStates || [],
  });
  return {
    actualDialogText: dialogText.slice(0, 2000),
    boundingBox: box,
    viewport,
    drawerCount,
    centered,
    role: "dialog",
    ariaModal: "true",
    buttonStates: metadata.buttonStates || [],
  };
}

async function readButtonState(page, name, locator) {
  const visible = await locator.isVisible().catch(() => false);
  if (!visible) {
    return { name, visible: false, disabled: null, text: "" };
  }
  return {
    name,
    visible: true,
    disabled: await locator.isDisabled().catch(() => null),
    text: String((await locator.textContent().catch(() => "")) || "").trim(),
  };
}

async function assertPreflight(fixture) {
  const checks = [
    {
      name: "admin-front-root",
      url: ADMIN_FRONT_URL,
      headers: {},
    },
    {
      name: "admin-auth-me",
      url: `${ADMIN_GATEWAY_URL}/api/admin/v1/auth/me`,
      headers: {
        Cookie: `${ADMIN_COOKIE_NAME}=${fixture.auth.sessionToken}`,
      },
    },
    {
      name: "admin-visible-menu",
      url: `${ADMIN_GATEWAY_URL}/api/admin/v1/config/menu-items/visible`,
      headers: {
        Cookie: `${ADMIN_COOKIE_NAME}=${fixture.auth.sessionToken}`,
      },
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
    if (!response.ok) {
      throw new Error(
        `Admin withdrawal approval preflight failed: ${check.name} ${response.status} ${check.url}`
      );
    }
  }
}

function loadFixture() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Fixture not found: ${FIXTURE_PATH}. Run npm run e2e:admin-withdrawal-approval:seed first.`
    );
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  if (!fixture.auth?.sessionToken)
    throw new Error("Fixture is missing admin session token.");
  if (!fixture.withdrawal?.withdrawalId)
    throw new Error("Fixture is missing withdrawalId.");
  return fixture;
}

async function createContext(browser, fixture) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
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
      if (
        text.includes("Failed to fetch RSC payload") &&
        text.includes("Falling back to browser navigation")
      )
        return;
      if (
        text.includes(
          "Failed to load resource: the server responded with a status of 404"
        )
      )
        return;
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
      consoleErrors.push({
        page: "withdrawal-approval",
        text: `API ${record.method} ${record.status} ${record.url}`,
      });
    }
    if (
      url.includes("/withdrawal-reviews/") &&
      url.includes("/decision") &&
      response.request().method() === "POST"
    ) {
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
  const stepUp = page
    .getByText(/Step-up Verification|Google Authenticator 验证码/)
    .first();
  if (!(await stepUp.isVisible({ timeout: 2500 }).catch(() => false))) {
    return false;
  }
  await screenshot(page, "03-step-up-verification");
  await waitForSafeTotpWindow({
    guardSeconds: 10,
    sleep: (ms) => page.waitForTimeout(ms),
  });
  await page
    .locator('input[placeholder="123456"]')
    .fill(generateTotpCode(ADMIN_TOTP_SECRET));
  const confirmButton = page
    .getByRole("button", { name: /确认放行|确认|Approve|Submit/ })
    .last();
  await confirmButton.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(
    () => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons
        .reverse()
        .find((button) =>
          /确认放行|确认|Approve|Submit/.test(button.textContent || "")
        );
      return Boolean(target && !target.disabled);
    },
    null,
    { timeout: 10000 }
  );
  await confirmButton.click();
  return true;
}

async function waitForWithdrawalReviewPage(page, withdrawalId) {
  const titleLocator = page
    .getByText(/提现审核工作台|提现审核队列|Withdrawal/i)
    .first();
  await titleLocator
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(async (error) => {
      const diagnostics = await captureDiagnostics(
        page,
        "00-withdrawal-review-load-failed"
      );
      if (page.url().includes("/login")) {
        throw new Error(
          `Admin session was not accepted; redirected to login. Diagnostics: ${diagnostics.diagnosticPath}`
        );
      }
      if (resourceErrors.length > 0) {
        throw new Error(
          `Admin front static assets failed to load (${resourceErrors.length} resource errors). Restart admin-front and retry. Diagnostics: ${diagnostics.diagnosticPath}`
        );
      }
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        }. Diagnostics: ${diagnostics.diagnosticPath}`
      );
    });
  await page
    .getByText(withdrawalId)
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(async (error) => {
      const diagnostics = await captureDiagnostics(
        page,
        "00-withdrawal-review-id-missing"
      );
      throw new Error(
        `Withdrawal ${withdrawalId} was not visible on the review page: ${
          error instanceof Error ? error.message : String(error)
        }. Diagnostics: ${diagnostics.diagnosticPath}`
      );
    });
}

async function verifyApprovalFlow(page, fixture) {
  const withdrawalId = fixture.withdrawal.withdrawalId;
  await page.goto(
    `${ADMIN_FRONT_URL}/withdrawal-reviews?q=${encodeURIComponent(
      withdrawalId
    )}`,
    { waitUntil: "networkidle" }
  );
  await waitForWithdrawalReviewPage(page, withdrawalId);
  await screenshot(page, "01-withdrawal-review-queue");

  const row = page.locator("tr", { hasText: withdrawalId }).first();
  if (await row.count()) {
    await row.getByRole("button", { name: "详情" }).click();
  } else {
    await page.getByText(withdrawalId).click();
  }
  await page
    .getByText("审核详情")
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => null);
  const openModalEvidence = await assertCenteredModal(
    page,
    [withdrawalId, "Action Modal", "处理摘要"],
    "withdrawal approval detail",
    {
      action: "open withdrawal approval modal",
      screenshotName: "withdrawal-review-modal-open",
      withdrawalId,
    }
  );
  await screenshot(page, "withdrawal-review-modal-open", {
    action: "open withdrawal approval modal",
    withdrawalId,
    expectedText: [withdrawalId, "Action Modal", "处理摘要"],
    ...openModalEvidence,
  });

  const note = `Admin withdrawal approval dogfood ${fixture.runId}`;
  await page.locator("textarea").last().fill(note);
  await page.route(
    "**/api/admin/v1/withdrawal-reviews/**/decision",
    async (route) => {
      await page.waitForTimeout(800);
      await route.continue();
    },
    { times: 1 }
  );
  const approvalPromise = page.waitForResponse(
    (response) =>
      response
        .url()
        .includes(
          `/withdrawal-reviews/${encodeURIComponent(withdrawalId)}/decision`
        ) && response.request().method() === "POST",
    { timeout: 60000 }
  );
  await page
    .getByRole("button", { name: /Approve & Issue Ticket|确认放行|放行|批准/ })
    .last()
    .click();
  const waitingButton = page
    .getByRole("button", { name: /等待验证码/ })
    .first();
  await waitingButton.waitFor({ state: "visible", timeout: 30000 });
  if (!(await waitingButton.isDisabled().catch(() => false))) {
    throw new Error("Approve button was not disabled while awaiting OTP");
  }
  const awaitingRejectButton = page
    .getByRole("button", { name: /驳回申请|驳回|Reject/i })
    .first();
  const awaitingButtonStates = [
    await readButtonState(page, "approve", waitingButton),
    await readButtonState(page, "reject", awaitingRejectButton),
  ];
  const awaitingModalEvidence = await assertCenteredModal(
    page,
    [withdrawalId, "等待验证码"],
    "withdrawal approval awaiting otp",
    {
      action: "approve clicked and waiting for MFA",
      screenshotName: "withdrawal-review-awaiting-otp",
      withdrawalId,
      buttonStates: awaitingButtonStates,
    }
  );
  await screenshot(page, "withdrawal-review-awaiting-otp", {
    action: "approve clicked and waiting for MFA",
    withdrawalId,
    expectedText: [withdrawalId, "等待验证码"],
    ...awaitingModalEvidence,
  });
  await maybeSubmitStepUp(page);
  const submittingButton = page
    .getByRole("button", { name: /放行提交中/i })
    .first();
  await submittingButton.waitFor({ state: "visible", timeout: 10000 });
  if (!(await submittingButton.isDisabled().catch(() => false))) {
    throw new Error("Approve button was not disabled while submitting");
  }
  const submittingRejectButton = page
    .getByRole("button", { name: /驳回申请|驳回|Reject/i })
    .first();
  const submittingButtonStates = [
    await readButtonState(page, "approve", submittingButton),
    await readButtonState(page, "reject", submittingRejectButton),
  ];
  const submittingModalEvidence = await assertCenteredModal(
    page,
    [withdrawalId, "放行提交中"],
    "withdrawal approval submitting",
    {
      action: "approval request submitting",
      screenshotName: "withdrawal-review-submitting",
      withdrawalId,
      buttonStates: submittingButtonStates,
    }
  );
  await screenshot(page, "withdrawal-review-submitting", {
    action: "approval request submitting",
    withdrawalId,
    expectedText: [withdrawalId, "放行提交中"],
    ...submittingModalEvidence,
  });
  const approvalResponse = await approvalPromise;
  const body = await approvalResponse.json().catch(() => ({}));
  approvalResult = body;
  if (!approvalResponse.ok()) {
    throw new Error(
      `Approval request failed: ${approvalResponse.status()} ${JSON.stringify(
        body
      ).slice(0, 800)}`
    );
  }
  const data = body.data || body;
  if (data.status !== "APPROVED_AUTO" || data.reviewDecision !== "APPROVE") {
    throw new Error(
      `Unexpected approval result: ${JSON.stringify(data).slice(0, 800)}`
    );
  }
  await page
    .getByText(/已提交放行|放行|approved|签发|成功|ticket/i)
    .first()
    .waitFor({ state: "visible", timeout: 30000 })
    .catch(() => null);
  const submittedButton = page
    .getByRole("button", { name: /已提交放行/i })
    .first();
  await submittedButton.waitFor({ state: "visible", timeout: 30000 });
  if (!(await submittedButton.isDisabled().catch(() => false))) {
    throw new Error("Approve button was not locked after submit");
  }
  const rejectButton = page.getByRole("button", { name: /驳回申请/i }).first();
  if (await rejectButton.isVisible().catch(() => false)) {
    if (!(await rejectButton.isDisabled().catch(() => false))) {
      throw new Error("Reject button was not locked after approve submit");
    }
  }
  const submittedButtonStates = [
    await readButtonState(page, "approve", submittedButton),
    await readButtonState(page, "reject", rejectButton),
  ];
  const submittedModalEvidence = await assertCenteredModal(
    page,
    [withdrawalId, "已提交放行"],
    "withdrawal approval submitted",
    {
      action: "approval submitted terminal state",
      screenshotName: "withdrawal-review-submitted-terminal",
      withdrawalId,
      buttonStates: submittedButtonStates,
    }
  );
  await screenshot(page, "withdrawal-review-submitted-terminal", {
    action: "approval submitted terminal state",
    withdrawalId,
    expectedText: [withdrawalId, "已提交放行"],
    ...submittedModalEvidence,
  });

  await page.goto(
    `${ADMIN_FRONT_URL}/review-history?q=${encodeURIComponent(withdrawalId)}`,
    {
      waitUntil: "networkidle",
    }
  );
  await page
    .getByText(/审核历史|review/i)
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  const reviewHistoryRow = page.locator("tr", { hasText: withdrawalId }).first();
  let historyVisible = await reviewHistoryRow
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  for (let attempt = 0; attempt < 5 && !historyVisible; attempt += 1) {
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "networkidle" });
    historyVisible = await reviewHistoryRow
      .isVisible({ timeout: 2000 })
      .catch(() => false);
  }
  if (!historyVisible) {
    const diagnostics = await captureDiagnostics(
      page,
      "05-review-history-missing-withdrawal"
    );
    const canonicalHistoryScreenshot = path.join(
      SCREENSHOT_DIR,
      "05-review-history.png"
    );
    fs.copyFileSync(diagnostics.filePath, canonicalHistoryScreenshot);
    screenshots.push(canonicalHistoryScreenshot);
    screenshotEvidence.push({
      name: "05-review-history",
      filePath: canonicalHistoryScreenshot,
      route: page.url(),
      action: "review history projection delayed",
      withdrawalId,
      expectedText: [withdrawalId],
      diagnosticPath: diagnostics.diagnosticPath,
      sourceScreenshot: diagnostics.filePath,
    });
    warn(
      "review-history:projection-delay",
      `Review history did not show ${withdrawalId}. Diagnostics: ${diagnostics.diagnosticPath}`
    );
  } else {
    await screenshot(page, "05-review-history");
  }

  await page.goto(`${ADMIN_FRONT_URL}/finance/reconciliation`, {
    waitUntil: "networkidle",
  });
  await page
    .getByText(/Reconciliation|对账/)
    .first()
    .waitFor({ state: "visible", timeout: 30000 });
  await screenshot(page, "06-finance-reconciliation");

  return `approved ${withdrawalId}`;
}

function writeReport(fixture) {
  const report = {
    status:
      failed.length === 0 && consoleErrors.length === 0 ? "success" : "failed",
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
    screenshotEvidence,
    modalDomEvidence,
    preflightChecks,
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
    ...passed.map(
      (item) => `- PASS ${item.name}${item.detail ? ` - ${item.detail}` : ""}`
    ),
    "",
    "## Failed",
    ...(failed.length
      ? failed.map((item) => `- FAIL ${item.name} - ${item.detail}`)
      : ["- None"]),
    "",
    "## Console / API Errors",
    ...(consoleErrors.length
      ? consoleErrors.map((item) => `- ${item.page}: ${item.text}`)
      : ["- None"]),
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
  await assertPreflight(fixture);
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
  });
  try {
    const context = await createContext(browser, fixture);
    const page = await createPage(context);
    await step("browser:approve-provider-withdrawal", () =>
      verifyApprovalFlow(page, fixture)
    );
    if (consoleErrors.length) {
      fail(
        "browser:console-errors",
        `${consoleErrors.length} console/API errors`
      );
    } else {
      pass(
        "browser:console-errors",
        "no uncaught console errors or hidden 500s"
      );
    }
    const report = writeReport(fixture);
    if (report.status !== "success") process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    `[admin-withdrawal-dogfood] fatal: ${
      error.stack || error.message || String(error)
    }`
  );
  process.exit(1);
});
