#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = (() => {
  let current = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  for (let i = 0; i < 4; i += 1) {
    if (fs.existsSync(path.join(current, "package.json")) && fs.existsSync(path.join(current, "services"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
})();

const FIXTURE_PATH = path.resolve(process.env.ADMIN_ANALYTICS_LOAD_FIXTURE || findLatestFixture());
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
const OUT_DIR = path.resolve(process.env.ADMIN_ANALYTICS_LOAD_OUTPUT_DIR || fixture.outputDir || path.dirname(FIXTURE_PATH));
const RECONCILE_REPORT = path.resolve(process.env.ADMIN_ANALYTICS_LOAD_REPORT || path.join(OUT_DIR, "report.json"));
const SCREENSHOT_DIR = path.join(OUT_DIR, "screens");
const ADMIN_FRONT_URL = (process.env.ADMIN_FRONT_URL || "http://localhost:4000").replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300").replace(/\/+$/, "");
const ADMIN_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";

let passed = 0;
let failed = 0;
const checks = [];
const screenshots = [];
const consoleErrors = [];

function findLatestFixture() {
  const base = path.resolve(ROOT, "output/analytics-load");
  if (!fs.existsSync(base)) {
    throw new Error("No analytics load output found. Set ADMIN_ANALYTICS_LOAD_FIXTURE or run admin_analytics_10k_fullchain.mjs first.");
  }
  const candidates = fs.readdirSync(base)
    .map((name) => path.join(base, name, "fixture.json"))
    .filter((candidate) => fs.existsSync(candidate))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!candidates.length) {
    throw new Error("No analytics load fixture found. Set ADMIN_ANALYTICS_LOAD_FIXTURE.");
  }
  return candidates[0];
}

function ok(name, detail = "") {
  passed += 1;
  checks.push({ name, passed: true, detail });
  console.log(`\x1b[32m✔ ${name}${detail ? `: ${detail}` : ""}\x1b[0m`);
}

function fail(name, detail = "") {
  failed += 1;
  checks.push({ name, passed: false, detail });
  console.log(`\x1b[31m✘ ${name}${detail ? `: ${detail}` : ""}\x1b[0m`);
}

function check(name, condition, detail = "") {
  if (condition) ok(name, detail);
  else fail(name, detail);
}

function parseSessionCookie(setCookieHeader) {
  if (!setCookieHeader) return "";
  const parts = Array.isArray(setCookieHeader) ? setCookieHeader : String(setCookieHeader).split(/,(?=\s*[^;,]+=)/);
  const match = parts.map((item) => item.trim()).find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`));
  return match ? match.split(";")[0].slice(ADMIN_COOKIE_NAME.length + 1) : "";
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return { sessionToken: process.env.ADMIN_SESSION_TOKEN, csrfToken: process.env.ADMIN_CSRF_TOKEN || "" };
  }
  const email = process.env.ADMIN_EMAIL || "super@synapse.network";
  const password = process.env.ADMIN_PASSWORD || "qwer@1234";
  const otpCode = process.env.ADMIN_OTP_CODE;
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, otpCode }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : response.headers.get("set-cookie");
  const sessionToken = parseSessionCookie(setCookie);
  if (!response.ok || !body.success || !sessionToken) {
    throw new Error(`Admin login failed. Set ADMIN_SESSION_TOKEN if local password/MFA is unavailable. ${response.status} ${JSON.stringify(body)}`);
  }
  return { sessionToken, csrfToken: body.data?.csrfToken || "" };
}

async function screenshot(page, name) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push({ name, path: filePath });
  ok(`screenshot saved ${name}`, filePath);
}

async function waitForBodyText(page, expectedText, timeout = 30000) {
  await page.waitForFunction(
    (text) => document.body && document.body.innerText.includes(text),
    expectedText,
    { timeout },
  );
}

async function waitForAdminAppRendered(page, expectedText, timeout = 60000) {
  await page.waitForFunction(
    (text) => {
      const bodyText = document.body?.innerText || "";
      const appRoot = [...document.body.children].find((element) => {
        const tagName = element.tagName.toLowerCase();
        if (tagName === "script" || tagName === "style" || tagName === "next-route-announcer") {
          return false;
        }
        return (element.textContent || "").trim().length > 0;
      });
      return Boolean(appRoot && bodyText.includes(text));
    },
    expectedText,
    { timeout },
  );
}

function importantValues(report) {
  const api = report.adminApi || {};
  return {
    overview: [
      String(report.expected?.totalCalls || ""),
      String(report.expected?.expectedGmvUsdc || "").replace(/\.000000$/, ""),
      String(api.invocationRevenue?.invokeCompletedCount || ""),
      String(api.overview?.cards?.find((card) => card.key === "gmv_usdc")?.value || ""),
    ].filter(Boolean),
    consumerFunnel: [
      String(api.consumerFunnel?.steps?.find((step) => step.eventName === "quote_generated")?.events || ""),
      String(api.consumerFunnel?.steps?.find((step) => step.eventName === "invoke_started")?.events || ""),
      String(api.consumerFunnel?.steps?.find((step) => step.eventName === "invoke_completed")?.events || ""),
      String(api.consumerFunnel?.steps?.find((step) => step.eventName === "page_viewed")?.users || ""),
    ].filter(Boolean),
    invocationRevenue: [
      String(api.invocationRevenue?.quoteCount || ""),
      String(api.invocationRevenue?.invokeStartedCount || ""),
      String(api.invocationRevenue?.invokeCompletedCount || ""),
      String(api.invocationRevenue?.gmvUsdc || ""),
    ].filter(Boolean),
    providerRevenue: [
      String(api.providerRevenue?.providerGrossUsdc || ""),
      String(api.providerRevenue?.providerNetUsdc || ""),
      String(api.providerRevenue?.revenueProviderCount || ""),
    ].filter(Boolean),
    moneyFlow: [
      String(api.moneyFlow?.depositUsdc || ""),
      String(api.moneyFlow?.depositFailedCount || ""),
      String(api.moneyFlow?.withdrawalUsdc || ""),
      String(api.moneyFlow?.refundUsdc || ""),
    ].filter(Boolean),
    riskHealth: [
      String(api.riskHealth?.criticalRiskEvents || ""),
      String(api.riskHealth?.providerHealthDegradedCount || ""),
      String(api.riskHealth?.budgetGapUsdc || ""),
    ].filter(Boolean),
    dataQuality: [
      String(api.dataQuality?.eventCount || ""),
      String(api.dataQuality?.privacyViolations || ""),
      String(api.dataQuality?.missingRequiredProperties || ""),
    ].filter(Boolean),
  };
}

function comparableNumber(value) {
  if (value === null || value === undefined || value === "n/a") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function domCandidates(value) {
  const parsed = comparableNumber(value);
  if (parsed === null) {
    return [];
  }
  const raw = String(value).replaceAll(",", "");
  const candidates = new Set([
    raw,
    raw.replace(/\.000000$/, ""),
    raw.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""),
    parsed.toFixed(6),
    parsed.toFixed(4),
    parsed.toFixed(2),
    String(Math.trunc(parsed)),
  ]);
  return [...candidates].filter(Boolean);
}

function pageBodyKey(pageName) {
  const map = {
    "Analytics 总览": "overview",
    "Consumer 激活漏斗": "consumerFunnel",
    "调用与收入": "invocationRevenue",
    "Provider 收益": "providerRevenue",
    "资金流": "moneyFlow",
    "风控健康": "riskHealth",
    "埋点质量": "dataQuality",
  };
  return map[pageName] || "";
}

function updatePageComparisonsWithDom(report, pageBodies) {
  const rows = Array.isArray(report.pageComparisons) ? report.pageComparisons : [];
  for (const row of rows) {
    const body = String(pageBodies[pageBodyKey(row.page)] || "").replaceAll(",", "");
    const candidates = domCandidates(row.adminApiActual);
    if (!candidates.length) {
      row.adminFrontActual = "not_asserted";
      continue;
    }
    const matched = candidates.find((candidate) => body.includes(candidate));
    row.adminFrontActual = matched || "missing";
    row.pass = Boolean(row.pass && matched);
    check(`DOM displays ${row.page} / ${row.metricName}`, Boolean(matched), matched || `missing ${candidates.slice(0, 4).join(", ")}`);
  }
  return rows;
}

function markdownComparisonTables(pageComparisons) {
  const pages = [...new Set(pageComparisons.map((row) => row.page))];
  const sections = [];
  for (const page of pages) {
    const rows = pageComparisons.filter((row) => row.page === page);
    sections.push(
      `## ${page}`,
      "",
      "| Result | Metric | Expected from fixture | ClickHouse actual | Admin API actual | Admin Front actual |",
      "| --- | --- | --- | --- | --- | --- |",
      ...rows.map((row) => `| ${row.pass ? "PASS" : "FAIL"} | ${row.metricName} | ${String(row.expectedFromFixture ?? "").replace(/\|/g, "\\|")} | ${String(row.clickHouseActual ?? "").replace(/\|/g, "\\|")} | ${String(row.adminApiActual ?? "").replace(/\|/g, "\\|")} | ${String(row.adminFrontActual ?? "").replace(/\|/g, "\\|")} |`),
      "",
    );
  }
  return sections.join("\n");
}

async function expectPage(page, route, title, screenshotName, values = []) {
  await page.goto(`${ADMIN_FRONT_URL}${route}`, { waitUntil: "networkidle", timeout: 60000 });
  await waitForAdminAppRendered(page, title);
  const body = String(await page.textContent("body") || "").replaceAll(",", "");
  check(`${route} renders ${title}`, body.includes(title), body.slice(0, 160));
  const normalizedValues = values.map((value) => String(value).replaceAll(",", "").replace(/\.000000$/, "")).filter((value) => value && value !== "0");
  if (normalizedValues.length) {
    const matched = normalizedValues.find((value) => body.includes(value));
    check(`${route} displays backend/reconcile value`, Boolean(matched), `checked ${normalizedValues.slice(0, 4).join(", ")}`);
  }
  await screenshot(page, screenshotName);
  return body;
}

async function clickWindowSwitchers(page) {
  await page.goto(`${ADMIN_FRONT_URL}/dashboard/analytics`, { waitUntil: "networkidle", timeout: 60000 });
  await waitForAdminAppRendered(page, "Analytics 总览");
  for (const windowValue of ["7d", "30d", "24h"]) {
    await page.getByRole("button", { name: windowValue, exact: true }).click();
    await page.waitForTimeout(300);
    const body = String(await page.textContent("body") || "");
    check(`window switcher ${windowValue} keeps overview rendered`, body.includes("Analytics 总览"));
  }
  await screenshot(page, "08-window-switchers");
}

async function clickDrilldowns(page) {
  const routes = [
    ["consumer", "/dashboard/analytics/consumer-funnel", "Consumer 激活漏斗"],
    ["invocation", "/dashboard/analytics/invocation-revenue", "调用与收入"],
    ["provider", "/dashboard/analytics/provider-revenue", "Provider 收益"],
    ["money", "/dashboard/analytics/money-flow", "资金流"],
    ["risk", "/dashboard/analytics/risk-health", "风控健康"],
    ["quality", "/dashboard/analytics/data-quality", "埋点质量"],
  ];
  for (const [key, route, title] of routes) {
    await page.goto(`${ADMIN_FRONT_URL}/dashboard/analytics`, { waitUntil: "networkidle", timeout: 60000 });
    await waitForAdminAppRendered(page, "Analytics 总览");
    await page.getByTestId(`analytics-drilldown-${key}`).click();
    await page.waitForURL((url) => url.pathname === route, { timeout: 30000 });
    await waitForAdminAppRendered(page, title);
    const body = String(await page.textContent("body") || "");
    check(`drilldown card navigates to ${route}`, body.includes(title));
  }
  await screenshot(page, "09-drilldown-card-clicks");
}

async function clickBudgetAlert(page, report) {
  const alerts = report.adminApi?.overview?.alerts || [];
  const hasBudgetAlert = alerts.some((alert) => String(alert.title || "").toLowerCase().includes("budget"));
  if (!hasBudgetAlert) {
    ok("budget alert drilldown skipped because current overview has no budget alert");
    return;
  }
  await page.goto(`${ADMIN_FRONT_URL}/dashboard/analytics`, { waitUntil: "networkidle", timeout: 60000 });
  await waitForAdminAppRendered(page, "Analytics 总览");
  await page.getByTestId("analytics-alert-budget-blocks").click();
  await page.waitForURL((url) => url.pathname === "/dashboard/analytics/risk-health" && url.searchParams.get("focus") === "budget_blocked", { timeout: 30000 });
  await waitForAdminAppRendered(page, "风控健康");
  const body = String(await page.textContent("body") || "");
  check("budget alert navigates to focused risk-health panel", body.includes("Focused from alert") || body.includes("Budget blocked breakdown"));
  await screenshot(page, "10-budget-block-alert-drilldown");
}

async function main() {
  if (!fs.existsSync(RECONCILE_REPORT)) {
    throw new Error(`Missing reconcile report: ${RECONCILE_REPORT}. Run admin_analytics_10k_reconcile.mjs first.`);
  }
  const report = JSON.parse(fs.readFileSync(RECONCILE_REPORT, "utf8"));
  check("reconcile report succeeded before browser dogfood", report.status === "success", report.status);
  const values = importantValues(report);
  const auth = await loginAdmin();
  ok("admin authenticated");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.on("page", (newPage) => {
      newPage.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
    });
    await context.addCookies([{ name: ADMIN_COOKIE_NAME, value: auth.sessionToken, url: ADMIN_FRONT_URL, httpOnly: true, sameSite: "Lax" }]);
    if (auth.csrfToken) {
      await context.addInitScript((csrfToken) => {
        window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
      }, auth.csrfToken);
    }
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    const pageBodies = {};
    pageBodies.overview = await expectPage(page, "/dashboard/analytics", "Analytics 总览", "01-analytics-overview", values.overview);
    pageBodies.consumerFunnel = await expectPage(page, "/dashboard/analytics/consumer-funnel", "Consumer 激活漏斗", "02-consumer-funnel", values.consumerFunnel);
    pageBodies.invocationRevenue = await expectPage(page, "/dashboard/analytics/invocation-revenue", "调用与收入", "03-invocation-revenue", values.invocationRevenue);
    pageBodies.providerRevenue = await expectPage(page, "/dashboard/analytics/provider-revenue", "Provider 收益", "04-provider-revenue", values.providerRevenue);
    pageBodies.moneyFlow = await expectPage(page, "/dashboard/analytics/money-flow", "资金流", "05-money-flow", values.moneyFlow);
    pageBodies.riskHealth = await expectPage(page, "/dashboard/analytics/risk-health", "风控健康", "06-risk-health", values.riskHealth);
    pageBodies.dataQuality = await expectPage(page, "/dashboard/analytics/data-quality", "埋点质量", "07-data-quality", values.dataQuality);
    report.pageComparisons = updatePageComparisonsWithDom(report, pageBodies);
    await clickWindowSwitchers(page);
    await clickDrilldowns(page);
    await clickBudgetAlert(page, report);
  } finally {
    await browser.close();
  }

  check("browser console has no uncaught errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  const verification = {
    status: failed === 0 ? "success" : "failed",
    generatedAt: new Date().toISOString(),
    fixturePath: FIXTURE_PATH,
    reconcileReport: RECONCILE_REPORT,
    adminFrontUrl: ADMIN_FRONT_URL,
    checks,
    pageComparisons: report.pageComparisons || [],
    screenshots,
    consoleErrors,
  };
  const outputPath = path.join(OUT_DIR, "admin-page-verification.json");
  fs.writeFileSync(outputPath, JSON.stringify(verification, null, 2));
  const mdPath = path.join(OUT_DIR, "admin-page-verification.md");
  fs.writeFileSync(mdPath, [
    "# Admin Analytics Browser Dogfood Verification",
    "",
    `- Status: ${verification.status}`,
    `- Generated at: ${verification.generatedAt}`,
    `- Fixture: ${FIXTURE_PATH}`,
    `- Reconcile report: ${RECONCILE_REPORT}`,
    "",
    "# Page Comparisons",
    "",
    markdownComparisonTables(report.pageComparisons || []),
    "",
    "# Screenshots",
    "",
    ...screenshots.map((shot) => `- ${shot.name}: ${shot.path}`),
  ].join("\n"));
  console.log(`[INFO] wrote ${outputPath}`);
  console.log(`[INFO] wrote ${mdPath}`);
  console.log(`[INFO] results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[dogfood-admin-analytics-10k] fatal: ${error.stack || error.message || String(error)}`);
  process.exit(1);
});
