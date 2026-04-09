#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  console.error("Missing dependency: playwright. Run with `npx -p playwright node ...` or install playwright.");
  throw error;
}

function getArg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }

  return process.argv[index + 1] ?? fallback;
}

function slugify(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

const baseUrl = getArg("base-url", "http://127.0.0.1:3002");
const label = getArg("label", `run-${Date.now()}`);
const outputRoot = getArg(
  "output-dir",
  path.resolve(process.cwd(), "output/playwright/dashboard-navigation")
);
const runDir = path.join(outputRoot, slugify(label));
const metricsPath = path.join(runDir, "metrics.json");
const screenshotsDir = path.join(runDir, "screenshots");
const videosDir = path.join(runDir, "videos");

const ROUTES = [
  {
    label: "Overview",
    path: "/dashboard/overview",
    nav: { role: "link", name: /^Overview$/ },
    ready: { role: "heading", name: "Control Plane Overview" },
  },
  {
    label: "Agents",
    path: "/dashboard/agents",
    nav: { role: "link", name: /^Agents(\s+3)?$/ },
    ready: { role: "heading", name: "Agents" },
  },
  {
    label: "Discovery",
    path: "/dashboard/discovery",
    nav: { role: "link", name: /^Discovery$/ },
    ready: { role: "heading", name: /discovery/i },
  },
  {
    label: "Invocations",
    path: "/dashboard/invocations",
    nav: { role: "link", name: /^Invocations$/ },
    ready: { role: "heading", name: /invocations/i },
  },
  {
    label: "Credits",
    path: "/dashboard/billing/credits",
    nav: { role: "link", name: /^Credits$/ },
    ready: { role: "heading", name: "Credits" },
  },
  {
    label: "Payments",
    path: "/dashboard/billing",
    nav: { role: "link", name: /^Payments$/ },
    ready: { role: "heading", name: "Payments" },
  },
  {
    label: "Risk & Audit",
    path: "/dashboard/audit",
    nav: { role: "link", name: /Risk & Audit/i },
    ready: { role: "heading", name: /Risk & Audit/i },
  },
  {
    label: "Developer Resources",
    path: "/dashboard/developer",
    nav: { role: "link", name: /Developer Resources/i },
    ready: { role: "heading", name: /Developer Resources/i },
  },
];

async function ensureBillingExpanded(page) {
  const billingButton = page.getByRole("button", { name: /^Billing$/ });
  if ((await billingButton.count()) === 0) {
    return;
  }

  const creditsLink = page.getByRole("link", { name: /^Credits$/ });
  if (await creditsLink.isVisible().catch(() => false)) {
    return;
  }

  await billingButton.click();
  await creditsLink.waitFor({ state: "visible", timeout: 5000 });
}

async function waitForAppReady(page) {
  await page.goto(`${baseUrl}/dashboard/overview`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.getByRole("link", { name: "Overview" }).waitFor({ timeout: 15000 });
  await ensureBillingExpanded(page);
}

async function measureRoute(page, route) {
  if (route.path.startsWith("/dashboard/billing")) {
    await ensureBillingExpanded(page);
  }

  const navTarget = page.getByRole(route.nav.role, {
    name: route.nav.name,
    exact: typeof route.nav.name === "string",
  });
  const readyTarget =
    typeof route.ready.name === "string"
      ? page.locator("h1").getByText(route.ready.name, { exact: true }).first()
      : page.getByRole(route.ready.role, { name: route.ready.name }).first();

  await navTarget.waitFor({ state: "visible", timeout: 10000 });

  const measurementPromise = page.evaluate(
    ({ path, name }) =>
      new Promise((resolve) => {
        const startedAt = performance.now();
        const namePattern = typeof name === "string" ? null : new RegExp(name.source, name.flags);
        let busyVisibleAt = null;
        let pathnameSettledAt = null;
        let headingVisibleAt = null;

        function hasBusyState() {
          return Boolean(document.querySelector('[aria-busy="true"]'));
        }

        function findHeading() {
          const headings = [...document.querySelectorAll("h1, h2")];
          return headings.find((node) => {
            const text = (node.textContent || "").trim();
            if (typeof name === "string") {
              return text === name;
            }
            return namePattern ? namePattern.test(text) : false;
          });
        }

        function tick() {
          const elapsed = performance.now() - startedAt;

          if (busyVisibleAt === null && hasBusyState()) {
            busyVisibleAt = elapsed;
          }

          if (pathnameSettledAt === null && window.location.pathname === path) {
            pathnameSettledAt = elapsed;
          }

          if (headingVisibleAt === null && findHeading()) {
            headingVisibleAt = elapsed;
          }

          if (pathnameSettledAt !== null && headingVisibleAt !== null && !hasBusyState()) {
            resolve({
              busyVisibleMs: busyVisibleAt,
              pathnameSettledMs: pathnameSettledAt,
              headingVisibleMs: headingVisibleAt,
              stableMs: elapsed,
            });
            return;
          }

          if (elapsed >= 15000) {
            resolve({
              busyVisibleMs: busyVisibleAt,
              pathnameSettledMs: pathnameSettledAt ?? elapsed,
              headingVisibleMs: headingVisibleAt ?? elapsed,
              stableMs: elapsed,
            });
            return;
          }

          requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
      }),
    {
      path: route.path,
      name:
        route.ready.name instanceof RegExp
          ? { source: route.ready.name.source, flags: route.ready.name.flags }
          : route.ready.name,
    }
  );

  await navTarget.click();
  const metrics = await measurementPromise;
  await readyTarget.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(screenshotsDir, `${slugify(route.label)}.png`),
    fullPage: true,
  });

  return {
    ...route,
    ...metrics,
  };
}

await fs.mkdir(runDir, { recursive: true });
await fs.mkdir(screenshotsDir, { recursive: true });
await fs.mkdir(videosDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1512, height: 982 },
  recordVideo: {
    dir: videosDir,
    size: { width: 1512, height: 982 },
  },
});

const page = await context.newPage();

try {
  await waitForAppReady(page);

  const results = [];
  for (const route of ROUTES) {
    const measurement = await measureRoute(page, route);
    results.push(measurement);
  }

  const sortedByStable = [...results].sort((left, right) => right.stableMs - left.stableMs);
  const summary = {
    label,
    measuredAt: new Date().toISOString(),
    baseUrl,
    results,
    slowestByStable: sortedByStable.slice(0, 3).map(({ label: routeLabel, stableMs, pathnameSettledMs, headingVisibleMs, busyVisibleMs }) => ({
      label: routeLabel,
      stableMs,
      pathnameSettledMs,
      headingVisibleMs,
      busyVisibleMs,
    })),
  };

  await fs.writeFile(metricsPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Saved metrics to ${metricsPath}`);
  console.log(`Saved screenshots to ${screenshotsDir}`);
  console.log(`Saved video to ${videosDir}`);
} finally {
  await context.close();
  await browser.close();
}