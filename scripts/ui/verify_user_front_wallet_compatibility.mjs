#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE_URL = (process.env.USER_FRONT_BASE_URL || "http://localhost:3000")
  .trim()
  .replace(/\/+$/, "");
const I18N_STORAGE_KEY = "synapse_lang";
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const OUT_DIR = path.join(
  ROOT,
  "output/playwright/user-front-wallet-compatibility",
  timestamp
);

const cases = [
  {
    language: "en",
    expectedTexts: ["Connect Wallet"],
  },
  {
    language: "zh",
    expectedTexts: ["Connect Wallet"],
  },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

async function createPage(browser, language) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  await context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: I18N_STORAGE_KEY, value: language }
  );
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  return { context, page, consoleErrors };
}

function assertIncludes(haystack, needles, label) {
  for (const needle of needles) {
    if (!haystack.includes(needle)) {
      throw new Error(`${label} missing "${needle}"`);
    }
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const testCase of cases) {
      const { context, page, consoleErrors } = await createPage(
        browser,
        testCase.language
      );
      const caseName = `dashboard-credentials-${testCase.language}`;

      try {
        await page.goto(`${BASE_URL}/dashboard/credentials`, {
          waitUntil: "networkidle",
          timeout: 60000,
        });
        await page.waitForLoadState("domcontentloaded");
        await page.getByRole("heading", { name: "Connect Wallet" }).waitFor({
          timeout: 15000,
        });

        const bodyText = (await page.locator("body").innerText())
          .replace(/\s+/g, " ")
          .trim();
        assertIncludes(bodyText, testCase.expectedTexts, caseName);
        if (
          bodyText.includes("Recommended for Arbitrum") ||
          bodyText.includes("Arbitrum 环境推荐使用")
        ) {
          throw new Error(`${caseName} still shows deprecated Arbitrum hint`);
        }

        await page.getByRole("button", { name: "Connect Wallet" }).click({
          timeout: 15000,
        });
        await page.waitForTimeout(1200);
        const modalText = (await page.locator("body").innerText())
          .replace(/\s+/g, " ")
          .trim();
        if (modalText.includes("Phantom")) {
          throw new Error(`${caseName} still lists Phantom in wallet modal`);
        }

        const screenshotPath = path.join(OUT_DIR, `${caseName}.png`);
        const domPath = path.join(OUT_DIR, `${caseName}.txt`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        fs.writeFileSync(domPath, bodyText, "utf8");

        results.push({
          caseName,
          status: "pass",
          screenshotPath,
          domPath,
          consoleErrors,
        });
        console.log(`PASS ${caseName} -> ${screenshotPath}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const summaryPath = path.join(OUT_DIR, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`Summary written to ${summaryPath}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
