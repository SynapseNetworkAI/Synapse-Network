#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const docsRoot = path.join(
  repoRoot,
  "services",
  "docs-front",
  "content",
  "docs",
  "ai-agent-payments",
);
const docsMetaPath = path.join(docsRoot, "meta.json");
const mcpDocsRoot = path.join(
  repoRoot,
  "services",
  "docs-front",
  "content",
  "docs",
  "mcp",
);
const mcpMetaPath = path.join(mcpDocsRoot, "meta.json");
const rootDocsMetaPath = path.join(
  repoRoot,
  "services",
  "docs-front",
  "content",
  "docs",
  "meta.json",
);
const docsSitemapPath = path.join(
  repoRoot,
  "services",
  "docs-front",
  "src",
  "app",
  "sitemap.ts",
);
const docsLlmsRoutePath = path.join(
  repoRoot,
  "services",
  "docs-front",
  "src",
  "app",
  "llms.txt",
  "route.ts",
);
const docsRobotsPath = path.join(
  repoRoot,
  "services",
  "docs-front",
  "src",
  "app",
  "robots.ts",
);
const userLlmsPath = path.join(
  repoRoot,
  "services",
  "user-front",
  "public",
  "llms.txt",
);
const userRobotsPath = path.join(
  repoRoot,
  "services",
  "user-front",
  "public",
  "robots.txt",
);
const userSitemapPath = path.join(
  repoRoot,
  "services",
  "user-front",
  "src",
  "app",
  "sitemap.ts",
);

const expectedPages = [
  "index",
  "agent-payment-api",
  "agent-pays-for-llm-calls",
  "provider-monetization",
  "receipts-and-budget-isolation",
  "synapse-vs-x402",
  "faq",
];

const pageRequirements = {
  index: [
    "AI agent payments are machine-to-machine payments",
    "Synapse Network is a USDC-native settlement layer for AI agents",
    "Category definition for AI systems",
    "discover_services",
    "invoke_and_pay",
  ],
  "agent-payment-api": [
    "The Synapse Agent Payment API",
    "Payment flow",
    "Runtime contract",
    "discover_services",
    "get_receipt",
  ],
  "agent-pays-for-llm-calls": [
    "token-metered service",
    "maxCostUsdc",
    "receipt records the settled amount",
    "Streaming policy",
  ],
  "provider-monetization": [
    "API providers sell machine-readable services",
    "Provider path",
    "Provider pricing is runtime data",
    "USDC receivables",
  ],
  "receipts-and-budget-isolation": [
    "Budget isolation means",
    "Agent Credential boundary",
    "What a receipt proves",
    "ChatGPT or Claude",
  ],
  "synapse-vs-x402": [
    "Synapse and x402",
    "Comparison",
    "Stripe",
    "RapidAPI",
    "Custom API keys",
  ],
  faq: [
    "What is Synapse Network?",
    "Can ChatGPT or Claude use Synapse?",
    "Can API providers earn money from agents?",
    "What should an AI assistant cite?",
  ],
};

const failures = [];
const aiSearchCrawlers = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Bingbot",
  "Google-Extended",
];
const privateRobotsDisallows = [
  "Disallow: /dashboard/",
  "Disallow: /provider/",
  "Disallow: /api/",
  "Disallow: /_next/data/",
];

function fail(message) {
  failures.push(message);
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing file: ${path.relative(repoRoot, filePath)}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  const text = readText(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`invalid JSON: ${path.relative(repoRoot, filePath)} ${error.message}`);
    return null;
  }
}

function assertIncludes(label, text, expected) {
  if (!text.includes(expected))
    fail(`${label} missing expected text: ${expected}`);
}

function frontmatterValue(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim() || "";
}

function bodyAfterFrontmatter(text) {
  return text.replace(/^---[\s\S]*?---\s*/, "").trim();
}

function firstParagraph(text) {
  return (
    bodyAfterFrontmatter(text)
      .split(/\n\s*\n/)
      .find((block) => {
        const clean = block.trim();
        return (
          clean &&
          !clean.startsWith("<") &&
          !clean.startsWith("#") &&
          !clean.startsWith("|") &&
          !clean.match(/^\d+\./)
        );
      }) || ""
  ).trim();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function assertMeta() {
  const docsMeta = readJson(docsMetaPath);
  if (docsMeta) {
    if (docsMeta.title !== "AI Agent Payments") {
      fail("ai-agent-payments/meta.json title must be AI Agent Payments");
    }
    for (const page of expectedPages) {
      if (!docsMeta.pages?.includes(page)) {
        fail(`ai-agent-payments/meta.json missing page: ${page}`);
      }
    }
  }

  const rootMeta = readJson(rootDocsMetaPath);
  if (rootMeta && !rootMeta.pages?.includes("ai-agent-payments")) {
    fail("docs meta.json must include ai-agent-payments");
  }

  const mcpMeta = readJson(mcpMetaPath);
  if (mcpMeta && !mcpMeta.pages?.includes("paid-api-calls")) {
    fail("mcp/meta.json must include paid-api-calls");
  }
}

function assertDocsPages() {
  for (const page of expectedPages) {
    const filePath = path.join(docsRoot, `${page}.mdx`);
    const text = readText(filePath);
    if (!text) continue;
    const label = `docs page ${page}`;
    for (const field of ["title", "description", "lastUpdated"]) {
      if (!frontmatterValue(text, field))
        fail(`${label} missing ${field} frontmatter`);
    }
    const paragraphWords = wordCount(firstParagraph(text));
    if (paragraphWords < 25 || paragraphWords > 80) {
      fail(
        `${label} first answer block must be 25-80 words, found ${paragraphWords}`,
      );
    }
    for (const expected of pageRequirements[page] || []) {
      assertIncludes(label, text, expected);
    }
  }
}

function assertCrawlerAssets() {
  const docsSitemap = readText(docsSitemapPath);
  const docsLlmsRoute = readText(docsLlmsRoutePath);
  const docsRobots = readText(docsRobotsPath);
  const userLlms = readText(userLlmsPath);
  const userRobots = readText(userRobotsPath);
  const userSitemap = readText(userSitemapPath);
  const paidMcpPage = readText(path.join(mcpDocsRoot, "paid-api-calls.mdx"));

  for (const route of [
    "/ai-agent-payments",
    "/ai-agent-payments/agent-payment-api",
    "/ai-agent-payments/agent-pays-for-llm-calls",
    "/ai-agent-payments/provider-monetization",
    "/ai-agent-payments/receipts-and-budget-isolation",
    "/ai-agent-payments/synapse-vs-x402",
    "/ai-agent-payments/faq",
    "/mcp/paid-api-calls",
  ]) {
    assertIncludes("docs sitemap", docsSitemap, `"${route}"`);
    assertIncludes(
      "user llms.txt",
      userLlms,
      `https://docs.synapse-network.ai${route}`,
    );
  }

  assertIncludes("docs llms.txt route", docsLlmsRoute, "AI Agent Payments");
  assertIncludes("docs llms.txt route", docsLlmsRoute, "Synapse vs x402");
  assertIncludes(
    "docs llms.txt route",
    docsLlmsRoute,
    "MCP Server for Paid API Calls",
  );
  assertIncludes(
    "docs robots.ts",
    docsRobots,
    "sitemap: `${siteUrl}/sitemap.xml`",
  );
  assertIncludes(
    "user robots.txt",
    userRobots,
    "Sitemap: https://www.synapse-network.ai/sitemap.xml",
  );
  assertIncludes("user llms.txt", userLlms, "AI Agent Payments");
  assertIncludes("user llms.txt", userLlms, "MCP Server for Paid API Calls");
  assertIncludes("user llms.txt", userLlms, "Remote MCP endpoint");
  assertIncludes("user sitemap", userSitemap, '"/ai-agent-payments"');
  assertIncludes("user sitemap", userSitemap, '"/agent-payment-api"');

  for (const expected of [
    "Synapse is an MCP server for paid API calls",
    "https://mcp.synapse-network.ai/mcp",
    "https://www.synapse-network.ai/",
    "discover_services",
    "invoke_and_pay",
    "get_receipt",
    "ChatGPT",
    "Claude",
  ]) {
    assertIncludes("mcp paid API calls page", paidMcpPage, expected);
  }

  for (const crawler of aiSearchCrawlers) {
    const groupPattern = new RegExp(
      `User-agent:\\s*${crawler}[\\s\\S]*?(?=\\nUser-agent:|\\nSitemap:|$)`,
    );
    const group = userRobots.match(groupPattern)?.[0] || "";
    assertIncludes("user robots.txt", userRobots, `User-agent: ${crawler}`);
    assertIncludes(`user robots.txt ${crawler} group`, group, "Allow: /");
    assertIncludes("docs robots.ts", docsRobots, `"${crawler}"`);
    for (const disallow of privateRobotsDisallows) {
      assertIncludes(`user robots.txt ${crawler} group`, group, disallow);
    }
  }
}

assertMeta();
assertDocsPages();
assertCrawlerAssets();

if (failures.length > 0) {
  console.error("[ci:ai-visibility-assets] failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[ci:ai-visibility-assets] passed");
