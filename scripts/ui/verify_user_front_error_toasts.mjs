#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { errorToastCases } from "./user_front_error_toast_cases.mjs";
import {
  BASE_URL,
  OUT_DIR,
  ensureOutputDir,
  forbiddenRawStrings,
  newAuthedPage,
  pageUrl,
} from "./user_front_error_toast_setup.mjs";

const passed = [];
const failed = [];
const warnings = [];

function pass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function fail(name, detail) {
  failed.push({ name, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

function warn(name, detail) {
  warnings.push({ name, detail });
  console.warn(`WARN ${name} - ${detail}`);
}

async function assertCleanPage(page, caseName, expectedText) {
  await page.locator("body").getByText(expectedText, { exact: false }).waitFor({
    timeout: 15000,
  });
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  const expectedLang = caseName.endsWith(":zh") ? "zh" : "en";
  if (htmlLang !== expectedLang) {
    throw new Error(`expected html lang=${expectedLang}, got ${htmlLang}`);
  }
  const bodyText = (await page.locator("body").innerText({ timeout: 15000 }))
    .replace(/\s+/g, " ")
    .trim();
  for (const needle of forbiddenRawStrings) {
    if (bodyText.includes(needle)) {
      throw new Error(`body leaks raw technical text: ${needle}`);
    }
  }
}

async function runCase(browser, caseDef, language) {
  const caseName = `${caseDef.name}:${language}`;
  const { context, page } = await newAuthedPage(
    browser,
    language,
    caseDef.role,
    caseDef.options,
    (message) => warn(`console:${language}`, message)
  );
  try {
    await page.goto(pageUrl(caseDef.path), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await caseDef.act(page, language);
    await assertCleanPage(page, caseName, caseDef.expected[language]);
    const screenshotPath = path.join(
      OUT_DIR,
      `${caseDef.name}-${language}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    pass(caseName, screenshotPath);
  } catch (error) {
    const screenshotPath = path.join(
      OUT_DIR,
      `${caseDef.name}-${language}-failed.png`
    );
    await page
      .screenshot({ path: screenshotPath, fullPage: true })
      .catch(() => {});
    fail(
      caseName,
      `${
        error instanceof Error ? error.message : String(error)
      } (${screenshotPath})`
    );
  } finally {
    await context.close();
  }
}

async function main() {
  ensureOutputDir();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  try {
    for (const language of ["en", "zh"]) {
      for (const caseDef of errorToastCases()) {
        await runCase(browser, caseDef, language);
      }
    }
  } finally {
    await browser.close();
  }
}

await main();

const report = {
  baseUrl: BASE_URL,
  outputDir: OUT_DIR,
  passed,
  failed,
  warnings,
  forbiddenRawStrings,
};
const reportPath = path.join(OUT_DIR, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`user-front error toast report written: ${reportPath}`);

if (failed.length > 0) {
  process.exitCode = 1;
}
