#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = process.env.DOCS_BASE_URL || "http://localhost:3000";
const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "T").replace("Z", "Z");
const OUT_DIR = path.join(ROOT, "output/playwright/docs-verification", timestamp);
const ENDPOINT_DATA = path.join(ROOT, "services/user-front/src/app/docs/api-reference/endpoint-data.ts");

const pages = [
  {
    id: "overview",
    href: "/docs#introduction",
    heading: "Synapse Developer Platform",
    anchors: ["introduction", "architecture"],
    screenshot: "overview.png",
  },
  {
    id: "getting-started",
    href: "/docs/getting-started",
    heading: "Choose your role",
    anchors: [],
  },
  {
    id: "consumer",
    href: "/docs/getting-started/consumer",
    heading: "Consumer Quick Start",
    anchors: ["step-auth", "step-deposit", "step-discover", "step-credential", "step-invoke", "step-verify", "step-withdraw"],
    screenshot: "consumer.png",
  },
  {
    id: "provider",
    href: "/docs/getting-started/provider",
    heading: "Provider Quick Start",
    anchors: ["step-auth", "step-secret", "step-register", "step-status", "step-earnings", "step-withdraw"],
    screenshot: "provider.png",
  },
  {
    id: "concepts",
    href: "/docs/concepts",
    heading: "How Synapse Works",
    anchors: ["settlement", "service-registry", "credentials", "idempotency"],
  },
  {
    id: "api-reference",
    href: "/docs/api-reference",
    heading: "REST API",
    anchors: ["api-auth", "api-balance", "api-services", "api-invocations", "api-credentials"],
    screenshot: "api-reference.png",
  },
  {
    id: "sdk",
    href: "/docs/sdk",
    heading: "SDKs",
    anchors: ["sdk-overview", "sdk-compare"],
    screenshot: "sdk.png",
  },
  {
    id: "sdk-typescript",
    href: "/docs/sdk/typescript",
    heading: "TypeScript SDK",
    anchors: ["sdk-ts-install", "sdk-ts-auth", "sdk-ts-deposit", "sdk-ts-discover", "sdk-ts-invoke", "sdk-ts-direct", "sdk-ts-starter", "sdk-ts-verify", "sdk-ts-cheatsheet"],
  },
  {
    id: "sdk-python",
    href: "/docs/sdk/python",
    heading: "Python SDK",
    anchors: ["sdk-py"],
  },
  {
    id: "contracts",
    href: "/docs/contracts",
    heading: "Smart Contracts",
    anchors: ["contract-core", "contract-usdc", "contract-abi"],
    screenshot: "contracts.png",
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const passed = [];
const failed = [];
const screenshots = [];
const consoleErrors = [];

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail) {
  failed.push({ name, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

async function step(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error));
  }
}

function pageUrl(href) {
  return `${BASE_URL}${href}`;
}

async function goto(page, href) {
  await page.goto(pageUrl(href), { waitUntil: "domcontentloaded", timeout: 30000 });
}

async function assertHeading(page, expected) {
  const heading = page.getByRole("heading", { name: expected }).first();
  await heading.waitFor({ state: "visible", timeout: 10000 });
}

async function assertAnchors(page, anchors) {
  for (const anchor of anchors) {
    const count = await page.locator(`#${anchor}`).count();
    if (count === 0) {
      throw new Error(`missing anchor #${anchor}`);
    }
  }
}

async function screenshot(page, name) {
  const out = path.join(OUT_DIR, name);
  await page.screenshot({ path: out, fullPage: false });
  screenshots.push(out);
}

function readEndpointIds() {
  const source = fs.readFileSync(ENDPOINT_DATA, "utf8");
  return Array.from(
    new Set(
      Array.from(source.matchAll(/^\s+id:\s+"((?:get|post|put|delete)-[^"]+)"/gm)).map((match) => match[1]),
    ),
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
  });
  await context.route("**/api/v1/services/discover**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "success", services: [] }),
    });
  });
  await context.route("**/api/v1/events**", async (route) => {
    await route.fulfill({ status: 204 });
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (text.includes("Failed to fetch RSC payload") && text.includes("Falling back to browser navigation")) {
        return;
      }
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  for (const docsPage of pages) {
    await step(`page:${docsPage.id}`, async () => {
      await goto(page, docsPage.href);
      await assertHeading(page, docsPage.heading);
      await assertAnchors(page, docsPage.anchors);
      if (docsPage.screenshot) {
        await screenshot(page, docsPage.screenshot);
      }
    });
  }

  await step("click:top-nav", async () => {
    await goto(page, "/docs#introduction");
    const topLinks = [
      ["/docs/getting-started", "/docs/getting-started"],
      ["/docs/concepts", "/docs/concepts"],
      ["/docs/api-reference", "/docs/api-reference"],
      ["/docs/sdk", "/docs/sdk"],
      ["/docs/contracts", "/docs/contracts"],
    ];
    for (const [selectorHref, expectedPath] of topLinks) {
      await page.locator(`a[href="${selectorHref}"]`).first().click();
      await page.waitForURL(`**${expectedPath}`, { timeout: 10000 });
    }
  });

  await step("click:overview-ctas", async () => {
    await goto(page, "/docs#introduction");
    await page.getByRole("button", { name: /Quick Start/i }).click();
    await page.waitForURL("**/docs/getting-started", { timeout: 10000 });
    await goto(page, "/docs#introduction");
    await page.getByTestId("docs-hero").getByRole("button", { name: /API Reference/i }).click();
    await page.waitForURL("**/docs/api-reference", { timeout: 10000 });
  });

  await step("click:sidebar-page-and-anchor", async () => {
    await goto(page, "/docs#introduction");
    await page.getByRole("button", { name: /^Consumer Guide$/i }).click();
    await page.waitForURL("**/docs/getting-started/consumer", { timeout: 10000 });
    await page.getByRole("button", { name: /Discover Services/i }).click();
    await page.waitForURL("**/docs/getting-started/consumer#step-discover", { timeout: 10000 });

    await goto(page, "/docs/getting-started/provider");
    const sidebar = page.getByTestId("docs-sidebar");
    await sidebar.getByRole("button", { name: /Provider Secret/i }).click();
    await page.waitForURL("**/docs/getting-started/provider#step-secret", { timeout: 10000 });
    await sidebar.getByRole("button", { name: /Runtime Status/i }).click();
    await page.waitForURL("**/docs/getting-started/provider#step-status", { timeout: 10000 });
  });

  await step("click:concepts-idempotency-to-settlement", async () => {
    await goto(page, "/docs/concepts#idempotency");
    const sidebar = page.getByTestId("docs-sidebar");
    await sidebar.getByRole("button", { name: /How Settlement Works/i }).click();
    await page.waitForURL("**/docs/concepts#settlement", { timeout: 10000 });
    if (await page.locator("#settlement").count() === 0) {
      throw new Error("missing #settlement after clicking How Settlement Works");
    }
  });

  await step("click:api-provider-role-filter", async () => {
    await goto(page, "/docs/api-reference");
    await page.getByRole("button", { name: /^Provider$/i }).click();
    await page.locator("#api-provider").waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("link", { name: /Issue provider secret/i }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("link", { name: /Create provider withdrawal intent/i }).waitFor({ state: "visible", timeout: 10000 });

    await goto(page, "/docs/api-reference#api-provider");
    await page.locator("#api-provider").waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("link", { name: /Get provider earnings summary/i }).waitFor({ state: "visible", timeout: 10000 });

    await page.getByRole("button", { name: /^Consumer$/i }).click();
    await page.waitForTimeout(100);
    const providerLinks = await page.getByRole("link", { name: /Issue provider secret/i }).count();
    if (providerLinks !== 0) {
      throw new Error("consumer role should not show provider-only endpoint links");
    }
  });

  await step("click:soon-status-page", async () => {
    await goto(page, "/docs#introduction");
    const before = page.url();
    await page.getByRole("button", { name: /Status Page/i }).click();
    await page.waitForTimeout(300);
    if (page.url() !== before) {
      throw new Error(`status page should not navigate, got ${page.url()}`);
    }
  });

  const endpointIds = readEndpointIds();
  await step("api:endpoint-detail-pages", async () => {
    for (const id of endpointIds) {
      await goto(page, `/docs/api-reference/${id}`);
      const notFound = await page.getByText("Endpoint not found.").count();
      if (notFound > 0) {
        throw new Error(`endpoint ${id} rendered not-found`);
      }
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 10000 });
    }
    await screenshot(page, "api-endpoint-detail.png");
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
  passed,
  failed,
  screenshots,
  consoleErrors,
};

fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

const reportLines = [
  "# Docs Pages Browser Verification",
  "",
  `- Base URL: ${BASE_URL}`,
  `- Generated at: ${report.generatedAt}`,
  `- Passed: ${passed.length}`,
  `- Failed: ${failed.length}`,
  "",
  "## Passed",
  "",
  ...passed.map((item) => `- PASS ${item.name}${item.detail ? ` - ${item.detail}` : ""}`),
  "",
  "## Failed",
  "",
  ...(failed.length === 0 ? ["- None"] : failed.map((item) => `- FAIL ${item.name} - ${item.detail}`)),
  "",
  "## Screenshots",
  "",
  ...screenshots.map((item) => `- ${path.relative(ROOT, item)}`),
  "",
];

fs.writeFileSync(path.join(OUT_DIR, "report.md"), reportLines.join("\n"));

console.log(`\nReport: ${path.join(OUT_DIR, "report.md")}`);

if (failed.length > 0) {
  process.exit(1);
}
