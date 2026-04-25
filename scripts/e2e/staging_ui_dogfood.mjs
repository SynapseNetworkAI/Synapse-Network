#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { assertSeedEnvironment } from "./seed_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const RUN_ID = process.env.STAGING_UI_DOGFOOD_RUN_ID || `staging-ui-${Date.now().toString(36)}`;
const OUT_DIR = path.resolve(
  process.env.STAGING_UI_DOGFOOD_EVIDENCE_DIR ||
    path.join(ROOT, "docs/evidence/staging/ui-dogfood", `${formatTimestamp(GENERATED_AT)}-staging-ui-dogfood`),
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const config = {
  userFrontUrl: process.env.STAGING_USER_FRONT_URL || "https://staging.synapse-network.ai",
  gatewayUrl: process.env.STAGING_GATEWAY_URL || "https://api-staging.synapse-network.ai",
  adminFrontUrl: process.env.STAGING_ADMIN_FRONT_URL || "https://admin-staging.synapse-network.ai",
  adminApiUrl: process.env.STAGING_ADMIN_API_URL || "https://admin-api-staging.synapse-network.ai",
};

// This dogfood runner is staging-only. The shared seed guard keeps prod from
// accidentally receiving E2E fixture traffic if someone reuses the command.
process.env.SYNAPSE_SEED_ENV ||= "staging";
assertSeedEnvironment({
  scriptName: "staging-ui-dogfood",
  allowStaging: true,
  runId: RUN_ID,
  urls: Object.values(config),
});

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function redact(value) {
  return String(value || "")
    .replace(/https:\/\/([^/\s]+)\/v2\/[A-Za-z0-9_-]+/g, "https://$1/v2/[REDACTED]")
    .replace(/0x[a-fA-F0-9]{64,}/g, "0x[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}

async function visit(page, checks, name, url, screenshotName) {
  const consoleErrors = [];
  const failedRequests = [];
  const onConsole = (message) => {
    if (message.type() === "error") consoleErrors.push(redact(message.text()).slice(0, 500));
  };
  const onRequestFailed = (request) => {
    failedRequests.push({
      url: redact(request.url()),
      failure: request.failure()?.errorText || "unknown",
    });
  };
  page.on("console", onConsole);
  page.on("requestfailed", onRequestFailed);
  try {
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, screenshotName), fullPage: true });
    const status = response?.status() || 0;
    const title = await page.title().catch(() => "");
    const bodyText = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 1_500);
    const effectiveConsoleErrors = consoleErrors.filter((message) => !isIgnorableConsoleError(name, message));
    const effectiveFailedRequests = failedRequests.filter((request) => !isIgnorableFailedRequest(name, request));
    const ok = status >= 200 && status < 400 && effectiveConsoleErrors.length === 0 && effectiveFailedRequests.length === 0 && bodyText.length > 0;
    checks.push({
      name,
      ok,
      url,
      status,
      title,
      consoleErrors: effectiveConsoleErrors,
      ignoredConsoleErrors: consoleErrors.filter((message) => isIgnorableConsoleError(name, message)),
      failedRequests: effectiveFailedRequests,
      ignoredFailedRequests: failedRequests.filter((request) => isIgnorableFailedRequest(name, request)),
      bodyTextExcerpt: bodyText,
    });
  } catch (error) {
    checks.push({ name, ok: false, url, error: redact(error.message) });
  } finally {
    page.off("console", onConsole);
    page.off("requestfailed", onRequestFailed);
  }
}

function isIgnorableFailedRequest(_name, request) {
  return request.url.includes("/api/v1/events") && request.failure === "net::ERR_ABORTED";
}

function isIgnorableConsoleError(name, message) {
  return name === "admin_front_login" && /Failed to load resource: the server responded with a status of 401/i.test(message);
}

async function browserFetch(page, checks, name, url) {
  try {
    const result = await page.evaluate(async (targetUrl) => {
      const response = await fetch(targetUrl, { headers: { Accept: "application/json" } });
      const text = await response.text();
      return {
        status: response.status,
        ok: response.ok,
        text: text.slice(0, 800),
      };
    }, url);
    checks.push({ name, ok: result.ok, url, ...result });
  } catch (error) {
    checks.push({ name, ok: false, url, error: redact(error.message) });
  }
}

async function main() {
  const checks = [];
  const browser = await chromium.launch({ headless: process.env.STAGING_UI_HEADLESS !== "0" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await visit(page, checks, "user_front_home", config.userFrontUrl, "user-front-home.png");
  await browserFetch(page, checks, "user_front_to_gateway_health", `${config.gatewayUrl}/health`);
  await browserFetch(page, checks, "user_front_to_gateway_discovery", `${config.gatewayUrl}/api/v1/services/discover`);
  await visit(page, checks, "user_front_about", `${config.userFrontUrl}/about`, "user-front-about.png");
  await visit(page, checks, "admin_front_login", `${config.adminFrontUrl}/login`, "admin-front-login.png");
  await browserFetch(page, checks, "admin_front_to_admin_api_health", `${config.adminApiUrl}/health`);

  await browser.close();

  const failed = checks.filter((check) => !check.ok);
  const report = {
    status: failed.length === 0 ? "success" : "failed",
    scriptVersion: "staging-ui-dogfood:v1",
    runId: RUN_ID,
    generatedAt: GENERATED_AT.toISOString(),
    finishedAt: new Date().toISOString(),
    environment: "staging",
    endpoints: config,
    checks,
    failed,
    screenshots: fs.readdirSync(SCREENSHOT_DIR).map((name) => `screenshots/${name}`),
    adminLoginLockScenario: process.env.STAGING_ADMIN_E2E_EMAIL
      ? "not-implemented-in-v1-runner"
      : "skipped: STAGING_ADMIN_E2E_EMAIL/STAGING_ADMIN_E2E_PASSWORD/STAGING_ADMIN_E2E_OTP_SECRET not provided",
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Staging UI Dogfood Evidence",
      "",
      `- Status: \`${report.status}\``,
      `- Run ID: \`${RUN_ID}\``,
      `- Generated at: \`${report.generatedAt}\``,
      "",
      "## Checks",
      "",
      "| Check | Result | Detail |",
      "| --- | --- | --- |",
      ...checks.map((check) => `| ${check.name} | ${check.ok ? "PASS" : "FAIL"} | ${String(check.error || check.status || "ok").replace(/\|/g, "\\|")} |`),
      "",
      "## Screenshots",
      "",
      ...report.screenshots.map((item) => `- \`${item}\``),
      "",
      "## Admin Login Lock Scenario",
      "",
      `- ${report.adminLoginLockScenario}`,
    ].join("\n") + "\n",
  );
  console.log(`[staging-ui-dogfood] evidence=${OUT_DIR}`);
  console.log(`[staging-ui-dogfood] status=${report.status} checks=${checks.length} failed=${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[staging-ui-dogfood] failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
