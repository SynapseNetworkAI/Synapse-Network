#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error(
    "Missing dependency: playwright. Run with `npx -y -p playwright node tools/scripts/ui/measure_x_console_credits.mjs ...`."
  );
  throw error;
}

function getArg(name, fallback = undefined) {
  const flagIndex = process.argv.indexOf(`--${name}`);
  if (flagIndex === -1) {
    return fallback;
  }
  return process.argv[flagIndex + 1] ?? fallback;
}

const cookiePath = getArg("cookies", "/tmp/x_console_cookies.json");
const outputPath = getArg("output", "/tmp/x_console_credits_metrics.json");
const screenshotPath = getArg("screenshot", "/tmp/x_console_credits.png");
const chromePath = getArg("chrome", "/opt/google/chrome/chrome");
const url = getArg(
  "url",
  "https://console.x.com/accounts/2038798078744948737/billing/credits"
);

const cookiePayload = JSON.parse(await fs.readFile(cookiePath, "utf8"));
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1800 },
  deviceScaleFactor: 1,
});

await context.addCookies(cookiePayload);

const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: screenshotPath, fullPage: true });

const metrics = await page.evaluate(() => {
  function elementMetrics(el) {
    if (!el) {
      return null;
    }
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      className: String(el.className || ""),
      text: (el.textContent || "").trim(),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      fontWeight: s.fontWeight,
      color: s.color,
      background: s.backgroundColor,
      border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
      borderRadius: s.borderRadius,
      padding: s.padding,
      gap: s.gap,
      textAlign: s.textAlign,
    };
  }

  function exactText(text, selector = "body *") {
    return (
      [...document.querySelectorAll(selector)].find(
        (node) => (node.textContent || "").trim() === text
      ) || null
    );
  }

  const purchaseButton = [...document.querySelectorAll("button")].find(
    (el) => (el.textContent || "").trim() === "Purchase credits"
  );
  const manageButton = [...document.querySelectorAll("button")].find(
    (el) => (el.textContent || "").trim() === "Manage Spend Cap"
  );
  const voucherButton = [...document.querySelectorAll("button")].find(
    (el) => (el.textContent || "").trim() === "Redeem Voucher"
  );

  const remainingBalanceCard = purchaseButton?.closest(
    ".bg-\\[\\#0d0d0d\\].rounded-xl"
  );
  const billingCard = exactText("Current Billing Cycle")?.closest(
    ".bg-\\[\\#1a1a1a\\].rounded-lg"
  );
  const autoRechargeCard = exactText("Auto Recharge unavailable")?.closest(
    ".bg-\\[\\#1a1a1a\\].rounded-lg"
  );
  const manageCard = exactText("Manage Spend Cap", "h1,h2,h3,h4,h5,h6")?.closest(
    ".bg-\\[\\#1a1a1a\\].rounded-lg"
  );
  const voucherSection = exactText(
    "Free Credits Voucher",
    "h1,h2,h3,h4,h5,h6"
  )?.closest(".py-8.border-b");

  return {
    pageTitle: elementMetrics(exactText("Credits", "h1")),
    pageSubtitle: elementMetrics(
      exactText("Manage your free and prepaid credits", "p")
    ),
    remainingBalanceCard: elementMetrics(remainingBalanceCard),
    remainingBalanceLabel: elementMetrics(exactText("Remaining balance:")),
    remainingBalanceValue: elementMetrics(
      exactText("$4.99") || exactText("$40.00")
    ),
    purchaseButton: elementMetrics(purchaseButton),
    billingCard: elementMetrics(billingCard),
    billingLabel: elementMetrics(exactText("Current Billing Cycle")),
    billingValue: elementMetrics(
      exactText("Mar 31 - Apr 30, 2026") || exactText("Apr 1 - Apr 30, 2026")
    ),
    daysRemainingLabel: elementMetrics(exactText("Days Remaining")),
    daysRemainingValue: elementMetrics(exactText("28")),
    autoRechargeCard: elementMetrics(autoRechargeCard),
    autoRechargeTitle: elementMetrics(exactText("Auto Recharge unavailable")),
    autoRechargeBody: elementMetrics(
      exactText(
        "You need to set a default payment method before enabling auto-recharge."
      )
    ),
    manageSpendCapCard: elementMetrics(manageCard),
    manageSpendCapTitle: elementMetrics(
      exactText("Manage Spend Cap", "h1,h2,h3,h4,h5,h6")
    ),
    manageSpendCapDescription: elementMetrics(
      exactText(
        "Set a maximum amount you can spend in a billing cycle. When reached, API requests will be blocked until the next cycle."
      )
    ),
    manageSpendCapButton: elementMetrics(manageButton),
    currentSpendLabel: elementMetrics(exactText("Current Spend")),
    currentSpendValue: elementMetrics(exactText("0.01") || exactText("0.00")),
    billingCycleCapLabel: elementMetrics(exactText("Billing Cycle Cap")),
    billingCycleCapValue: elementMetrics(
      exactText("10.00") || exactText("$10.00")
    ),
    usedText: elementMetrics(exactText("0.1% used") || exactText("0.0% used")),
    voucherSection: elementMetrics(voucherSection),
    voucherTitle: elementMetrics(
      exactText("Free Credits Voucher", "h1,h2,h3,h4,h5,h6")
    ),
    voucherDescription: elementMetrics(
      exactText(
        "X may give out free credits to developers to build with the API. Enter a voucher to add free credits to your account."
      )
    ),
    voucherButton: elementMetrics(voucherButton),
  };
});

await browser.close();

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

console.log(`Wrote metrics to ${outputPath}`);
console.log(`Saved screenshot to ${screenshotPath}`);
