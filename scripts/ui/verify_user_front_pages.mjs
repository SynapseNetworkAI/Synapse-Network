#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = process.env.USER_FRONT_BASE_URL || "http://localhost:3000";
const VERIFY_REAL_BACKEND = process.env.USER_FRONT_VERIFY_REAL_BACKEND === "1";
const GATEWAY_HEALTH_URL = process.env.USER_FRONT_GATEWAY_HEALTH_URL || "http://127.0.0.1:8000/health";
const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const OUT_DIR = path.join(ROOT, "output/playwright/user-front-verification", timestamp);
const REGISTRY_PATH = path.join(ROOT, "services/user-front/src/app/user-front-page-registry.json");

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
const screenshotRows = registry.filter((row) => row.visualVerification === "screenshot-required");
const routeRows = registry.filter((row) => row.kind !== "api" && !row.kind.includes("redirect"));
const redirectRows = registry.filter((row) => row.kind.includes("redirect"));

fs.mkdirSync(OUT_DIR, { recursive: true });

const passed = [];
const failed = [];
const blocked = [];
const warnings = [];
const screenshots = [];
const consoleErrors = [];
const backendResponses = [];

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail) {
  failed.push({ name, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

function block(name, detail) {
  blocked.push({ name, detail });
  console.warn(`BLOCKED ${name} - ${detail}`);
}

function warn(name, detail) {
  warnings.push({ name, detail });
  console.warn(`WARN ${name} - ${detail}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

function pageUrl(href) {
  return `${BASE_URL}${href}`;
}

async function goto(page, href) {
  await page.goto(pageUrl(href), { waitUntil: "commit", timeout: 60000 });
}

function resolveVerificationHref(href) {
  if (href === "/docs/api-reference/[id]") {
    return "/docs/api-reference/get-balance";
  }
  return href;
}

async function expectAnyText(page, texts, href) {
  for (const text of texts) {
    const locator = page.getByText(text, { exact: false }).first();
    if (await locator.waitFor({ state: "visible", timeout: 20000 }).then(() => true).catch(() => false)) {
      return text;
    }
  }
  throw new Error(`${href} did not show any expected text: ${texts.join(", ")}`);
}

async function assertNoHorizontalOverflow(page, href) {
  const result = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  const overflow = Math.max(result.scrollWidth, result.bodyWidth) - result.innerWidth;
  if (overflow > 4) {
    throw new Error(`${href} has horizontal overflow ${overflow}px`);
  }
}

async function captureScreenshot(page, name) {
  const out = path.join(OUT_DIR, name);
  await page.screenshot({ path: out, fullPage: false });
  screenshots.push(out);
}

async function verifyGatewayHealth() {
  if (!VERIFY_REAL_BACKEND) {
    warn("backend:real-data", "USER_FRONT_VERIFY_REAL_BACKEND=1 not set; browser checks still run, data truth is not enforced");
    return;
  }
  const response = await fetch(GATEWAY_HEALTH_URL);
  if (!response.ok) {
    throw new Error(`gateway health failed: ${response.status} ${response.statusText}`);
  }
}

async function verifyRegistryJson() {
  const response = await fetch(`${BASE_URL}/marketplace/registry.json?page=1&pageSize=10`);
  if (!response.ok) {
    throw new Error(`registry.json failed: ${response.status}`);
  }
  const payload = await response.json();
  if (payload.status !== "success") {
    throw new Error(`registry.json status was ${payload.status}`);
  }
  if (!Array.isArray(payload.services)) {
    throw new Error("registry.json services is not an array");
  }
  if (!payload.pagination || payload.pagination.pageSize !== 10) {
    throw new Error("registry.json pagination metadata missing or wrong");
  }
  const unavailable = payload.services.filter((service) => service.isActive === false || service.runtimeAvailable === false);
  if (unavailable.length > 0) {
    throw new Error(`registry.json returned unavailable services: ${unavailable.map((service) => service.serviceId).join(", ")}`);
  }
  return `${payload.services.length} services returned, total=${payload.pagination.total}`;
}

async function verifyMarketplaceControls(page) {
  await goto(page, "/marketplace");
  const searchVisible = await page
    .getByRole("textbox")
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!searchVisible) {
    throw new Error("marketplace search input is not visible");
  }

  const tagControls = await page.locator("button").filter({ hasText: /All|全部|All tags|标签/i }).count();
  if (tagControls < 1) {
    throw new Error("marketplace tag filter control is not visible");
  }

  const pageStatusVisible = await page
    .getByText(/Showing|Page|当前|显示|页/i)
    .first()
    .isVisible({ timeout: 5000 })
    .catch(() => false);
  if (!pageStatusVisible) {
    warn("marketplace:pagination-copy", "pagination copy not visible; this can be okay when the list is empty, but should be reviewed visually");
  }
}

function isRealBackendRow(row) {
  return ["public-gateway", "authenticated-gateway", "authenticated-gateway-and-chain", "public-gateway-and-chain"].includes(row.dataVerification);
}

function normalizeDataSourcePath(source) {
  const match = source.match(/\/api\/v1\/[^\s,]*/);
  if (!match) {
    return "";
  }
  return match[0].replace(/:\w+/g, "");
}

function summarizeBackendResponsesFor(row) {
  const pageResponses = backendResponses.filter((item) => item.page === row.href && item.url.includes("/api/"));
  if (pageResponses.length > 0) {
    return pageResponses;
  }

  const sourcePaths = row.dataSources.map(normalizeDataSourcePath).filter(Boolean);
  if (sourcePaths.length === 0) {
    return [];
  }

  return backendResponses.filter((item) =>
    sourcePaths.some((sourcePath) => item.url.includes(sourcePath))
  );
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("synapse_lang", "en");
    localStorage.setItem("a2a_selected_role", "CONSUMER");
  });
  const page = await context.newPage();
  let currentPageHref = "";

  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (text.includes("Failed to fetch RSC payload") && text.includes("Falling back to browser navigation")) {
      return;
    }
    consoleErrors.push(text);
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/v1/") || url.includes("/marketplace/registry.json")) {
      backendResponses.push({
        page: currentPageHref,
        url,
        status: response.status(),
        ok: response.ok(),
      });
    }
  });

  await step("backend:gateway-health", verifyGatewayHealth);
  await step("api:marketplace-registry-json", verifyRegistryJson);

  for (const row of routeRows) {
    await step(`page:${row.id}`, async () => {
      currentPageHref = row.href;
      const verificationHref = resolveVerificationHref(row.href);
      await goto(page, verificationHref);
      const matchedText = await expectAnyText(page, row.expectedTexts, verificationHref);
      await assertNoHorizontalOverflow(page, verificationHref);
      const screenshotRow = screenshotRows.find((item) => item.href === row.href);
      if (screenshotRow?.screenshotName) {
        await captureScreenshot(page, screenshotRow.screenshotName);
      }
      if (VERIFY_REAL_BACKEND && isRealBackendRow(row) && row.dataVerification.startsWith("authenticated")) {
        block(
          `data:${row.id}`,
          "requires wallet/JWT fixture; unauthenticated smoke render is verified but authenticated data truth is not proven",
        );
      }
      if (VERIFY_REAL_BACKEND && row.dataVerification === "public-gateway") {
        await page.waitForTimeout(7000);
        const responses = summarizeBackendResponsesFor(row);
        if (responses.length === 0) {
          throw new Error(`${row.href} did not call a public backend API`);
        }
        const failedResponses = responses.filter((item) => !item.ok);
        if (failedResponses.length > 0) {
          throw new Error(`${row.href} backend responses failed: ${failedResponses.map((item) => `${item.status} ${item.url}`).join("; ")}`);
        }
      }
      return `matched "${matchedText}"`;
    });
  }

  for (const row of redirectRows) {
    await step(`redirect:${row.id}`, async () => {
      currentPageHref = row.href;
      await goto(page, row.href);
    await page.waitForURL(`**${row.redirectsTo}`, { timeout: 20000 });
    });
  }

  await step("click:home-launch-console", async () => {
    currentPageHref = "/";
    await goto(page, "/");
    await page.getByRole("button", { name: /Launch Console/i }).click();
    await page.waitForURL("**/dashboard/overview", { timeout: 20000 });
  });

  await step("click:home-developer-resources", async () => {
    currentPageHref = "/";
    await goto(page, "/");
    await page.getByRole("button", { name: /Open Developer Resources/i }).click();
    await page.waitForURL("**/dashboard/developer", { timeout: 20000 });
  });

  await step("click:docs-concepts-settlement-anchor", async () => {
    currentPageHref = "/docs/concepts";
    await goto(page, "/docs/concepts#idempotency");
    await page.getByTestId("docs-sidebar").getByRole("button", { name: /How Settlement Works/i }).click();
    await page.waitForURL("**/docs/concepts#settlement", { timeout: 20000 });
  });

  await step("ui:marketplace-controls", async () => {
    currentPageHref = "/marketplace";
    await verifyMarketplaceControls(page);
  });

  if (consoleErrors.length > 0) {
    fail("browser:console-errors", consoleErrors.join("\n"));
  } else {
    pass("browser:console-errors", "no uncaught console errors");
  }
} finally {
  await browser.close();
}

const report = {
  baseUrl: BASE_URL,
  generatedAt: new Date().toISOString(),
  verifyRealBackend: VERIFY_REAL_BACKEND,
  gatewayHealthUrl: GATEWAY_HEALTH_URL,
  passed,
  failed,
  blocked,
  warnings,
  screenshots,
  consoleErrors,
  backendResponses,
};

fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

const reportLines = [
  "# User Front Pages Browser Verification",
  "",
  `- Base URL: ${BASE_URL}`,
  `- Generated at: ${report.generatedAt}`,
  `- Real backend enforced: ${VERIFY_REAL_BACKEND ? "yes" : "no"}`,
  `- Passed: ${passed.length}`,
  `- Failed: ${failed.length}`,
  `- Blocked: ${blocked.length}`,
  `- Warnings: ${warnings.length}`,
  "",
  "## Passed",
  "",
  ...passed.map((item) => `- PASS ${item.name}${item.detail ? ` - ${item.detail}` : ""}`),
  "",
  "## Failed",
  "",
  ...(failed.length === 0 ? ["- None"] : failed.map((item) => `- FAIL ${item.name} - ${item.detail}`)),
  "",
  "## Blocked",
  "",
  ...(blocked.length === 0 ? ["- None"] : blocked.map((item) => `- BLOCKED ${item.name} - ${item.detail}`)),
  "",
  "## Warnings",
  "",
  ...(warnings.length === 0 ? ["- None"] : warnings.map((item) => `- WARN ${item.name} - ${item.detail}`)),
  "",
  "## Screenshots",
  "",
  ...screenshots.map((item) => `- ${path.relative(ROOT, item)}`),
  "",
  "## Backend Responses",
  "",
  ...backendResponses.map((item) => `- ${item.status} ${item.url} (page: ${item.page || "unknown"})`),
  "",
];

fs.writeFileSync(path.join(OUT_DIR, "report.md"), reportLines.join("\n"));

console.log(`\nReport: ${path.join(OUT_DIR, "report.md")}`);

if (failed.length > 0) {
  process.exit(1);
}
