#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  activityTrendProjectionSql,
  dashboardProjectionSql,
  financeProjectionSql,
  operationsProjectionSql,
} from "./admin_dashboard_projection_readmodel_sql.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const timestamp = generatedAt
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const outDir = path.resolve(
  process.env.ADMIN_DASHBOARD_PROJECTION_READMODEL_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "output/dogfood/admin-dashboard-projection-readmodel",
      `${timestamp}-local`
    )
);
const screenshotsDir = path.join(outDir, "screenshots");

const config = {
  adminFrontUrl: stripSlash(
    process.env.ADMIN_FRONT_URL || "http://127.0.0.1:3200"
  ),
  adminGatewayUrl: stripSlash(
    process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300"
  ),
  adminCookieName:
    process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session",
  adminEmail: process.env.ADMIN_EMAIL || "cliff@synapse-network.ai",
  adminPassword: process.env.ADMIN_PASSWORD || "qwer@1234",
  adminTotpSecret: process.env.ADMIN_TOTP_SECRET || "",
  adminDsn:
    process.env.ADMIN_DATABASE_DSN ||
    "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin",
  gatewayDsn:
    process.env.GATEWAY_POSTGRES_DSN ||
    process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
    process.env.POSTGRES_DSN ||
    "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
  headless: process.env.ADMIN_DASHBOARD_PROJECTION_READMODEL_HEADLESS !== "0",
};

const evidence = {
  environment: "local",
  generatedAt: generatedAt.toISOString(),
  adminFrontUrl: config.adminFrontUrl,
  adminGatewayUrl: config.adminGatewayUrl,
  checks: [],
  failed: [],
  api: [],
  sql: { queries: [] },
  dom: [],
  screenshots: [],
  trace: [],
};

const forbiddenPageText = [
  "Internal server error",
  "str has no attribute isoformat",
  "datetime - str",
  "Failed to fetch",
  "Unauthorized",
  "Missing admin session",
  "Unhandled Runtime Error",
  "Loading",
];

const dashboardEndpoints = [
  "/api/admin/v1/dashboard/overview",
  "/api/admin/v1/dashboard/finance-overview",
  "/api/admin/v1/dashboard/activity-trends",
  "/api/admin/v1/dashboard/operations-overview",
  "/api/admin/v1/dashboard/system-status",
];

fs.mkdirSync(screenshotsDir, { recursive: true });

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertLocalOnly() {
  for (const [name, value] of [
    ["ADMIN_FRONT_URL", config.adminFrontUrl],
    ["ADMIN_GATEWAY_URL", config.adminGatewayUrl],
  ]) {
    if (!isLocalUrl(value)) {
      throw new Error(`Refusing non-local ${name}: ${value}`);
    }
  }
  for (const [name, dsn] of [
    ["ADMIN_DATABASE_DSN", config.adminDsn],
    ["GATEWAY_POSTGRES_DSN", config.gatewayDsn],
  ]) {
    if (!dsn.includes("127.0.0.1") && !dsn.includes("localhost")) {
      throw new Error(`Refusing non-local ${name}.`);
    }
  }
}

function redact(value) {
  let text = String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi,
      "postgresql://[REDACTED]@"
    )
    .replace(
      /"((?:password|authorization|access_token|token|secret|cookie)[^"]*)"\s*:\s*"[^"]+"/gi,
      '"$1":"[REDACTED]"'
    );
  if (config.adminPassword) {
    text = text.replaceAll(config.adminPassword, "[REDACTED_PASSWORD]");
  }
  if (config.adminTotpSecret) {
    text = text.replaceAll(config.adminTotpSecret, "[REDACTED_TOTP]");
  }
  return text;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [
        key,
        /password|authorization|bearer|jwt|token|secret|cookie|session/i.test(
          key
        )
          ? "[REDACTED]"
          : sanitize(next),
      ])
    );
  }
  return typeof value === "string" ? redact(value) : value;
}

function addTrace(name, detail = {}) {
  evidence.trace.push(
    sanitize({ timestamp: new Date().toISOString(), name, ...detail })
  );
}

function addCheck(name, ok, detail = "", extra = {}) {
  const row = sanitize({ name, ok: Boolean(ok), detail, ...extra });
  evidence.checks.push(row);
  if (!row.ok) evidence.failed.push(row);
  console.log(
    `[admin-dashboard-projection-readmodel] ${
      row.ok ? "PASS" : "FAIL"
    } ${name}${detail ? ` - ${redact(detail)}` : ""}`
  );
}

function sqlSha(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

function assertCleanSql(name, sql) {
  const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.includes("row_to_json")) {
    throw new Error(`${name} SQL must not use row_to_json`);
  }
  if (/select\s+\*\s+from\s+synapse_admin_dashboard_.*projection/i.test(sql)) {
    throw new Error(`${name} SQL must not use dashboard projection SELECT *`);
  }
}

function psqlJson(dsn, name, sql) {
  assertCleanSql(name, sql);
  const result = spawnSync(
    "psql",
    [dsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { cwd: ROOT, encoding: "utf8" }
  );
  const queryEvidence = {
    name,
    sqlSha256: sqlSha(sql),
    forbiddenAbsent: {
      rowToJson: !/row_to_json/i.test(sql),
      projectionSelectStar:
        !/select\s+\*\s+from\s+synapse_admin_dashboard_.*projection/i.test(sql),
    },
  };
  evidence.sql.queries.push(queryEvidence);
  if (result.status !== 0) {
    throw new Error(
      `${name} SQL failed: ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function collectSqlEvidence() {
  evidence.sql.financeProjection = psqlJson(
    config.gatewayDsn,
    "finance-projection-native-columns",
    financeProjectionSql()
  );
  evidence.sql.activityTrendProjection = psqlJson(
    config.gatewayDsn,
    "activity-trend-projection-native-columns",
    activityTrendProjectionSql()
  );
  evidence.sql.operationsProjection = psqlJson(
    config.gatewayDsn,
    "operations-projection-native-columns",
    operationsProjectionSql()
  );
  evidence.sql.dashboardProjection = psqlJson(
    config.gatewayDsn,
    "dashboard-projection-native-columns",
    dashboardProjectionSql()
  );
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of String(secret)
    .replace(/=+$/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) {
      throw new Error(`Invalid base32 character in ADMIN_TOTP_SECRET: ${char}`);
    }
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

function resolveLocalAdminTotpSecret() {
  if (config.adminTotpSecret) return config.adminTotpSecret;
  const sql = `
    SELECT to_json(payload_json->>'totpSecret')
    FROM admin_mfa_factors mf
    JOIN admin_users au ON au.admin_id = mf.admin_id
    WHERE au.email = 'cliff@synapse-network.ai'
      AND mf.status = 'active'
      AND payload_json ? 'totpSecret'
    ORDER BY mf.updated_at DESC
    LIMIT 1
  `;
  const result = spawnSync(
    "psql",
    [
      config.adminDsn,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) return "JBSWY3DPEHPK3PXP";
  try {
    const parsed = JSON.parse(result.stdout.trim() || "null");
    return typeof parsed === "string" && parsed.trim()
      ? parsed.trim()
      : "JBSWY3DPEHPK3PXP";
  } catch {
    return "JBSWY3DPEHPK3PXP";
  }
}

function parseSessionCookie(setCookieHeader) {
  const header = Array.isArray(setCookieHeader)
    ? setCookieHeader.join(",")
    : String(setCookieHeader || "");
  const match = header
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${config.adminCookieName}=`));
  return match
    ? match.split(";")[0].slice(config.adminCookieName.length + 1)
    : "";
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return {
      sessionToken: process.env.ADMIN_SESSION_TOKEN,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
    };
  }
  const totpSecret = resolveLocalAdminTotpSecret();
  const response = await fetch(
    `${config.adminGatewayUrl}/api/admin/v1/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: config.adminEmail,
        password: config.adminPassword,
        otpCode: process.env.ADMIN_OTP_CODE || generateTotpCode(totpSecret),
      }),
    }
  );
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
  const response = await fetch(`${config.adminGatewayUrl}${pathname}`, {
    headers: {
      Accept: "application/json",
      Cookie: `${config.adminCookieName}=${auth.sessionToken}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  const record = sanitize({
    pathname,
    status: response.status,
    ok: response.ok && body.success === true,
    data: body.data || null,
    requestId: body.requestId || null,
  });
  evidence.api.push(record);
  if (!record.ok) {
    throw new Error(
      `Admin API failed ${pathname}: ${response.status} ${JSON.stringify(
        body
      ).slice(0, 800)}`
    );
  }
  return body.data;
}

async function collectApiEvidence(auth) {
  const results = {};
  for (const endpoint of dashboardEndpoints) {
    results[endpoint] = await adminApi(endpoint, auth);
  }
  evidence.apiProjection = {
    overview: results["/api/admin/v1/dashboard/overview"],
    finance: results["/api/admin/v1/dashboard/finance-overview"],
    activity: results["/api/admin/v1/dashboard/activity-trends"],
    operations: results["/api/admin/v1/dashboard/operations-overview"],
    system: results["/api/admin/v1/dashboard/system-status"],
  };
}

function formatDecimal2(value) {
  const raw = String(value ?? "0").trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return "0.00";
  const sign = match[1];
  const whole = match[2];
  const fraction = (match[3] || "").padEnd(3, "0");
  let cents = Number.parseInt(fraction.slice(0, 2), 10);
  const roundDigit = Number.parseInt(fraction[2] || "0", 10);
  let wholeNumber = BigInt(whole || "0");
  if (roundDigit >= 5) cents += 1;
  if (cents >= 100) {
    wholeNumber += 1n;
    cents -= 100;
  }
  const rendered = `${wholeNumber.toString()}.${String(cents).padStart(
    2,
    "0"
  )}`;
  return sign && rendered !== "0.00" ? `-${rendered}` : rendered;
}

function formatUsdc(value) {
  const raw = formatDecimal2(value);
  const [whole, fraction] = raw.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function sameTimestamp(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs)
    ? Math.abs(leftMs - rightMs) < 1000
    : String(left) === String(right);
}

function assertApiSqlConsistency() {
  const finance = evidence.apiProjection.finance;
  const sqlFinance = evidence.sql.financeProjection;
  const moneyFields = [
    "todayChargeUsdc",
    "todayDepositUsdc",
    "todayRefundUsdc",
    "todayWithdrawalUsdc",
    "todayPlatformFeeEarnedUsdc",
    "todayProviderEarnedUsdc",
    "ownerLiabilityUsdc",
    "providerPayableUsdc",
    "platformFeeBalanceUsdc",
    "vaultLedgerDeltaUsdc",
  ];
  const moneyMismatches = moneyFields.filter(
    (field) => formatDecimal2(sqlFinance?.[field]) !== finance?.[field]
  );
  const countMismatches = [
    "todayInvocationCount",
    "pendingDepositCount",
    "pendingWithdrawalCount",
  ].filter(
    (field) =>
      Number(sqlFinance?.[field] || 0) !== Number(finance?.[field] || 0)
  );
  const activityApi = evidence.apiProjection.activity?.points || [];
  const activitySql = evidence.sql.activityTrendProjection || [];
  const activityOk =
    activityApi.length === activitySql.length &&
    activityApi.every((point, index) => {
      const sqlPoint = activitySql[index];
      return (
        point.bucketDate === sqlPoint?.bucketDate &&
        formatDecimal2(sqlPoint.depositUsdc) === point.depositUsdc &&
        formatDecimal2(sqlPoint.chargeUsdc) === point.chargeUsdc &&
        Number(sqlPoint.invocationCount || 0) === Number(point.invocationCount)
      );
    });
  const operations = evidence.apiProjection.operations;
  const sqlOperations = evidence.sql.operationsProjection;
  const operationsOk =
    operations?.gatewayStatus === sqlOperations?.gatewayStatus &&
    operations?.indexerRunning === sqlOperations?.indexerRunning &&
    sameTimestamp(operations?.projectedAt, sqlOperations?.projectedAt);

  addCheck("api-sql:finance-money-fields", moneyMismatches.length === 0, "", {
    moneyMismatches,
  });
  addCheck("api-sql:finance-count-fields", countMismatches.length === 0, "", {
    countMismatches,
  });
  addCheck("api-sql:activity-trends", activityOk, "", {
    apiRows: activityApi.length,
    sqlRows: activitySql.length,
  });
  addCheck("api-sql:operations", operationsOk, "", {
    apiGatewayStatus: operations?.gatewayStatus,
    sqlGatewayStatus: sqlOperations?.gatewayStatus,
  });
}

async function createBrowserContext(auth) {
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    {
      name: config.adminCookieName,
      value: auth.sessionToken,
      url: config.adminFrontUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  if (auth.csrfToken) {
    await context.addInitScript((csrfToken) => {
      window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
    }, auth.csrfToken);
  }
  return { browser, context };
}

async function captureScreenshot(page, name, checkpoint) {
  const relativeFile = `screenshots/${name}`;
  await page.screenshot({
    path: path.join(outDir, relativeFile),
    fullPage: true,
  });
  const row = {
    file: relativeFile,
    url: page.url(),
    expectedText: checkpoint.expectedText,
    forbiddenTextAbsent: true,
    domCheckpoint: checkpoint.domCheckpoint,
    apiCheckpoint: checkpoint.apiCheckpoint,
    sqlCheckpoint: checkpoint.sqlCheckpoint,
    capturedAt: new Date().toISOString(),
  };
  evidence.screenshots.push(sanitize(row));
}

async function waitForDashboardPage(page, route, expectedText) {
  await page.goto(`${config.adminFrontUrl}${route}`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.waitForFunction(
    ({ expected, forbidden }) => {
      const body = document.body?.innerText || "";
      return (
        expected.some((text) => body.includes(text)) ||
        forbidden.some((text) => body.includes(text))
      );
    },
    { expected: expectedText, forbidden: forbiddenPageText },
    { timeout: 45000 }
  );
  const bodyText = String((await page.textContent("body")) || "");
  const forbiddenHit = forbiddenPageText.find((text) =>
    bodyText.includes(text)
  );
  if (forbiddenHit) {
    throw new Error(`${route} rendered forbidden text: ${forbiddenHit}`);
  }
  const expectedHit = expectedText.find((text) => bodyText.includes(text));
  if (!expectedHit) {
    throw new Error(
      `${route} missing expected text: ${expectedText.join(", ")}`
    );
  }
  return bodyText;
}

function pageValueChecks(route, bodyText) {
  const finance = evidence.apiProjection.finance;
  const operations = evidence.apiProjection.operations;
  const overview = evidence.apiProjection.overview;
  if (route === "/finance") {
    return [
      "资金概览",
      "今天的资金变化",
      `${formatUsdc(finance.todayChargeUsdc)} USDC`,
      `${formatUsdc(finance.todayPlatformFeeEarnedUsdc)} USDC`,
      `${formatUsdc(finance.todayProviderEarnedUsdc)} USDC`,
      String(finance.pendingDepositCount),
      String(finance.pendingWithdrawalCount),
    ].filter((value) => bodyText.includes(value));
  }
  if (route === "/dashboard/runtime") {
    return [
      "业务运行态",
      String(finance.pendingDepositCount),
      String(finance.pendingWithdrawalCount),
      operations.gatewayStatus,
      operations.indexerStatus,
      operations.reconciliationStatus,
    ].filter((value) => value && bodyText.includes(String(value)));
  }
  return [
    "控制台概览",
    `${formatUsdc(finance.todayDepositUsdc)} USDC`,
    `${formatUsdc(finance.todayChargeUsdc)} USDC`,
    String(overview.metrics.pendingApprovals),
    String(finance.pendingDepositCount),
    String(finance.pendingWithdrawalCount),
  ].filter((value) => bodyText.includes(value));
}

async function verifyDomEvidence(auth) {
  const { browser, context } = await createBrowserContext(auth);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("401")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  const pages = [
    {
      route: "/dashboard/overview",
      screenshot: "overview-readmodel.png",
      expectedText: ["控制台概览"],
    },
    {
      route: "/finance",
      screenshot: "finance-readmodel.png",
      expectedText: ["资金概览"],
    },
    {
      route: "/dashboard/runtime",
      screenshot: "runtime-readmodel.png",
      expectedText: ["业务运行态"],
    },
  ];
  for (const item of pages) {
    const bodyText = await waitForDashboardPage(
      page,
      item.route,
      item.expectedText
    );
    const matchedValues = pageValueChecks(item.route, bodyText);
    const checkpoint = {
      route: item.route,
      expectedText: item.expectedText,
      forbiddenTextAbsent: true,
      matchedValues,
      url: page.url(),
    };
    evidence.dom.push(sanitize(checkpoint));
    addCheck(`dom:${item.route}`, matchedValues.length >= 3, "", checkpoint);
    await captureScreenshot(page, item.screenshot, {
      expectedText: item.expectedText,
      domCheckpoint: checkpoint,
      apiCheckpoint: {
        endpoints: dashboardEndpoints,
        status: "passed",
      },
      sqlCheckpoint: {
        queries: evidence.sql.queries.map((query) => query.name),
        status: "passed",
      },
    });
  }
  addCheck("dom:console-errors", consoleErrors.length === 0, "", {
    consoleErrors,
  });
  await browser.close();
}

function writeEvidence(status) {
  const trace =
    evidence.trace.map((row) => JSON.stringify(sanitize(row))).join("\n") +
    "\n";
  const traceDigest = crypto.createHash("sha256").update(trace).digest("hex");
  const report = {
    environment: evidence.environment,
    status,
    generatedAt: evidence.generatedAt,
    failed: evidence.failed,
    checks: evidence.checks,
    traceDigest,
    apiEndpoints: dashboardEndpoints,
    screenshots: evidence.screenshots.map((row) => row.file),
  };
  fs.writeFileSync(path.join(outDir, "trace.jsonl"), trace);
  fs.writeFileSync(
    path.join(outDir, "api-evidence.json"),
    JSON.stringify(evidence.api, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "sql-evidence.json"),
    JSON.stringify(evidence.sql, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "dom-evidence.json"),
    JSON.stringify(evidence.dom, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "screenshot-evidence.json"),
    JSON.stringify(evidence.screenshots, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "bugfix-log.md"),
    evidence.failed.length
      ? "# Bugfix Log\n\n- OPEN: Admin dashboard projection read-model E2E has failing checkpoints.\n"
      : "# Bugfix Log\n\nNo bugs found in this run.\n"
  );
  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "report.md"),
    [
      "# Admin Dashboard Projection Read Model E2E",
      "",
      `- Status: ${status}`,
      `- Failed: ${evidence.failed.length}`,
      `- Generated at: ${evidence.generatedAt}`,
      "",
      "## Checks",
      "",
      ...evidence.checks.map(
        (row) => `- ${row.ok ? "PASS" : "FAIL"} ${row.name}`
      ),
      "",
    ].join("\n")
  );
  console.log(
    `[admin-dashboard-projection-readmodel] Report: ${path.join(
      outDir,
      "report.md"
    )}`
  );
}

async function main() {
  assertLocalOnly();
  addTrace("preflight", {
    adminFrontUrl: config.adminFrontUrl,
    adminGatewayUrl: config.adminGatewayUrl,
  });
  collectSqlEvidence();
  addCheck("sql:projection-native-column-queries", true, "", {
    queries: evidence.sql.queries,
  });
  const auth = await loginAdmin();
  addCheck("admin:login", true);
  await collectApiEvidence(auth);
  addCheck("api:dashboard-endpoints", evidence.api.length === 5, "", {
    endpoints: evidence.api.map((row) => row.pathname),
  });
  assertApiSqlConsistency();
  await verifyDomEvidence(auth);
  const status = evidence.failed.length ? "failed" : "success";
  writeEvidence(status);
  if (evidence.failed.length) process.exit(1);
}

main().catch((error) => {
  addCheck(
    "fatal",
    false,
    error instanceof Error ? error.stack || error.message : String(error)
  );
  writeEvidence("failed");
  process.exit(1);
});
