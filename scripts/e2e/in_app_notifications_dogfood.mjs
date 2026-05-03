#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { chromium, request as playwrightRequest } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const OUT_DIR = process.env.INAPP_E2E_OUT_DIR
  ? path.resolve(process.env.INAPP_E2E_OUT_DIR)
  : path.join(ROOT, "output/dogfood/in-app-notifications", timestamp);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const REPORT_PATH = path.join(OUT_DIR, "report.json");
const RUN_ID =
  process.env.INAPP_E2E_RUN_ID || `inapp-e2e-${Date.now().toString(36)}`;
const SAFE_RUN_ID = RUN_ID.replace(/[^a-zA-Z0-9_-]/g, "_");
const GATEWAY_BASE_URL = (
  process.env.INAPP_E2E_GATEWAY_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const USER_FRONT_URL = (
  process.env.INAPP_E2E_USER_FRONT_URL || "http://127.0.0.1:3000"
).replace(/\/+$/, "");
const POSTGRES_DSN =
  process.env.INAPP_E2E_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
const BOOTSTRAP_DSN =
  process.env.INAPP_E2E_BOOTSTRAP_DSN ||
  process.env.LOCAL_GATEWAY_POSTGRES_BOOTSTRAP_DSN ||
  process.env.POSTGRES_BOOTSTRAP_DSN ||
  "postgresql://synapse:local-dev-postgres-password@127.0.0.1:15432/synapse_gateway";
const OWNER_PRIVATE_KEY =
  process.env.INAPP_E2E_OWNER_PRIVATE_KEY ||
  `0x${crypto.createHash("sha256").update(`${RUN_ID}:owner`).digest("hex")}`;
const OTHER_OWNER_PRIVATE_KEY =
  process.env.INAPP_E2E_OTHER_OWNER_PRIVATE_KEY ||
  `0x${crypto
    .createHash("sha256")
    .update(`${RUN_ID}:other-owner`)
    .digest("hex")}`;
const OWNER_WALLET = new ethers.Wallet(OWNER_PRIVATE_KEY);
const OTHER_OWNER_WALLET = new ethers.Wallet(OTHER_OWNER_PRIVATE_KEY);
const OWNER_ADDRESS = (
  process.env.INAPP_E2E_OWNER_ADDRESS || OWNER_WALLET.address
).toLowerCase();
const OTHER_OWNER_ADDRESS = (
  process.env.INAPP_E2E_OTHER_OWNER_ADDRESS || OTHER_OWNER_WALLET.address
).toLowerCase();
const AUTH_WALLETS = new Map([
  [OWNER_ADDRESS, OWNER_WALLET],
  [OTHER_OWNER_ADDRESS, OTHER_OWNER_WALLET],
]);
const AUTH_TOKENS = new Map();

const passed = [];
const failed = [];
const screenshots = [];
const apiEvidence = [];
const consoleErrors = [];
const bugfixItems = [];

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail, extra = {}) {
  const item = { name, detail, ...extra };
  failed.push(item);
  bugfixItems.push({
    id: `BUG-${String(bugfixItems.length + 1).padStart(3, "0")}`,
    severity: extra.severity || "P1",
    scenario: name,
    screenshot: extra.screenshot || "",
    apiEvidence: extra.apiEvidence || "",
    reproSteps: extra.reproSteps || "Run npm run e2e:in-app-notifications",
    expected: extra.expected || "",
    actual: detail,
    status: "Open",
  });
  console.error(`FAIL ${name} - ${detail}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

function stopIfFailed() {
  if (failed.length > 0) {
    writeReports();
    process.exitCode = 1;
    return true;
  }
  return false;
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function assertLocalOnly() {
  if (!isLocalUrl(GATEWAY_BASE_URL) || !isLocalUrl(USER_FRONT_URL)) {
    throw new Error(
      "Refusing to run in-app notification dogfood against non-local Gateway/User-front URLs."
    );
  }
  if (!/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(POSTGRES_DSN)) {
    throw new Error(
      "Refusing to run in-app notification dogfood against non-local Postgres DSN."
    );
  }
}

function runPsql(args, { dsn = POSTGRES_DSN, input = undefined } = {}) {
  const result = spawnSync(
    "psql",
    [dsn, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args],
    {
      cwd: ROOT,
      input,
      encoding: "utf8",
    }
  );
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "psql failed").trim());
  }
  return result.stdout;
}

function psqlScalar(sql, dsn = POSTGRES_DSN) {
  return runPsql(["-t", "-A", "-c", sql], { dsn }).trim();
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function ensureSchema() {
  const exists = psqlScalar(
    "SELECT to_regclass('public.synapse_in_app_notifications') IS NOT NULL;"
  );
  if (exists === "t") {
    return "table exists";
  }
  if (!/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(BOOTSTRAP_DSN)) {
    throw new Error(
      "Notification table missing and bootstrap DSN is not local."
    );
  }
  const schemaPath = path.join(
    ROOT,
    "infra/postgres/init/gateway/001_synapse_schema.sql"
  );
  runPsql(["-f", schemaPath], { dsn: BOOTSTRAP_DSN });
  const created = psqlScalar(
    "SELECT to_regclass('public.synapse_in_app_notifications') IS NOT NULL;"
  );
  if (created !== "t") {
    throw new Error(
      "synapse_in_app_notifications table still missing after bootstrap."
    );
  }
  return "table bootstrapped";
}

function buildWagmiStore(address, chainId = 31337) {
  return {
    state: {
      connections: {
        __type: "Map",
        value: [
          [
            "injected",
            {
              accounts: [address],
              chainId,
              connector: {
                id: "injected",
                name: "Injected",
                type: "injected",
                uid: "injected",
              },
            },
          ],
        ],
      },
      chainId,
      current: "injected",
      status: "connected",
    },
    version: 2,
  };
}

function seedNotifications() {
  const rows = [
    {
      id: `${SAFE_RUN_ID}-success-action`,
      owner: OWNER_ADDRESS,
      eventType: "deposit.confirmed",
      category: "deposit",
      severity: "success",
      priority: "transactional",
      title: "Deposit confirmed",
      body: "Deposit credited.",
      actionUrl: "/dashboard/billing/credits",
      resourceType: "deposit",
      resourceId: `${SAFE_RUN_ID}-dep`,
      payload: {
        amount: "100.000000",
        currency: "USDC",
        depositId: `${SAFE_RUN_ID}-dep`,
        status: "CONFIRMED",
      },
      ageSeconds: 1,
    },
    {
      id: `${SAFE_RUN_ID}-critical`,
      owner: OWNER_ADDRESS,
      eventType: "refund.failed",
      category: "refund",
      severity: "critical",
      priority: "transactional_high",
      title: "Refund failed",
      body: "Refund requires attention.",
      actionUrl: null,
      resourceType: "refund",
      resourceId: `${SAFE_RUN_ID}-refund`,
      payload: {
        amount: "5.000000",
        currency: "USDC",
        refundId: `${SAFE_RUN_ID}-refund`,
        status: "FAILED",
      },
      ageSeconds: 2,
    },
    {
      id: `${SAFE_RUN_ID}-longtext`,
      owner: OWNER_ADDRESS,
      eventType: "security.new_device_login",
      category: "security",
      severity: "warning",
      priority: "security",
      title: "New device login",
      body: `Long boundary ${"x".repeat(900)}`,
      actionUrl: "/dashboard/account/settings",
      resourceType: "security_event",
      resourceId: `${SAFE_RUN_ID}-security`,
      payload: {
        status: "NEW_DEVICE",
        deviceId: `${SAFE_RUN_ID}-device`,
        resourceId: `${SAFE_RUN_ID}-security`,
      },
      ageSeconds: 3,
    },
    {
      id: `${SAFE_RUN_ID}-info`,
      owner: OWNER_ADDRESS,
      eventType: "provider_health.recovered",
      category: "service",
      severity: "success",
      priority: "transactional",
      title: "Provider health recovered",
      body: "Provider health is back within threshold.",
      actionUrl: "/provider/health",
      resourceType: "provider_health",
      resourceId: `${SAFE_RUN_ID}-provider`,
      payload: { status: "RECOVERED", providerId: `${SAFE_RUN_ID}-provider` },
      ageSeconds: 4,
    },
    {
      id: `${SAFE_RUN_ID}-other-owner`,
      owner: OTHER_OWNER_ADDRESS,
      eventType: "deposit.confirmed",
      category: "deposit",
      severity: "success",
      priority: "transactional",
      title: "Other owner notification",
      body: "This row must not appear for the primary owner.",
      actionUrl: null,
      resourceType: "deposit",
      resourceId: `${SAFE_RUN_ID}-other`,
      payload: {
        amount: "1.000000",
        currency: "USDC",
        depositId: `${SAFE_RUN_ID}-other`,
        status: "CONFIRMED",
      },
      ageSeconds: 5,
    },
  ];
  const values = rows
    .map(
      (row) => `(
    ${sqlLiteral(row.id)},
    ${sqlLiteral(`e2e:${row.id}`)},
    'owner',
    ${sqlLiteral(row.owner)},
    ${sqlLiteral(row.eventType)},
    ${sqlLiteral(row.category)},
    ${sqlLiteral(row.severity)},
    ${sqlLiteral(row.priority)},
    ${sqlLiteral(row.title)},
    ${sqlLiteral(row.body)},
    ${row.actionUrl ? sqlLiteral(row.actionUrl) : "NULL"},
    ${sqlLiteral(row.resourceType)},
    ${sqlLiteral(row.resourceId)},
    ${sqlLiteral(JSON.stringify(row.payload))}::jsonb,
    now() - interval '${row.ageSeconds} seconds'
  )`
    )
    .join(",\n");
  runPsql([
    "-c",
    `
    DELETE FROM synapse_in_app_notifications WHERE notification_id LIKE ${sqlLiteral(
      `${SAFE_RUN_ID}-%`
    )};
    INSERT INTO synapse_in_app_notifications (
      notification_id, dedupe_key, recipient_type, recipient_owner_id,
      event_type, category, severity, priority, title, body, action_url,
      resource_type, resource_id, payload, created_at
    ) VALUES ${values}
    ON CONFLICT (dedupe_key) DO NOTHING;
  `,
  ]);
  return rows;
}

async function gatewayJson(pathname, options = {}) {
  const response = await fetch(`${GATEWAY_BASE_URL}/api${pathname}`, {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${options.method || "GET"} ${pathname} failed: ${
        response.status
      } ${JSON.stringify(payload).slice(0, 500)}`
    );
  }
  return payload;
}

async function authTokenFor(owner) {
  const normalized = String(owner).toLowerCase();
  if (AUTH_TOKENS.has(normalized)) return AUTH_TOKENS.get(normalized);
  const wallet = AUTH_WALLETS.get(normalized);
  if (!wallet) {
    throw new Error(`No local auth wallet configured for ${normalized}.`);
  }
  const challenge = await gatewayJson(
    `/v1/auth/challenge?address=${encodeURIComponent(wallet.address)}`
  );
  const message = challenge.challenge || challenge.message;
  if (!message)
    throw new Error(`Auth challenge missing message for ${normalized}`);
  const signature = await wallet.signMessage(message);
  const verified = await gatewayJson("/v1/auth/verify", {
    method: "POST",
    body: { wallet_address: wallet.address, message, signature },
  });
  const token = verified.access_token || verified.token || verified.accessToken;
  if (!token)
    throw new Error(`Auth verify did not return token for ${normalized}`);
  AUTH_TOKENS.set(normalized, token);
  return token;
}

async function apiRequest(
  context,
  pathname,
  { method = "GET", owner = OWNER_ADDRESS } = {}
) {
  const token = await authTokenFor(owner);
  const response = await context.fetch(`${GATEWAY_BASE_URL}/api${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "X-User-Address": owner,
    },
  });
  const payload = await response.json().catch(() => ({}));
  apiEvidence.push({
    pathname,
    method,
    status: response.status(),
    ok: response.ok(),
    owner,
  });
  if (!response.ok()) {
    throw new Error(
      `${method} ${pathname} failed: ${response.status()} ${JSON.stringify(
        payload
      ).slice(0, 500)}`
    );
  }
  return payload;
}

function assertUtcIso(value, label) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,6})?Z$/.test(String(value))
  ) {
    throw new Error(`${label} is not UTC ISO-8601 Z timestamp: ${value}`);
  }
}

function assertNoSecrets(value, label) {
  const text = JSON.stringify(value);
  const patterns = [
    /authorization/i,
    /private[_-]?key/i,
    /jwt/i,
    /admin[_-]?token/i,
    /raw[_-]?signature/i,
    /0x[a-fA-F0-9]{64,}/,
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      throw new Error(
        `${label} contains secret-like value matching ${pattern}`
      );
    }
  }
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  screenshots.push(filePath);
  return filePath;
}

async function installAuth(context) {
  const token = await authTokenFor(OWNER_ADDRESS);
  const session = {
    token,
    wallet: OWNER_ADDRESS,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  const wagmiStore = buildWagmiStore(OWNER_ADDRESS);
  await context.addInitScript(
    ({ address, session, wagmiStore }) => {
      localStorage.setItem("synapse_lang", "en");
      localStorage.setItem("a2a_auth_session", JSON.stringify(session));
      localStorage.setItem(
        "developer_session",
        JSON.stringify({ wallet: address })
      );
      localStorage.setItem("wagmi.store", JSON.stringify(wagmiStore));
      localStorage.setItem(
        "wagmi.recentConnectorId",
        JSON.stringify("injected")
      );
      localStorage.setItem("wagmi.injected.connected", JSON.stringify(true));
      localStorage.removeItem("wagmi.injected.disconnected");
      window.ethereum = {
        isMetaMask: true,
        selectedAddress: address,
        request: async ({ method }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts")
            return [address];
          if (method === "eth_chainId") return "0x7a69";
          return null;
        },
        on: () => undefined,
        removeListener: () => undefined,
      };
    },
    { address: OWNER_ADDRESS, session, wagmiStore }
  );
}

async function runApiAssertions(apiContext) {
  const list = await apiRequest(apiContext, "/v1/notifications?limit=2");
  if (list.notifications.length !== 2 || !list.nextCursor) {
    throw new Error("Pagination did not return 2 rows and a nextCursor.");
  }
  for (const notification of list.notifications) {
    assertUtcIso(
      notification.createdAt,
      `${notification.notificationId}.createdAt`
    );
    assertNoSecrets(
      notification.payload,
      `${notification.notificationId}.payload`
    );
  }
  const count = await apiRequest(apiContext, "/v1/notifications/unread-count");
  if (count.unreadCount !== 4) {
    throw new Error(
      `Expected primary owner unreadCount=4, got ${count.unreadCount}`
    );
  }
  const other = await apiRequest(apiContext, "/v1/notifications/unread-count", {
    owner: OTHER_OWNER_ADDRESS,
  });
  if (other.unreadCount !== 1) {
    throw new Error(
      `Expected other owner unreadCount=1, got ${other.unreadCount}`
    );
  }
  const scoped = await apiRequest(apiContext, "/v1/notifications?limit=20", {
    owner: OTHER_OWNER_ADDRESS,
  });
  if (
    scoped.notifications.some(
      (item) =>
        String(item.notificationId).startsWith(SAFE_RUN_ID) &&
        !item.notificationId.endsWith("other-owner")
    )
  ) {
    throw new Error(
      "Owner scoping leaked primary owner notifications to other owner."
    );
  }
  return "API list/count/pagination/owner-scope passed";
}

async function runUiAssertions() {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== "0",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await installAuth(context);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    await page.goto(`${USER_FRONT_URL}/dashboard/overview`, {
      waitUntil: "networkidle",
      timeout: 45000,
    });
    await page.waitForSelector('button[aria-label="Notifications"]', {
      timeout: 30000,
    });
    await page.waitForSelector("text=4", { timeout: 30000 });
    await screenshot(page, "01-unread-badge");
    await page.getByLabel("Notifications").click();
    await page.waitForSelector("text=Deposit confirmed", { timeout: 30000 });
    await screenshot(page, "02-dropdown-list");
    await page.getByText("Open").first().click();
    await page.waitForURL(
      (url) => url.pathname === "/dashboard/billing/credits",
      { timeout: 30000 }
    );
    await screenshot(page, "03-action-url-opened");
    await page.goto(`${USER_FRONT_URL}/dashboard/overview`, {
      waitUntil: "networkidle",
      timeout: 45000,
    });
    await page.getByLabel("Notifications").click();
    await page.getByRole("button", { name: "Mark all read" }).click();
    await page.waitForTimeout(500);
    await screenshot(page, "04-mark-all-read");
    while (await page.getByLabel("Archive notification").count()) {
      await page.getByLabel("Archive notification").first().click();
      await page.waitForTimeout(200);
    }
    await page.getByLabel("Notifications").click();
    await page.getByLabel("Notifications").click();
    await page.waitForSelector("text=No notifications yet.", {
      timeout: 30000,
    });
    await screenshot(page, "05-empty-state");
  } finally {
    await browser.close();
  }
  if (consoleErrors.length) {
    throw new Error(
      `Console/page errors: ${consoleErrors.slice(0, 5).join(" | ")}`
    );
  }
  return "UI badge/dropdown/action/mark-all/archive/empty screenshots passed";
}

function writeReports() {
  const status = failed.length === 0 ? "success" : "failed";
  const report = {
    status,
    runId: RUN_ID,
    generatedAt: new Date().toISOString(),
    environment: "local",
    gatewayBaseUrl: GATEWAY_BASE_URL,
    userFrontUrl: USER_FRONT_URL,
    passed,
    failed,
    screenshots,
    apiEvidence,
    consoleErrors,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      `# In-App Notifications Dogfood Report`,
      ``,
      `- Status: ${status}`,
      `- Run ID: ${RUN_ID}`,
      `- Generated at: ${report.generatedAt}`,
      `- Gateway: ${GATEWAY_BASE_URL}`,
      `- User-front: ${USER_FRONT_URL}`,
      ``,
      `## Passed`,
      ...passed.map(
        (item) => `- ${item.name}${item.detail ? `: ${item.detail}` : ""}`
      ),
      ``,
      `## Failed`,
      ...(failed.length
        ? failed.map((item) => `- ${item.name}: ${item.detail}`)
        : ["- none"]),
      ``,
      `## Screenshots`,
      ...screenshots.map((item) => `- ${path.relative(OUT_DIR, item)}`),
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "bugfix-log.md"),
    [
      `# In-App Notifications Bugfix Log`,
      ``,
      ...(bugfixItems.length
        ? bugfixItems.map((item) =>
            [
              `## ${item.id} ${item.scenario}`,
              `- Severity: ${item.severity}`,
              `- Status: ${item.status}`,
              `- Screenshot: ${item.screenshot || "n/a"}`,
              `- API Evidence: ${item.apiEvidence || "n/a"}`,
              `- Repro Steps: ${item.reproSteps}`,
              `- Expected: ${item.expected || "n/a"}`,
              `- Actual: ${item.actual}`,
            ].join("\n")
          )
        : ["No open bugs."]),
    ].join("\n\n")
  );
  console.log(`Report: ${REPORT_PATH}`);
  return report;
}

async function main() {
  assertLocalOnly();
  await step("postgres schema ready", async () => ensureSchema());
  if (stopIfFailed()) return;
  await step(
    "seed representative notifications",
    async () => `${seedNotifications().length} rows seeded`
  );
  if (stopIfFailed()) return;
  const apiContext = await playwrightRequest.newContext();
  try {
    await step("gateway api assertions", async () =>
      runApiAssertions(apiContext)
    );
  } finally {
    await apiContext.dispose();
  }
  if (stopIfFailed()) return;
  await step("user-front ui assertions", async () => runUiAssertions());
  const report = writeReports();
  if (report.status !== "success") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  fail(
    "runner crashed",
    error instanceof Error ? error.message : String(error)
  );
  writeReports();
  process.exitCode = 1;
});
