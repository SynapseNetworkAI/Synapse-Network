#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const mcpDocsRoot = path.join(
  repoRoot,
  "services",
  "docs-front",
  "content",
  "docs",
  "mcp",
);
const mcpMetaPath = path.join(mcpDocsRoot, "meta.json");
const mcpPaidApiPath = path.join(mcpDocsRoot, "paid-api-calls.mdx");
const mcpIndexPath = path.join(mcpDocsRoot, "index.mdx");
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
const userLlmsPath = path.join(
  repoRoot,
  "services",
  "user-front",
  "public",
  "llms.txt",
);

const failures = [];

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
  if (!text.includes(expected)) {
    fail(`${label} missing expected text: ${expected}`);
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

function assertMcpPaidApiPage() {
  const paidMcpPage = readText(mcpPaidApiPath);
  if (!paidMcpPage) return;

  for (const field of ["title", "description", "lastUpdated"]) {
    if (!frontmatterValue(paidMcpPage, field)) {
      fail(`mcp paid API calls page missing ${field} frontmatter`);
    }
  }

  const paragraphWords = wordCount(firstParagraph(paidMcpPage));
  if (paragraphWords < 35 || paragraphWords > 80) {
    fail(
      `mcp paid API calls first answer block must be 35-80 words, found ${paragraphWords}`,
    );
  }

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
}

function assertMcpNavigation() {
  const mcpMeta = readJson(mcpMetaPath);
  const mcpIndex = readText(mcpIndexPath);
  const docsSitemap = readText(docsSitemapPath);

  if (mcpMeta && !mcpMeta.pages?.includes("paid-api-calls")) {
    fail("mcp/meta.json must include paid-api-calls");
  }
  assertIncludes("mcp index", mcpIndex, "/mcp/paid-api-calls");
  assertIncludes("docs sitemap", docsSitemap, '"/mcp/paid-api-calls"');
}

function assertCrawlerFeeds() {
  const docsLlmsRoute = readText(docsLlmsRoutePath);
  const userLlms = readText(userLlmsPath);

  assertIncludes(
    "docs llms.txt route",
    docsLlmsRoute,
    "MCP Server for Paid API Calls",
  );
  assertIncludes(
    "docs llms.txt route",
    docsLlmsRoute,
    "https://docs.synapse-network.ai/mcp/paid-api-calls",
  );
  assertIncludes(
    "docs llms.txt route",
    docsLlmsRoute,
    "https://mcp.synapse-network.ai/mcp",
  );
  assertIncludes("docs llms.txt route", docsLlmsRoute, "discover_services");
  assertIncludes("docs llms.txt route", docsLlmsRoute, "invoke_and_pay");
  assertIncludes("docs llms.txt route", docsLlmsRoute, "get_receipt");
  assertIncludes("user llms.txt", userLlms, "MCP paid API calls");
  assertIncludes("user llms.txt", userLlms, "MCP Server for Paid API Calls");
  assertIncludes(
    "user llms.txt",
    userLlms,
    "https://docs.synapse-network.ai/mcp/paid-api-calls",
  );
  assertIncludes("user llms.txt", userLlms, "Remote MCP endpoint");
  assertIncludes(
    "user llms.txt",
    userLlms,
    "https://mcp.synapse-network.ai/mcp",
  );
}

assertMcpPaidApiPage();
assertMcpNavigation();
assertCrawlerFeeds();

if (failures.length > 0) {
  console.error("[ci:ai-visibility-assets] failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[ci:ai-visibility-assets] passed");
