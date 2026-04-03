#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error(
    "Missing dependency: playwright. Run with `npx -y -p playwright node tools/scripts/ui/measure_x_console_settings.mjs ...`."
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
const outputPath = getArg("output", "/tmp/x_console_settings_metrics.json");
const screenshotPath = getArg("screenshot", "/tmp/x_console_settings.png");
const chromePath = getArg("chrome", "/opt/google/chrome/chrome");
const url = getArg(
  "url",
  "https://console.x.com/accounts/2038798078744948737/settings"
);

const cookiePayload = JSON.parse(await fs.readFile(cookiePath, "utf8"));
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1400 },
  deviceScaleFactor: 1,
});

await context.addCookies(cookiePayload);
const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
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
    };
  }

  const title = exactText("Settings", "h1");
  const subtitle = exactText(
    "Manage your account settings and team members",
    "p"
  );
  const xaiTitle = exactText("xAI", "h1,h2,h3,h4,h5,h6,strong,span,div");
  const xaiButton = [...document.querySelectorAll("a,button")].find((el) =>
    (el.textContent || "").includes("Link your xAI team")
  );
  const legacyTitle = exactText(
    "Move back to legacy",
    "h1,h2,h3,h4,h5,h6,strong,span,div"
  );
  const legacyButton = [...document.querySelectorAll("a,button")].find((el) =>
    (el.textContent || "").includes("Move to legacy")
  );
  const contentColumn =
    title?.closest("main")?.querySelector(".w-full.max-w-3xl") ||
    title?.parentElement?.parentElement;
  const headerBlock = title?.closest(".mb-4.border-b");
  const xaiSection = xaiTitle?.closest(".py-8.border-b");
  const legacySection = legacyTitle?.closest(".py-8");
  const xaiRow = xaiTitle?.closest(".flex.flex-col");
  const legacyRow = legacyTitle?.closest(".flex.flex-col");

  return {
    pageTitle: metric(title),
    pageSubtitle: metric(subtitle),
    contentColumn: metric(contentColumn),
    headerBlock: metric(headerBlock),
    xaiSection: metric(xaiSection),
    xaiRow: metric(xaiRow),
    xaiTitle: metric(xaiTitle),
    xaiBody: metric(
      exactText("Link your X account to xAI to enable xAI features.", "p,div,span")
    ),
    xaiButton: metric(xaiButton),
    legacySection: metric(legacySection),
    legacyRow: metric(legacyRow),
    legacyTitle: metric(legacyTitle),
    legacyBody: metric(
      exactText(
        "Leave the Developer Console and return to the legacy Developer Portal.",
        "p,div,span"
      )
    ),
    legacyButton: metric(legacyButton),
  };
});

await browser.close();
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

console.log(`Wrote metrics to ${outputPath}`);
console.log(`Saved screenshot to ${screenshotPath}`);
