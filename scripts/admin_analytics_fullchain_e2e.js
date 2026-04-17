#!/usr/bin/env node
"use strict";

/**
 * Admin Analytics Full-Chain E2E Verification
 *
 * Preconditions:
 *   1. gateway, gateway-admin, admin-front, Kafka, and ClickHouse are running.
 *   2. Run gateway analytics full-chain e2e first so output/analytics-fullchain/report.json exists:
 *      cd services/gateway
 *      ANALYTICS_FULLCHAIN_E2E=true pytest tests/e2e/test_01_infrastructure.py \
 *        tests/e2e/test_02_wallet_auth.py tests/e2e/test_03_fund_wallet.py \
 *        tests/e2e/test_04_deposit.py tests/e2e/test_05_provider_register.py \
 *        tests/e2e/test_06_agent_credential.py tests/e2e/test_07_invoke.py \
 *        tests/e2e/test_08_analytics_fullchain.py -q
 *
 * Auth:
 *   - Preferred: ADMIN_SESSION_TOKEN=<synapse_admin_session cookie value>
 *   - Or: ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_OTP_CODE
 */

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const REPO_ROOT = (() => {
  let current = __dirname;
  for (let i = 0; i < 5; i += 1) {
    if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, "services"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
})();

const ADMIN_FRONT_URL = (process.env.ADMIN_FRONT_URL || "http://127.0.0.1:4000").replace(/\/$/, "");
const ADMIN_GATEWAY_URL = (process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300").replace(/\/$/, "");
const ADMIN_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const REPORT_PATH = path.resolve(
  REPO_ROOT,
  process.env.ANALYTICS_FULLCHAIN_REPORT || "output/analytics-fullchain/report.json",
);
const SCREENSHOT_DIR = path.resolve(
  REPO_ROOT,
  process.env.ANALYTICS_FULLCHAIN_SCREENSHOT_DIR || "output/analytics-fullchain/screens",
);

let passed = 0;
let failed = 0;

function ok(message) {
  passed += 1;
  console.log(`\x1b[32m✔ ${message}\x1b[0m`);
}

function fail(message) {
  failed += 1;
  console.log(`\x1b[31m✘ ${message}\x1b[0m`);
}

function check(message, condition) {
  if (condition) ok(message);
  else fail(message);
}

function readReport() {
  if (!fs.existsSync(REPORT_PATH)) {
    throw new Error(`Missing analytics full-chain report: ${REPORT_PATH}`);
  }
  return JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSessionCookie(setCookieHeader) {
  if (!setCookieHeader) return "";
  const parts = Array.isArray(setCookieHeader) ? setCookieHeader : String(setCookieHeader).split(/,(?=\s*[^;,]+=)/);
  const match = parts
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`));
  if (!match) return "";
  return match.split(";")[0].slice(ADMIN_COOKIE_NAME.length + 1);
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return {
      sessionToken: process.env.ADMIN_SESSION_TOKEN,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
    };
  }

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const otpCode = process.env.ADMIN_OTP_CODE;
  if (!email || !password) {
    throw new Error(
      "Admin auth missing. Set ADMIN_SESSION_TOKEN or ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_OTP_CODE.",
    );
  }

  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, otpCode }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !body.success || !sessionToken) {
    throw new Error(`Admin login failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return {
    sessionToken,
    csrfToken: body.data?.csrfToken || "",
  };
}

async function adminApiGet(pathname, auth) {
  const response = await fetch(`${ADMIN_GATEWAY_URL}${pathname}`, {
    headers: {
      "Content-Type": "application/json",
      Cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    throw new Error(`Admin API failed ${pathname}: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.data;
}

function assertAdminDataMatchesRaw(report, apiData) {
  const raw = report.rawInvocationSummary || {};
  const invocation = apiData.invocation;
  const overview = apiData.overview;
  const consumerFunnel = apiData.consumerFunnel;

  check(
    "admin invocation quoteCount matches ClickHouse raw summary",
    invocation.quoteCount === numberValue(raw.quoteCount),
  );
  check(
    "admin invocation invokeStartedCount matches ClickHouse raw summary",
    invocation.invokeStartedCount === numberValue(raw.invokeStartedCount),
  );
  check(
    "admin invocation invokeCompletedCount matches ClickHouse raw summary",
    invocation.invokeCompletedCount === numberValue(raw.invokeCompletedCount),
  );
  check(
    "admin invocation gmvUsdc matches ClickHouse raw summary",
    Math.abs(numberValue(invocation.gmvUsdc) - numberValue(raw.gmvUsdc)) < 0.000001,
  );
  check(
    "overview Paid Invokes card matches invocation drilldown",
    (overview.cards || []).some((card) => card.key === "invoke_completed" && card.value === invocation.invokeCompletedCount),
  );
  check(
    "consumer funnel includes invoke_completed users",
    (consumerFunnel.steps || []).some((step) => step.eventName === "invoke_completed" && step.users >= 1),
  );
}

async function screenshotPage(page, route, name, expectedText) {
  await page.goto(`${ADMIN_FRONT_URL}${route}`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);
  const bodyText = await page.textContent("body");
  check(`${name} renders expected title`, String(bodyText || "").includes(expectedText));
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  ok(`screenshot saved: ${filePath}`);
  return { route, filePath };
}

async function verifyAdminPages(auth, report, apiData) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
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

    const page = await context.newPage();
    const screenshots = [];
    screenshots.push(await screenshotPage(page, "/dashboard/analytics", "01-analytics-overview", "Analytics 总览"));
    screenshots.push(await screenshotPage(page, "/dashboard/analytics/consumer-funnel", "02-consumer-funnel", "Consumer 激活漏斗"));
    screenshots.push(await screenshotPage(page, "/dashboard/analytics/invocation-revenue", "03-invocation-revenue", "调用与收入"));
    screenshots.push(await screenshotPage(page, "/dashboard/analytics/provider-revenue", "04-provider-revenue", "Provider 收益"));
    screenshots.push(await screenshotPage(page, "/dashboard/analytics/money-flow", "05-money-flow", "资金流"));
    screenshots.push(await screenshotPage(page, "/dashboard/analytics/risk-health", "06-risk-health", "风控健康"));
    screenshots.push(await screenshotPage(page, "/dashboard/analytics/data-quality", "07-data-quality", "埋点质量"));

    await page.goto(`${ADMIN_FRONT_URL}/dashboard/analytics`, { waitUntil: "networkidle", timeout: 45000 });
    const overviewText = String(await page.textContent("body") || "").replaceAll(",", "");
    check(
      "Analytics overview displays backend invoke count",
      overviewText.includes(String(apiData.invocation.invokeCompletedCount)),
    );
    check(
      "Analytics overview displays full-chain service event context",
      (report.requiredEvents || []).includes("service_registered")
        && (report.requiredEvents || []).includes("provider_revenue_received"),
    );
    return screenshots;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Admin Analytics Full-Chain E2E");
  console.log("═══════════════════════════════════════════════════════\n");

  const report = readReport();
  check("gateway full-chain report succeeded", report.status === "success");

  const auth = await loginAdmin();
  ok("admin authenticated");

  const apiData = {
    overview: await adminApiGet("/api/admin/v1/dashboard/analytics/overview?window=24h", auth),
    consumerFunnel: await adminApiGet("/api/admin/v1/dashboard/analytics/consumer-funnel?window=24h", auth),
    invocation: await adminApiGet("/api/admin/v1/dashboard/analytics/invocation-revenue?window=24h", auth),
    providerRevenue: await adminApiGet("/api/admin/v1/dashboard/analytics/provider-revenue?window=24h", auth),
    moneyFlow: await adminApiGet("/api/admin/v1/dashboard/analytics/money-flow?window=24h", auth),
    riskHealth: await adminApiGet("/api/admin/v1/dashboard/analytics/risk-health?window=24h", auth),
    dataQuality: await adminApiGet("/api/admin/v1/dashboard/analytics/data-quality?window=24h", auth),
  };
  ok("admin analytics APIs loaded");

  assertAdminDataMatchesRaw(report, apiData);
  const screenshots = await verifyAdminPages(auth, report, apiData);

  const verificationPath = path.join(path.dirname(REPORT_PATH), "admin-page-verification.json");
  fs.writeFileSync(
    verificationPath,
    JSON.stringify(
      {
        status: failed === 0 ? "success" : "failed",
        verifiedAt: new Date().toISOString(),
        reportPath: REPORT_PATH,
        screenshots,
        adminInvocationRevenue: apiData.invocation,
        adminOverview: apiData.overview,
      },
      null,
      2,
    ),
  );
  ok(`verification report saved: ${verificationPath}`);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\x1b[31m✘ Fatal: ${error.message}\x1b[0m`);
  console.error(error);
  process.exit(1);
});
