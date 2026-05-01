#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ENVIRONMENT =
  process.env.SEO_PUBLIC_ASSETS_ENV || process.env.SYNAPSE_E2E_ENV || "local";
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "screenshot-evidence.json",
];
const REQUIRED_CHECKS = [
  "llms_txt_http_200",
  "llms_txt_expected_content",
  "llms_txt_no_private_routes",
  "llms_internal_links_200",
  "robots_txt_http_200",
  "robots_txt_expected_content",
  "robots_txt_no_bad_sitemap_paths",
  "sitemap_xml_http_200",
  "sitemap_xml_public_routes",
  "sitemap_xml_no_private_routes",
  "sitemap_xml_no_xml_pollution",
  "homepage_metadata",
  "screenshot_homepage-metadata.png",
  "screenshot_llms-txt.png",
  "screenshot_robots-txt.png",
  "screenshot_sitemap-xml.png",
];

function evidenceRoot() {
  if (process.env.SEO_PUBLIC_ASSETS_EVIDENCE_DIR) {
    return path.resolve(process.env.SEO_PUBLIC_ASSETS_EVIDENCE_DIR);
  }
  if (ENVIRONMENT === "staging") {
    return path.join(ROOT, "docs/evidence/staging/seo-public-assets");
  }
  if (ENVIRONMENT === "prod") {
    return path.join(ROOT, "docs/evidence/prod/seo-public-assets");
  }
  return path.join(ROOT, "output/dogfood/seo-public-assets");
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  const root = evidenceRoot();
  if (process.env.SEO_PUBLIC_ASSETS_EVIDENCE_DIR) return root;
  if (!fs.existsSync(root)) return "";
  return (
    fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.endsWith(`-${ENVIRONMENT}`)
      )
      .map((entry) => path.join(root, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "SEO-PUBLIC-ASSETS-EVIDENCE-JSON",
      filePath,
      `evidence JSON cannot be parsed: ${error.message}`,
      "rerun the SEO public assets E2E instead of hand-editing evidence."
    );
    return null;
  }
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "SEO-PUBLIC-ASSETS-EVIDENCE-MISSING",
    "",
    `SEO public assets evidence is missing for environment=${ENVIRONMENT}.`,
    `run npm run e2e:seo-public-assets:${ENVIRONMENT} and rerun this checker.`
  );
}

if (process.exitCode) process.exit(process.exitCode);

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) {
    fatal(
      "SEO-PUBLIC-ASSETS-EVIDENCE-FILE",
      filePath,
      `required SEO evidence artifact is missing: ${fileName}`,
      "rerun the SEO public assets E2E; do not assemble partial evidence by hand."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const report = readJson(reportPath);
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
if (!report || !screenshots) process.exit(process.exitCode || 1);

if (
  report.status !== "passed" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "SEO-PUBLIC-ASSETS-EVIDENCE-FAILED",
    reportPath,
    `SEO report status=${report.status}; failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "fix the public SEO asset route, metadata, sitemap, or screenshot checkpoint and regenerate evidence."
  );
}

if (report.environment !== ENVIRONMENT) {
  fatal(
    "SEO-PUBLIC-ASSETS-EVIDENCE-ENV",
    reportPath,
    `evidence environment mismatch; expected=${ENVIRONMENT}, actual=${report.environment}`,
    "rerun the checker with the same SEO_PUBLIC_ASSETS_ENV used by the E2E runner."
  );
}

const tracePath = path.join(dir, "trace.jsonl");
if (!report.traceDigest || report.traceDigest !== sha256File(tracePath)) {
  fatal(
    "SEO-PUBLIC-ASSETS-EVIDENCE-DIGEST",
    tracePath,
    "trace digest does not match report.json traceDigest.",
    "rerun the SEO public assets E2E so report.json and trace.jsonl are generated together."
  );
}

const checks = new Map(
  (report.checks || []).map((check) => [check.name, check])
);
for (const name of REQUIRED_CHECKS) {
  const check = checks.get(name);
  if (!check || check.status !== "passed") {
    fatal(
      "SEO-PUBLIC-ASSETS-EVIDENCE-CHECK",
      reportPath,
      `required SEO check is missing or failed: ${name}`,
      "fix the E2E runner or SEO public asset deployment so all required checks pass."
    );
  }
}

for (const screenshot of screenshots) {
  const screenshotPath = path.join(dir, screenshot.file || "");
  if (!screenshot.file || !fs.existsSync(screenshotPath)) {
    fatal(
      "SEO-PUBLIC-ASSETS-EVIDENCE-SCREENSHOT",
      screenshotPath,
      `screenshot artifact is missing for ${screenshot.url || "unknown url"}`,
      "rerun the SEO public assets E2E to capture browser evidence."
    );
  }
  if (
    screenshot.expectedVisible !== true ||
    screenshot.forbiddenTextAbsent !== true
  ) {
    fatal(
      "SEO-PUBLIC-ASSETS-EVIDENCE-DOM",
      screenshotPath,
      `screenshot DOM checkpoint failed for ${screenshot.url}`,
      "fix the page route or screenshot checkpoint; screenshots must prove expected SEO content is visible."
    );
  }
}

const evidenceText = REQUIRED_FILES.map((fileName) =>
  fs.readFileSync(path.join(dir, fileName), "utf8")
).join("\n");
const leakPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b0x[a-fA-F0-9]{64,}\b/,
  /"(?:privateKey|rawSignature|jwt|adminToken|accessToken|apiKey|secret|password|token)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
];
for (const pattern of leakPatterns) {
  if (pattern.test(evidenceText)) {
    fatal(
      "SEO-PUBLIC-ASSETS-EVIDENCE-SECRET",
      dir,
      `SEO evidence appears to contain a secret-like value matching ${pattern}`,
      "redact tokens, private keys, signatures, and passwords at generation time and rerun evidence."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[ci:seo-public-assets-evidence] validated ${dir}`);
