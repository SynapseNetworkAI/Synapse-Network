import path from "node:path";

export async function runInvocationBillingUiCapture(ctx) {
  if (process.env.INVOCATION_BILLING_UI_CAPTURE !== "1") return;
  const {
    adminFrontUrl,
    addCheck,
    evidenceDir,
    screenshotEvidence,
    uiEvidence,
    userFrontUrl,
  } = ctx;
  uiEvidence.attempted = true;
  uiEvidence.skippedWithReason = "";
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: process.env.INVOCATION_BILLING_HEADLESS !== "0",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    for (const item of uiPages({ userFrontUrl, adminFrontUrl })) {
      const response = await page.goto(item.url, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      const body = await page
        .locator("body")
        .innerText({ timeout: 10_000 })
        .catch(() => "");
      const forbidden = forbiddenText().filter((text) => body.includes(text));
      const ok =
        (response?.status() || 0) < 500 &&
        body.includes(item.expectedText) &&
        forbidden.length === 0;
      const pageEvidence = {
        name: item.name,
        url: item.url,
        httpStatus: response?.status() || 0,
        expectedText: item.expectedText,
        forbiddenPresent: forbidden,
        bodyExcerpt: body.slice(0, 1000),
      };
      uiEvidence.pages.push(pageEvidence);
      addCheck(`ui_${item.name}`, ok, pageEvidence);
      if (ok) {
        const file = `screenshots/${item.name}.png`;
        await page.screenshot({
          path: path.join(evidenceDir, file),
          fullPage: true,
        });
        screenshotEvidence.push({
          file,
          url: item.url,
          expectedText: item.expectedText,
          forbiddenTextAbsent: true,
          domCheckpoint: item.name,
          apiCheckpoint: item.apiCheckpoint,
          dbCheckpoint: item.dbCheckpoint,
          capturedAt: new Date().toISOString(),
        });
      }
    }
  } finally {
    await browser.close();
  }
}

function uiPages({ userFrontUrl, adminFrontUrl }) {
  return [
    {
      name: "user-invocations",
      url: `${userFrontUrl}/dashboard/invocations`,
      expectedText: "Invocations",
      dbCheckpoint: "db-evidence.json",
      apiCheckpoint: "api-evidence.json",
    },
    {
      name: "user-billing",
      url: `${userFrontUrl}/dashboard/billing`,
      expectedText: "Billing",
      dbCheckpoint: "db-evidence.json",
      apiCheckpoint: "api-evidence.json",
    },
    {
      name: "admin-finance",
      url: `${adminFrontUrl}/finance`,
      expectedText: "Finance",
      dbCheckpoint: "db-evidence.json",
      apiCheckpoint: "api-evidence.json",
    },
  ];
}

function forbiddenText() {
  return [
    "Loading",
    "Failed to fetch",
    "Internal Server Error",
    "Application error",
  ];
}
