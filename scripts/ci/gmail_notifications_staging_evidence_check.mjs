#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(ROOT, "docs/evidence/staging/gmail");
const REQUIRED_STEPS = ["confirmation", "postgres_dsn", "recipient_email", "enqueue_outbox", "run_outbox_job", "delivery_log"];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.GMAIL_STAGING_E2E_EVIDENCE_DIR) return path.resolve(process.env.GMAIL_STAGING_E2E_EVIDENCE_DIR);
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return fs.readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-gmail-staging-e2e"))
    .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "GMAIL-STAGING-EVIDENCE-001",
    "",
    "Gmail staging E2E evidence is missing.",
    "run npm run e2e:gmail-notifications:staging and then rerun npm run ci:gmail-notifications-staging-evidence.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const markdownPath = path.join(dir, "report.md");
if (!fs.existsSync(reportPath) || !fs.existsSync(markdownPath)) {
  fatal(
    "GMAIL-STAGING-EVIDENCE-002",
    dir,
    "Gmail staging evidence must include report.json and report.md.",
    "rerun npm run e2e:gmail-notifications:staging.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
if (report.status !== "success" || !Array.isArray(report.failed) || report.failed.length > 0) {
  fatal(
    "GMAIL-STAGING-EVIDENCE-003",
    reportPath,
    `Gmail staging evidence status=${report.status}; failed=${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "fix Gmail SMTP/outbox/job delivery and regenerate evidence.",
  );
}

const generatedAt = Date.parse(report.generatedAt || "");
const maxAgeHours = Number(process.env.GMAIL_STAGING_E2E_MAX_AGE_HOURS || "72");
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (!Number.isFinite(generatedAt) || ageHours < -0.1 || ageHours > maxAgeHours) {
  fatal(
    "GMAIL-STAGING-EVIDENCE-004",
    reportPath,
    `Gmail staging evidence is stale or invalid; age=${Number.isFinite(ageHours) ? ageHours.toFixed(2) : "invalid"}h, max=${maxAgeHours}h`,
    "rerun npm run e2e:gmail-notifications:staging.",
  );
}

const steps = new Map((report.steps || []).map((step) => [step.name, step]));
for (const name of REQUIRED_STEPS) {
  if (steps.get(name)?.ok !== true) {
    fatal(
      "GMAIL-STAGING-EVIDENCE-005",
      reportPath,
      `required Gmail staging step is missing or failed: ${name}`,
      "rerun the Gmail staging E2E after fixing the failed step.",
    );
  }
}

const text = fs.readFileSync(reportPath, "utf8") + "\n" + fs.readFileSync(markdownPath, "utf8");
const leakPatterns = [
  /postgres(?:ql)?:\/\/[^@\s]+@/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\b0x[a-fA-F0-9]{64,}\b/,
  /"(?:password|secret|token|apiKey|privateKey)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
];
for (const pattern of leakPatterns) {
  if (pattern.test(text)) {
    fatal(
      "GMAIL-STAGING-EVIDENCE-006",
      dir,
      `Gmail staging evidence contains secret-like data matching ${pattern}`,
      "redact DSNs, tokens, private keys, and credentials at generation time.",
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[ci:gmail-notifications-staging-evidence] validated ${dir}`);
