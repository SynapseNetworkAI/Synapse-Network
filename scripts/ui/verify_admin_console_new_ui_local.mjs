#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { adminConsoleRouteSpecs } from "../lib/admin_console_new_ui_contract.mjs";
import {
  ROOT,
  assertLocalOnly,
  buildLocalConfig,
  forbiddenLoginTexts,
  forbiddenPageTexts,
  sanitizeWithConfig,
} from "../lib/admin_menu_config_local_contract.mjs";

const generatedAt = new Date();
const timestamp = generatedAt.toISOString().replace(/[:.]/g, "");
const outDir = path.resolve(
  process.env.ADMIN_CONSOLE_NEW_UI_EVIDENCE_DIR ||
    path.join(ROOT, "output/e2e/admin-console-new-ui-local", timestamp)
);
const screenshotDir = path.join(outDir, "screenshots");
const config = buildLocalConfig();
const evidence = {
  status: "success",
  generatedAt: generatedAt.toISOString(),
  adminFrontUrl: config.adminFrontUrl,
  adminGatewayUrl: config.adminGatewayUrl,
  checks: [],
  failed: [],
  api: [],
  dom: [],
  screenshots: [],
  trace: [],
};

fs.mkdirSync(screenshotDir, { recursive: true });

function sanitize(value) {
  return sanitizeWithConfig(value, config);
}

function addTrace(name, detail = {}) {
  evidence.trace.push(
    sanitize({ timestamp: new Date().toISOString(), name, ...detail })
  );
}

function addCheck(name, ok, detail = "") {
  const row = sanitize({ name, ok: Boolean(ok), detail });
  evidence.checks.push(row);
  if (!row.ok) evidence.failed.push(row);
  console.log(`[admin-console-new-ui] ${row.ok ? "PASS" : "FAIL"} ${name}`);
}

function slugRoute(route) {
  return route.replace(/^\/+/, "").replace(/[^a-z0-9]+/gi, "-") || "root";
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(init.headers || {}) },
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  return { body, response };
}

async function preflight() {
  assertLocalOnly(config);
  const front = await fetch(config.adminFrontUrl);
  addCheck("preflight:admin-front-local", front.ok, String(front.status));
  if (!front.ok) throw new Error(`Admin-front not reachable: ${front.status}`);

  const policyUrl = `${config.adminGatewayUrl}/api/admin/v1/auth/policy`;
  const { body, response } = await fetchJson(policyUrl);
  const policy = body?.data || body;
  const ok = response.ok && policy?.loginTotpRequired === false;
  evidence.api.push(
    sanitize({
      route: "/api/admin/v1/auth/policy",
      status: response.status,
      loginTotpRequired: policy?.loginTotpRequired,
      highRiskTotpRequired: policy?.highRiskTotpRequired,
    })
  );
  addCheck(
    "auth-policy:login-google-fa-disabled",
    ok,
    `loginTotpRequired=${String(policy?.loginTotpRequired)}`
  );
  if (!ok) {
    throw new Error("Local Google FA login must be disabled for this E2E.");
  }
}

async function assertAbsent(page, texts, label) {
  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  const present = texts.filter((text) => bodyText.includes(text));
  if (present.length > 0) {
    throw new Error(`${label} forbidden text present: ${present.join(", ")}`);
  }
  return { bodyText, present };
}

async function capture(page, name, metadata = {}) {
  const file = `screenshots/${name}.png`;
  await page.screenshot({ path: path.join(outDir, file), fullPage: true });
  const row = sanitize({
    name,
    file,
    url: page.url(),
    capturedAt: new Date().toISOString(),
    ...metadata,
  });
  evidence.screenshots.push(row);
  return row;
}

async function login(page) {
  await page.goto(`${config.adminFrontUrl}/login`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await assertAbsent(page, forbiddenLoginTexts, "login");
  await capture(page, "login-no-google-fa", {
    domCheckpoint: true,
    expectedText: ["Operator Identification", "Access Cipher"],
  });
  await page.locator('input[type="email"]').fill(config.adminEmail);
  await page.locator('input[type="password"]').fill(config.adminPassword);
  await page.getByRole("button", { name: /Execute Initialization/i }).click();
  await page.waitForURL(/\/dashboard(\/.*)?$/, { timeout: 30000 });
  await page.waitForLoadState("networkidle");
  addCheck("admin:password-login", true, page.url());
}

async function readVisibleMenu(page) {
  const payload = await page.evaluate(async () => {
    const response = await fetch("/api/admin/v1/config/menu-items/visible", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, body };
  });
  const items = payload.body?.data?.items || [];
  const ok = payload.ok && Array.isArray(items) && items.length > 0;
  evidence.api.push(
    sanitize({
      route: "/api/admin/v1/config/menu-items/visible",
      status: payload.status,
      ok: payload.ok,
      itemCount: items.length,
      itemIds: items.map((item) => item.itemId).sort(),
    })
  );
  addCheck("api:visible-menu", ok, `${items.length} items`);
  if (!ok) throw new Error("Visible menu API did not return menu items.");
  return items;
}

function currentPathname(page) {
  return new URL(page.url()).pathname;
}

async function waitForExpectedTexts(page, spec) {
  await page.waitForFunction(
    (expectedTexts) =>
      expectedTexts.every((text) => document.body.innerText.includes(text)),
    spec.expectedTexts,
    { timeout: 25000 }
  );
  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  const missingTexts = spec.expectedTexts.filter(
    (text) => !bodyText.includes(text)
  );
  if (missingTexts.length > 0) {
    throw new Error(
      `${spec.route} missing expected text: ${missingTexts.join(", ")}`
    );
  }
  return { bodyText, missingTexts };
}

async function verifyRoute(page, spec, menuItemIds) {
  const { route, expectedPath, expectedTexts } = spec;
  addTrace("route:start", { route });
  await page.goto(`${config.adminFrontUrl}${route}`, {
    waitUntil: "networkidle",
  });
  await page.locator('[data-testid="admin-console-shell"]').waitFor({
    state: "visible",
    timeout: 20000,
  });
  await page.locator('[data-testid="admin-console-sidebar"]').first().waitFor({
    state: "visible",
    timeout: 20000,
  });
  await page.locator('[data-testid="admin-console-topbar"]').waitFor({
    state: "visible",
    timeout: 20000,
  });
  const uiSystem = await page
    .locator('[data-testid="admin-console-shell"]')
    .getAttribute("data-ui-system");
  const actualPath = currentPathname(page);
  if (actualPath !== expectedPath) {
    throw new Error(
      `${route} expected final path ${expectedPath}, got ${actualPath}`
    );
  }
  const { bodyText } = await assertAbsent(page, forbiddenPageTexts, route);
  const { missingTexts } = await waitForExpectedTexts(page, spec);
  const routeOk =
    uiSystem === "shadcn-token-console" &&
    bodyText.includes("Admin Sentinel") &&
    !page.url().includes("/login");
  if (!routeOk) throw new Error(`New UI shell checkpoint failed for ${route}`);
  const screenshot = await capture(page, `module-${slugRoute(route)}`, {
    route,
    expectedPath,
    actualPath,
    uiSystem,
    domCheckpoint: true,
    expectedTexts,
    missingTexts,
    menuItemIdsFromApi: menuItemIds,
  });
  evidence.dom.push(
    sanitize({
      route,
      expectedPath,
      actualPath,
      expectedTexts,
      missingTexts,
      uiSystem,
      shellOk: true,
      sidebarOk: true,
      topbarOk: true,
      screenshot: screenshot.file,
    })
  );
  addCheck(`dom:route:${route}`, true, screenshot.file);
  addTrace("route:done", { route });
}

function writeJson(name, data) {
  fs.writeFileSync(
    path.join(outDir, name),
    `${JSON.stringify(sanitize(data), null, 2)}\n`
  );
}

function writeReport() {
  const traceText = evidence.trace.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(path.join(outDir, "trace.jsonl"), `${traceText}\n`);
  const traceDigest = crypto
    .createHash("sha256")
    .update(`${traceText}\n`)
    .digest("hex");
  const report = {
    status: evidence.status,
    generatedAt: evidence.generatedAt,
    traceDigest,
    routeCount: evidence.dom.length,
    checks: evidence.checks,
    failed: evidence.failed,
    screenshots: evidence.screenshots.map((row) => row.file),
  };
  writeJson("report.json", report);
  writeJson("api-evidence.json", evidence.api);
  writeJson("dom-evidence.json", evidence.dom);
  writeJson("screenshot-evidence.json", evidence.screenshots);
  fs.writeFileSync(
    path.join(outDir, "report.md"),
    [
      "# Admin Console New UI Local Evidence",
      "",
      `- Status: ${evidence.status}`,
      `- Generated at: ${evidence.generatedAt}`,
      `- Routes verified: ${evidence.dom.length}`,
      `- Screenshots: ${evidence.screenshots.length}`,
      `- Failed checks: ${evidence.failed.length}`,
      "",
      "## Proof",
      "",
      "- Local Google FA login policy is disabled.",
      "- Password-only login succeeds.",
      "- Each authenticated admin route renders the tokenized admin shell and route-level function texts.",
      "- Screenshots are captured after DOM checkpoints pass.",
    ].join("\n") + "\n"
  );
}

async function main() {
  const routeSpecs = adminConsoleRouteSpecs();
  let browser;
  try {
    await preflight();
    browser = await chromium.launch({
      headless: process.env.ADMIN_CONSOLE_NEW_UI_HEADLESS !== "0",
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      baseURL: config.adminFrontUrl,
    });
    const page = await context.newPage();
    await login(page);
    const menuItems = await readVisibleMenu(page);
    const menuItemIds = menuItems.map((item) => item.itemId).sort();
    for (const spec of routeSpecs) {
      await verifyRoute(page, spec, menuItemIds);
    }
    await context.close();
  } catch (error) {
    evidence.status = "failed";
    addCheck(
      "runner:completed",
      false,
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    writeReport();
    console.log(`[admin-console-new-ui] Evidence: ${outDir}`);
  }
}

await main();
