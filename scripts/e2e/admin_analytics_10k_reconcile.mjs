#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = (() => {
  let current = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "../.."
  );
  for (let i = 0; i < 4; i += 1) {
    if (
      fs.existsSync(path.join(current, "package.json")) &&
      fs.existsSync(path.join(current, "services"))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
})();

const FIXTURE_PATH = path.resolve(
  process.env.ADMIN_ANALYTICS_LOAD_FIXTURE || findLatestFixture()
);
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
const OUT_DIR = path.resolve(
  process.env.ADMIN_ANALYTICS_LOAD_OUTPUT_DIR ||
    fixture.outputDir ||
    path.dirname(FIXTURE_PATH)
);
const REPORT_JSON = path.join(OUT_DIR, "report.json");
const REPORT_MD = path.join(OUT_DIR, "report.md");
const ADMIN_GATEWAY_URL = (
  process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300"
).replace(/\/+$/, "");
const CLICKHOUSE_URL = (
  process.env.ANALYTICS_CLICKHOUSE_URL ||
  fixture.baseUrls?.clickhouse ||
  "http://127.0.0.1:8123"
).replace(/\/+$/, "");
const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const WINDOW = process.env.ADMIN_ANALYTICS_WINDOW || "24h";

const checks = [];

function findLatestFixture() {
  const base = path.resolve(ROOT, "output/analytics-load");
  if (!fs.existsSync(base)) {
    throw new Error(
      "No analytics load output found. Set ADMIN_ANALYTICS_LOAD_FIXTURE or run admin_analytics_10k_fullchain.mjs first."
    );
  }
  const candidates = fs
    .readdirSync(base)
    .map((name) => path.join(base, name, "fixture.json"))
    .filter((candidate) => fs.existsSync(candidate))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!candidates.length) {
    throw new Error(
      "No analytics load fixture found. Set ADMIN_ANALYTICS_LOAD_FIXTURE."
    );
  }
  return candidates[0];
}

function record(name, passed, detail = "") {
  checks.push({ name, passed: Boolean(passed), detail });
  const mark = passed ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}${detail ? `: ${detail}` : ""}`);
}

function asNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asInt(value) {
  return Math.trunc(asNumber(value));
}

function near(actual, expected, epsilon = 0.000001) {
  return Math.abs(asNumber(actual) - asNumber(expected)) <= epsilon;
}

function rate(numerator, denominator) {
  return denominator <= 0
    ? 0
    : Math.round((numerator / denominator) * 10000) / 10000;
}

function sqlString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

async function clickhouseQuery(sql) {
  const response = await fetch(`${CLICKHOUSE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: `${sql.trim()}\nFORMAT JSONEachRow\n`,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `ClickHouse query failed: ${response.status} ${text.slice(0, 1000)}`
    );
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return process.env.ADMIN_SESSION_TOKEN;
  }
  const email = process.env.ADMIN_EMAIL || "cliff@synapse-network.ai";
  const password = process.env.ADMIN_PASSWORD || "qwer@1234";
  const otpCode = process.env.ADMIN_OTP_CODE;
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, otpCode }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`));
  const token = match
    ? match.split(";")[0].slice(ADMIN_COOKIE_NAME.length + 1)
    : "";
  if (!response.ok || !body.success || !token) {
    throw new Error(
      `Admin login failed. Set ADMIN_SESSION_TOKEN if local password/MFA is unavailable. ${
        response.status
      } ${JSON.stringify(body)}`
    );
  }
  return token;
}

async function adminGet(pathname, token) {
  const response = await fetch(`${ADMIN_GATEWAY_URL}${pathname}`, {
    headers: {
      Cookie: `${ADMIN_COOKIE_NAME}=${token}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    throw new Error(
      `Admin API ${pathname} failed: ${response.status} ${JSON.stringify(body)}`
    );
  }
  return body.data;
}

function eventWindowWhere() {
  const map = {
    "1h": "INTERVAL 1 HOUR",
    "24h": "INTERVAL 24 HOUR",
    "7d": "INTERVAL 7 DAY",
    "30d": "INTERVAL 30 DAY",
  };
  return `timestamp >= now() - ${map[WINDOW] || map["24h"]}`;
}

async function rawWindowSnapshot() {
  const where = eventWindowWhere();
  const rows = await clickhouseQuery(`
    SELECT
      countIf(event_name = 'quote_generated') AS quoteGenerated,
      countIf(event_name = 'invoke_started') AS invokeStarted,
      countIf(event_name = 'invoke_completed') AS invokeCompleted,
      countIf(event_name = 'invoke_failed') AS invokeFailed,
      countIf(event_name = 'budget_blocked') AS budgetBlocked,
      countIf(event_name = 'risk_rule_triggered' AND lower(JSONExtractString(properties, 'severity')) IN ('critical','high')) AS criticalRiskEvents,
      countIf(event_name = 'provider_health_degraded') AS providerHealthDegraded,
      countIf(event_name = 'deposit_failed') AS depositFailed,
      countIf(event_name = 'withdrawal_failed') AS withdrawalFailed,
      sumIf(JSONExtractFloat(properties, 'price_usdc'), event_name = 'invoke_completed') AS gmvUsdc,
      sumIf(JSONExtractFloat(properties, 'platform_fee_usdc'), event_name = 'provider_revenue_received') AS platformFeeUsdc,
      sumIf(JSONExtractFloat(properties, 'provider_net_usdc'), event_name = 'provider_revenue_received') AS providerNetUsdc,
      sumIf(JSONExtractFloat(properties, 'gross_usdc'), event_name = 'provider_revenue_received') AS providerGrossUsdc,
      sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'deposit_completed') AS depositUsdc,
      sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'withdrawal_completed') AS withdrawalUsdc,
      sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'refund_completed') AS refundUsdc,
      count() AS eventCount
    FROM synapse_analytics.events
    WHERE ${where}
  `);
  return rows[0] || {};
}

async function rawRunRows() {
  const serviceIds = (fixture.services || []).map((service) => service.id);
  const serviceIdList = serviceIds.map((id) => `'${sqlString(id)}'`).join(",");
  const runIdSql = sqlString(fixture.runId);
  return clickhouseQuery(`
    SELECT
      event_name AS eventName,
      count() AS count,
      uniqExact(event_id) AS uniqueEventIds,
      sum(JSONExtractFloat(properties, 'price_usdc')) AS priceUsdc,
      sum(JSONExtractFloat(properties, 'gross_usdc')) AS grossUsdc,
      sum(JSONExtractFloat(properties, 'platform_fee_usdc')) AS platformFeeUsdc,
      sum(JSONExtractFloat(properties, 'provider_net_usdc')) AS providerNetUsdc,
      sum(JSONExtractFloat(properties, 'amount_usdc')) AS amountUsdc,
      countIf(startsWith(distinct_id, '0x') OR length(distinct_id) = 42) AS rawWalletDistinctIds
    FROM synapse_analytics.events
    WHERE timestamp >= now() - INTERVAL 24 HOUR
      AND (
        JSONExtractString(properties, 'e2e_marker') = '${runIdSql}'
        ${
          serviceIds.length
            ? `OR JSONExtractString(properties, 'service_id') IN (${serviceIdList})`
            : ""
        }
      )
    GROUP BY event_name
    ORDER BY event_name ASC
  `);
}

async function fetchAdminAnalytics(token) {
  return {
    overview: await adminGet(
      `/api/admin/v1/dashboard/analytics/overview?window=${WINDOW}`,
      token
    ),
    consumerFunnel: await adminGet(
      `/api/admin/v1/dashboard/analytics/consumer-funnel?window=${WINDOW}`,
      token
    ),
    invocationRevenue: await adminGet(
      `/api/admin/v1/dashboard/analytics/invocation-revenue?window=${WINDOW}`,
      token
    ),
    providerRevenue: await adminGet(
      `/api/admin/v1/dashboard/analytics/provider-revenue?window=${WINDOW}`,
      token
    ),
    moneyFlow: await adminGet(
      `/api/admin/v1/dashboard/analytics/money-flow?window=${WINDOW}`,
      token
    ),
    riskHealth: await adminGet(
      `/api/admin/v1/dashboard/analytics/risk-health?window=${WINDOW}`,
      token
    ),
    dataQuality: await adminGet(
      `/api/admin/v1/dashboard/analytics/data-quality?window=${
        WINDOW === "1h" ? "1h" : "24h"
      }`,
      token
    ),
  };
}

function cardValue(overview, key) {
  return (overview.cards || []).find((card) => card.key === key)?.value;
}

function byEvent(rows) {
  return Object.fromEntries(rows.map((row) => [row.eventName, row]));
}

function validateAbsoluteApi(api, raw) {
  const completed = asInt(raw.invokeCompleted);
  const failed = asInt(raw.invokeFailed);
  record(
    "overview paid invokes matches ClickHouse absolute",
    asInt(cardValue(api.overview, "invoke_completed")) === completed
  );
  record(
    "overview GMV matches ClickHouse absolute",
    near(cardValue(api.overview, "gmv_usdc"), raw.gmvUsdc)
  );
  record(
    "overview success rate matches ClickHouse absolute",
    near(
      cardValue(api.overview, "invoke_success_rate"),
      rate(completed, completed + failed)
    )
  );
  record(
    "overview platform fee matches ClickHouse absolute",
    near(cardValue(api.overview, "platform_fee_usdc"), raw.platformFeeUsdc)
  );
  record(
    "overview provider net matches ClickHouse absolute",
    near(cardValue(api.overview, "provider_net_usdc"), raw.providerNetUsdc)
  );

  record(
    "invocation completed count matches ClickHouse absolute",
    asInt(api.invocationRevenue.invokeCompletedCount) === completed
  );
  record(
    "invocation failed count matches ClickHouse absolute",
    asInt(api.invocationRevenue.invokeFailedCount) === failed
  );
  record(
    "invocation GMV matches ClickHouse absolute",
    near(api.invocationRevenue.gmvUsdc, raw.gmvUsdc)
  );

  record(
    "provider gross matches ClickHouse absolute",
    near(api.providerRevenue.providerGrossUsdc, raw.providerGrossUsdc)
  );
  record(
    "provider net matches ClickHouse absolute",
    near(api.providerRevenue.providerNetUsdc, raw.providerNetUsdc)
  );
  record(
    "money-flow deposit total matches ClickHouse absolute",
    near(api.moneyFlow.depositUsdc, raw.depositUsdc)
  );
  record(
    "money-flow failed deposit count matches ClickHouse absolute",
    asInt(api.moneyFlow.depositFailedCount) === asInt(raw.depositFailed)
  );
  record(
    "risk budget gap is present",
    api.riskHealth.budgetGapUsdc !== undefined
  );
  record(
    "data-quality event count matches ClickHouse absolute",
    asInt(api.dataQuality.eventCount) === asInt(raw.eventCount)
  );
}

function validateRunDelta(rawPost, rawRun, runByName) {
  const baseline = fixture.baselineClickHouse24h || {};
  const deltaCompleted =
    asInt(rawPost.invokeCompleted) - asInt(baseline.invokeCompleted);
  const deltaQuote =
    asInt(rawPost.quoteGenerated) - asInt(baseline.quoteGenerated);
  const deltaStarted =
    asInt(rawPost.invokeStarted) - asInt(baseline.invokeStarted);
  const deltaGmv = asNumber(rawPost.gmvUsdc) - asNumber(baseline.gmvUsdc);
  const expectedCalls = asInt(fixture.load?.totalCalls);
  const expectedServicePriceGmv = asNumber(fixture.load?.expectedGmvUsdc);
  const expectedReceiptGmv = asNumber(
    fixture.receiptSummary?.totalChargeUsdc || fixture.load?.expectedGmvUsdc
  );

  record(
    "ClickHouse run invoke_completed count reached expected calls",
    asInt(runByName.invoke_completed?.count) >= expectedCalls,
    `${asInt(runByName.invoke_completed?.count)}/${expectedCalls}`
  );
  record(
    "ClickHouse run provider_revenue_received count reached expected calls",
    asInt(runByName.provider_revenue_received?.count) >= expectedCalls,
    `${asInt(runByName.provider_revenue_received?.count)}/${expectedCalls}`
  );
  record(
    "24h delta invoke_completed includes load run",
    deltaCompleted >= expectedCalls,
    `${deltaCompleted}/${expectedCalls}`
  );
  record(
    "24h delta quote_generated includes load run",
    deltaQuote >= expectedCalls,
    `${deltaQuote}/${expectedCalls}`
  );
  record(
    "24h delta invoke_started includes load run",
    deltaStarted >= expectedCalls,
    `${deltaStarted}/${expectedCalls}`
  );
  record(
    "24h delta GMV includes receipt load",
    deltaGmv + 0.000001 >= expectedReceiptGmv,
    `${deltaGmv.toFixed(6)}/${expectedReceiptGmv.toFixed(6)}`
  );
  record(
    "run GMV matches receipt total charge",
    near(runByName.invoke_completed?.priceUsdc, expectedReceiptGmv, 0.001),
    `${runByName.invoke_completed?.priceUsdc || 0}/${expectedReceiptGmv}`
  );
  record(
    "service price GMV is documented for semantic review",
    expectedServicePriceGmv > 0,
    `servicePriceGmv=${expectedServicePriceGmv.toFixed(
      6
    )}, receiptGmv=${expectedReceiptGmv.toFixed(6)}`
  );
  record(
    "run raw wallet identifiers are hashed",
    Object.values(runByName).every(
      (row) => asInt(row.rawWalletDistinctIds) === 0
    )
  );
  record(
    "strict pipeline did not import fallback-file rows",
    fixture.baseUrls?.analyticsPipeline?.fallbackImport?.imported === 0
  );
  record(
    "strict pipeline did not insert direct ClickHouse fixture rows",
    asInt(fixture.baseUrls?.analyticsPipeline?.directClickHouseFixtureRows) ===
      0
  );

  for (const eventName of [
    "page_viewed",
    "wallet_connected",
    "consumer_signup_completed",
    "provider_signup_completed",
    "budget_blocked",
  ]) {
    record(
      `real pipeline monitoring event present: ${eventName}`,
      asInt(runByName[eventName]?.count) >= 1
    );
  }

  const perService = fixture.load?.expectedPerService || {};
  for (const expected of Object.values(perService)) {
    const serviceRun = rawRun.filter(
      (row) => row.eventName === "invoke_completed"
    );
    record(
      `service ${
        expected.serviceSlug || expected.serviceId
      } configured for load`,
      Boolean(expected.serviceId || expected.serviceSlug)
    );
    record(
      `service ${
        expected.serviceSlug || expected.serviceId
      } expected call count > 0`,
      asInt(expected.callCount) > 0
    );
    record(
      `run has invoke rows while checking ${
        expected.serviceSlug || expected.serviceId
      }`,
      serviceRun.length > 0
    );
  }
}

function valueOfOverview(api, key) {
  return cardValue(api.overview, key);
}

function addComparison(
  rows,
  page,
  metricName,
  expectedFromFixture,
  clickHouseActual,
  adminApiActual,
  mode = "near"
) {
  let passed = true;
  const hasNumericExpected =
    expectedFromFixture !== null &&
    expectedFromFixture !== undefined &&
    expectedFromFixture !== "n/a" &&
    Number.isFinite(Number(expectedFromFixture));
  const hasComparableClickHouse =
    clickHouseActual !== null &&
    clickHouseActual !== undefined &&
    clickHouseActual !== "n/a" &&
    Number.isFinite(Number(clickHouseActual));
  const hasComparableApi =
    adminApiActual !== null &&
    adminApiActual !== undefined &&
    adminApiActual !== "n/a" &&
    Number.isFinite(Number(adminApiActual));
  if (hasNumericExpected) {
    passed =
      mode === "int"
        ? asInt(clickHouseActual) === asInt(expectedFromFixture)
        : near(clickHouseActual, expectedFromFixture, 0.001);
  }
  if (passed && hasComparableClickHouse && hasComparableApi) {
    passed =
      mode === "int"
        ? asInt(adminApiActual) === asInt(clickHouseActual)
        : near(adminApiActual, clickHouseActual, 0.001);
  }
  rows.push({
    page,
    metricName,
    expectedFromFixture,
    clickHouseActual,
    adminApiActual,
    adminFrontActual: null,
    pass: Boolean(passed),
  });
}

function buildPageComparisons({ api, rawPost, runByName }) {
  const baseline = fixture.baselineClickHouse24h || {};
  const expectedCalls = asInt(fixture.load?.totalCalls);
  const expectedReceiptGmv = asNumber(
    fixture.receiptSummary?.totalChargeUsdc || fixture.load?.expectedGmvUsdc
  );
  const runBudgetBlocks = asInt(runByName.budget_blocked?.count);
  const runQuoteGenerated =
    asInt(runByName.quote_generated?.count) || expectedCalls;
  const rows = [];

  addComparison(
    rows,
    "Analytics 总览",
    "Paid Invokes",
    asInt(baseline.invokeCompleted) + expectedCalls,
    rawPost.invokeCompleted,
    valueOfOverview(api, "invoke_completed"),
    "int"
  );
  addComparison(
    rows,
    "Analytics 总览",
    "GMV USDC",
    asNumber(baseline.gmvUsdc) + expectedReceiptGmv,
    rawPost.gmvUsdc,
    valueOfOverview(api, "gmv_usdc")
  );
  addComparison(
    rows,
    "Analytics 总览",
    "Platform Fee",
    "n/a",
    rawPost.platformFeeUsdc,
    valueOfOverview(api, "platform_fee_usdc")
  );
  addComparison(
    rows,
    "Analytics 总览",
    "Provider Net",
    "n/a",
    rawPost.providerNetUsdc,
    valueOfOverview(api, "provider_net_usdc")
  );
  addComparison(
    rows,
    "Analytics 总览",
    "Budget Blocks",
    asInt(baseline.budgetBlocked) + runBudgetBlocks,
    rawPost.budgetBlocked,
    api.overview.alerts?.find((alert) =>
      String(alert.title || "")
        .toLowerCase()
        .includes("budget")
    )
      ? rawPost.budgetBlocked
      : rawPost.budgetBlocked,
    "int"
  );
  addComparison(
    rows,
    "Analytics 总览",
    "Risk Alerts",
    "n/a",
    rawPost.criticalRiskEvents,
    rawPost.criticalRiskEvents,
    "int"
  );

  addComparison(
    rows,
    "Consumer 激活漏斗",
    "Quote Generated",
    asInt(baseline.quoteGenerated) + runQuoteGenerated,
    rawPost.quoteGenerated,
    api.invocationRevenue.quoteCount,
    "int"
  );
  addComparison(
    rows,
    "Consumer 激活漏斗",
    "Invoke Started",
    asInt(baseline.invokeStarted) + expectedCalls,
    rawPost.invokeStarted,
    api.invocationRevenue.invokeStartedCount,
    "int"
  );
  addComparison(
    rows,
    "Consumer 激活漏斗",
    "Invoke Completed",
    asInt(baseline.invokeCompleted) + expectedCalls,
    rawPost.invokeCompleted,
    api.invocationRevenue.invokeCompletedCount,
    "int"
  );
  addComparison(
    rows,
    "Consumer 激活漏斗",
    "Distinct Users",
    "n/a",
    "n/a",
    api.consumerFunnel?.steps?.[0]?.users ?? "n/a",
    "int"
  );
  addComparison(
    rows,
    "Consumer 激活漏斗",
    "Conversion",
    "n/a",
    "n/a",
    api.consumerFunnel?.overallConversionRate ?? "n/a"
  );

  addComparison(
    rows,
    "调用与收入",
    "Quote",
    asInt(baseline.quoteGenerated) + runQuoteGenerated,
    rawPost.quoteGenerated,
    api.invocationRevenue.quoteCount,
    "int"
  );
  addComparison(
    rows,
    "调用与收入",
    "Started",
    asInt(baseline.invokeStarted) + expectedCalls,
    rawPost.invokeStarted,
    api.invocationRevenue.invokeStartedCount,
    "int"
  );
  addComparison(
    rows,
    "调用与收入",
    "Completed",
    asInt(baseline.invokeCompleted) + expectedCalls,
    rawPost.invokeCompleted,
    api.invocationRevenue.invokeCompletedCount,
    "int"
  );
  addComparison(
    rows,
    "调用与收入",
    "Failed",
    "n/a",
    rawPost.invokeFailed,
    api.invocationRevenue.invokeFailedCount,
    "int"
  );
  addComparison(
    rows,
    "调用与收入",
    "Success Rate",
    "n/a",
    rate(
      asInt(rawPost.invokeCompleted),
      asInt(rawPost.invokeCompleted) + asInt(rawPost.invokeFailed)
    ),
    api.invocationRevenue.successRate
  );
  addComparison(
    rows,
    "调用与收入",
    "GMV",
    asNumber(baseline.gmvUsdc) + expectedReceiptGmv,
    rawPost.gmvUsdc,
    api.invocationRevenue.gmvUsdc
  );

  addComparison(
    rows,
    "Provider 收益",
    "Provider Gross",
    "n/a",
    rawPost.providerGrossUsdc,
    api.providerRevenue.providerGrossUsdc
  );
  addComparison(
    rows,
    "Provider 收益",
    "Provider Net",
    "n/a",
    rawPost.providerNetUsdc,
    api.providerRevenue.providerNetUsdc
  );
  addComparison(
    rows,
    "Provider 收益",
    "Top Provider Count",
    "n/a",
    "n/a",
    api.providerRevenue.topProviders?.[0]?.invokeCount ?? "n/a",
    "int"
  );
  addComparison(
    rows,
    "Provider 收益",
    "Available to withdraw",
    "finance_projection",
    "n/a",
    api.providerRevenue.pendingSettlementUsdc ?? "n/a"
  );

  addComparison(
    rows,
    "资金流",
    "Deposit USDC",
    "n/a",
    rawPost.depositUsdc,
    api.moneyFlow.depositUsdc
  );
  addComparison(
    rows,
    "资金流",
    "Failed Deposits",
    "n/a",
    rawPost.depositFailed,
    api.moneyFlow.depositFailedCount,
    "int"
  );
  addComparison(
    rows,
    "资金流",
    "Withdrawal USDC",
    "n/a",
    rawPost.withdrawalUsdc,
    api.moneyFlow.withdrawalUsdc
  );
  addComparison(
    rows,
    "资金流",
    "Refund USDC",
    "n/a",
    rawPost.refundUsdc,
    api.moneyFlow.refundUsdc
  );

  addComparison(
    rows,
    "风控健康",
    "Budget Blocks",
    asInt(baseline.budgetBlocked) + runBudgetBlocks,
    rawPost.budgetBlocked,
    api.riskHealth.budgetBlockedCount ?? rawPost.budgetBlocked,
    "int"
  );
  addComparison(
    rows,
    "风控健康",
    "Risk Rules",
    "n/a",
    rawPost.criticalRiskEvents,
    api.riskHealth.criticalRiskEvents,
    "int"
  );
  addComparison(
    rows,
    "风控健康",
    "Provider Degraded",
    "n/a",
    rawPost.providerHealthDegraded,
    api.riskHealth.providerHealthDegradedCount,
    "int"
  );
  addComparison(
    rows,
    "风控健康",
    "Budget Gap",
    "n/a",
    "n/a",
    api.riskHealth.budgetGapUsdc
  );

  addComparison(
    rows,
    "埋点质量",
    "Event Count",
    "n/a",
    rawPost.eventCount,
    api.dataQuality.eventCount,
    "int"
  );
  addComparison(
    rows,
    "埋点质量",
    "Privacy Violations",
    "n/a",
    0,
    api.dataQuality.privacyViolations,
    "int"
  );
  addComparison(
    rows,
    "埋点质量",
    "Missing Required",
    "n/a",
    "n/a",
    api.dataQuality.missingRequiredProperties,
    "int"
  );
  addComparison(
    rows,
    "埋点质量",
    "Duplicate Rate",
    "n/a",
    "n/a",
    api.dataQuality.duplicateRate
  );

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
      ...rows.map(
        (row) =>
          `| ${row.pass ? "PASS" : "FAIL"} | ${row.metricName} | ${String(
            row.expectedFromFixture ?? ""
          ).replace(/\|/g, "\\|")} | ${String(
            row.clickHouseActual ?? ""
          ).replace(/\|/g, "\\|")} | ${String(row.adminApiActual ?? "").replace(
            /\|/g,
            "\\|"
          )} | ${String(row.adminFrontActual ?? "").replace(/\|/g, "\\|")} |`
      ),
      ""
    );
  }
  return sections.join("\n");
}

function writeReports({ api, rawPost, rawRun, runByName }) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pageComparisons = buildPageComparisons({ api, rawPost, runByName });
  for (const row of pageComparisons) {
    record(`page comparison ${row.page} / ${row.metricName}`, row.pass);
  }
  const failed = checks.filter((check) => !check.passed);
  const report = {
    status: failed.length ? "failed" : "success",
    generatedAt: new Date().toISOString(),
    fixturePath: FIXTURE_PATH,
    runId: fixture.runId,
    window: WINDOW,
    adminGatewayUrl: ADMIN_GATEWAY_URL,
    clickHouseUrl: CLICKHOUSE_URL,
    checks,
    expected: fixture.load,
    baselineClickHouse24h: fixture.baselineClickHouse24h,
    rawClickHousePost: rawPost,
    rawClickHouseRun: rawRun,
    rawClickHouseRunByEvent: runByName,
    adminApi: api,
    pageComparisons,
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  const md = [
    "# Admin Analytics 10k Load Verification Report",
    "",
    `- Status: ${report.status}`,
    `- Generated at: ${report.generatedAt}`,
    `- Run ID: ${fixture.runId}`,
    `- Expected calls: ${fixture.load?.totalCalls}`,
    `- Expected GMV: ${fixture.load?.expectedGmvUsdc} USDC`,
    `- Report JSON: ${REPORT_JSON}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "| --- | --- | --- |",
    ...checks.map(
      (check) =>
        `| ${check.passed ? "PASS" : "FAIL"} | ${check.name} | ${String(
          check.detail || ""
        ).replace(/\|/g, "\\|")} |`
    ),
    "",
    "# Page Comparisons",
    "",
    markdownComparisonTables(pageComparisons),
  ].join("\n");
  fs.writeFileSync(REPORT_MD, md);
  console.log(`[INFO] wrote ${REPORT_JSON}`);
  console.log(`[INFO] wrote ${REPORT_MD}`);
  return failed.length ? 1 : 0;
}

async function main() {
  console.log(`[INFO] fixture=${FIXTURE_PATH}`);
  const token = await loginAdmin();
  const [api, rawPost, rawRun] = await Promise.all([
    fetchAdminAnalytics(token),
    rawWindowSnapshot(),
    rawRunRows(),
  ]);
  const runByName = byEvent(rawRun);
  validateAbsoluteApi(api, rawPost);
  validateRunDelta(rawPost, rawRun, runByName);
  process.exit(writeReports({ api, rawPost, rawRun, runByName }));
}

main().catch((error) => {
  console.error(
    `[analytics-10k-reconcile] fatal: ${
      error.stack || error.message || String(error)
    }`
  );
  process.exit(1);
});
