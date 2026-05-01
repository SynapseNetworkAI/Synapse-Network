import path from "node:path";

export function createScreenshotCapture({
  screenshotsDir,
  evidenceDir,
  screenshotEvidence,
  addCheck,
  sanitize,
}) {
  return async function capturePage({
    page,
    url,
    fileName,
    expectedText = [],
    forbiddenText = [],
    apiCheckpoint = {},
  }) {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    await page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => {});
    if (expectedText.length > 0) {
      const expected = Array.isArray(expectedText)
        ? expectedText
        : [expectedText];
      await page
        .waitForFunction(
          (texts) => {
            const body = document.body?.innerText || "";
            const title = document.title || "";
            return texts.every(
              (text) => body.includes(text) || title.includes(text)
            );
          },
          expected,
          {
            timeout: Number(
              process.env.GATEWAY_PULL_HEALTH_UI_WAIT_MS || 15_000
            ),
          }
        )
        .catch(() => {});
    }
    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 10_000 })
      .catch(() => "");
    const title = await page.title().catch(() => "");
    const expected = Array.isArray(expectedText)
      ? expectedText
      : [expectedText];
    const forbidden = [
      "Application error",
      "Internal Server Error",
      "This page could not be found",
      "Connect Wallet",
      "Please connect your wallet",
      "Wallet not connected",
      ...forbiddenText,
    ].filter(Boolean);
    const expectedMissing = expected.filter(
      (text) => text && !bodyText.includes(text) && !title.includes(text)
    );
    const forbiddenPresent = forbidden.filter(
      (text) => text && bodyText.includes(text)
    );
    const filePath = path.join(screenshotsDir, fileName);
    await page.screenshot({ path: filePath, fullPage: true });
    const evidence = sanitize({
      file: path.relative(evidenceDir, filePath),
      url,
      httpStatus: response?.status() || 0,
      title,
      expectedText: expected,
      expectedVisible: expectedMissing.length === 0,
      expectedMissing,
      forbiddenText: forbidden,
      forbiddenTextAbsent: forbiddenPresent.length === 0,
      forbiddenPresent,
      apiCheckpoint,
      capturedAt: new Date().toISOString(),
    });
    screenshotEvidence.push(evidence);
    addCheck(
      `screenshot:${fileName}`,
      evidence.httpStatus >= 200 &&
        evidence.httpStatus < 400 &&
        evidence.expectedVisible &&
        evidence.forbiddenTextAbsent,
      evidence,
      `Screenshot ${fileName} did not satisfy DOM/API checkpoint.`
    );
    return evidence;
  };
}
