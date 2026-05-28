#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "api-evidence.json",
  "db-evidence.json",
  "chain-evidence.json",
  "log-evidence.json",
  "screenshot-evidence.json",
];
const REQUIRED_SCREENSHOTS = [
  "screenshots/billing-requested.png",
  "screenshots/credits-before-complete.png",
  "screenshots/billing-completed.png",
  "screenshots/credits-completed.png",
];
const REQUIRED_CHECKS = [
  "withdraw:auto-approved-requested",
  "withdraw:client-complete-slo",
  "withdraw:ui-completed",
];

function latestEvidenceDir() {
  if (process.env.STAGING_CONSUMER_WITHDRAW_EVIDENCE_DIR) {
    return path.resolve(process.env.STAGING_CONSUMER_WITHDRAW_EVIDENCE_DIR);
  }
  const base = path.join(
    ROOT,
    "docs/evidence/staging/consumer-withdraw-auto-approve"
  );
  if (!fs.existsSync(base)) return "";
  return (
    fs
      .readdirSync(base)
      .map((name) => path.join(base, name))
      .filter((candidate) => fs.existsSync(path.join(candidate, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function parseJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "STAGING-CONSUMER-WITHDRAW-JSON",
      filePath,
      `invalid JSON evidence: ${error.message}`,
      "rerun npm run e2e:staging-consumer-withdraw-auto-approve; do not hand-edit evidence JSON."
    );
    return null;
  }
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function scanForSecrets(text) {
  const patterns = [
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
    /"(?:password|privateKey|rawSignature|signature|jwt|adminToken|accessToken|apiKey|secret|authorization)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    /https:\/\/(?:arb-sepolia|eth-mainnet|[a-z0-9-]+)\.[^/\s]+\/v2\/(?!\[REDACTED\])[A-Za-z0-9_-]+/i,
  ];
  return patterns.filter((pattern) => pattern.test(text)).map(String);
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-MISSING",
    "",
    "staging consumer withdraw auto-approve evidence is missing.",
    "run npm run e2e:staging-consumer-withdraw-auto-approve and then npm run ci:staging-consumer-withdraw-auto-approve-evidence."
  );
}

if (!process.exitCode) {
  for (const name of REQUIRED_FILES) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      fatal(
        "STAGING-CONSUMER-WITHDRAW-FILE",
        filePath,
        `required evidence artifact is missing: ${name}`,
        "rerun npm run e2e:staging-consumer-withdraw-auto-approve."
      );
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const tracePath = path.join(dir, "trace.jsonl");
const report = parseJson(reportPath);
const dbEvidence = parseJson(path.join(dir, "db-evidence.json"));
const chainEvidence = parseJson(path.join(dir, "chain-evidence.json"));
const logEvidence = parseJson(path.join(dir, "log-evidence.json"));
const screenshotEvidence = parseJson(path.join(dir, "screenshot-evidence.json"));
const traceText = fs.readFileSync(tracePath, "utf8");

if (report?.status !== "success" || (Array.isArray(report?.failed) && report.failed.length > 0)) {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-STATUS",
    reportPath,
    `report status is ${report?.status}; failures=${JSON.stringify(report?.failed || []).slice(0, 1000)}`,
    "fix the staging consumer withdraw lane and rerun it."
  );
}

if (report?.environment !== "staging") {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-ENV",
    reportPath,
    `expected environment=staging, got ${report?.environment}`,
    "rerun against staging only."
  );
}

if (!report?.traceDigest || report.traceDigest !== sha256File(tracePath)) {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-DIGEST",
    reportPath,
    "report.json traceDigest does not match trace.jsonl.",
    "rerun the generator; do not hand-edit report.json or trace.jsonl independently."
  );
}

for (const checkName of REQUIRED_CHECKS) {
  const found = (report?.checks || []).find((item) => item.name === checkName && item.ok);
  if (!found) {
    fatal(
      "STAGING-CONSUMER-WITHDRAW-CHECK",
      reportPath,
      `required passing check is missing: ${checkName}`,
      "ensure the staging withdraw lane records the check and rerun the evidence."
    );
  }
}

for (const screenshot of REQUIRED_SCREENSHOTS) {
  if (!(report?.screenshots || []).includes(screenshot) || !fs.existsSync(path.join(dir, screenshot))) {
    fatal(
      "STAGING-CONSUMER-WITHDRAW-SCREENSHOT",
      path.join(dir, screenshot),
      `required screenshot is missing: ${screenshot}`,
      "rerun the Playwright phase against staging billing and credits."
    );
  }
}

const result = chainEvidence?.result || {};
if (!result.withdrawalId || !result.txHash) {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-CHAIN",
    path.join(dir, "chain-evidence.json"),
    "chain evidence missing withdrawalId or txHash.",
    "capture the withdrawal identifiers in the lane."
  );
}

if (Number(result.completedDelaySec || 0) > 120) {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-SLO",
    path.join(dir, "chain-evidence.json"),
    `completion delay exceeded 120s: ${result.completedDelaySec}`,
    "keep this lane failing until the client-complete path closes within 2 minutes."
  );
}

const finalWithdrawal = dbEvidence?.final?.withdrawal || {};
const finalBalance = dbEvidence?.final?.balance || {};
if (String(finalWithdrawal.status || "").toUpperCase() !== "COMPLETED") {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-DB-STATUS",
    path.join(dir, "db-evidence.json"),
    `final withdrawal status is ${finalWithdrawal.status}`,
    "the withdrawal row must finish COMPLETED."
  );
}

if (
  finalBalance.pendingBalance == null ||
  !["0", "0.0", "0.00", "0.000000"].includes(String(finalBalance.pendingBalance))
) {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-PENDING",
    path.join(dir, "db-evidence.json"),
    `pending balance did not release cleanly: ${finalBalance.pendingBalance}`,
    "the client-complete path must not leave consumer pending balance behind."
  );
}

const gatewayLogs = Array.isArray(logEvidence?.gateway) ? logEvidence.gateway : [];
const completionLog = gatewayLogs.find(
  (row) =>
    String(row.textPayload || "").includes("event=CONSUMER_WITHDRAW_COMPLETED") &&
    String(row.textPayload || "").includes("completion_source=client_complete")
);
if (!completionLog) {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-LOG",
    path.join(dir, "log-evidence.json"),
    "missing structured client_complete withdrawal log entry.",
    "capture the new CONSUMER_WITHDRAW_COMPLETED log so the evidence proves /complete closed the row."
  );
}

const screenshotJson = JSON.stringify(screenshotEvidence);
const secretHits = scanForSecrets(traceText + "\n" + screenshotJson);
if (secretHits.length > 0) {
  fatal(
    "STAGING-CONSUMER-WITHDRAW-SECRETS",
    dir,
    `secret-like material found in evidence: ${secretHits.join(", ")}`,
    "tighten evidence redaction before merging."
  );
}

console.log(
  `OK staging consumer withdraw evidence validated: ${result.withdrawalId} -> ${result.txHash}`
);
