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
  "screenshots/billing-pending.png",
  "screenshots/credits-pending.png",
  "screenshots/billing-completed.png",
  "screenshots/credits-completed.png",
];
const REQUIRED_CHECKS = [
  "deposit:intent-pending",
  "deposit:webhook-credit-slo",
];

function latestEvidenceDir() {
  if (process.env.STAGING_WEBHOOK_DEPOSIT_EVIDENCE_DIR) {
    return path.resolve(process.env.STAGING_WEBHOOK_DEPOSIT_EVIDENCE_DIR);
  }
  const base = path.join(ROOT, "docs/evidence/staging/webhook-deposit");
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
      "STAGING-WEBHOOK-DEPOSIT-JSON",
      filePath,
      `invalid JSON evidence: ${error.message}`,
      "rerun npm run e2e:staging-webhook-deposit; do not hand-edit evidence JSON."
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
    "STAGING-WEBHOOK-DEPOSIT-MISSING",
    "",
    "staging webhook deposit evidence is missing.",
    "run npm run e2e:staging-webhook-deposit and then npm run ci:staging-webhook-deposit-evidence."
  );
}

if (!process.exitCode) {
  for (const name of REQUIRED_FILES) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      fatal(
        "STAGING-WEBHOOK-DEPOSIT-FILE",
        filePath,
        `required evidence artifact is missing: ${name}`,
        "rerun npm run e2e:staging-webhook-deposit."
      );
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const tracePath = path.join(dir, "trace.jsonl");
const report = parseJson(reportPath);
const apiEvidence = parseJson(path.join(dir, "api-evidence.json"));
const dbEvidence = parseJson(path.join(dir, "db-evidence.json"));
const chainEvidence = parseJson(path.join(dir, "chain-evidence.json"));
const logEvidence = parseJson(path.join(dir, "log-evidence.json"));
const screenshotEvidence = parseJson(path.join(dir, "screenshot-evidence.json"));
const traceText = fs.readFileSync(tracePath, "utf8");

if (report?.status !== "success" || (Array.isArray(report?.failed) && report.failed.length > 0)) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-STATUS",
    reportPath,
    `report status is ${report?.status}; failures=${JSON.stringify(report?.failed || []).slice(0, 1000)}`,
    "fix the staging webhook deposit lane and rerun it."
  );
}

if (report?.environment !== "staging") {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-ENV",
    reportPath,
    `expected environment=staging, got ${report?.environment}`,
    "rerun against staging only."
  );
}

if (!report?.traceDigest || report.traceDigest !== sha256File(tracePath)) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-DIGEST",
    reportPath,
    "report.json traceDigest does not match trace.jsonl.",
    "rerun the generator; do not hand-edit report.json or trace.jsonl independently."
  );
}

for (const checkName of REQUIRED_CHECKS) {
  const found = (report?.checks || []).find((item) => item.name === checkName && item.ok);
  if (!found) {
    fatal(
      "STAGING-WEBHOOK-DEPOSIT-CHECK",
      reportPath,
      `required passing check is missing: ${checkName}`,
      "ensure the staging webhook lane records the check and rerun the evidence."
    );
  }
}

for (const screenshot of REQUIRED_SCREENSHOTS) {
  if (!(report?.screenshots || []).includes(screenshot) || !fs.existsSync(path.join(dir, screenshot))) {
    fatal(
      "STAGING-WEBHOOK-DEPOSIT-SCREENSHOT",
      path.join(dir, screenshot),
      `required screenshot is missing: ${screenshot}`,
      "rerun the Playwright phase against staging billing and credits."
    );
  }
}

const depositSummary = chainEvidence?.result || {};
if (!depositSummary.txHash || !depositSummary.depositIntentId) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-CHAIN",
    path.join(dir, "chain-evidence.json"),
    "chain evidence missing txHash or depositIntentId.",
    "capture the deposit tx and intent identifiers in the lane."
  );
}

if (Number(depositSummary.creditedDelaySec || 0) > 120) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-SLO",
    path.join(dir, "chain-evidence.json"),
    `credited delay exceeded 120s: ${depositSummary.creditedDelaySec}`,
    "keep this lane failing until real webhook credit happens within 2 minutes."
  );
}

const finalDeposit = dbEvidence?.final?.deposit || {};
const finalBalance = dbEvidence?.final?.balance || {};
if (String(finalDeposit.status || "").toUpperCase() !== "CONFIRMED") {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-DB-STATUS",
    path.join(dir, "db-evidence.json"),
    `final deposit status is ${finalDeposit.status}`,
    "the deposit row must finish CONFIRMED."
  );
}

if (!logEvidence?.webhook?.textPayload || !String(logEvidence.webhook.textPayload).includes("ALCHEMY_DEPOSIT_WEBHOOK_RECEIVED")) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-WEBHOOK-LOG",
    path.join(dir, "log-evidence.json"),
    "missing webhook receipt log entry.",
    "the lane must prove a real webhook callback hit staging."
  );
}

const creditText = String(logEvidence?.credit?.textPayload || "");
if (
  !creditText ||
  (!creditText.includes("DEPOSIT_CREDITED") &&
    !creditText.toLowerCase().includes("deposit credited"))
) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-CREDIT-LOG",
    path.join(dir, "log-evidence.json"),
    "missing deposit credited log entry.",
    "capture the credit log so the evidence shows callback -> credit."
  );
}

if (Array.isArray(logEvidence?.depositIndexerJob) && logEvidence.depositIndexerJob.length > 0) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-JOB-AMBIGUOUS",
    path.join(dir, "log-evidence.json"),
    "deposit-indexer Cloud Run job ran during the webhook proof window.",
    "this lane must prove webhook-driven credit, not scheduler-first compensation."
  );
}

if (
  logEvidence?.webhook?.timestamp &&
  logEvidence?.credit?.timestamp &&
  String(logEvidence.webhook.timestamp || "") > String(logEvidence.credit.timestamp || "")
) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-ORDER",
    path.join(dir, "log-evidence.json"),
    "webhook log timestamp is after credit log timestamp.",
    "the callback must be observed before or at credit time."
  );
}

if (Object.keys(screenshotEvidence || {}).length < REQUIRED_SCREENSHOTS.length) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-SCREENSHOT-META",
    path.join(dir, "screenshot-evidence.json"),
    "screenshot metadata is incomplete.",
    "record screenshot metadata for each required capture."
  );
}

const secretFindings = scanForSecrets(
  [
    traceText,
    fs.readFileSync(path.join(dir, "api-evidence.json"), "utf8"),
    fs.readFileSync(path.join(dir, "db-evidence.json"), "utf8"),
    fs.readFileSync(path.join(dir, "chain-evidence.json"), "utf8"),
    fs.readFileSync(path.join(dir, "log-evidence.json"), "utf8"),
    fs.readFileSync(path.join(dir, "screenshot-evidence.json"), "utf8"),
  ].join("\n")
);
if (secretFindings.length > 0) {
  fatal(
    "STAGING-WEBHOOK-DEPOSIT-SECRET",
    dir,
    `evidence contains secret-like values: ${secretFindings.join(", ")}`,
    "redact tokens, private keys, signatures, passwords, and RPC API keys before writing evidence."
  );
}

if (!process.exitCode) {
  console.log(`[staging-webhook-deposit-evidence] passed: ${dir}`);
}
