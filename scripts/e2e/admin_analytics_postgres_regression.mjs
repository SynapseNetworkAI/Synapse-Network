#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgresRawWindowSnapshot } from "./lib/admin_analytics_postgres_source.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const RUN_ID =
  process.env.ADMIN_ANALYTICS_POSTGRES_RUN_ID ||
  `admin-analytics-pg-${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
const OUT_DIR = path.resolve(
  process.env.ADMIN_ANALYTICS_POSTGRES_OUTPUT_DIR ||
    path.join(ROOT, "output/dogfood/admin-analytics-postgres", RUN_ID)
);
const ADMIN_GATEWAY_URL = (
  process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300"
).replace(/\/+$/, "");
const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const POSTGRES_DSN =
  process.env.GATEWAY_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
const WINDOW = process.env.ADMIN_ANALYTICS_WINDOW || "24h";
const DEFAULT_ADMIN_FIXTURE = path.join(
  ROOT,
  "tmp/admin-front-dogfood/fixture.json"
);

const checks = [];

function record(name, passed, detail = "") {
  checks.push({ name, passed: Boolean(passed), detail });
  console.log(
    `[${passed ? "PASS" : "FAIL"}] ${name}${detail ? `: ${detail}` : ""}`
  );
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

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return process.env.ADMIN_SESSION_TOKEN;
  }
  if (fs.existsSync(DEFAULT_ADMIN_FIXTURE)) {
    const fixture = JSON.parse(fs.readFileSync(DEFAULT_ADMIN_FIXTURE, "utf8"));
    if (fixture.auth?.sessionToken) {
      return fixture.auth.sessionToken;
    }
  }
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL || "cliff@synapse-network.ai",
      password: process.env.ADMIN_PASSWORD || "qwer@1234",
      otpCode: process.env.ADMIN_OTP_CODE,
    }),
  });
  const body = await response.json().catch(() => ({}));
  const setCookie = response.headers.get("set-cookie") || "";
  const cookie = setCookie
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`));
  const token = cookie
    ? cookie.split(";")[0].slice(ADMIN_COOKIE_NAME.length + 1)
    : "";
  if (!response.ok || !body.success || !token) {
    throw new Error(
      `Admin login failed: ${response.status} ${JSON.stringify(body).slice(
        0,
        800
      )}. Set ADMIN_SESSION_TOKEN or run npm run e2e:admin-front:seed first.`
    );
  }
  return token;
}

async function adminGet(pathname, token) {
  const response = await fetch(`${ADMIN_GATEWAY_URL}${pathname}`, {
    headers: {
      Accept: "application/json",
      Cookie: `${ADMIN_COOKIE_NAME}=${token}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    throw new Error(
      `Admin API failed ${pathname}: ${response.status} ${JSON.stringify(
        body
      ).slice(0, 800)}`
    );
  }
  return body.data;
}

function cardValue(overview, key) {
  return (overview.cards || []).find((card) => card.key === key)?.value;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const [token, raw] = await Promise.all([
    loginAdmin(),
    postgresRawWindowSnapshot({
      dsn: POSTGRES_DSN,
      root: ROOT,
      window: WINDOW,
    }),
  ]);
  const api = {
    overview: await adminGet(
      `/api/admin/v1/dashboard/analytics/overview?window=${WINDOW}`,
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
    dataQuality: await adminGet(
      `/api/admin/v1/dashboard/analytics/data-quality?window=${
        WINDOW === "1h" ? "1h" : "24h"
      }`,
      token
    ),
  };

  record(
    "analytics source is postgres",
    true,
    "Postgres SQL raw snapshot used"
  );
  record(
    "overview paid invokes matches Postgres",
    asInt(cardValue(api.overview, "invoke_completed")) ===
      asInt(raw.invokeCompleted)
  );
  record(
    "overview GMV matches Postgres",
    near(cardValue(api.overview, "gmv_usdc"), raw.gmvUsdc)
  );
  record(
    "overview platform fee matches Postgres",
    near(cardValue(api.overview, "platform_fee_usdc"), raw.platformFeeUsdc)
  );
  record(
    "overview provider net matches Postgres",
    near(cardValue(api.overview, "provider_net_usdc"), raw.providerNetUsdc)
  );
  record(
    "invocation completed matches Postgres",
    asInt(api.invocationRevenue.invokeCompletedCount) ===
      asInt(raw.invokeCompleted)
  );
  record(
    "provider gross matches Postgres",
    near(api.providerRevenue.providerGrossUsdc, raw.providerGrossUsdc)
  );
  record(
    "money-flow deposit matches Postgres",
    near(api.moneyFlow.depositUsdc, raw.depositUsdc)
  );
  record(
    "data-quality count matches Postgres",
    asInt(api.dataQuality.eventCount) === asInt(raw.eventCount)
  );

  const failed = checks.filter((check) => !check.passed);
  const report = {
    status: failed.length ? "failed" : "success",
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    analyticsSource: "postgres",
    window: WINDOW,
    rawPostgres: raw,
    adminApi: api,
    checks,
    failed,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(report, null, 2)
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Admin Analytics Postgres Regression",
      "",
      `- Status: ${report.status}`,
      `- Run ID: ${RUN_ID}`,
      `- Window: ${WINDOW}`,
    ].join("\n")
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(
    `[admin-analytics-postgres] fatal: ${
      error.stack || error.message || String(error)
    }`
  );
  process.exit(1);
});
