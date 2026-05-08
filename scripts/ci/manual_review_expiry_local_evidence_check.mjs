#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE = path.join(ROOT, "output/dogfood/manual-review-expiry");

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestReportDir() {
  if (process.env.MANUAL_REVIEW_EXPIRY_EVIDENCE_DIR) {
    return path.resolve(process.env.MANUAL_REVIEW_EXPIRY_EVIDENCE_DIR);
  }
  if (!fs.existsSync(BASE)) return "";
  return (
    fs
      .readdirSync(BASE)
      .map((name) => path.join(BASE, name))
      .filter((dir) => fs.existsSync(path.join(dir, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hasSecretLeak(text) {
  const patterns = [
    ["JWT", /eyJ[A-Za-z0-9._~+/=-]{20,}/],
    ["AUTHORIZATION", /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
    [
      "SENSITIVE_FIELD_VALUE",
      /"(?:[^"]*(?:privateKey|private_key|signature|authorization|token|secret|password)[^"]*)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    ],
    [
      "SENSITIVE_ENV_NAME",
      /\b(?:PRIVATE_KEY|JWT_SECRET|AUTH_SECRET|ADMIN_TOTP_SECRET|ADMIN_PASSWORD|POSTGRES_DSN)\b/,
    ],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

const dir = latestReportDir();
if (!dir) {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-001",
    "",
    "No local manual review expiry evidence directory was found.",
    "Run npm run e2e:manual-review-expiry:local first."
  );
}

if (process.exitCode) process.exit(process.exitCode);

const requiredFiles = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-evidence.json",
  "db-evidence.json",
  "notification-evidence.json",
];

for (const name of requiredFiles) {
  if (!fs.existsSync(path.join(dir, name))) {
    fatal(
      "MANUAL-REVIEW-EXPIRY-EVIDENCE-002",
      path.join(dir, name),
      "Required manual review expiry evidence file is missing.",
      "Rerun the local E2E and do not hand-edit partial evidence directories."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const dbEvidence = readJson(path.join(dir, "db-evidence.json"));
const apiEvidence = readJson(path.join(dir, "api-evidence.json"));
const notificationEvidence = readJson(
  path.join(dir, "notification-evidence.json")
);
const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
const allEvidenceText = requiredFiles
  .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
  .join("\n");
const traceText = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");
const traceDigest = crypto.createHash("sha256").update(traceText).digest("hex");

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length !== 0
) {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-003",
    path.join(dir, "report.json"),
    `E2E report status is ${report.status}; failures=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "Fix the failure, keep bugfix-log.md, and rerun the E2E."
  );
}

if (!report.traceDigest || report.traceDigest !== traceDigest) {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-004",
    path.join(dir, "report.json"),
    "report.json traceDigest does not match trace.jsonl.",
    "Do not hand-edit evidence; rerun the E2E."
  );
}

if (report.expirySecUsed !== 3) {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-005",
    path.join(dir, "report.json"),
    `Expected expirySecUsed=3, got ${report.expirySecUsed}.`,
    "Run the E2E through npm run e2e:manual-review-expiry:local."
  );
}

if (/Status:\s*open/i.test(bugfixLog)) {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-006",
    path.join(dir, "bugfix-log.md"),
    "bugfix-log.md still contains an open bug.",
    "Fix the bug, mark it closed, and rerun the E2E."
  );
}

for (const actor of ["consumer", "provider"]) {
  const evidence = dbEvidence[actor];
  if (!evidence) {
    fatal(
      "MANUAL-REVIEW-EXPIRY-EVIDENCE-007",
      path.join(dir, "db-evidence.json"),
      `Missing ${actor} DB evidence.`,
      "Regenerate full consumer and provider expiry evidence."
    );
    continue;
  }
  if (!evidence.reviewExpiresAt) {
    fatal(
      "MANUAL-REVIEW-EXPIRY-EVIDENCE-016",
      path.join(dir, "db-evidence.json"),
      `${actor} reviewExpiresAt is missing.`,
      "Include review expiration timestamp evidence in the local expiry runner."
    );
  }
  if (evidence.after?.status !== "FAILED_EXPIRED") {
    fatal(
      "MANUAL-REVIEW-EXPIRY-EVIDENCE-008",
      path.join(dir, "db-evidence.json"),
      `${actor} status is ${evidence.after?.status}, not FAILED_EXPIRED.`,
      "Fix the expiry processor/reaper and rerun the E2E."
    );
  }
  if (
    Number(evidence.frozenDelta) >= 0 ||
    Number(evidence.availableDelta) <= 0
  ) {
    fatal(
      "MANUAL-REVIEW-EXPIRY-EVIDENCE-009",
      path.join(dir, "db-evidence.json"),
      `${actor} balance deltas are invalid: frozen=${evidence.frozenDelta}, available=${evidence.availableDelta}.`,
      "Ensure expiry releases frozen funds back to available balance atomically."
    );
  }
  if (evidence.pendingQueueContainsExpired) {
    fatal(
      "MANUAL-REVIEW-EXPIRY-EVIDENCE-010",
      path.join(dir, "db-evidence.json"),
      `${actor} expired item is still represented as pending.`,
      "Filter FAILED_EXPIRED rows out of pending manual review queues."
    );
  }
}

if (dbEvidence.reconciliationDeltaUsdc !== "0.000000") {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-011",
    path.join(dir, "db-evidence.json"),
    `Reconciliation delta is ${dbEvidence.reconciliationDeltaUsdc}.`,
    "Fix balance release accounting until reconciliation delta is zero."
  );
}

const queue = apiEvidence.pendingReviewQueue || {};
if (queue.consumerContainsExpired || queue.providerContainsExpired) {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-012",
    path.join(dir, "api-evidence.json"),
    "API evidence says an expired item remains in the pending review queue.",
    "Fix pending review filters and rerun the E2E."
  );
}

const notificationText = JSON.stringify(notificationEvidence);
if (!notificationText.includes("Frozen funds were safely returned")) {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-013",
    path.join(dir, "notification-evidence.json"),
    "Consumer expiry notification does not reassure users that funds were returned.",
    "Update the in-app/email copy and rerun the E2E."
  );
}
if (!notificationText.includes("Frozen earnings were safely returned")) {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-014",
    path.join(dir, "notification-evidence.json"),
    "Provider expiry notification does not reassure users that earnings were returned.",
    "Update the in-app/email copy and rerun the E2E."
  );
}

const leaks = hasSecretLeak(allEvidenceText);
if (leaks.length > 0) {
  fatal(
    "MANUAL-REVIEW-EXPIRY-EVIDENCE-015",
    dir,
    `Evidence appears to contain secret-like values: ${leaks.join(", ")}.`,
    "Redact secrets from the runner and regenerate evidence."
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`manual review expiry evidence OK: ${dir}`);
