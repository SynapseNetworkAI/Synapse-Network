#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const userFrontRoot = path.join(repoRoot, "services", "user-front");
const llmsPath = path.join(userFrontRoot, "public", "llms.txt");
const robotsPath = path.join(userFrontRoot, "public", "robots.txt");
const sitemapPath = path.join(userFrontRoot, "src", "app", "sitemap.ts");
const layoutPath = path.join(userFrontRoot, "src", "app", "layout.tsx");
const appRoot = path.join(userFrontRoot, "src", "app");
const siteHostname = "synapse-network.ai";

const PUBLIC_ROUTES = [
  "/",
  "/about",
  "/marketplace",
  "/docs",
  "/docs/concepts",
  "/docs/getting-started",
  "/docs/getting-started/consumer",
  "/docs/getting-started/provider",
  "/docs/api-reference",
  "/docs/contracts",
  "/docs/sdk",
  "/docs/sdk/typescript",
  "/docs/sdk/python",
  "/docs/support",
  "/forum",
];

const PRIVATE_PATTERNS = [
  "/dashboard",
  "/provider",
  "/api",
  "/marketplace/registry.json",
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

if (assertFile(llmsPath, "llms.txt")) {
  const llms = readText(llmsPath);
  const urls = extractMarkdownUrls(llms);

  for (const expected of [
    "SynapseNetwork",
    "LLM billing",
    "MCP Server GitHub",
    "https://github.com/cliff-personal/Synapse-Network-MCP-Server",
  ]) {
    if (!llms.includes(expected)) {
      fail(`llms.txt missing expected text: ${expected}`);
    }
  }

  if (/\.md\b/.test(llms)) {
    fail("llms.txt must not include docs .md mirror links");
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
    if (!routeExists(routePath)) {
      fail(`Internal llms.txt URL has no public Next page: ${rawUrl}`);
    }
  }
}

if (assertFile(robotsPath, "robots.txt")) {
  const robots = readText(robotsPath);
  const requiredLines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /dashboard/",
    "Disallow: /provider/",
    "Disallow: /api/",
    "Disallow: /_next/data/",
    "Sitemap: https://synapse-network.ai/sitemap.xml",
  ];

  for (const line of requiredLines) {
    if (!robots.includes(line)) {
      fail(`robots.txt missing required line: ${line}`);
    }
  }
}

if (assertFile(sitemapPath, "sitemap.ts")) {
  const sitemap = readText(sitemapPath);
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
  for (const expected of [
    'metadataBase: new URL("https://synapse-network.ai")',
    "SynapseNetwork | Settlement Layer for AI Agents",
    "USDC-native payment and settlement infrastructure",
    "openGraph",
    "twitter",
  ]) {
    if (!layout.includes(expected)) {
      fail(`layout metadata missing expected text: ${expected}`);
    }
  }
}

if (failures.length > 0) {
  console.error("[ci:seo-public-assets] failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[ci:seo-public-assets] passed");
