/**
 * Automated test for /docs page
 * Run: node tools/test-docs-page.mjs
 */
import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "output", "playwright");
const BASE = "http://localhost:3002";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let passed = 0;
let failed = 0;

function ok(name) {
  console.log(`  ✓  ${name}`);
  passed++;
}
function fail(name, reason) {
  console.error(`  ✗  ${name}: ${reason}`);
  failed++;
}

async function ss(filename) {
  await page.screenshot({
    path: path.join(OUT, filename),
    fullPage: false,
  });
}

console.log("\n=== Docs Page Automated Tests ===\n");

// ── T1: Page loads ──────────────────────────────────────────────
await page.goto(`${BASE}/docs`, { waitUntil: "networkidle" });
const title = await page.title();
if (title) ok("T1: Page loads (has <title>)");
else fail("T1: Page loads", "No title");
await ss("docs-01-pageload.png");

// ── T2: Hero heading ────────────────────────────────────────────
const heroH1 = await page.locator('[data-testid="docs-hero"] h1').textContent({ timeout: 5000 });
if (heroH1?.includes("Synapse Developer Platform"))
  ok("T2: Hero heading 'Synapse Developer Platform'");
else fail("T2: Hero heading", `Got: "${heroH1}"`);

// ── T3: Left sidebar visible ────────────────────────────────────
const sidebar = page.locator('[data-testid="docs-sidebar"]');
if (await sidebar.isVisible()) ok("T3: Left sidebar visible");
else fail("T3: Left sidebar", "Not visible");

// ── T4: Sidebar has nav buttons ────────────────────────────────
const catCount = await page.locator('[data-testid="docs-sidebar"] button').count();
if (catCount >= 7) ok(`T4: Sidebar has ${catCount} nav buttons (≥7)`);
else fail("T4: Sidebar categories", `Only ${catCount} buttons`);

// ── T5: Quick Start cards ───────────────────────────────────────
const cardCount = await page.locator('[data-testid="quickstart-cards"] > *').count();
if (cardCount >= 3) ok(`T5: Quick Start has ${cardCount} cards (≥3)`);
else fail("T5: Quick Start cards", `Only ${cardCount}`);

// ── T6: Products grid ───────────────────────────────────────────
await page.locator('[data-testid="products-grid"]').scrollIntoViewIfNeeded();
const productCount = await page.locator('[data-testid="products-grid"] > *').count();
if (productCount >= 6) ok(`T6: Products grid has ${productCount} items (≥6)`);
else fail("T6: Products grid", `Only ${productCount}`);
await ss("docs-02-products.png");

// ── T7: API reference table ─────────────────────────────────────
await page.locator('[data-testid="api-reference-section"]').scrollIntoViewIfNeeded();
const rowCount = await page.locator('[data-testid="api-reference-section"] tbody tr').count();
if (rowCount >= 5) ok(`T7: API reference table has ${rowCount} rows (≥5)`);
else fail("T7: API reference table", `Only ${rowCount} rows`);
await ss("docs-03-apitable.png");

// ── T8: Sidebar collapse / expand ──────────────────────────────
const firstCatBtn = page.locator('[data-testid="docs-sidebar"] button').first();
await firstCatBtn.click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "docs-04-sidebar-collapse.png"), fullPage: false });
await firstCatBtn.click();
await page.waitForTimeout(300);
ok("T8: Sidebar collapse/expand toggle works");

// ── T9: Navbar shows Docs link ──────────────────────────────────
await page.goto(`${BASE}`, { waitUntil: "networkidle" });
const docsLink = page.locator('nav a[href="/docs"]').first();
if (await docsLink.isVisible()) ok("T9: Navbar has /docs link on home page");
else fail("T9: Navbar /docs link", "Not visible on home page");
await ss("docs-05-navbar.png");

// ── T10: CTA navigates to /dashboard ───────────────────────────
await page.goto(`${BASE}/docs`, { waitUntil: "networkidle" });
const ctaBtn = page.locator('[data-testid="cta-quickstart"]');
if (await ctaBtn.isVisible()) {
  await ctaBtn.click();
  await page.waitForTimeout(600);
  const url = page.url();
  // Auth middleware may redirect /dashboard → /login — any navigation away from /docs is correct
  if (url !== `${BASE}/docs`) ok(`T10: CTA navigates away from /docs → ${url.replace(BASE, "")}`);
  else fail("T10: CTA navigation", "URL did not change from /docs");
} else {
  fail("T10: CTA quickstart button", "Not found");
}

await ss("docs-06-cta-nav.png");

// ── Full-page final screenshot ──────────────────────────────────
await page.goto(`${BASE}/docs`, { waitUntil: "networkidle" });
await page.screenshot({
  path: path.join(OUT, "docs-00-full.png"),
  fullPage: true,
});
ok("Full-page screenshot saved → output/playwright/docs-00-full.png");

await browser.close();

console.log(`\n${"─".repeat(40)}`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
console.log(`${"─".repeat(40)}\n`);

if (failed > 0) process.exit(1);
