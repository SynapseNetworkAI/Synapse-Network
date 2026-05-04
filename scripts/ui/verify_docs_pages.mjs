#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = process.env.DOCS_BASE_URL || "http://localhost:3100";
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("T", "T")
  .replace("Z", "Z");
const OUT_DIR = path.join(
  ROOT,
  "output/playwright/docs-verification",
  timestamp
);
const ENDPOINT_DATA = path.join(
  ROOT,
  "services/docs-front/src/data/api-reference.json"
);

const pages = [
  {
    id: "home",
    href: "/",
    heading: "Synapse Developer Platform",
    screenshot: "home.png",
  },
  { id: "get-started", href: "/get-started", heading: "Get Started" },
  {
    id: "agent-builders",
    href: "/get-started/agent-builders",
    heading: "For Agent Builders",
    screenshot: "agent-builders.png",
  },
  {
    id: "api-providers",
    href: "/get-started/api-providers",
    heading: "For API Providers",
  },
  {
    id: "first-paid-invocation",
    href: "/get-started/first-paid-invocation",
    heading: "First Paid Invocation",
  },
  {
    id: "mcp",
    href: "/mcp",
    heading: "MCP / Agent Tooling",
    texts: [
      "discover_services -> invoke_and_pay -> get_receipt",
      "npx -y @synapse-network-ai/mcp-server",
    ],
    screenshot: "mcp.png",
  },
  {
    id: "money-flows",
    href: "/money-flows",
    heading: "Money Flows",
    texts: ["Matured Funds", "T+1", "T+7"],
    screenshot: "money-flows.png",
  },
  {
    id: "deposit-usdc",
    href: "/money-flows/deposit-usdc",
    heading: "Deposit USDC",
  },
  {
    id: "consumer-withdrawals",
    href: "/money-flows/consumer-withdrawals",
    heading: "Consumer Withdrawals",
    texts: ["Consumer withdrawals are T+1"],
  },
  {
    id: "provider-withdrawals",
    href: "/money-flows/provider-withdrawals",
    heading: "Provider Withdrawals",
    texts: ["Provider earnings are T+7"],
  },
  {
    id: "reconciliation",
    href: "/money-flows/reconciliation",
    heading: "Reconciliation",
  },
  {
    id: "pricing-and-fees",
    href: "/pricing-and-fees",
    heading: "Pricing & Fees",
    texts: ["Do not hard-code fees or prices", "dynamic pricing"],
    screenshot: "pricing-and-fees.png",
  },
  {
    id: "agent-settlement",
    href: "/concepts/agent-settlement",
    heading: "Agent Settlement",
  },
  {
    id: "budget-isolation",
    href: "/concepts/budget-isolation",
    heading: "Budget Isolation",
  },
  {
    id: "off-chain-charging",
    href: "/concepts/off-chain-charging",
    heading: "Off-chain Charging",
  },
  {
    id: "on-chain-withdrawal",
    href: "/concepts/on-chain-withdrawal",
    heading: "On-chain Withdrawal",
  },
  {
    id: "api-reference",
    href: "/api-reference",
    heading: "API Reference",
    screenshot: "api-reference.png",
  },
  { id: "sdks", href: "/sdks", heading: "SDKs", screenshot: "sdks.png" },
  {
    id: "typescript",
    href: "/sdks/typescript",
    heading: "TypeScript SDK",
    texts: [
      "@synapse-network-ai/sdk",
      "SynapseClient",
      'environment: "staging"',
    ],
  },
  {
    id: "python",
    href: "/sdks/python",
    heading: "Python SDK",
    texts: ["synapse-client", "synapse_client", "invoke_llm"],
  },
  {
    id: "go",
    href: "/sdks/go",
    heading: "Go SDK",
    texts: [
      "go get github.com/SynapseNetworkAI/Synapse-Network-Sdk/go",
      "MaxCostUSDC",
    ],
  },
  {
    id: "java",
    href: "/sdks/java",
    heading: "Java/JVM SDK",
    texts: ["ai.synapsenetwork", "synapse-network-sdk", "maxCostUsdc"],
  },
  {
    id: "dotnet",
    href: "/sdks/dotnet",
    heading: ".NET SDK",
    texts: ["SynapseNetwork.Sdk", "0.1.0-preview", "MaxCostUsdc"],
  },
  {
    id: "mcp-agent-tooling",
    href: "/sdks/mcp-agent-tooling",
    heading: "MCP / Agent Tooling",
  },
  {
    id: "smart-contracts",
    href: "/smart-contracts",
    heading: "Smart Contracts",
    screenshot: "smart-contracts.png",
  },
  { id: "support", href: "/support", heading: "Support" },
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
  await page.goto(pageUrl(href), {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
}

async function assertHeading(page, expected) {
  const heading = page.getByRole("heading", { name: expected }).first();
  await heading.waitFor({ state: "visible", timeout: 10000 });
}

async function assertText(page, expected) {
  await page
    .getByText(expected, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: 10000 });
}

async function screenshot(page, name) {
  const out = path.join(OUT_DIR, name);
  await page.screenshot({ path: out, fullPage: false });
  screenshots.push(out);
}

function readEndpointIds() {
  const source = JSON.parse(fs.readFileSync(ENDPOINT_DATA, "utf8"));
  return source.routes.map((route) => route.id);
}

function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const normalized = value / 255;
    if (normalized <= 0.03928) {
      return normalized / 12.92;
    }
    return ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground, background) {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRgbColor(label, value) {
  const match = String(value).match(
    /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/
  );
  if (!match) {
    throw new Error(`${label} color could not be parsed: ${value}`);
  }

  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
    raw: value,
  };
}

function assertContrast(label, foregroundRaw, backgroundRaw, minimum) {
  const foreground = parseRgbColor(`${label} foreground`, foregroundRaw);
  const background = parseRgbColor(`${label} background`, backgroundRaw);
  const ratio = contrastRatio(foreground, background);
  if (ratio < minimum) {
    throw new Error(
      `${label} contrast ${ratio.toFixed(2)} is below ${minimum.toFixed(1)}`
    );
  }
}

async function sampleDocsReadabilityStyles(page) {
  return page.evaluate(() => {
    const sample = (selector, pseudo) => {
      const el = document.querySelector(selector);
      if (el === null) {
        return {
          selector,
          color: "",
          backgroundColor: "",
          text: "",
        };
      }
      const computed = getComputedStyle(el, pseudo);
      return {
        selector,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        text: (el.textContent || "").trim().slice(0, 80),
      };
    };
    return {
      body: sample("body"),
      h1: sample("h1"),
      h2: sample("h2"),
      description: sample("p"),
      listItem: sample("ol li"),
      listMarker: sample("ol li", "::marker"),
      sidebar: sample("#nd-sidebar, aside[class*='--fd-sidebar-width']"),
      activeNav: sample(
        'a[href="/get-started/agent-builders"][data-active="true"], a[href="/get-started/agent-builders"]'
      ),
      toc: sample('#nd-toc, [data-toc], nav[aria-label="Table of contents"]'),
    };
  });
}

function requiredStyle(styles, key) {
  const style = styles[key];
  if (!style?.color || !style?.backgroundColor) {
    throw new Error(`${key} style could not be sampled`);
  }
  return style;
}

function assertSidebarDark(styles) {
  const sidebar = requiredStyle(styles, "sidebar");
  const sidebarColor = parseRgbColor(
    "sidebar background",
    sidebar.backgroundColor
  );
  const sidebarLuminance = relativeLuminance(sidebarColor);
  if (sidebarLuminance <= 0.18) return;

  throw new Error(`sidebar background is too light (${sidebarColor.raw})`);
}

function assertDocsDarkContrast(styles) {
  const background = requiredStyle(styles, "body").backgroundColor;
  const sidebarBackground = requiredStyle(styles, "sidebar").backgroundColor;
  const activeNav = requiredStyle(styles, "activeNav");

  assertContrast("h1", requiredStyle(styles, "h1").color, background, 4.5);
  assertContrast("h2", requiredStyle(styles, "h2").color, background, 4.5);
  assertContrast(
    "description",
    requiredStyle(styles, "description").color,
    background,
    3
  );
  assertContrast(
    "ordered list item",
    requiredStyle(styles, "listItem").color,
    background,
    4.5
  );
  assertContrast(
    "ordered list marker",
    requiredStyle(styles, "listMarker").color,
    background,
    4.5
  );
  assertContrast(
    "active sidebar item",
    activeNav.color,
    sidebarBackground,
    4.5
  );
  if (styles.toc?.color) {
    assertContrast("table of contents", styles.toc.color, background, 3);
  }
}

async function assertDocsDarkReadability(page) {
  const styles = await sampleDocsReadabilityStyles(page);
  assertSidebarDark(styles);
  assertDocsDarkContrast(styles);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  for (const docsPage of pages) {
    await step(`page:${docsPage.id}`, async () => {
      await goto(page, docsPage.href);
      await assertHeading(page, docsPage.heading);
      for (const expectedText of docsPage.texts || []) {
        await assertText(page, expectedText);
      }
      if (docsPage.screenshot) {
        await screenshot(page, docsPage.screenshot);
      }
      if (docsPage.id === "agent-builders") {
        await assertDocsDarkReadability(page);
      }
    });
  }

  await step("legacy-redirects", async () => {
    await goto(page, "/docs/getting-started/consumer");
    await page.waitForURL("**/get-started/agent-builders", { timeout: 10000 });
    await goto(page, "/docs/getting-started/provider");
    await page.waitForURL("**/get-started/api-providers", { timeout: 10000 });
    await goto(page, "/docs/sdk/typescript");
    await page.waitForURL("**/sdks/typescript", { timeout: 10000 });
    await goto(page, "/docs/contracts");
    await page.waitForURL("**/smart-contracts", { timeout: 10000 });
  });

  const endpointIds = readEndpointIds();
  await step("api:endpoint-detail-pages", async () => {
    for (const id of endpointIds) {
      await goto(page, `/api-reference/${id}`);
      await page
        .locator("h1")
        .first()
        .waitFor({ state: "visible", timeout: 10000 });
      await page
        .getByText("For AI agents")
        .first()
        .waitFor({ state: "visible", timeout: 10000 });
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

fs.writeFileSync(
  path.join(OUT_DIR, "report.json"),
  JSON.stringify(report, null, 2)
);

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
  ...passed.map(
    (item) => `- PASS ${item.name}${item.detail ? ` - ${item.detail}` : ""}`
  ),
  "",
  "## Failed",
  "",
  ...(failed.length === 0
    ? ["- None"]
    : failed.map((item) => `- FAIL ${item.name} - ${item.detail}`)),
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
