#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  assertMcpQueryFeed,
  assertUserFeedAssets,
} from "./ai_visibility_feed_asset_assertions.mjs";

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
const docsIndexNowKeyPath = path.join(
  repoRoot,
  "services",
  "docs-front",
  "public",
  "4f58d9a2e2c84f85a5f3b5baf9a65c7d.txt",
);
const userLlmsPath = path.join(
  repoRoot,
  "services",
  "user-front",
  "public",
  "llms.txt",
);
const userLlmsFullPath = path.join(
  repoRoot,
  "services",
  "user-front",
  "public",
  "llms-full.txt",
);
const indexNowScriptPath = path.join(
  repoRoot,
  "scripts",
  "seo",
  "submit_indexnow_ai_visibility.mjs",
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
const indexNowKey = "4f58d9a2e2c84f85a5f3b5baf9a65c7d";
const canonicalHomepage = "https://www.synapse-network.ai";
const bareProductionHomepage = "https://synapse-network.ai";

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

function assertNoBareProductionHomepage(label, text) {
  if (text.includes(bareProductionHomepage)) {
    fail(
      `${label} must use ${canonicalHomepage} as the answer-engine canonical homepage, not ${bareProductionHomepage}`,
    );
  }
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
  assertMetaTitle(docsMeta, "AI Agent Payments", "AI Agent Payments");
  assertMetaPages(docsMeta, expectedPages, "ai-agent-payments/meta.json");

  const rootMeta = readJson(rootDocsMetaPath);
  assertMetaPages(rootMeta, ["ai-agent-payments"], "docs meta.json");

  const mcpMeta = readJson(mcpMetaPath);
  assertMetaPages(
    mcpMeta,
    ["paid-api-calls", "synapse-vs-paid-mcp", "brand-disambiguation"],
    "mcp/meta.json",
  );
}

function assertMetaTitle(meta, expectedTitle, label) {
  if (meta && meta.title !== expectedTitle) {
    fail(`${label} title must be ${expectedTitle}`);
  }
}

function assertMetaPages(meta, pages, label) {
  if (!meta) return;
  for (const page of pages) {
    if (!meta.pages?.includes(page)) {
      fail(`${label} missing page: ${page}`);
    }
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

function assertDocsRoutes(docsSitemap, userLlms) {
  for (const route of [
    "/ai-agent-payments",
    "/ai-agent-payments/agent-payment-api",
    "/ai-agent-payments/agent-pays-for-llm-calls",
    "/ai-agent-payments/provider-monetization",
    "/ai-agent-payments/receipts-and-budget-isolation",
    "/ai-agent-payments/synapse-vs-x402",
    "/ai-agent-payments/faq",
    "/mcp",
    "/mcp/paid-api-calls",
    "/mcp/synapse-vs-paid-mcp",
    "/mcp/brand-disambiguation",
  ]) {
    assertIncludes("docs sitemap", docsSitemap, `"${route}"`);
    assertIncludes(
      "user llms.txt",
      userLlms,
      `https://docs.synapse-network.ai${route}`,
    );
  }
}

function assertDocsLlmsRoute(docsLlmsRoute) {
  for (const expected of [
    "AI Agent Payments",
    "Synapse vs x402",
    "MCP Server for Paid API Calls",
    "Synapse vs Paid MCP Alternatives",
    "https://docs.synapse-network.ai/mcp/synapse-vs-paid-mcp",
    "Synapse Brand Disambiguation",
    "https://docs.synapse-network.ai/mcp/brand-disambiguation",
    'for "MCP server for paid API calls"',
    'for "ChatGPT MCP app for API payments"',
    "synapseproto.com",
    "synapsenetwork.xyz",
    "Dock0",
    "Apiosk",
    "Teleport",
    "agent402",
    "mcpay.fun",
    "Cashfree",
    "mcp-marketplace.io",
    "Glama lists the SynapseNetworkAI MCP Connector",
    "dataset search/entity metadata",
    "2026-06-10 ChatGPT correction",
    "mcp.synapse.org",
    "docs.synapse.sh",
    "io.github.SynapseLayer/synapse-layer",
    "getdrio.com",
    "https://mcp.synapse.sh/mcp",
    "python-docs.synapse.org",
    "susheel synapse-mcp",
  ]) {
    assertIncludes("docs llms.txt route", docsLlmsRoute, expected);
  }
}

function assertIndexNowAssets(indexNowScript) {
  assertIncludes(
    "IndexNow script",
    indexNowScript,
    "https://api.indexnow.org/indexnow",
  );
  assertIncludes("IndexNow script", indexNowScript, "docs.synapse-network.ai");
  assertIncludes("IndexNow script", indexNowScript, indexNowKey);
  assertIncludes("IndexNow script", indexNowScript, "${INDEXNOW_KEY}.txt");
  assertIncludes(
    "IndexNow script",
    indexNowScript,
    "https://docs.synapse-network.ai/mcp/paid-api-calls",
  );
  assertIncludes(
    "IndexNow script",
    indexNowScript,
    "https://docs.synapse-network.ai/mcp/synapse-vs-paid-mcp",
  );
  assertIncludes(
    "IndexNow script",
    indexNowScript,
    "https://docs.synapse-network.ai/mcp/brand-disambiguation",
  );
  assertIncludes(
    "IndexNow script",
    indexNowScript,
    "https://www.synapse-network.ai/ai-agent-payments",
  );
  assertIncludes(
    "IndexNow script",
    indexNowScript,
    "https://www.synapse-network.ai/mcp-server-for-paid-api-calls",
  );
  assertIncludes(
    "IndexNow script",
    indexNowScript,
    "https://www.synapse-network.ai/chatgpt-mcp-app-api-payments",
  );
  assertIncludes(
    "IndexNow script",
    indexNowScript,
    "https://www.synapse-network.ai/llms-full.txt",
  );
}

function assertCrawlerGroups(docsRobots, userRobots) {
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

function assertCrawlerAssets() {
  const docsSitemap = readText(docsSitemapPath);
  const docsLlmsRoute = readText(docsLlmsRoutePath);
  const docsRobots = readText(docsRobotsPath);
  const docsIndexNowKey = readText(docsIndexNowKeyPath).trim();
  const userLlms = readText(userLlmsPath);
  const userLlmsFull = readText(userLlmsFullPath);
  const userRobots = readText(userRobotsPath);
  const userSitemap = readText(userSitemapPath);
  const indexNowScript = readText(indexNowScriptPath);
  const mcpIndexPage = readText(path.join(mcpDocsRoot, "index.mdx"));
  const paidMcpPage = readText(path.join(mcpDocsRoot, "paid-api-calls.mdx"));
  const paidMcpComparisonPage = readText(
    path.join(mcpDocsRoot, "synapse-vs-paid-mcp.mdx"),
  );
  const registryPage = readText(path.join(mcpDocsRoot, "registry.mdx"));
  const brandDisambiguationPage = readText(
    path.join(mcpDocsRoot, "brand-disambiguation.mdx"),
  );

  for (const [label, text] of [
    ["docs sitemap", docsSitemap],
    ["docs llms.txt route", docsLlmsRoute],
    ["docs robots.ts", docsRobots],
    ["user llms.txt", userLlms],
    ["user llms-full.txt", userLlmsFull],
    ["user robots.txt", userRobots],
    ["user sitemap", userSitemap],
    ["IndexNow script", indexNowScript],
    ["mcp index page", mcpIndexPage],
    ["mcp paid API calls page", paidMcpPage],
    ["mcp paid MCP comparison page", paidMcpComparisonPage],
    ["mcp registry page", registryPage],
    ["mcp brand disambiguation page", brandDisambiguationPage],
  ]) {
    assertNoBareProductionHomepage(label, text);
  }

  assertDocsRoutes(docsSitemap, userLlms);
  assertDocsLlmsRoute(docsLlmsRoute);
  assertIncludes(
    "docs robots.ts",
    docsRobots,
    "sitemap: `${siteUrl}/sitemap.xml`",
  );
  if (docsIndexNowKey !== indexNowKey) {
    fail("docs-front IndexNow key file must contain the public IndexNow key.");
  }
  assertIncludes(
    "user robots.txt",
    userRobots,
    "Sitemap: https://www.synapse-network.ai/sitemap.xml",
  );
  assertIndexNowAssets(indexNowScript);
  assertUserFeedAssets({
    assertIncludes,
    userLlms,
    userLlmsFull,
    userSitemap,
  });
  assertMcpQueryFeed({
    assertIncludes,
    mcpIndexPage,
    paidMcpPage,
    paidMcpComparisonPage,
    registryPage,
    brandDisambiguationPage,
    userLlmsFull,
  });
  assertCrawlerGroups(docsRobots, userRobots);
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
