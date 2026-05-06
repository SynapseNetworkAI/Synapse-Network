#!/usr/bin/env node

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import {
  BASE_URL,
  ROOT,
  forbiddenRawStrings,
  newAuthedPage,
  pageUrl,
} from "./user_front_error_toast_setup.mjs";

const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const OUT_DIR = path.join(
  ROOT,
  "output/playwright/provider-withdraw-mature",
  timestamp
);
const staleStrings = [
  "Blank = full withdrawal",
  "Amount (blank = full withdrawal)",
  "留空=全额",
  "留空 = 全额",
  "最多 2 位小数",
  "Max 2 decimals",
  ...forbiddenRawStrings,
];

const cases = [
  {
    name: "dust-disabled",
    options: { providerReceivable: 50, providerMatureReceivable: 5 },
    expected: {
      en: {
        labels: [
          "Provider Withdraw",
          "Withdrawable receivable",
          "5.00 USDC",
          "Receivable balance",
          "50.00 USDC",
          "Newly earned receivables appear in balance first, then enter withdrawable receivable after T+7.",
          "Minimum withdrawal: 10.00 USDC",
        ],
        button: "Generate & Claim",
        title: "Matured withdrawable amount is below the 10.00 USDC minimum",
      },
      zh: {
        labels: [
          "Provider 提现",
          "可提现额度",
          "5.00 USDC",
          "应收余额",
          "50.00 USDC",
          "新产生的应收会先显示在余额中，T+7 后才进入可提现额度。",
          "最小提现金额：10.00 USDC",
        ],
        button: "生成并提现",
        title: "已成熟可提现额度低于最小提现金额 10.00 USDC",
      },
    },
  },
  {
    name: "max-explicit-amount",
    options: { providerReceivable: 50, providerMatureReceivable: 12.6 },
    expected: {
      en: {
        labels: [
          "Provider Withdraw",
          "Withdrawable receivable",
          "12.60 USDC",
          "Receivable balance",
          "50.00 USDC",
          "Minimum withdrawal: 10.00 USDC",
        ],
        button: "Generate & Claim",
        confirm: "Confirm",
        placeholder: "Amount",
      },
      zh: {
        labels: [
          "Provider 提现",
          "可提现额度",
          "12.60 USDC",
          "应收余额",
          "50.00 USDC",
          "最小提现金额：10.00 USDC",
        ],
        button: "生成并提现",
        confirm: "确认提现",
        placeholder: "金额",
      },
    },
  },
];

const passed = [];
const failed = [];
const warnings = [];

fs.mkdirSync(OUT_DIR, { recursive: true });

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

async function bodyText(page) {
  return (await page.locator("body").innerText({ timeout: 15000 }))
    .replace(/\s+/g, " ")
    .trim();
}

function assertNoStaleText(text, caseName) {
  for (const stale of staleStrings) {
    if (text.includes(stale)) {
      throw new Error(`${caseName} leaked stale/raw text: ${stale}`);
    }
  }
}

async function assertLabels(page, labels, caseName) {
  const text = await bodyText(page);
  for (const label of labels) {
    if (!text.includes(label)) {
      throw new Error(`${caseName} missing DOM text: ${label}`);
    }
  }
  assertNoStaleText(text, caseName);
}

async function verifyDustDisabled(page, language, expected) {
  const button = page.getByRole("button", { name: expected.button }).first();
  await button.waitFor({ timeout: 15000 });
  if (await button.isEnabled()) {
    throw new Error("withdraw button should be disabled below 10.00 USDC");
  }
  const title = await button.getAttribute("title");
  if (title !== expected.title) {
    throw new Error(
      `expected disabled title "${expected.title}", got "${title}"`
    );
  }
  await page.screenshot({
    path: path.join(OUT_DIR, `dust-disabled-${language}.png`),
    fullPage: true,
  });
}

async function verifyMaxExplicitAmount(page, language, expected) {
  const generate = page.getByRole("button", { name: expected.button }).first();
  await generate.waitFor({ timeout: 15000 });
  if (!(await generate.isEnabled())) {
    throw new Error(
      "withdraw button should be enabled for mature amount 12.60"
    );
  }
  await generate.click();

  const input = page.getByPlaceholder(expected.placeholder).first();
  await input.waitFor({ timeout: 15000 });
  const confirm = page.getByRole("button", { name: expected.confirm }).first();
  if (await confirm.isEnabled()) {
    throw new Error("confirm should stay disabled until amount is explicit");
  }

  await page.getByRole("button", { name: "MAX" }).first().click();
  const value = await input.inputValue();
  if (value !== "12.60") {
    throw new Error(`MAX should fill 12.60, got ${value}`);
  }
  if (!(await confirm.isEnabled())) {
    throw new Error("confirm should be enabled after MAX fills 12.60");
  }
  await page.screenshot({
    path: path.join(OUT_DIR, `max-explicit-amount-${language}.png`),
    fullPage: true,
  });
}

async function runCase(browser, caseDef, language) {
  const caseName = `${caseDef.name}:${language}`;
  const { context, page } = await newAuthedPage(
    browser,
    language,
    "PROVIDER",
    caseDef.options,
    (message) => warn(`console:${caseName}`, message)
  );
  try {
    await page.goto(pageUrl("/provider/withdraw"), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    if (htmlLang !== language) {
      throw new Error(`expected html lang=${language}, got ${htmlLang}`);
    }

    const expected = caseDef.expected[language];
    await assertLabels(page, expected.labels, caseName);
    if (caseDef.name === "dust-disabled") {
      await verifyDustDisabled(page, language, expected);
    } else {
      await verifyMaxExplicitAmount(page, language, expected);
    }
    pass(caseName);
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
      for (const caseDef of cases) {
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
  staleStrings,
};
const reportPath = path.join(OUT_DIR, "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`provider withdraw mature report written: ${reportPath}`);

if (failed.length > 0) {
  process.exitCode = 1;
}
