/**
 * Playwright docs performance measurement script
 * Measures page load timing BEFORE and AFTER optimizations.
 *
 * Usage:
 *   node tools/measure-docs-perf.mjs
 *   node tools/measure-docs-perf.mjs --label after
 *
 * Output:
 *   output/playwright/perf-before.json
 *   output/playwright/perf-after.json
 *   output/playwright/perf-report.md  (generated when both exist)
 */
import { chromium } from "playwright";
import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "output", "playwright");
const BASE = process.env.DOCS_BASE_URL || "http://localhost:3001";
const LABEL = process.argv.includes("--label")
  ? process.argv[process.argv.indexOf("--label") + 1]
  : "before";

const PAGES = [
  { name: "docs/home", url: `${BASE}/` },
  { name: "docs/get-started", url: `${BASE}/get-started` },
  { name: "docs/concepts", url: `${BASE}/concepts/agent-settlement` },
  { name: "docs/api-reference", url: `${BASE}/api-reference` },
  { name: "docs/sdks", url: `${BASE}/sdks` },
  { name: "docs/smart-contracts", url: `${BASE}/smart-contracts` },
];

// Sidebar nav links visible on a docs page (text → target route)
const SIDEBAR_NAV_PAIRS = [
  {
    from: `${BASE}/`,
    clickText: "API Reference",
    expectedUrl: `${BASE}/api-reference`,
  },
  {
    from: `${BASE}/sdks`,
    clickText: "TypeScript",
    expectedUrl: `${BASE}/sdks/typescript`,
  },
  {
    from: `${BASE}/`,
    clickText: "Get Started",
    expectedUrl: `${BASE}/get-started`,
  },
];

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });

// --------------------------------------------------------------------------
// 1. Cold navigation timing — navigate direct to URL
// --------------------------------------------------------------------------
async function measurePageLoad(page, url) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      domContentLoaded: Math.round(
        nav.domContentLoadedEventEnd - nav.startTime
      ),
      loadEvent: Math.round(nav.loadEventEnd - nav.startTime),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      responseEnd: Math.round(nav.responseEnd - nav.startTime),
      transferSize: nav.transferSize ?? 0,
    };
  });

  // Wait for main content to appear
  await page.waitForSelector("main", { timeout: 5000 }).catch(() => {});
  timing.wallClockMs = Date.now() - t0;
  return timing;
}

// --------------------------------------------------------------------------
// 2. In-app navigation timing — sidebar click → content visible
// --------------------------------------------------------------------------
async function measureSidebarNav(page, from, clickText, expectedUrl) {
  await page.goto(from, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 5000 }).catch(() => {});

  const link = page.getByRole("link", { name: new RegExp(clickText, "i") });

  const clickStart = Date.now();
  await link.first().click();

  // Wait for URL change
  await page.waitForURL(expectedUrl, { timeout: 5000 }).catch(() => {});

  // Wait for content to appear
  await page
    .waitForSelector("main h1, main h2, main section", { timeout: 5000 })
    .catch(() => {});
  const timeToContentMs = Date.now() - clickStart;

  return { from, to: expectedUrl, clickText, timeToContentMs };
}

// --------------------------------------------------------------------------
// 3. Collect results
// --------------------------------------------------------------------------
console.log(
  `\n=== Docs Performance Measurement [${LABEL.toUpperCase()}] ===\n`
);

const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
});
const page = await context.newPage({ viewport: { width: 1440, height: 900 } });

// Disable cache to get clean measurements
await context.route("**/*", (route) => route.continue());

const pageResults = [];
for (const { name, url } of PAGES) {
  // Run 2 warm-up passes, take 3rd measurement
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  const timing = await measurePageLoad(page, url);

  // Screenshot
  const ssName = `perf-${LABEL}-${name.replace(/\//g, "-")}.png`;
  await page.screenshot({ path: path.join(OUT, ssName), fullPage: false });

  pageResults.push({ name, url, ...timing });
  console.log(`  ${name}`);
  console.log(`    DOMContentLoaded: ${timing.domContentLoaded}ms`);
  console.log(`    LoadEvent:        ${timing.loadEvent}ms`);
  console.log(`    FCP:              ${timing.fcp ?? "n/a"}ms`);
  console.log(`    Wall clock:       ${timing.wallClockMs}ms`);
}

// In-app (sidebar) navigation
console.log("\n  --- In-app sidebar navigation ---");
const navResults = [];
for (const pair of SIDEBAR_NAV_PAIRS) {
  try {
    const result = await measureSidebarNav(
      page,
      pair.from,
      pair.clickText,
      pair.expectedUrl
    );
    navResults.push(result);
    console.log(`  ${pair.clickText}: ${result.timeToContentMs}ms`);

    // Screenshot of destination after click
    const ssName = `perf-${LABEL}-nav-${pair.clickText
      .toLowerCase()
      .replace(/\s/g, "-")}.png`;
    await page.screenshot({ path: path.join(OUT, ssName), fullPage: false });
  } catch (e) {
    console.error(`  SKIP ${pair.clickText}: ${e.message.slice(0, 80)}`);
    navResults.push({
      ...pair,
      timeToContentMs: null,
      error: e.message.slice(0, 80),
    });
  }
}

await browser.close();

// --------------------------------------------------------------------------
// 4. Save results
// --------------------------------------------------------------------------
const results = {
  label: LABEL,
  timestamp: new Date().toISOString(),
  pages: pageResults,
  navigation: navResults,
};
const outFile = path.join(OUT, `perf-${LABEL}.json`);
await writeFile(outFile, JSON.stringify(results, null, 2));
console.log(`\n  Saved → ${outFile}`);

// --------------------------------------------------------------------------
// 5. Generate comparison report if both before/after exist
// --------------------------------------------------------------------------
const beforeFile = path.join(OUT, "perf-before.json");
const afterFile = path.join(OUT, "perf-after.json");

try {
  const before = JSON.parse(await readFile(beforeFile, "utf-8"));
  const after = JSON.parse(await readFile(afterFile, "utf-8"));

  const lines = [
    "# Docs Page Load Performance: Before vs After",
    "",
    `**Before**: ${before.timestamp}`,
    `**After**:  ${after.timestamp}`,
    "",
    "## Cold Navigation (direct URL load)",
    "",
    "| Page | Before DOMReady | After DOMReady | Δ | Before FCP | After FCP | Δ FCP |",
    "|------|-----------------|----------------|---|------------|-----------|-------|",
  ];

  for (const bp of before.pages) {
    const ap = after.pages.find((p) => p.name === bp.name);
    if (!ap) continue;
    const deltaDOM = ap.domContentLoaded - bp.domContentLoaded;
    const deltaFCP = ap.fcp !== null && bp.fcp !== null ? ap.fcp - bp.fcp : "–";
    const sign = (n) =>
      typeof n === "number" ? (n <= 0 ? `**${n}ms ✓**` : `+${n}ms`) : "–";
    lines.push(
      `| ${bp.name} | ${bp.domContentLoaded}ms | ${
        ap.domContentLoaded
      }ms | ${sign(deltaDOM)} | ${bp.fcp ?? "–"}ms | ${
        ap.fcp ?? "–"
      }ms | ${sign(deltaFCP)} |`
    );
  }

  lines.push("", "## In-App Sidebar Navigation (click → content visible)", "");
  lines.push("| Route | Before | After | Δ |");
  lines.push("|-------|--------|-------|---|");

  for (const bn of before.navigation) {
    const an = after.navigation.find((n) => n.clickText === bn.clickText);
    if (!an) continue;
    const delta =
      an.timeToContentMs !== null && bn.timeToContentMs !== null
        ? an.timeToContentMs - bn.timeToContentMs
        : "–";
    const sign = (n) =>
      typeof n === "number" ? (n <= 0 ? `**${n}ms ✓**` : `+${n}ms`) : "–";
    lines.push(
      `| ${bn.clickText} | ${bn.timeToContentMs ?? "err"}ms | ${
        an.timeToContentMs ?? "err"
      }ms | ${sign(delta)} |`
    );
  }

  lines.push("", "---", "_Generated by tools/measure-docs-perf.mjs_");

  const reportFile = path.join(OUT, "perf-report.md");
  await writeFile(reportFile, lines.join("\n"));
  console.log(`\n  ✓ Comparison report → ${reportFile}`);
  console.log("\n" + lines.join("\n"));
} catch {
  console.log(
    "\n  (Run again with --label after to generate comparison report)"
  );
}

console.log("\n=== Done ===\n");
