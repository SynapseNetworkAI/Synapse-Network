#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ADMIN_FRONT_URL = (
  process.env.ADMIN_FRONT_URL || "http://127.0.0.1:3200"
).replace(/\/+$/, "");
const ADMIN_GATEWAY_URL = (
  process.env.ADMIN_GATEWAY_URL || "http://127.0.0.1:8300"
).replace(/\/+$/, "");
const ADMIN_DSN =
  process.env.ADMIN_DATABASE_DSN ||
  "postgresql://synapse_admin_app:local-dev-admin-app-password@127.0.0.1:15432/synapse_gateway_admin";
const ADMIN_MIGRATION_DSN =
  process.env.ADMIN_DATABASE_MIGRATION_DSN ||
  "postgresql://synapse_admin_migrator:local-dev-admin-migrator-password@127.0.0.1:15432/synapse_gateway_admin";
const ADMIN_LOCAL_SUPERUSER_DSN =
  process.env.ADMIN_DATABASE_LOCAL_SUPERUSER_DSN ||
  "postgresql://synapse:local-dev-postgres-password@127.0.0.1:15432/synapse_gateway_admin";
const ADMIN_COOKIE_NAME =
  process.env.ADMIN_SESSION_COOKIE_NAME || "synapse_admin_session";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "cliff@synapse-network.ai";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "qwer@1234";
const ADMIN_TOTP_SECRET = process.env.ADMIN_TOTP_SECRET || "JBSWY3DPEHPK3PXP";
const SERVICE_ID =
  process.env.ADMIN_INBOX_PROVIDER_SERVICE_ID || "svc_synapse_mock_cost_1usdc";
const RUN_ID =
  process.env.ADMIN_INBOX_PROVIDER_SERVICES_RUN_ID ||
  `admin_inbox_provider_services_${new Date()
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 14)}`;
const OUT_DIR = path.resolve(
  process.env.ADMIN_INBOX_PROVIDER_SERVICES_OUT_DIR ||
    path.join(ROOT, "output/e2e/admin-inbox-provider-services", RUN_ID)
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const FORBIDDEN_COPY = [
  "synapse_in_app_notifications",
  "HTTPException",
  "CHAIN_RPC",
  "PROVIDER_",
  "WITHDRAW_",
  "backend",
  "ledger",
  "SQL",
  "RPC Error",
];

const evidence = {
  generatedAt: new Date().toISOString(),
  environment: {
    adminFrontUrl: ADMIN_FRONT_URL,
    adminGatewayUrl: ADMIN_GATEWAY_URL,
    serviceId: SERVICE_ID,
  },
  passed: [],
  failed: [],
  api: {},
  sql: {},
  dom: {},
  screenshots: [],
};

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function pass(name, detail = "") {
  evidence.passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail) {
  evidence.failed.push({ name, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

function isLocalUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

function assertLocalOnly() {
  if (!isLocalUrl(ADMIN_FRONT_URL) || !isLocalUrl(ADMIN_GATEWAY_URL)) {
    throw new Error("Admin inbox E2E only runs against local Admin URLs.");
  }
  if (!/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(ADMIN_DSN)) {
    throw new Error("Admin inbox E2E only runs against local Postgres DSN.");
  }
}

function sh(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${(
        result.stderr ||
        result.stdout ||
        ""
      ).trim()}`
    );
  }
  return result.stdout.trim();
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function adminSql(sql) {
  return sh("psql", [
    ADMIN_DSN,
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

function adminQueryJson(sql) {
  const text = sh("psql", [
    ADMIN_DSN,
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
  return text ? JSON.parse(text) : null;
}

function runAdminMigration(dsn) {
  const pythonPath = path.join(ROOT, "services/gateway-admin/.venv/bin/python");
  const scriptPath = path.join(
    ROOT,
    "services/gateway-admin/scripts/apply_migrations.py"
  );
  const sqlFile = path.join(
    ROOT,
    "infra/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql"
  );
  sh(pythonPath, ["-u", scriptPath, "--dsn", dsn, "--sql-file", sqlFile], {
    env: {
      ...process.env,
      ADMIN_DATABASE_DSN: ADMIN_DSN,
      ADMIN_DATABASE_MIGRATION_DSN: dsn,
    },
  });
}

function applyLocalAdminSchema() {
  try {
    runAdminMigration(ADMIN_MIGRATION_DSN);
  } catch (error) {
    if (!String(error?.message || error).includes("lacks CREATE privileges")) {
      throw error;
    }
    runAdminMigration(ADMIN_LOCAL_SUPERUSER_DSN);
  }
}

function resolveLocalAdminTotpSecret() {
  if (process.env.ADMIN_TOTP_SECRET) return process.env.ADMIN_TOTP_SECRET;
  try {
    const text = sh("psql", [
      ADMIN_DSN,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `
        SELECT to_json(payload_json->>'totpSecret')
        FROM admin_mfa_factors mf
        JOIN admin_users au ON au.admin_id = mf.admin_id
        WHERE au.email = ${sqlLiteral(ADMIN_EMAIL)}
          AND mf.status = 'active'
          AND payload_json ? 'totpSecret'
        ORDER BY mf.updated_at DESC
        LIMIT 1
      `,
    ]);
    const value = JSON.parse(text || "null");
    return typeof value === "string" && value.trim()
      ? value.trim()
      : ADMIN_TOTP_SECRET;
  } catch {
    return ADMIN_TOTP_SECRET;
  }
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of String(secret)
    .replace(/=+$/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0)
      throw new Error(`Invalid base32 character in ADMIN_TOTP_SECRET: ${char}`);
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
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

function parseSessionCookie(setCookieHeader) {
  return (
    String(
      Array.isArray(setCookieHeader)
        ? setCookieHeader.join(",")
        : setCookieHeader || ""
    )
      .split(/,(?=\s*[^;,]+=)/)
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${ADMIN_COOKIE_NAME}=`))
      ?.split(";")[0]
      .slice(ADMIN_COOKIE_NAME.length + 1) || ""
  );
}

async function loginAdmin() {
  if (process.env.ADMIN_SESSION_TOKEN) {
    return {
      sessionToken: process.env.ADMIN_SESSION_TOKEN,
      csrfToken: process.env.ADMIN_CSRF_TOKEN || "",
      adminId: process.env.ADMIN_ID || "adm_super_admin",
    };
  }
  const response = await fetch(`${ADMIN_GATEWAY_URL}/api/admin/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      otpCode:
        process.env.ADMIN_OTP_CODE ||
        totp(resolveLocalAdminTotpSecret() || ADMIN_TOTP_SECRET),
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
      `Admin login failed: ${response.status} ${JSON.stringify(body).slice(
        0,
        800
      )}`
    );
  }
  return {
    sessionToken,
    csrfToken: body.data?.csrfToken || "",
    adminId: body.data?.admin?.adminId || "adm_super_admin",
  };
}

async function adminApi(pathname, auth, options = {}) {
  const method = options.method || "GET";
  const headers = {
    Accept: "application/json",
    Cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(method === "GET" || !auth.csrfToken
      ? {}
      : { "X-CSRF-Token": auth.csrfToken }),
  };
  const response = await fetch(`${ADMIN_GATEWAY_URL}${pathname}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
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

async function capture(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  evidence.screenshots.push({
    name,
    path: path.relative(ROOT, filePath),
  });
  return filePath;
}

function assertNoForbiddenText(text, label) {
  const hits = FORBIDDEN_COPY.filter((value) => text.includes(value));
  if (hits.length) {
    throw new Error(`${label} leaked forbidden text: ${hits.join(", ")}`);
  }
}

function cleanupExistingNotificationRows(serviceId) {
  adminSql(`
    DELETE FROM synapse_in_app_notifications
    WHERE recipient_type = 'admin'
      AND resource_type = 'provider_service'
      AND resource_id = ${sqlLiteral(serviceId)}
      AND event_type IN (
        'admin.provider_service.pause',
        'admin.provider_service.resume',
        'admin.provider_service.action_failed'
      );
  `);
}

function selectService(items) {
  return items.find((item) => item.serviceId === SERVICE_ID);
}

async function waitForNotification(serviceId, adminId) {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const rows =
      adminQueryJson(`
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT notification_id AS "notificationId",
                 dedupe_key AS "dedupeKey",
                 recipient_type AS "recipientType",
                 recipient_admin_id AS "recipientAdminId",
                 event_type AS "eventType",
                 category, severity, title, body, action_url AS "actionUrl",
                 resource_type AS "resourceType", resource_id AS "resourceId",
                 read_at AS "readAt", archived_at AS "archivedAt", created_at AS "createdAt"
          FROM synapse_in_app_notifications
          WHERE recipient_type = 'admin'
            AND recipient_admin_id = ${sqlLiteral(adminId)}
            AND resource_type = 'provider_service'
            AND resource_id = ${sqlLiteral(serviceId)}
            AND event_type IN (
              'admin.provider_service.pause',
              'admin.provider_service.action_failed'
            )
          ORDER BY created_at DESC
          LIMIT 20
        ) t
      `) || [];
    const row = rows.find((item) => item.readAt === null);
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for admin provider-service notification.");
}

function collectNotificationSqlEvidence(serviceId, adminId, notificationId) {
  const current =
    adminQueryJson(`
      SELECT row_to_json(t)
      FROM (
        SELECT notification_id AS "notificationId",
               dedupe_key AS "dedupeKey",
               recipient_admin_id AS "recipientAdminId",
               event_type AS "eventType",
               title, body, action_url AS "actionUrl",
               read_at AS "readAt", archived_at AS "archivedAt"
        FROM synapse_in_app_notifications
        WHERE notification_id = ${sqlLiteral(notificationId)}
          AND recipient_admin_id = ${sqlLiteral(adminId)}
        LIMIT 1
      ) t
    `) || {};
  return {
    rows:
      adminQueryJson(`
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT notification_id AS "notificationId",
                 dedupe_key AS "dedupeKey",
                 recipient_type AS "recipientType",
                 recipient_admin_id AS "recipientAdminId",
                 event_type AS "eventType",
                 category, severity, title, body, action_url AS "actionUrl",
                 resource_type AS "resourceType", resource_id AS "resourceId",
                 read_at AS "readAt", archived_at AS "archivedAt", created_at AS "createdAt"
          FROM synapse_in_app_notifications
          WHERE recipient_type = 'admin'
            AND resource_type = 'provider_service'
            AND resource_id = ${sqlLiteral(serviceId)}
          ORDER BY created_at DESC
          LIMIT 20
        ) t
      `) || [],
    current,
    duplicateCount: current.dedupeKey
      ? adminQueryJson(`
        SELECT row_to_json(t)
        FROM (
          SELECT ${sqlLiteral(current.dedupeKey)} AS "dedupeKey",
                 COUNT(*)::int AS "duplicateCount"
          FROM synapse_in_app_notifications
          WHERE dedupe_key = ${sqlLiteral(current.dedupeKey)}
        ) t
      `)
      : null,
  };
}

function writeReports() {
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(
      {
        ...evidence,
        status: evidence.failed.length ? "failed" : "success",
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "sql-evidence.json"),
    `${JSON.stringify(evidence.sql, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "screenshot-evidence.json"),
    `${JSON.stringify(
      {
        screenshots: evidence.screenshots,
        dom: evidence.dom,
      },
      null,
      2
    )}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Admin Inbox Provider Services E2E",
      "",
      `Status: ${evidence.failed.length ? "failed" : "success"}`,
      `Generated: ${evidence.generatedAt}`,
      "",
      "## Passed",
      ...evidence.passed.map((item) => `- ${item.name}: ${item.detail}`),
      "",
      "## Failed",
      ...(evidence.failed.length
        ? evidence.failed.map((item) => `- ${item.name}: ${item.detail}`)
        : ["- none"]),
      "",
      "## Screenshots",
      ...evidence.screenshots.map((item) => `- ${item.name}: ${item.path}`),
      "",
    ].join("\n")
  );
}

async function main() {
  assertLocalOnly();
  let schemaReady = adminQueryJson(
    `
    SELECT to_json(
      to_regclass('public.synapse_in_app_notifications') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'synapse_in_app_notifications'
          AND column_name = 'row_id'
          AND (column_default IS NOT NULL OR is_identity = 'YES')
      )
    );
    `
  );
  if (schemaReady !== true) {
    applyLocalAdminSchema();
    schemaReady = adminQueryJson(
      `
      SELECT to_json(
        to_regclass('public.synapse_in_app_notifications') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'synapse_in_app_notifications'
            AND column_name = 'row_id'
            AND (column_default IS NOT NULL OR is_identity = 'YES')
        )
      );
      `
    );
  }
  if (schemaReady !== true) {
    throw new Error(
      "synapse_in_app_notifications table is missing or stale after local schema migration."
    );
  }
  pass("postgres schema ready", "admin inbox storage exists");

  const auth = await loginAdmin();
  evidence.environment.adminId = auth.adminId;
  pass("admin login", auth.adminId);

  const list = await adminApi(
    `/api/admin/v1/provider-services?query=${encodeURIComponent(
      SERVICE_ID
    )}&page=1&pageSize=20`,
    auth
  );
  const service = selectService(list.items || []);
  if (!service?.serviceId) {
    throw new Error(
      `Canonical provider service ${SERVICE_ID} is not available. Run the Synapse-Network-Provider local onboarding first or set ADMIN_INBOX_PROVIDER_SERVICE_ID.`
    );
  }
  const serviceId = service.serviceId;
  cleanupExistingNotificationRows(serviceId);
  evidence.environment.serviceId = serviceId;
  pass("provider service selected", serviceId);

  let browser;
  let pauseSucceeded = false;
  try {
    try {
      await adminApi(
        `/api/admin/v1/provider-services/${encodeURIComponent(
          serviceId
        )}/lifecycle`,
        auth,
        { method: "POST", body: { action: "PAUSE", note: RUN_ID } }
      );
      pauseSucceeded = true;
      pass("provider service pause", serviceId);
    } catch (error) {
      pass(
        "provider service action failure notification path",
        error instanceof Error ? error.message : String(error)
      );
    }
    const notification = await waitForNotification(serviceId, auth.adminId);
    evidence.sql.beforeOpen = collectNotificationSqlEvidence(
      serviceId,
      auth.adminId,
      notification.notificationId
    );
    pass("sql notification unread", notification.notificationId);

    browser = await chromium.launch({ headless: true });
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
      {
        name: ADMIN_COOKIE_NAME,
        value: auth.sessionToken,
        url: ADMIN_GATEWAY_URL,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await context.route("**/api/admin/v1/**", async (route) => {
      const request = route.request();
      const sourceUrl = new URL(request.url());
      const targetUrl = `${ADMIN_GATEWAY_URL}${sourceUrl.pathname}${sourceUrl.search}`;
      const headers = {
        ...request.headers(),
        cookie: `${ADMIN_COOKIE_NAME}=${auth.sessionToken}`,
      };
      delete headers.host;
      delete headers["content-length"];
      if (auth.csrfToken && request.method().toUpperCase() !== "GET") {
        headers["x-csrf-token"] = auth.csrfToken;
      }
      const response = await fetch(targetUrl, {
        method: request.method(),
        headers,
        body:
          request.method().toUpperCase() === "GET"
            ? undefined
            : request.postDataBuffer(),
      });
      const responseHeaders = Object.fromEntries(response.headers.entries());
      delete responseHeaders["content-encoding"];
      delete responseHeaders["content-length"];
      delete responseHeaders["transfer-encoding"];
      await route.fulfill({
        status: response.status,
        headers: responseHeaders,
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    if (auth.csrfToken) {
      await context.addInitScript((csrfToken) => {
        window.sessionStorage.setItem("synapse.admin.csrfToken", csrfToken);
      }, auth.csrfToken);
    }
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") {
        evidence.failed.push({
          name: "browser console",
          detail: message.text(),
        });
      }
    });
    page.on("requestfailed", (request) => {
      const errorText = request.failure()?.errorText || "";
      if (errorText.includes("net::ERR_ABORTED")) {
        return;
      }
      evidence.failed.push({
        name: "browser request failed",
        detail: `${request.method()} ${request.url()} ${errorText}`.trim(),
      });
    });
    await page.goto(`${ADMIN_FRONT_URL}/provider-services`, {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    await page
      .locator("text=Provider 服务")
      .or(page.locator("text=Provider Services"))
      .first()
      .waitFor({ timeout: 30_000 });
    await capture(page, "provider-services-before");

    await page.getByRole("button", { name: /通知/ }).click();
    await page.waitForSelector("text=Admin Inbox", { timeout: 30_000 });
    await page.waitForSelector(`text=${notification.title}`, {
      timeout: 30_000,
    });
    const inboxText = await page.locator("body").textContent();
    assertNoForbiddenText(inboxText || "", "admin inbox DOM");
    await capture(page, "inbox-unread");
    evidence.dom.unread = {
      hasInbox: (inboxText || "").includes("Admin Inbox"),
      hasNotification: (inboxText || "").includes(notification.title),
      hasArchive: (inboxText || "").includes("归档"),
      hasView: (inboxText || "").includes("查看"),
    };
    pass("admin-front inbox unread DOM", "notification visible");

    await page.getByRole("button", { name: "查看" }).first().click();
    await page.waitForURL(new RegExp(`provider-services.*${serviceId}`), {
      timeout: 30_000,
    });
    evidence.sql.afterRead = collectNotificationSqlEvidence(
      serviceId,
      auth.adminId,
      notification.notificationId
    );
    if (!evidence.sql.afterRead.current?.readAt) {
      throw new Error("notification read_at was not set after opening action");
    }
    await capture(page, "inbox-read");
    pass("sql notification read", notification.notificationId);

    await page.getByRole("button", { name: /通知/ }).click();
    await page.waitForSelector(`text=${notification.title}`, {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "归档" }).first().click();
    await page.waitForTimeout(500);
    evidence.sql.afterArchive = collectNotificationSqlEvidence(
      serviceId,
      auth.adminId,
      notification.notificationId
    );
    if (!evidence.sql.afterArchive.current?.archivedAt) {
      throw new Error("notification archived_at was not set after archive");
    }
    pass("sql notification archived", notification.notificationId);

    const duplicateCount =
      evidence.sql.afterArchive.duplicateCount?.duplicateCount ?? 0;
    if (duplicateCount > 1) {
      throw new Error(`dedupe key duplicated: ${duplicateCount}`);
    }
    pass("sql dedupe", `duplicateCount=${duplicateCount}`);
  } finally {
    try {
      if (pauseSucceeded) {
        await adminApi(
          `/api/admin/v1/provider-services/${encodeURIComponent(
            serviceId
          )}/lifecycle`,
          auth,
          {
            method: "POST",
            body: { action: "RESUME", note: `${RUN_ID}:cleanup` },
          }
        );
        pass("provider service resumed", serviceId);
      } else {
        pass("provider service resume skipped", "pause did not succeed");
      }
    } catch (error) {
      fail(
        "provider service resume cleanup",
        error instanceof Error ? error.message : String(error)
      );
    }
    if (browser) await browser.close();
  }
}

main()
  .catch((error) => {
    fail("fatal", error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    writeReports();
    if (evidence.failed.length) {
      console.error(`[admin-inbox-provider-services] evidence=${OUT_DIR}`);
      process.exitCode = 1;
    } else {
      console.log(`[admin-inbox-provider-services] evidence=${OUT_DIR}`);
    }
  });
