#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const ENVIRONMENT = (
  process.env.SEO_PUBLIC_ASSETS_ENV ||
  process.env.SYNAPSE_E2E_ENV ||
  "local"
).trim();
const BASE_URL = normalizeBaseUrl(
  process.env.SEO_PUBLIC_ASSETS_BASE_URL || defaultBaseUrl(ENVIRONMENT)
);
const GENERATED_AT = new Date();
const RUN_ID =
  process.env.SEO_PUBLIC_ASSETS_RUN_ID ||
  `seo-public-assets-${ENVIRONMENT}-${Date.now().toString(36)}`;
const OUT_DIR = path.resolve(
  process.env.SEO_PUBLIC_ASSETS_EVIDENCE_DIR ||
    defaultEvidenceDir(ENVIRONMENT, GENERATED_AT)
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");

const EXPECTED_TITLE = "SynapseNetwork | Settlement Layer for AI Agents";
const EXPECTED_DESCRIPTION =
  "USDC-native payment and settlement infrastructure for AI agents buying APIs, LLM calls, data services, tools, and MCP integrations.";
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
const FORBIDDEN_SITEMAP_URLS = [
  "https://synapse-network.ai/dashboard",
  "https://synapse-network.ai/provider",
  "https://synapse-network.ai/api",
  "https://synapse-network.ai/marketplace/registry.json",
];

const checks = [];
const trace = [];
const screenshotEvidence = [];

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function defaultBaseUrl(environment) {
  if (environment === "staging") return "https://staging.synapse-network.ai";
  if (environment === "prod") return "https://synapse-network.ai";
  return "http://localhost:3000";
}

function defaultEvidenceDir(environment, date) {
  const stamp = formatTimestamp(date);
  if (environment === "staging") {
    return path.join(
      ROOT,
      "docs/evidence/staging/seo-public-assets",
      `${stamp}-staging`
    );
  }
  if (environment === "prod") {
    return path.join(
      ROOT,
      "docs/evidence/prod/seo-public-assets",
      `${stamp}-prod`
    );
  }
  return path.join(ROOT, "output/dogfood/seo-public-assets", `${stamp}-local`);
}

function formatTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function normalizeBaseUrl(value) {
  const parsed = new URL(value);
  return parsed.toString().replace(/\/+$/, "");
}

function absoluteUrl(route) {
  return `${BASE_URL}${route}`;
}

function redact(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b0x[a-fA-F0-9]{64,}\b/g, "0x[REDACTED]")
    .replace(
      /(token|secret|password|private[_-]?key|signature|cookie)\s*[:=]\s*[^,\s"']+/gi,
      "$1=[REDACTED]"
    );
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [key, sanitize(next)])
    );
  }
  if (typeof value === "string") return redact(value);
  return value;
}

function addTrace(entry) {
  trace.push(
    sanitize({
      runId: RUN_ID,
      timestamp: new Date().toISOString(),
      ...entry,
    })
  );
}

function addCheck(name, status, details = {}) {
  const check = sanitize({ name, ...details, status });
  checks.push(check);
  addTrace({
    scenario: name,
    status,
    details,
  });
  return check;
}

function pass(name, details = {}) {
  return addCheck(name, "passed", details);
}

function fail(name, error, details = {}) {
  return addCheck(name, "failed", {
    error: redact(error?.message || error),
    ...details,
  });
}

async function fetchText(route) {
  const url = absoluteUrl(route);
  const started = Date.now();
  const response = await fetch(url, {
    headers: { Accept: "text/plain,text/html,application/xml,*/*" },
  });
  const text = await response.text();
  const result = {
    route,
    url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type") || "",
    durationMs: Date.now() - started,
    text,
  };
  addTrace({
    scenario: `fetch:${route}`,
    method: "GET",
    url,
    httpStatus: result.status,
    durationMs: result.durationMs,
    bodyExcerpt: text.slice(0, 500),
  });
  return result;
}

function assertIncludes({ name, text, values }) {
  const missing = values.filter((value) => !text.includes(value));
  if (missing.length > 0) {
    fail(name, `Missing expected text: ${missing.join(", ")}`, { missing });
    return false;
  }
  pass(name, { expected: values });
  return true;
}

function assertExcludes({ name, text, values }) {
  const present = values.filter((value) => text.includes(value));
  if (present.length > 0) {
    fail(name, `Found forbidden text: ${present.join(", ")}`, { present });
    return false;
  }
  pass(name, { forbidden: values });
  return true;
}

function extractUrls(text) {
  return [
    ...new Set(text.match(/https:\/\/synapse-network\.ai\/?[^\s),]*/g) || []),
  ].map((url) => url.replace(/[.,;]+$/, ""));
}

async function verifyInternalLinks(llmsText) {
  const urls = extractUrls(llmsText);
  const internalLinks = [];
  for (const originalUrl of urls) {
    const parsed = new URL(originalUrl);
    const route = parsed.pathname || "/";
    const localUrl = absoluteUrl(
      route === "/" ? "/" : route.replace(/\/+$/, "")
    );
    const started = Date.now();
    const response = await fetch(localUrl, { redirect: "manual" });
    const durationMs = Date.now() - started;
    internalLinks.push({
      originalUrl,
      checkedUrl: localUrl,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      durationMs,
    });
  }
  const failed = internalLinks.filter((link) => !link.ok);
  if (failed.length > 0) {
    fail(
      "llms_internal_links_200",
      "One or more llms.txt internal links did not return 2xx",
      { failed, internalLinks }
    );
  } else {
    pass("llms_internal_links_200", {
      count: internalLinks.length,
      internalLinks,
    });
  }
  return internalLinks;
}

async function capturePage({ page, route, fileName, expectedText }) {
  const url = absoluteUrl(route);
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
  const bodyText = await page
    .locator("body")
    .innerText({ timeout: 10_000 })
    .catch(() => "");
  const title = await page.title().catch(() => "");
  const status = response?.status() || 0;
  const expectedVisible = expectedText
    ? bodyText.includes(expectedText) || title.includes(expectedText)
    : true;
  const forbiddenText = [
    "Application error",
    "Internal Server Error",
    "404",
    "This page could not be found",
  ];
  const forbiddenPresent = forbiddenText.filter((text) =>
    bodyText.includes(text)
  );
  const filePath = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  const evidence = {
    file: path.relative(OUT_DIR, filePath),
    url,
    httpStatus: status,
    title,
    expectedText,
    expectedVisible,
    forbiddenTextAbsent: forbiddenPresent.length === 0,
    forbiddenPresent,
    capturedAt: new Date().toISOString(),
  };
  screenshotEvidence.push(evidence);
  if (
    status >= 200 &&
    status < 300 &&
    expectedVisible &&
    forbiddenPresent.length === 0
  ) {
    pass(`screenshot_${fileName}`, evidence);
  } else {
    fail(
      `screenshot_${fileName}`,
      "Screenshot DOM checkpoint failed",
      evidence
    );
  }
}

async function verifyMetadata(page) {
  const url = absoluteUrl("/");
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
  const metadata = await page.evaluate(() => ({
    title: document.title,
    description:
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content") || "",
    canonical:
      document.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
      "",
    ogTitle:
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content") || "",
    ogDescription:
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") || "",
    twitterCard:
      document
        .querySelector('meta[name="twitter:card"]')
        ?.getAttribute("content") || "",
    twitterTitle:
      document
        .querySelector('meta[name="twitter:title"]')
        ?.getAttribute("content") || "",
    twitterDescription:
      document
        .querySelector('meta[name="twitter:description"]')
        ?.getAttribute("content") || "",
  }));
  const ok =
    response?.status() === 200 &&
    metadata.title === EXPECTED_TITLE &&
    metadata.description === EXPECTED_DESCRIPTION &&
    metadata.ogTitle === EXPECTED_TITLE &&
    metadata.ogDescription === EXPECTED_DESCRIPTION &&
    metadata.twitterCard === "summary";
  if (ok) {
    pass("homepage_metadata", {
      url,
      httpStatus: response?.status(),
      metadata,
    });
  } else {
    fail(
      "homepage_metadata",
      "Homepage metadata does not match expected SEO contract",
      {
        url,
        httpStatus: response?.status(),
        metadata,
        expectedTitle: EXPECTED_TITLE,
        expectedDescription: EXPECTED_DESCRIPTION,
      }
    );
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: process.env.SEO_PUBLIC_ASSETS_HEADLESS !== "0",
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const llms = await fetchText("/llms.txt");
    if (llms.status === 200) {
      pass("llms_txt_http_200", {
        status: llms.status,
        contentType: llms.contentType,
      });
      assertIncludes({
        name: "llms_txt_expected_content",
        text: llms.text,
        values: ["SynapseNetwork", "MCP Server GitHub", "LLM billing"],
      });
      assertExcludes({
        name: "llms_txt_no_private_routes",
        text: llms.text,
        values: [
          "https://synapse-network.ai/dashboard",
          "https://synapse-network.ai/provider",
          "https://synapse-network.ai/api",
          "https://synapse-network.ai/marketplace/registry.json",
          ".md",
        ],
      });
      await verifyInternalLinks(llms.text);
    } else {
      fail("llms_txt_http_200", `Expected 200, got ${llms.status}`, {
        status: llms.status,
        bodyExcerpt: llms.text.slice(0, 500),
      });
    }

    const robots = await fetchText("/robots.txt");
    if (robots.status === 200) {
      pass("robots_txt_http_200", {
        status: robots.status,
        contentType: robots.contentType,
      });
      assertIncludes({
        name: "robots_txt_expected_content",
        text: robots.text,
        values: [
          "User-agent: *",
          "Allow: /",
          "Disallow: /dashboard/",
          "Disallow: /provider/",
          "Disallow: /api/",
          "Sitemap: https://synapse-network.ai/sitemap.xml",
        ],
      });
    } else {
      fail("robots_txt_http_200", `Expected 200, got ${robots.status}`, {
        status: robots.status,
        bodyExcerpt: robots.text.slice(0, 500),
      });
    }

    const sitemap = await fetchText("/sitemap.xml");
    if (sitemap.status === 200) {
      pass("sitemap_xml_http_200", {
        status: sitemap.status,
        contentType: sitemap.contentType,
      });
      assertIncludes({
        name: "sitemap_xml_public_routes",
        text: sitemap.text,
        values: PUBLIC_ROUTES.map(
          (route) => `https://synapse-network.ai${route === "/" ? "" : route}`
        ),
      });
      assertExcludes({
        name: "sitemap_xml_no_private_routes",
        text: sitemap.text,
        values: FORBIDDEN_SITEMAP_URLS,
      });
    } else {
      fail("sitemap_xml_http_200", `Expected 200, got ${sitemap.status}`, {
        status: sitemap.status,
        bodyExcerpt: sitemap.text.slice(0, 500),
      });
    }

    await verifyMetadata(page);
    await capturePage({
      page,
      route: "/",
      fileName: "homepage-metadata.png",
      expectedText: "SynapseNetwork",
    });
    await capturePage({
      page,
      route: "/llms.txt",
      fileName: "llms-txt.png",
      expectedText: "SynapseNetwork",
    });
    await capturePage({
      page,
      route: "/robots.txt",
      fileName: "robots-txt.png",
      expectedText: "User-agent: *",
    });
    await capturePage({
      page,
      route: "/sitemap.xml",
      fileName: "sitemap-xml.png",
      expectedText: "https://synapse-network.ai",
    });
  } finally {
    await browser.close();
  }

  writeEvidence();
  const failed = checks.filter((check) => check.status !== "passed");
  if (failed.length > 0) {
    console.error(
      `[seo-public-assets] failed: ${failed
        .map((check) => check.name)
        .join(", ")}`
    );
    process.exit(1);
  }
  console.log(`[seo-public-assets] evidence written to ${OUT_DIR}`);
}

function writeEvidence() {
  const traceText =
    trace.map((entry) => JSON.stringify(sanitize(entry))).join("\n") + "\n";
  const traceDigest = crypto
    .createHash("sha256")
    .update(traceText)
    .digest("hex");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "trace.jsonl"), traceText);
  fs.writeFileSync(
    path.join(OUT_DIR, "screenshot-evidence.json"),
    `${JSON.stringify(screenshotEvidence.map(sanitize), null, 2)}\n`
  );

  const failed = checks.filter((check) => check.status !== "passed");
  const report = sanitize({
    status: failed.length === 0 ? "passed" : "failed",
    environment: ENVIRONMENT,
    baseUrl: BASE_URL,
    runId: RUN_ID,
    generatedAt: GENERATED_AT.toISOString(),
    checks,
    failed,
    screenshots: screenshotEvidence,
    traceDigest,
  });
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    renderReportMarkdown(report)
  );
}

function renderReportMarkdown(report) {
  return [
    "# SEO Public Assets Evidence",
    "",
    `- Status: ${report.status}`,
    `- Environment: ${report.environment}`,
    `- Base URL: ${report.baseUrl}`,
    `- Generated: ${report.generatedAt}`,
    `- Trace digest: ${report.traceDigest}`,
    "",
    "| Check | Status |",
    "|---|---|",
    ...report.checks.map((check) => `| ${check.name} | ${check.status} |`),
    "",
    "## Screenshots",
    "",
    ...report.screenshots.map(
      (screenshot) => `- ${screenshot.file}: ${screenshot.url}`
    ),
    "",
  ].join("\n");
}

main().catch((error) => {
  fail("runner_uncaught_error", error);
  writeEvidence();
  console.error(error);
  process.exit(1);
});
