#!/usr/bin/env node
/**
 * screenshot_docs.js
 *
 * Take EN and ZH screenshots of docs pages to verify i18n rendering.
 *
 * Usage:
 *   node scripts/tools/screenshot_docs.js [page-path] [output-dir]
 *
 * Defaults:
 *   page-path  = /get-started/agent-builders
 *   output-dir = output/playwright/
 *
 * Examples:
 *   node scripts/tools/screenshot_docs.js
 *   node scripts/tools/screenshot_docs.js /get-started/api-providers output/playwright
 *   node scripts/tools/screenshot_docs.js /api-reference output/playwright
 *
 * Requirements:
 *   - npm install playwright  (or npx playwright install chromium)
 *   - Docs dev server running at http://localhost:3001
 *
 * i18n storage key: synapse_lang  (set via localStorage before page load)
 */

"use strict";

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE_URL = process.env.DOCS_BASE_URL || "http://localhost:3001";
const PAGE_PATH = process.argv[2] || "/get-started/agent-builders";
const OUT_DIR = path.resolve(
  process.cwd(),
  process.argv[3] || "output/playwright"
);

const LANGS = ["en", "zh"];

async function screenshot(lang, pagePath, outDir) {
  const browser = await chromium.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    // Inject language before any React hydration
    await page.addInitScript(
      (l) => localStorage.setItem("synapse_lang", l),
      lang
    );

    const url = `${BASE_URL}${pagePath}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(1500);

    const slug = pagePath.replace(/\//g, "_").replace(/^_/, "");
    const outFile = path.join(outDir, `${slug}_${lang}.png`);
    await page.screenshot({ path: outFile, fullPage: false });
    console.log(`[${lang.toUpperCase()}] Saved: ${outFile}`);
    return outFile;
  } finally {
    await browser.close();
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Screenshot docs page: ${PAGE_PATH}`);
  console.log(`Output dir: ${OUT_DIR}\n`);

  for (const lang of LANGS) {
    await screenshot(lang, PAGE_PATH, OUT_DIR);
  }
  console.log("\nDone.");
})().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
