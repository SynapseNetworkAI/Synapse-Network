#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const userFrontRoot = path.join(repoRoot, "services", "user-front");
const llmsPath = path.join(userFrontRoot, "public", "llms.txt");
const llmsFullPath = path.join(userFrontRoot, "public", "llms-full.txt");
const robotsPath = path.join(userFrontRoot, "public", "robots.txt");
const indexNowKeyPath = path.join(
  userFrontRoot,
  "public",
  "4f58d9a2e2c84f85a5f3b5baf9a65c7d.txt",
);
const publicSitemapPath = path.join(userFrontRoot, "public", "sitemap.xml");
const sitemapPath = path.join(userFrontRoot, "src", "app", "sitemap.ts");
const layoutPath = path.join(userFrontRoot, "src", "app", "layout.tsx");
const nextConfigPath = path.join(userFrontRoot, "next.config.mjs");
const appRoot = path.join(userFrontRoot, "src", "app");
const faviconPath = path.join(appRoot, "favicon.ico");
const iconPngPath = path.join(userFrontRoot, "public", "icon.png");
const appleTouchIconPath = path.join(
  userFrontRoot,
  "public",
  "apple-touch-icon.png",
);
const siteHostname = "www.synapse-network.ai";
const indexNowKey = "4f58d9a2e2c84f85a5f3b5baf9a65c7d";

const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/ai-agent-payments",
  "/agent-payment-api",
  "/mcp-server-for-paid-api-calls",
  "/chatgpt-mcp-app-api-payments",
  "/marketplace",
  "/forum",
  "/llms.txt",
  "/llms-full.txt",
];

const PRIVATE_PATTERNS = [
  "/dashboard",
  "/provider",
  "/api",
  "/marketplace/registry.json",
];
const FORBIDDEN_SEO_TEXT = [
  "http://synapse-network.ai",
  "sitemap.website.xml",
  "chrome-extension://",
  "<script",
];
const AI_SEARCH_CRAWLERS = [
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
const PRIVATE_ROBOTS_DISALLOWS = [
  "Disallow: /dashboard/",
  "Disallow: /provider/",
  "Disallow: /api/",
  "Disallow: /_next/data/",
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} missing: ${path.relative(repoRoot, filePath)}`);
    return false;
  }
  return true;
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractMarkdownUrls(markdown) {
  const urls = new Set();
  const markdownLinkPattern = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
  const bareUrlPattern = /https?:\/\/[^\s)]+/g;

  for (const match of markdown.matchAll(markdownLinkPattern)) {
    urls.add(match[1]);
  }
  for (const match of markdown.matchAll(bareUrlPattern)) {
    urls.add(match[0]);
  }

  return [...urls].map((url) => url.replace(/[.,;]+$/, ""));
}

function normalizeInternalPath(url) {
  const parsed = new URL(url);
  const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
  return decodeURIComponent(normalizedPath);
}

function routeExists(routePath) {
  if (routePath.endsWith(".md")) {
    return false;
  }
  const segments = routePath === "/" ? [] : routePath.slice(1).split("/");
  return fs.existsSync(path.join(appRoot, ...segments, "page.tsx"));
}

function includesRoute(text, route) {
  return text.includes(`"${route}"`) || text.includes(`'${route}'`);
}

function includesPrivateRouteLiteral(text, route) {
  return (
    text.includes(`"${route}"`) ||
    text.includes(`"${route}/"`) ||
    text.includes(`'${route}'`) ||
    text.includes(`'${route}/'`) ||
    text.includes(`https://${siteHostname}${route}`) ||
    text.includes(`https://${siteHostname}${route}/`)
  );
}

function assertNoForbiddenSeoText(label, text) {
  for (const forbidden of FORBIDDEN_SEO_TEXT) {
    if (text.includes(forbidden)) {
      fail(`${label} must not include forbidden SEO text: ${forbidden}`);
    }
  }
}

if (assertFile(llmsPath, "llms.txt")) {
  const llms = readText(llmsPath);
  const urls = extractMarkdownUrls(llms);
  assertNoForbiddenSeoText("llms.txt", llms);

  for (const expected of [
    "SynapseNetwork",
    "AI Agent Payments",
    "Agent Payment API",
    "MCP Server for Paid API Calls",
    "ChatGPT MCP App for API Payments",
    "LLM billing",
    "MCP Server GitHub",
    "https://github.com/SynapseNetworkAI/Synapse-Network-MCP-Server",
  ]) {
    if (!llms.includes(expected)) {
      fail(`llms.txt missing expected text: ${expected}`);
    }
  }

  for (const privatePattern of PRIVATE_PATTERNS) {
    if (llms.includes(`https://${siteHostname}${privatePattern}`)) {
      fail(`llms.txt must not include private/app route: ${privatePattern}`);
    }
  }

  if (urls.length === 0) {
    fail("llms.txt must include at least one public URL");
  }

  for (const rawUrl of urls) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      fail(`Invalid URL in llms.txt: ${rawUrl}`);
      continue;
    }

    if (parsed.hostname !== siteHostname) {
      continue;
    }

    const routePath = normalizeInternalPath(rawUrl);
    if (routePath.endsWith(".md")) {
      fail(
        `Internal llms.txt URL must not use docs .md mirror routes: ${rawUrl}`,
      );
      continue;
    }
    if (!routeExists(routePath)) {
      fail(`Internal llms.txt URL has no public Next page: ${rawUrl}`);
    }
  }
}

if (assertFile(llmsFullPath, "llms-full.txt")) {
  const llmsFull = readText(llmsFullPath);
  const urls = extractMarkdownUrls(llmsFull);
  assertNoForbiddenSeoText("llms-full.txt", llmsFull);

  for (const expected of [
    "SynapseNetwork Full Answer-Engine Context",
    "USDC-native settlement layer for AI agents",
    "Remote MCP endpoint: https://mcp.synapse-network.ai/mcp",
    "MCP paid API landing page: https://www.synapse-network.ai/mcp-server-for-paid-api-calls",
    "ChatGPT MCP app landing page: https://www.synapse-network.ai/chatgpt-mcp-app-api-payments",
    "MCP Server for Paid API Calls",
    "discover_services",
    "invoke_and_pay",
    "get_receipt",
    "ChatGPT",
    "Claude",
    "Grok",
    "Do not claim",
  ]) {
    if (!llmsFull.includes(expected)) {
      fail(`llms-full.txt missing expected text: ${expected}`);
    }
  }

  for (const privatePattern of PRIVATE_PATTERNS) {
    if (llmsFull.includes(`https://${siteHostname}${privatePattern}`)) {
      fail(
        `llms-full.txt must not include private/app route: ${privatePattern}`,
      );
    }
  }

  if (urls.length === 0) {
    fail("llms-full.txt must include at least one public URL");
  }

  for (const rawUrl of urls) {
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      fail(`Invalid URL in llms-full.txt: ${rawUrl}`);
      continue;
    }

    if (parsed.hostname !== siteHostname) {
      continue;
    }

    const routePath = normalizeInternalPath(rawUrl);
    if (routePath.endsWith(".md")) {
      fail(
        `Internal llms-full.txt URL must not use docs .md mirror routes: ${rawUrl}`,
      );
      continue;
    }
    if (routePath !== "/llms-full.txt" && !routeExists(routePath)) {
      fail(`Internal llms-full.txt URL has no public Next page: ${rawUrl}`);
    }
  }
}

if (assertFile(robotsPath, "robots.txt")) {
  const robots = readText(robotsPath);
  assertNoForbiddenSeoText("robots.txt", robots);
  const requiredLines = [
    ...AI_SEARCH_CRAWLERS.map((crawler) => `User-agent: ${crawler}`),
    "User-agent: *",
    "Allow: /",
    ...PRIVATE_ROBOTS_DISALLOWS,
    "Sitemap: https://www.synapse-network.ai/sitemap.xml",
  ];

  for (const line of requiredLines) {
    if (!robots.includes(line)) {
      fail(`robots.txt missing required line: ${line}`);
    }
  }

  for (const crawler of AI_SEARCH_CRAWLERS) {
    const groupPattern = new RegExp(
      `User-agent:\\s*${crawler}[\\s\\S]*?(?=\\nUser-agent:|\\nSitemap:|$)`,
    );
    const group = robots.match(groupPattern)?.[0] || "";
    if (!group.includes("Allow: /")) {
      fail(`robots.txt ${crawler} group must explicitly allow /`);
    }
    for (const disallow of PRIVATE_ROBOTS_DISALLOWS) {
      if (!group.includes(disallow)) {
        fail(
          `robots.txt ${crawler} group missing private path guard: ${disallow}`,
        );
      }
    }
  }
}

if (assertFile(indexNowKeyPath, "IndexNow key file")) {
  const keyText = readText(indexNowKeyPath).trim();
  if (keyText !== indexNowKey) {
    fail("IndexNow key file must contain the public IndexNow key.");
  }
}

if (fs.existsSync(publicSitemapPath)) {
  fail(
    "services/user-front/public/sitemap.xml must not exist because it shadows src/app/sitemap.ts",
  );
}

if (assertFile(sitemapPath, "sitemap.ts")) {
  const sitemap = readText(sitemapPath);
  assertNoForbiddenSeoText("sitemap.ts", sitemap);
  if (!sitemap.includes('const SITE_URL = "https://www.synapse-network.ai";')) {
    fail("sitemap.ts must hard-code the canonical HTTPS site URL");
  }
  for (const route of PUBLIC_ROUTES) {
    if (!includesRoute(sitemap, route)) {
      fail(`sitemap.ts missing public route: ${route}`);
    }
  }
  for (const privatePattern of PRIVATE_PATTERNS) {
    if (includesPrivateRouteLiteral(sitemap, privatePattern)) {
      fail(`sitemap.ts must not include private/app route: ${privatePattern}`);
    }
  }
}

if (assertFile(layoutPath, "layout.tsx")) {
  const layout = readText(layoutPath);
  assertNoForbiddenSeoText("layout.tsx", layout);
  for (const expected of [
    'metadataBase: new URL("https://www.synapse-network.ai")',
    "SynapseNetwork | Settlement Layer for AI Agents",
    "USDC-native payment and settlement infrastructure",
    "openGraph",
    "twitter",
    "/favicon.ico",
    "/icon.png",
    "/apple-touch-icon.png",
  ]) {
    if (!layout.includes(expected)) {
      fail(`layout metadata missing expected text: ${expected}`);
    }
  }
}

if (assertFile(nextConfigPath, "next.config.mjs")) {
  const nextConfig = readText(nextConfigPath);
  assertNoForbiddenSeoText("next.config.mjs", nextConfig);
  for (const expected of [
    'has: [{ type: "host", value: "synapse-network.ai" }]',
    'destination: "https://www.synapse-network.ai/:path*"',
    "permanent: true",
  ]) {
    if (!nextConfig.includes(expected)) {
      fail(
        `next.config.mjs missing canonical www redirect evidence: ${expected}`,
      );
    }
  }
}

assertFile(faviconPath, "favicon.ico");
assertFile(iconPngPath, "icon.png");
assertFile(appleTouchIconPath, "apple-touch-icon.png");

if (failures.length > 0) {
  console.error("[ci:seo-public-assets] failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[ci:seo-public-assets] passed");
