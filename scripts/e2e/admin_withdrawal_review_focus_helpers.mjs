import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

export function createAdminWithdrawalReviewFocusHelpers({
  config,
  enabled,
  evidence,
  isStaging,
  sanitize,
  screenshotDir,
}) {
  function recordAdminAuthCheckpoint(name, checkpoint) {
    if (!enabled) return;
    evidence.api.adminAuthCheckpoints = evidence.api.adminAuthCheckpoints || {};
    evidence.api.adminAuthCheckpoints[name] = sanitize({
      cookieName: config.adminCookieName,
      sessionCookiePresent: Boolean(checkpoint.sessionCookiePresent),
      csrfTokenPresent: Boolean(checkpoint.csrfTokenPresent),
      otpCodePresent: Boolean(checkpoint.otpCodePresent),
      permissions: checkpoint.permissions || [],
      role: checkpoint.role || "",
      httpStatus: checkpoint.httpStatus ?? null,
      requestId: checkpoint.requestId || "",
      errorCode: checkpoint.errorCode || "",
      errorMessage: checkpoint.errorMessage || "",
    });
  }

  async function screenshotAdmin(page, name, checkpoint = {}) {
    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 5_000 })
      .catch(() => "");
    const expectedText = checkpoint.expectedText || [];
    const forbiddenText = checkpoint.forbiddenText || [
      "Admin Authentication",
      "Sign in to continue",
      "Unauthorized",
      "Internal server error",
    ];
    const missingExpected = expectedText.filter((item) => {
      if (item instanceof RegExp) return !item.test(bodyText);
      return !bodyText.includes(String(item));
    });
    const presentForbidden = forbiddenText.filter((item) => {
      if (item instanceof RegExp) return item.test(bodyText);
      return bodyText.includes(String(item));
    });
    if (enabled && missingExpected.length > 0) {
      throw new Error(
        `SCREENSHOT_EXPECTED_TEXT_MISSING ${name}: ${missingExpected
          .map(String)
          .join(", ")}`
      );
    }
    if (enabled && presentForbidden.length > 0) {
      throw new Error(
        `SCREENSHOT_FORBIDDEN_TEXT_PRESENT ${name}: ${presentForbidden
          .map(String)
          .join(", ")}`
      );
    }
    const filePath = path.join(screenshotDir, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    evidence.screenshots.push(filePath);
    if (enabled) {
      evidence.screenshotEvidence.push({
        file: filePath,
        url: page.url(),
        expectedText: expectedText.map(String),
        forbiddenTextAbsent: presentForbidden.length === 0,
        capturedAt: new Date().toISOString(),
        domCheckpoint: checkpoint.domCheckpoint || name,
        apiCheckpoint: checkpoint.apiCheckpoint || "",
        dbCheckpoint: checkpoint.dbCheckpoint || "",
      });
    }
    return filePath;
  }

  async function assertAdminModal(page, expectedText, label) {
    if (!enabled) return;
    const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
    await dialog.waitFor({ state: "visible", timeout: 30_000 });
    const dialogText = String((await dialog.textContent()) || "");
    const missing = expectedText.filter((item) => {
      if (item instanceof RegExp) return !item.test(dialogText);
      return !dialogText.includes(String(item));
    });
    if (missing.length > 0) {
      throw new Error(
        `ADMIN_MODAL_EXPECTED_TEXT_MISSING ${label}: ${missing
          .map(String)
          .join(", ")}`
      );
    }
    const drawerCount = await page
      .locator(".crud-drawer--open, aside.crud-drawer, aside[role='dialog']")
      .count();
    if (drawerCount > 0) {
      throw new Error(`ADMIN_MODAL_RENDERED_AS_DRAWER ${label}`);
    }
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    if (box && viewport) {
      const modalCenter = box.x + box.width / 2;
      const viewportCenter = viewport.width / 2;
      if (Math.abs(modalCenter - viewportCenter) > viewport.width * 0.18) {
        throw new Error(
          `ADMIN_MODAL_NOT_CENTERED ${label}: modalCenter=${modalCenter} viewportCenter=${viewportCenter}`
        );
      }
    }
  }

  function copyAdminScreenshotAlias(sourcePath, aliasName, checkpoint = {}) {
    if (!enabled || !sourcePath) return "";
    const targetPath = path.join(screenshotDir, `${aliasName}.png`);
    fs.copyFileSync(sourcePath, targetPath);
    evidence.screenshots.push(targetPath);
    evidence.screenshotEvidence.push({
      file: targetPath,
      url: checkpoint.url || "",
      expectedText: (checkpoint.expectedText || []).map(String),
      forbiddenTextAbsent: true,
      capturedAt: new Date().toISOString(),
      domCheckpoint: checkpoint.domCheckpoint || aliasName,
      apiCheckpoint: checkpoint.apiCheckpoint || "",
      dbCheckpoint: checkpoint.dbCheckpoint || "",
      sourceFile: sourcePath,
    });
    return targetPath;
  }

  async function openAdminContext(adminAuth) {
    const browser = await chromium.launch({
      headless: process.env.HEADLESS !== "0",
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const adminCookie = {
      name: config.adminCookieName,
      value: adminAuth.sessionToken,
      httpOnly: true,
      sameSite: "Lax",
    };
    await context.addCookies([
      isStaging
        ? {
            ...adminCookie,
            domain: ".synapse-network.ai",
            path: "/",
            secure: true,
          }
        : {
            ...adminCookie,
            url: config.adminFront,
          },
    ]);
    if (adminAuth.csrfToken) {
      await context.addInitScript((csrfToken) => {
        window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
      }, adminAuth.csrfToken);
    }
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().includes("Failed to fetch RSC payload")
      ) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    return { browser, page, consoleErrors };
  }

  async function captureAdminLoginSuccess(adminAuth) {
    if (!enabled) return;
    const { browser, page, consoleErrors } = await openAdminContext(adminAuth);
    try {
      await page.goto(`${config.adminFront}/withdrawal-reviews`, {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      await page
        .getByText(/Withdrawal|提现|审核|Review/i)
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
      await screenshotAdmin(page, "01-admin-login-success", {
        expectedText: [/Withdrawal|提现|审核|Review/i],
        domCheckpoint:
          "admin session opens withdrawal reviews without login gate",
        apiCheckpoint: "adminAuthCheckpoints.login",
      });
      if (consoleErrors.length > 0) {
        throw new Error(
          `Admin login success page errors: ${consoleErrors
            .join(" | ")
            .slice(0, 800)}`
        );
      }
    } finally {
      await browser.close();
    }
  }

  async function captureReviewScreenshots(adminAuth, withdrawalId, prefix) {
    const { browser, page, consoleErrors } = await openAdminContext(adminAuth);
    try {
      await page.goto(
        `${config.adminFront}/withdrawal-reviews?q=${encodeURIComponent(
          withdrawalId
        )}`,
        { waitUntil: "networkidle", timeout: 45_000 }
      );
      await page
        .getByText(withdrawalId)
        .first()
        .waitFor({ state: "visible", timeout: 30_000 });
      const queueShot = await screenshotAdmin(page, `${prefix}-review-queue`, {
        expectedText: [withdrawalId],
        domCheckpoint: `${prefix} review queue contains withdrawal id`,
        apiCheckpoint: "withdrawal review list",
        dbCheckpoint: "db withdrawal row is PENDING_MANUAL_REVIEW",
      });
      if (enabled && prefix === "consumer-approve-before") {
        copyAdminScreenshotAlias(queueShot, "02-withdrawal-review-list", {
          url: page.url(),
          expectedText: [withdrawalId],
          domCheckpoint: "approve candidate visible in withdrawal review list",
          apiCheckpoint: "consumer approve fixture pending manual review",
          dbCheckpoint: "db withdrawal row is PENDING_MANUAL_REVIEW",
        });
      }
      await page
        .getByText(/Consumer withdrawal|Provider withdrawal/)
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => null);
      const row = page.locator("tr", { hasText: withdrawalId }).first();
      if (await row.count()) {
        const detail = row
          .getByRole("button", { name: /详情|Detail/i })
          .first();
        if (await detail.isVisible().catch(() => false)) await detail.click();
      }
      await page.waitForTimeout(500);
      await assertAdminModal(page, [withdrawalId, /Action Modal/i], prefix);
      const detailShot = await screenshotAdmin(
        page,
        `${prefix}-review-detail`,
        {
          expectedText: [withdrawalId],
          domCheckpoint: `${prefix} review detail contains withdrawal id`,
          apiCheckpoint: "withdrawal review detail",
          dbCheckpoint: "db withdrawal row is PENDING_MANUAL_REVIEW",
        }
      );
      if (enabled && prefix === "consumer-approve-before") {
        copyAdminScreenshotAlias(detailShot, "03-withdrawal-review-detail", {
          url: page.url(),
          expectedText: [withdrawalId],
          domCheckpoint: "approve candidate detail visible before decision",
          apiCheckpoint: "consumer approve fixture pending manual review",
          dbCheckpoint: "db withdrawal row is PENDING_MANUAL_REVIEW",
        });
        const approveButton = page
          .getByRole("button", { name: /Approve & Issue Ticket|确认放行/i })
          .first();
        if (await approveButton.isVisible().catch(() => false)) {
          await approveButton.click();
          await page
            .getByRole("button", { name: /等待验证码/i })
            .first()
            .waitFor({ state: "visible", timeout: 10_000 });
          const waitingButton = page
            .getByRole("button", { name: /等待验证码/i })
            .first();
          if (!(await waitingButton.isDisabled().catch(() => false))) {
            throw new Error("APPROVE_WAITING_BUTTON_NOT_DISABLED");
          }
          await page
            .getByText(/Google Authenticator 验证码|Step-up Verification/i)
            .first()
            .waitFor({ state: "visible", timeout: 10_000 });
          await screenshotAdmin(page, "04-otp-step-up", {
            expectedText: [/Google Authenticator 验证码|Step-up Verification/i],
            domCheckpoint: "high-risk approval opens OTP step-up modal",
            apiCheckpoint: "admin decision requires X-Admin-OTP-Code",
            dbCheckpoint: "db withdrawal row is PENDING_MANUAL_REVIEW",
          });
          await page
            .getByRole("button", { name: /取消|Cancel/i })
            .first()
            .click();
        } else {
          throw new Error("APPROVE_BUTTON_NOT_VISIBLE_FOR_OTP_SCREENSHOT");
        }
      }
      if (consoleErrors.length > 0) {
        throw new Error(
          `Admin console errors: ${consoleErrors.join(" | ").slice(0, 800)}`
        );
      }
    } finally {
      await browser.close();
    }
  }

  async function captureAdminApproveResult(adminAuth, withdrawalId) {
    if (!enabled) return;
    const { browser, page, consoleErrors } = await openAdminContext(adminAuth);
    try {
      await page.goto(
        `${config.adminFront}/withdrawal-reviews?q=${encodeURIComponent(
          withdrawalId
        )}`,
        { waitUntil: "networkidle", timeout: 45_000 }
      );
      await page.waitForTimeout(1_000);
      await screenshotAdmin(page, "05-approve-success", {
        expectedText: [/Withdrawal|提现|审核|Review/i],
        domCheckpoint:
          "approved withdrawal no longer blocks pending review workbench",
        apiCheckpoint: "consumerApprove decision returned 2xx",
        dbCheckpoint: "db withdrawal row status REQUESTED",
      });
      await page.goto(`${config.adminFront}/review-history`, {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      await page.waitForTimeout(1_000);
      await screenshotAdmin(page, "06-review-history", {
        expectedText: [/审核记录|Review|History|处理结论/i],
        forbiddenText: [
          "Admin Authentication",
          "Sign in to continue",
          "Unauthorized",
        ],
        domCheckpoint: "review history page loads after approval",
        apiCheckpoint: "review history expected to contain recent decision",
        dbCheckpoint: "db audit trail contains approve decision",
      });
      if (consoleErrors.length > 0) {
        throw new Error(
          `Admin post-decision page errors: ${consoleErrors
            .join(" | ")
            .slice(0, 800)}`
        );
      }
    } finally {
      await browser.close();
    }
  }

  return {
    captureAdminApproveResult,
    captureAdminLoginSuccess,
    captureReviewScreenshots,
    recordAdminAuthCheckpoint,
  };
}
