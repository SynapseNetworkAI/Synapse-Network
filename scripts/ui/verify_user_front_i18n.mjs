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
const OUT_DIR = path.join(ROOT, "output/playwright/user-front-i18n", timestamp);

const staleStrings = [
  "X may give out free credits",
  "feedback drawer",
  "Request Refund",
];

const routeCases = [
  {
    name: "overview",
    path: "/dashboard/overview",
    expected: {
      en: ["Control Plane Overview", "Open Agent Workspace"],
      zh: ["控制台总览", "打开 Agent Workspace"],
    },
    forbidden: {
      en: ["控制台总览"],
      zh: ["Control Plane Overview"],
    },
  },
  {
    name: "credits",
    path: "/dashboard/billing/credits",
    expected: {
      en: ["Credits", "Spendable credits", "Free Credits Voucher"],
      zh: ["Credits", "可消费 credits", "免费 Credits Voucher"],
    },
    forbidden: {
      en: ["平台可能会向开发者发放免费 credits"],
      zh: ["SynapseNetwork may give out free credits"],
    },
  },
  {
    name: "credentials",
    path: "/dashboard/credentials",
    expected: {
      en: ["Agent Credentials", "Issue Credential", "CREDENTIAL PREFIX"],
      zh: ["Agent 凭据", "签发凭据", "凭据前缀"],
    },
    forbidden: {
      en: ["Agent 凭据", "签发凭据"],
      zh: ["Agent Credentials", "Issue Credential"],
    },
  },
  {
    name: "agents",
    path: "/dashboard/agents",
    expected: {
      en: ["Agents", "Create Agent"],
      zh: ["Agents", "管理 Agents"],
    },
    forbidden: {
      en: ["创建 Agent"],
      zh: ["Create Agent"],
    },
  },
  {
    name: "provider-withdraw",
    path: "/provider/withdraw",
    expected: {
      en: ["Provider Withdraw", "Withdrawal History", "Available"],
      zh: ["Provider 提现", "提现历史", "可用余额"],
    },
    forbidden: {
      en: ["提现历史", "可用余额"],
      zh: ["Provider earnings need T+7 maturity before withdrawal."],
    },
  },
];

const feedbackCase = {
  name: "feedback",
  path: "/dashboard/overview",
  expected: {
    en: ["Send feedback", "CATEGORY", "Submit feedback"],
    zh: ["提交反馈", "类型", "提交反馈"],
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });

const passed = [];
const failed = [];
const warnings = [];

function recordPass(name, detail = "") {
  passed.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ""}`);
}

function recordFail(name, detail) {
  failed.push({ name, detail });
  console.error(`FAIL ${name} - ${detail}`);
}

function recordWarn(name, detail) {
  warnings.push({ name, detail });
  console.warn(`WARN ${name} - ${detail}`);
}

function urlFor(routePath) {
  return `${BASE_URL}${routePath}`;
}

function assertTextIncludes(bodyText, expected, context) {
  for (const needle of expected) {
    if (!bodyText.includes(needle)) {
      throw new Error(`${context} missing "${needle}"`);
    }
  }
}

function assertTextExcludes(bodyText, forbidden, context) {
  for (const needle of forbidden) {
    if (bodyText.includes(needle)) {
      throw new Error(`${context} unexpectedly contains "${needle}"`);
    }
  }
}

async function newLanguagePage(browser, language) {
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
  page.on("console", (message) => {
    if (message.type() === "error") {
      recordWarn(`console:${language}`, message.text().slice(0, 500));
    }
  });
  return { context, page };
}

async function verifyRoute(browser, language, routeCase) {
  const { context, page } = await newLanguagePage(browser, language);
  const caseName = `${routeCase.name}:${language}`;
  try {
    await page.goto(urlFor(routeCase.path), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    await page.waitForLoadState("domcontentloaded");
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    if (htmlLang !== language) {
      throw new Error(`expected html lang=${language}, got ${htmlLang}`);
    }
    const bodyText = (await page.locator("body").innerText({ timeout: 15000 }))
      .replace(/\s+/g, " ")
      .trim();
    assertTextIncludes(bodyText, routeCase.expected[language], caseName);
    assertTextExcludes(
      bodyText,
      [...staleStrings, ...(routeCase.forbidden?.[language] || [])],
      caseName
    );
    const screenshotPath = path.join(
      OUT_DIR,
      `${routeCase.name}-${language}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    recordPass(caseName, screenshotPath);
  } catch (error) {
    recordFail(
      caseName,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await context.close();
  }
}

async function verifyFeedback(browser, language) {
  const { context, page } = await newLanguagePage(browser, language);
  const caseName = `${feedbackCase.name}:${language}`;
  try {
    await page.goto(urlFor(feedbackCase.path), {
      waitUntil: "networkidle",
      timeout: 60000,
    });
    const button = page.getByRole("button", {
      name: language === "zh" ? "反馈" : "Feedback",
    });
    await button.click({ timeout: 15000 });
    await page
      .getByRole("heading", { name: feedbackCase.expected[language][0] })
      .waitFor({ timeout: 15000 });
    const bodyText = (await page.locator("body").innerText({ timeout: 15000 }))
      .replace(/\s+/g, " ")
      .trim();
    assertTextIncludes(bodyText, feedbackCase.expected[language], caseName);
    assertTextExcludes(bodyText, staleStrings, caseName);
    const screenshotPath = path.join(OUT_DIR, `feedback-${language}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    recordPass(caseName, screenshotPath);
  } catch (error) {
    recordFail(
      caseName,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const language of ["en", "zh"]) {
    for (const routeCase of routeCases) {
      await verifyRoute(browser, language, routeCase);
    }
    await verifyFeedback(browser, language);
  }
} finally {
  await browser.close();
}

const report = {
  baseUrl: BASE_URL,
  outDir: OUT_DIR,
  passed,
  failed,
  warnings,
};
fs.writeFileSync(
  path.join(OUT_DIR, "report.json"),
  JSON.stringify(report, null, 2)
);

if (failed.length > 0) {
  console.error(
    `[user-front-i18n-browser] failed ${
      failed.length
    } checks; report=${path.join(OUT_DIR, "report.json")}`
  );
  process.exit(1);
}

console.log(
  `[user-front-i18n-browser] passed ${passed.length} checks; report=${path.join(
    OUT_DIR,
    "report.json"
  )}`
);
