#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE = path.join(
  ROOT,
  "output/dogfood/consumer-withdraw-approval-expiry"
);

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestReportDir() {
  if (process.env.CONSUMER_WITHDRAW_APPROVAL_EXPIRY_OUT_DIR) {
    return path.resolve(process.env.CONSUMER_WITHDRAW_APPROVAL_EXPIRY_OUT_DIR);
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
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-001",
    "",
    "No local consumer withdrawal approval expiry evidence directory was found.",
    "Run npm run e2e:consumer-withdraw-approval-expiry:local first."
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
  "chain-evidence.json",
  "dom-evidence.json",
  "screenshot-evidence.json",
];

for (const name of requiredFiles) {
  if (!fs.existsSync(path.join(dir, name))) {
    fatal(
      "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-002",
      path.join(dir, name),
      "Required approval-expiry evidence file is missing.",
      "Rerun the local E2E and do not hand-edit partial evidence directories."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const apiEvidence = readJson(path.join(dir, "api-evidence.json"));
const dbEvidence = readJson(path.join(dir, "db-evidence.json"));
const chainEvidence = readJson(path.join(dir, "chain-evidence.json"));
const domEvidence = readJson(path.join(dir, "dom-evidence.json"));
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
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
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-003",
    path.join(dir, "report.json"),
    `E2E report status is ${report.status}; failures=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "Fix the failure, keep bugfix-log.md, and rerun the E2E."
  );
}

if (!report.traceDigest || report.traceDigest !== traceDigest) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-004",
    path.join(dir, "report.json"),
    "report.json traceDigest does not match trace.jsonl.",
    "Do not hand-edit evidence; rerun the E2E."
  );
}

if (/Status:\s*open/i.test(bugfixLog)) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-005",
    path.join(dir, "bugfix-log.md"),
    "bugfix-log.md still contains an open bug.",
    "Fix the bug, mark it closed, and rerun the E2E."
  );
}

if (
  String(dbEvidence.afterCreate?.row?.status || "").toUpperCase() !==
  "PENDING_MANUAL_REVIEW"
) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-006",
    path.join(dir, "db-evidence.json"),
    "Withdrawal did not enter PENDING_MANUAL_REVIEW after creation.",
    "Ensure the local fixture amount still routes through manual review."
  );
}

if (
  String(dbEvidence.afterApprove?.row?.status || "").toUpperCase() !==
  "REQUESTED"
) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-007",
    path.join(dir, "db-evidence.json"),
    "Withdrawal did not transition to REQUESTED after admin approval.",
    "Fix approve flow so frozen funds move to pending and a ticket is issued."
  );
}

if (
  String(dbEvidence.afterExpiry?.row?.status || "").toUpperCase() !==
  "FAILED_EXPIRED"
) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-008",
    path.join(dir, "db-evidence.json"),
    `Expired row status is ${dbEvidence.afterExpiry?.row?.status}, not FAILED_EXPIRED.`,
    "Fix consumer withdraw expiry processing and rerun the E2E."
  );
}

if (
  apiEvidence.afterApprove?.claimable !== true ||
  !apiEvidence.afterApprove?.ticket
) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-009",
    path.join(dir, "api-evidence.json"),
    "Approved API row did not expose claimable=true with a ticket.",
    "Fix the consumer withdrawal list/detail contract."
  );
}

if (apiEvidence.afterExpiry?.claimable !== false) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-010",
    path.join(dir, "api-evidence.json"),
    "Expired API row must return claimable=false.",
    "Fix the consumer withdrawal projection to fail closed after expiry."
  );
}

const expiredBalance = dbEvidence.afterExpiry?.balance || {};
if (Number(expiredBalance.pendingBalance || "0") !== 0) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-011",
    path.join(dir, "db-evidence.json"),
    `Pending balance should be released to zero after expiry, got ${expiredBalance.pendingBalance}.`,
    "Ensure ticket expiry releases pending balance back to available."
  );
}

const chainAfterExpiry = chainEvidence.afterExpiry || {};
if (
  String(chainAfterExpiry.ticketConsumed) !== "false" ||
  BigInt(chainAfterExpiry.walletDeltaAtomic || "0") !== 0n ||
  BigInt(chainAfterExpiry.vaultDeltaAtomic || "0") !== 0n ||
  BigInt(chainAfterExpiry.feePoolDeltaAtomic || "0") !== 0n
) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-012",
    path.join(dir, "chain-evidence.json"),
    "Expiry release must keep wallet, vault, and platform fee pool unchanged, with ticketConsumed=false.",
    "Fix expiry processing until it only releases the off-chain pending balance."
  );
}

if (domEvidence.summary?.expiringStatus !== "Withdrawal approval expiring") {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-013",
    path.join(dir, "dom-evidence.json"),
    "DOM evidence did not record the expiring approval state.",
    "Keep the withdraw page expiring-warning state and rerun the E2E."
  );
}

for (const expected of [
  "01-withdraw-under-review.png",
  "03-withdraw-ready-to-claim.png",
  "04-withdraw-approval-expiring.png",
  "05-withdraw-expired-released.png",
]) {
  if (!screenshots.some((item) => String(item.file || "").endsWith(expected))) {
    fatal(
      "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-014",
      path.join(dir, "screenshot-evidence.json"),
      `Missing required screenshot ${expected}.`,
      "Recapture all withdraw expiry checkpoints before rerunning the checker."
    );
  }
}

const leaks = hasSecretLeak(allEvidenceText);
if (leaks.length > 0) {
  fatal(
    "CONSUMER-WITHDRAW-APPROVAL-EXPIRY-015",
    dir,
    `Evidence appears to contain secret-like values: ${leaks.join(", ")}.`,
    "Redact secrets from the runner and regenerate evidence."
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`consumer withdraw approval expiry evidence OK: ${dir}`);
