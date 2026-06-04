#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { FUNCTION_MATRIX } from "../e2e/admin_regression_function_matrix.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const RUN_ID =
  process.env.ADMIN_PROD_READONLY_RUN_ID ||
  `admin-prod-readonly-${new Date().toISOString().replace(/[:.]/g, "")}`;
const OUT_DIR = path.resolve(
  process.env.ADMIN_PROD_READONLY_OUT_DIR ||
    path.join(ROOT, "output/dogfood/admin-front-prod-readonly", RUN_ID)
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const ADMIN_FRONT_URL = stripSlash(
  process.env.ADMIN_FRONT_URL || "https://admin.synapse-network.ai"
);
const ADMIN_GATEWAY_URL = stripSlash(
  process.env.ADMIN_GATEWAY_URL || "https://admin-api.synapse-network.ai"
);
const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_OTP_CODE = process.env.ADMIN_OTP_CODE || "";
const ADMIN_SESSION_TOKEN = process.env.ADMIN_SESSION_TOKEN || "";
const ADMIN_CSRF_TOKEN = process.env.ADMIN_CSRF_TOKEN || "";
const MANUAL_LOGIN = process.env.ADMIN_PROD_READONLY_MANUAL_LOGIN === "1";
const HEADLESS = MANUAL_LOGIN
  ? false
  : process.env.ADMIN_PROD_READONLY_HEADLESS !== "0";
const MANUAL_LOGIN_TIMEOUT_MS = Number(
  process.env.ADMIN_PROD_READONLY_MANUAL_LOGIN_TIMEOUT_MS || 180000
);
const ALLOW_LOG_SKIP = process.env.ADMIN_PROD_READONLY_ALLOW_LOG_SKIP === "1";

const AUTH_ROUTES = [
  { route: "/login", name: "login" },
  { route: "/login/mfa-enroll", name: "mfa-enroll" },
  { route: "/login/reset-success", name: "reset-success" },
];

const APP_ROUTES = Array.from(
  new Map(
    FUNCTION_MATRIX.flatMap((item) => item.routes).map((route) => [
      route,
      {
        route,
        name: route.replace(/^\//, "").replace(/[/?=&]+/g, "-") || "root",
      },
    ])
  ).values()
);

const FORBIDDEN_TEXT = [
  "Internal server error",
  "Unhandled Runtime Error",
  "Failed to fetch",
  "Unauthorized",
  "Missing admin session",
  "暂时无法连接管理后台",
  "temporarily unavailable",
];

const ALLOWED_AUTH_REDIRECTS = new Set(["/login", "/login/mfa-enroll"]);

const routeResults = [];
const apiResults = [];
const consoleResults = [];
const logResults = [];
const failures = [];
const warnings = [];

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function redact(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /"((?:password|authorization|access_token|token|secret|cookie)[^"]*)"\s*:\s*"[^"]+"/gi,
      '"$1":"[REDACTED]"'
    );
}

function writeJson(name, data) {
  fs.writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(data, null, 2)}\n`);
}

function addFailure(scope, detail) {
  failures.push({ scope, detail });
}

function addWarning(scope, detail) {
  warnings.push({ scope, detail });
}

function parseSessionCookie(headerValue) {
  const header = Array.isArray(headerValue)
    ? headerValue.join(",")
    : String(headerValue || "");
  const match = header
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`));
  return match ? match.split(";")[0].slice(ADMIN_COOKIE_NAME.length + 1) : "";
}

async function loginAdmin() {
  if (ADMIN_SESSION_TOKEN) {
    return { sessionToken: ADMIN_SESSION_TOKEN, csrfToken: ADMIN_CSRF_TOKEN };
  }
  if (MANUAL_LOGIN) {
    return null;
  }
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_OTP_CODE) {
    throw new Error(
      "Missing prod admin auth. Set ADMIN_SESSION_TOKEN, ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_OTP_CODE, or ADMIN_PROD_READONLY_MANUAL_LOGIN=1."
    );
  }
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      otpCode: ADMIN_OTP_CODE,
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
      `Prod admin login failed: ${response.status} ${JSON.stringify(body).slice(
        0,
        500
      )}`
    );
  }
  return {
    sessionToken,
    csrfToken: body.data?.csrfToken || "",
  };
}

async function createContext(browser, auth) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  await context.addCookies([
    {
      name: ADMIN_COOKIE_NAME,
      value: auth.sessionToken,
      url: ADMIN_FRONT_URL,
      httpOnly: true,
      sameSite: "Lax",
      secure: true,
    },
    {
      name: ADMIN_COOKIE_NAME,
      value: auth.sessionToken,
      url: ADMIN_GATEWAY_URL,
      httpOnly: true,
      sameSite: "Lax",
      secure: true,
    },
  ]);
  if (auth.csrfToken) {
    await context.addInitScript((csrfToken) => {
      window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
    }, auth.csrfToken);
  }
  return context;
}

async function manualLogin(context) {
  const page = await context.newPage();
  await page.goto(`${ADMIN_FRONT_URL}/login`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  console.log(
    `[admin-front-prod-readonly] manual login requested. Complete prod login in the opened browser within ${Math.round(
      MANUAL_LOGIN_TIMEOUT_MS / 1000
    )}s.`
  );
  const deadline = Date.now() + MANUAL_LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const currentUrl = new URL(page.url());
    if (!currentUrl.pathname.startsWith("/login")) {
      const response = await context.request
        .get(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/me`, {
          headers: { Accept: "application/json" },
        })
        .catch(() => null);
      const body = response ? await response.json().catch(() => ({})) : {};
      if (response && responseOk(response) && body?.success !== false) {
        await page.close();
        return;
      }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Manual prod admin login timed out before /auth/me passed.");
}

function responseOk(response) {
  return typeof response.ok === "function" ? response.ok() : response.ok;
}

function responseStatus(response) {
  return typeof response.status === "function" ? response.status() : response.status;
}

async function apiPreflight(auth, context) {
  const endpoints = [
    "/api/admin/v1/auth/policy",
    "/api/admin/v1/auth/me",
  ];
  for (const endpoint of endpoints) {
    const response = auth?.sessionToken
      ? await fetch(`${ADMIN_GATEWAY_URL}${endpoint}`, {
          headers: {
            Accept: "application/json",
            Cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}`,
          },
        })
      : await context.request.get(`${ADMIN_GATEWAY_URL}${endpoint}`, {
          headers: { Accept: "application/json" },
        });
    const body = await response.json().catch(() => ({}));
    const status = responseStatus(response);
    const ok = responseOk(response) && body.success !== false;
    apiResults.push({
      route: endpoint,
      ok,
      status,
      success: body.success ?? null,
      bodySnippet: redact(JSON.stringify(body).slice(0, 500)),
    });
    if (!ok) {
      addFailure(endpoint, `API preflight failed with ${status}`);
    }
  }
}

function summarizeBody(text) {
  return redact(
    text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600)
  );
}

async function verifyRoute(context, spec, requiresSession) {
  const page = await context.newPage();
  const routeApi = [];
  const routeConsole = [];
  const routeRequestFailures = [];

  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/admin/v1/")) return;
    routeApi.push({
      url,
      status: response.status(),
      ok: response.ok(),
      method: response.request().method(),
    });
  });
  page.on("console", (message) => {
    routeConsole.push({
      type: message.type(),
      text: redact(message.text()),
    });
  });
  page.on("requestfailed", (request) => {
    routeRequestFailures.push({
      url: request.url(),
      method: request.method(),
      failureText: request.failure()?.errorText || "unknown",
    });
  });

  const targetUrl = `${ADMIN_FRONT_URL}${spec.route}`;
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const currentUrl = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const screenshotPath = path.join(SCREENSHOT_DIR, `${spec.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const forbiddenHits = FORBIDDEN_TEXT.filter((needle) => bodyText.includes(needle));
  const consoleErrors = routeConsole.filter((entry) => entry.type === "error");
  const apiFailures = routeApi.filter((entry) => entry.status >= 400);
  const redirectedToLogin =
    requiresSession &&
    currentUrl.startsWith(`${ADMIN_FRONT_URL}/login`) &&
    !ALLOWED_AUTH_REDIRECTS.has(spec.route);

  if (!requiresSession) {
    const authOk =
      currentUrl.startsWith(`${ADMIN_FRONT_URL}/login`) &&
      bodyText.includes("System Authorization");
    if (!authOk) {
      addFailure(spec.route, `Auth page did not render expected login view (${currentUrl})`);
    }
  }

  if (requiresSession && redirectedToLogin) {
    addFailure(spec.route, `Authenticated route redirected to login (${currentUrl})`);
  }
  if (forbiddenHits.length > 0) {
    addFailure(spec.route, `Forbidden text present: ${forbiddenHits.join(", ")}`);
  }
  if (consoleErrors.length > 0) {
    addFailure(spec.route, `Console errors present: ${consoleErrors.length}`);
  }
  if (routeRequestFailures.length > 0) {
    addFailure(spec.route, `Request failures present: ${routeRequestFailures.length}`);
  }
  if (apiFailures.length > 0) {
    addFailure(
      spec.route,
      `Admin API failures present: ${apiFailures
        .map((entry) => `${entry.status}:${new URL(entry.url).pathname}`)
        .join(", ")}`
    );
  }

  routeResults.push({
    route: spec.route,
    name: spec.name,
    currentUrl,
    requiresSession,
    ok:
      forbiddenHits.length === 0 &&
      consoleErrors.length === 0 &&
      routeRequestFailures.length === 0 &&
      apiFailures.length === 0 &&
      !(requiresSession && redirectedToLogin),
    forbiddenHits,
    screenshotPath,
    summary: summarizeBody(bodyText),
  });

  consoleResults.push({
    route: spec.route,
    console: routeConsole,
    requestFailures: routeRequestFailures,
  });
  apiResults.push(
    ...routeApi.map((entry) => ({
      route: spec.route,
      path: new URL(entry.url).pathname,
      method: entry.method,
      status: entry.status,
      ok: entry.ok,
    }))
  );

  await page.close();
}

function collectLogsWindow(startedAtIso) {
  const filter =
    `severity=\"ERROR\" AND timestamp>=\"${startedAtIso}\" AND resource.type=\"cloud_run_revision\" ` +
    `AND (resource.labels.service_name=\"synapse-prod-admin-front\" OR resource.labels.service_name=\"synapse-prod-gateway-admin\")`;
  const result = spawnSync(
    "gcloud",
    [
      "logging",
      "read",
      filter,
      "--project=synapse-network-prod",
      "--limit=50",
      "--format=json",
    ],
    { cwd: ROOT, encoding: "utf8" }
  );
  if (result.status !== 0) {
    return {
      status: "skipped",
      reason: redact((result.stderr || result.stdout || "").trim()),
    };
  }
  const entries = JSON.parse(result.stdout || "[]");
  return {
    status: "ok",
    count: entries.length,
    entries: entries.map((entry) => ({
      timestamp: entry.timestamp,
      serviceName: entry.resource?.labels?.service_name || "",
      revisionName: entry.resource?.labels?.revision_name || "",
      textPayload: redact(entry.textPayload || ""),
      severity: entry.severity || "",
    })),
  };
}

function renderReport(startedAtIso, finishedAtIso) {
  const passedRoutes = routeResults.filter((item) => item.ok).length;
  const failedRoutes = routeResults.filter((item) => !item.ok).length;
  const logSummary = logResults[0] || { status: "skipped", reason: "not run" };
  return [
    "# Prod Admin Readonly Verification",
    "",
    `- Started: ${startedAtIso}`,
    `- Finished: ${finishedAtIso}`,
    `- Admin front: ${ADMIN_FRONT_URL}`,
    `- Admin gateway: ${ADMIN_GATEWAY_URL}`,
    `- Passed routes: ${passedRoutes}`,
    `- Failed routes: ${failedRoutes}`,
    `- Log scan: ${logSummary.status}${logSummary.reason ? ` (${logSummary.reason})` : ""}`,
    "",
    "## Failures",
    failures.length
      ? failures.map((item) => `- ${item.scope}: ${item.detail}`).join("\n")
      : "- none",
    "",
    "## Warnings",
    warnings.length
      ? warnings.map((item) => `- ${item.scope}: ${item.detail}`).join("\n")
      : "- none",
  ].join("\n");
}

async function main() {
  const startedAtIso = new Date().toISOString();
  const auth = await loginAdmin();

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = auth
    ? await createContext(browser, auth)
    : await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  if (!auth && MANUAL_LOGIN) {
    await manualLogin(context);
  }
  await apiPreflight(auth, context);

  for (const spec of AUTH_ROUTES) {
    await verifyRoute(context, spec, false);
  }
  for (const spec of APP_ROUTES) {
    await verifyRoute(context, spec, true);
  }

  await context.close();
  await browser.close();

  const logSummary = collectLogsWindow(startedAtIso);
  logResults.push(logSummary);
  if (logSummary.status === "ok" && logSummary.count > 0) {
    addFailure("logs", `${logSummary.count} ERROR log entries detected in scan window`);
  }
  if (logSummary.status === "skipped") {
    const message = `Log scan skipped: ${logSummary.reason}`;
    if (ALLOW_LOG_SKIP) {
      addWarning("logs", message);
    } else {
      addFailure("logs", message);
    }
  }

  const report = {
    status: failures.length === 0 ? "success" : "failed",
    runId: RUN_ID,
    startedAt: startedAtIso,
    finishedAt: new Date().toISOString(),
    adminFrontUrl: ADMIN_FRONT_URL,
    adminGatewayUrl: ADMIN_GATEWAY_URL,
    failures,
    warnings,
    routeCount: routeResults.length,
  };

  writeJson("route_results.json", routeResults);
  writeJson("api_results.json", apiResults);
  writeJson("console_results.json", consoleResults);
  writeJson("log_results.json", logResults);
  writeJson("report.json", report);
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    `${renderReport(report.startedAt, report.finishedAt)}\n`
  );

  console.log(
    `[admin-front-prod-readonly] ${report.status}: ${path.join(OUT_DIR, "report.json")}`
  );
  if (report.status !== "success") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  writeJson("route_results.json", routeResults);
  writeJson("api_results.json", apiResults);
  writeJson("console_results.json", consoleResults);
  writeJson("log_results.json", logResults);
  writeJson("report.json", {
    status: "failed",
    runId: RUN_ID,
    error: redact(error instanceof Error ? error.stack || error.message : String(error)),
  });
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    `# Prod Admin Readonly Verification\n\n- status: failed\n- error: ${redact(
      error instanceof Error ? error.message : String(error)
    )}\n`
  );
  console.error(
    `[admin-front-prod-readonly] failed: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exit(1);
});
