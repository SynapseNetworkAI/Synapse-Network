#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error("Missing dependency: playwright. Run `npm install` at repo root.");
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
const outputPath = getArg("output", "/tmp/x_console_payments_metrics.json");
const screenshotPath = getArg("screenshot", "/tmp/x_console_payments.png");
const chromePath = getArg("chrome", "/opt/google/chrome/chrome");
const creditsUrl = getArg(
  "credits-url",
  "https://console.x.com/accounts/2038798078744948737/billing/credits"
);

const cookiePayload = JSON.parse(await fs.readFile(cookiePath, "utf8"));
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1600 },
  deviceScaleFactor: 1,
});

await context.addCookies(cookiePayload);
const page = await context.newPage();
await page.goto(creditsUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.getByRole("link", { name: "Payments" }).first().click();
await page.waitForTimeout(5000);
await page.screenshot({ path: screenshotPath, fullPage: true });

const metrics = await page.evaluate(() => {
  function exactText(text, selector = "body *") {
    return (
      [...document.querySelectorAll(selector)].find(
        (node) => (node.textContent || "").trim() === text
      ) || null
    );
  }

  function metric(el) {
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

  const title = exactText("Payments", "h1");
  const subtitle = exactText(
    "View all billing transactions and payment history for your account",
    "p"
  );
  const outerCard = exactText("Jan 2, 2026", "button")?.closest(
    ".bg-\\[\\#0d0d0d\\].rounded-xl"
  );
  const innerCard = exactText("Jan 2, 2026", "button")?.closest(
    ".bg-\\[\\#1a1a1a\\].rounded-lg"
  );
  const fromTrigger = exactText("Jan 2, 2026", "button");
  const toTrigger = exactText("Apr 2, 2026", "button");
  const reset = exactText("Reset to last 3 months", "button");
  const transactionHeader = exactText("Transaction ID", "th");
  const status = exactText("Succeeded");
  const paymentMethod = exactText("Voucher");
  const amount = exactText("$5.00");
  const date = exactText("Mar 31, 2026, 02:52 AM UTC");

  return {
    pageTitle: metric(title),
    pageSubtitle: metric(subtitle),
    outerCard: metric(outerCard),
    innerCard: metric(innerCard),
    fromTrigger: metric(fromTrigger),
    toTrigger: metric(toTrigger),
    resetButton: metric(reset),
    transactionHeader: metric(transactionHeader),
    statusCell: metric(status),
    paymentMethodCell: metric(paymentMethod),
    amountCell: metric(amount),
    dateCell: metric(date),
  };
});

await browser.close();
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

console.log(`Wrote metrics to ${outputPath}`);
console.log(`Saved screenshot to ${screenshotPath}`);
