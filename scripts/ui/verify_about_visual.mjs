import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "../..");
const BASE_URL = process.env.ABOUT_VISUAL_BASE_URL || "http://localhost:3000";
const REFERENCE_PATH = process.env.ABOUT_VISUAL_REFERENCE || path.join(ROOT, "docs/design/reference/about-gpt-image2.png");
const VIEWPORT_WIDTH = Number(process.env.ABOUT_VISUAL_WIDTH || 1536);
const VIEWPORT_HEIGHT = Number(process.env.ABOUT_VISUAL_HEIGHT || 1024);
const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const OUT_DIR = process.env.ABOUT_VISUAL_OUT_DIR || path.join(ROOT, "output/playwright/about-visual", RUN_ID);

function ensureReference() {
  if (!fs.existsSync(REFERENCE_PATH)) {
    throw new Error(`Missing about visual reference: ${REFERENCE_PATH}`);
  }
}

function htmlForComparison({ actualPath, referencePath, mode }) {
  const actualUrl = `file://${actualPath}`;
  const referenceUrl = `file://${referencePath}`;
  const actualStyle = mode === "diff"
    ? "mix-blend-mode:difference;opacity:1;"
    : "opacity:0.52;";
  const label = mode === "diff" ? "difference blend" : "overlay";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      width: ${VIEWPORT_WIDTH}px;
      height: ${VIEWPORT_HEIGHT}px;
      margin: 0;
      overflow: hidden;
      background: #000;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .stage {
      position: relative;
      width: ${VIEWPORT_WIDTH}px;
      height: ${VIEWPORT_HEIGHT}px;
      overflow: hidden;
      background: #000;
    }
    img {
      position: absolute;
      inset: 0;
      width: ${VIEWPORT_WIDTH}px;
      height: ${VIEWPORT_HEIGHT}px;
      object-fit: fill;
      display: block;
    }
    .actual {
      ${actualStyle}
    }
    .label {
      position: absolute;
      right: 16px;
      bottom: 16px;
      z-index: 3;
      border: 1px solid rgba(127,247,190,0.32);
      border-radius: 999px;
      background: rgba(0,0,0,0.72);
      color: #dfffee;
      padding: 8px 12px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="stage">
    <img src="${referenceUrl}" alt="reference" />
    <img class="actual" src="${actualUrl}" alt="actual" />
    <div class="label">${label}: reference + actual</div>
  </div>
</body>
</html>`;
}

async function screenshotComparison(browser, actualPath, referencePath, outPath, mode) {
  const page = await browser.newPage({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent(htmlForComparison({ actualPath, referencePath, mode }), { waitUntil: "load" });
  await page.screenshot({ path: outPath, fullPage: false });
  await page.close();
}

async function main() {
  ensureReference();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const referenceOut = path.join(OUT_DIR, "reference.png");
  const actualOut = path.join(OUT_DIR, "actual.png");
  const overlayOut = path.join(OUT_DIR, "overlay.png");
  const diffOut = path.join(OUT_DIR, "diff.png");
  fs.copyFileSync(REFERENCE_PATH, referenceOut);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      deviceScaleFactor: 1,
    });
    await page.goto(`${BASE_URL}/about`, { waitUntil: "networkidle", timeout: 30000 });
    await page.screenshot({ path: actualOut, fullPage: false });
    await page.close();

    await screenshotComparison(browser, actualOut, referenceOut, overlayOut, "overlay");
    await screenshotComparison(browser, actualOut, referenceOut, diffOut, "diff");
  } finally {
    await browser.close();
  }

  const report = {
    status: "success",
    baseUrl: BASE_URL,
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    reference: path.relative(ROOT, referenceOut),
    actual: path.relative(ROOT, actualOut),
    overlay: path.relative(ROOT, overlayOut),
    diff: path.relative(ROOT, diffOut),
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), [
    "# About Visual Alignment",
    "",
    `- Base URL: ${BASE_URL}`,
    `- Viewport: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`,
    `- Reference: ${report.reference}`,
    `- Actual: ${report.actual}`,
    `- Overlay: ${report.overlay}`,
    `- Diff: ${report.diff}`,
    "",
    "Use overlay.png for alignment and diff.png for high-contrast mismatch hunting.",
    "",
  ].join("\n"));

  console.log(`About visual evidence written to ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
