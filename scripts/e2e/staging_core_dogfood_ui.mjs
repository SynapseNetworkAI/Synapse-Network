import { chromium } from "playwright";
import {
  addCheck,
  config,
  redact,
  screenshot,
} from "./staging_core_dogfood_runtime.mjs";

export async function captureUiEvidence(authState = null) {
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    if (authState?.sessionToken) {
      await context.addCookies([
        {
          name: config.adminCookieName,
          value: authState.sessionToken,
          url: config.adminFrontUrl,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      if (authState.csrfToken) {
        await context.addInitScript((csrfToken) => {
          window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
        }, authState.csrfToken);
      }
    }
    const page = await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    const responseErrors = [];
    const ignoredNetworkNoise = [];
    const isExpectedUiNetworkNoise = (item) => {
      const url = item.url || "";
      const failure = item.failure || "";
      const status = Number(item.status || 0);
      if (url.includes("/api/v1/events") && failure === "net::ERR_ABORTED") {
        return true;
      }
      if (url.includes("/api/admin/v1/auth/me") && status === 401) {
        return true;
      }
      return false;
    };
    page.on("console", (message) => {
      const text = redact(message.text()).slice(0, 600);
      if (
        message.type() === "error" &&
        !text.includes(
          "Failed to load resource: the server responded with a status of 401 ()"
        )
      ) {
        consoleErrors.push(text);
      } else if (message.type() === "error") {
        ignoredNetworkNoise.push({ type: "console", text });
      }
    });
    page.on("requestfailed", (request) => {
      const item = {
        url: redact(request.url()),
        failure: request.failure()?.errorText || "unknown",
      };
      if (isExpectedUiNetworkNoise(item)) {
        ignoredNetworkNoise.push({ type: "requestfailed", ...item });
      } else {
        failedRequests.push(item);
      }
    });
    page.on("response", (response) => {
      const item = { url: redact(response.url()), status: response.status() };
      if (item.status < 400) return;
      if (isExpectedUiNetworkNoise(item)) {
        ignoredNetworkNoise.push({ type: "response", ...item });
      } else {
        responseErrors.push(item);
      }
    });

    await page.goto(`${config.userFrontUrl}/dashboard/billing/credits`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    const userDepositShot = await screenshot(page, "user-deposit-entry");
    await page.goto(`${config.userFrontUrl}/dashboard/billing`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    const balanceBeforeShot = await screenshot(page, "user-balance-before");
    await page.goto(`${config.userFrontUrl}/dashboard/billing`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    await screenshot(page, "user-withdrawal-entry");
    await page.goto(`${config.userFrontUrl}/dashboard/overview`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    await screenshot(page, "user-overview");

    if (authState?.sessionToken) {
      await page.goto(`${config.adminFrontUrl}/withdrawal-reviews`, {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      await screenshot(page, "admin-review");
      await page.goto(`${config.adminFrontUrl}/audit`, {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      await screenshot(page, "admin-audit");
      await page.goto(`${config.adminFrontUrl}/finance/reconciliation`, {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      await screenshot(page, "reconciliation");
    }
    addCheck(
      "ui:screenshots",
      true,
      "captured staging user/admin screenshots",
      { screenshot: userDepositShot }
    );
    if (
      consoleErrors.length ||
      failedRequests.length ||
      responseErrors.length
    ) {
      addCheck(
        "ui:console-network",
        false,
        "browser reported console or network errors",
        {
          screenshot: balanceBeforeShot,
          expected: "No console errors or failed network requests.",
          actual: JSON.stringify({
            consoleErrors,
            failedRequests,
            responseErrors,
            ignoredNetworkNoise,
          }).slice(0, 1200),
        }
      );
    } else {
      addCheck(
        "ui:console-network",
        true,
        "no unexpected browser console or network errors",
        {
          actual: JSON.stringify({ ignoredNetworkNoise }).slice(0, 1200),
        }
      );
    }
  } finally {
    await browser.close();
  }
}

export async function capturePostMoneyUiEvidence(adminAuth = null) {
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    if (adminAuth?.sessionToken) {
      await context.addCookies([
        {
          name: config.adminCookieName,
          value: adminAuth.sessionToken,
          url: config.adminFrontUrl,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      if (adminAuth.csrfToken) {
        await context.addInitScript((csrfToken) => {
          window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
        }, adminAuth.csrfToken);
      }
    }
    const page = await context.newPage();
    await page.goto(`${config.userFrontUrl}/dashboard/billing`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    await screenshot(page, "user-balance-after");
    if (adminAuth?.sessionToken) {
      await page.goto(`${config.adminFrontUrl}/finance/reconciliation`, {
        waitUntil: "networkidle",
        timeout: 45_000,
      });
      await screenshot(page, "reconciliation-after");
    }
    addCheck(
      "ui:post-money-screenshots",
      true,
      "captured post-money balance/reconciliation screenshots"
    );
  } finally {
    await browser.close();
  }
}
