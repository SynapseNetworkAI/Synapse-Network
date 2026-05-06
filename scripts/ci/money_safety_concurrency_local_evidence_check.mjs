#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE = path.join(ROOT, "output/dogfood/money-safety-concurrency");
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-evidence.json",
  "db-evidence.json",
  "chain-evidence.json",
  "attack-evidence.json",
];
const REQUIRED_SCENARIOS = [
  "deposit_duplicate_and_replay",
  "consumer_withdraw_concurrent_create_review_complete",
  "provider_withdraw_concurrent_create_claim_complete",
  "refund_duplicate_complete_and_fail_race",
  "invoke_settlement_hold_capture_release_replay",
  "platform_fee_withdrawal_boundary_and_replay",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.MONEY_SAFETY_CONCURRENCY_EVIDENCE_DIR) {
    return path.resolve(process.env.MONEY_SAFETY_CONCURRENCY_EVIDENCE_DIR);
  }
  if (!fs.existsSync(BASE)) return "";
  return (
    fs
      .readdirSync(BASE, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith("-local"))
      .map((entry) => path.join(BASE, entry.name))
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
      /"(?:privateKey|private_key|signature|authorization|access_token|token|secret|password)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    ],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "MONEY-SAFETY-CONCURRENCY-001",
    "",
    "No money-safety concurrency evidence directory was found.",
    "Run npm run e2e:money-safety-concurrency:local before this checker."
  );
}
if (process.exitCode) process.exit(process.exitCode);

for (const file of REQUIRED_FILES) {
  const fullPath = path.join(dir, file);
  if (!fs.existsSync(fullPath)) {
    fatal(
      "MONEY-SAFETY-CONCURRENCY-002",
      fullPath,
      `Required evidence file is missing: ${file}`,
      "Rerun the E2E; do not hand-assemble the evidence bundle."
    );
  }
}
if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
const traceText = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");
const attackEvidence = readJson(path.join(dir, "attack-evidence.json"));
const chainEvidence = readJson(path.join(dir, "chain-evidence.json"));
const dbEvidence = readJson(path.join(dir, "db-evidence.json"));
const allEvidenceText = REQUIRED_FILES.map((name) =>
  fs.readFileSync(path.join(dir, name), "utf8")
).join("\n");

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "MONEY-SAFETY-CONCURRENCY-003",
    path.join(dir, "report.json"),
    `report is not clean; status=${report.status}; failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 1000)}`,
    "Fix the underlying money-safety regression and rerun the full local gate."
  );
}

const digest = crypto.createHash("sha256").update(traceText).digest("hex");
if (report.traceDigest !== digest) {
  fatal(
    "MONEY-SAFETY-CONCURRENCY-004",
    path.join(dir, "trace.jsonl"),
    "trace.jsonl digest does not match report.json traceDigest.",
    "Do not edit evidence by hand; rerun the E2E."
  );
}

if (/Status:\s*open/i.test(bugfixLog)) {
  fatal(
    "MONEY-SAFETY-CONCURRENCY-005",
    path.join(dir, "bugfix-log.md"),
    "bugfix-log.md still contains an open bug.",
    "Fix the bug and rerun the gate until bugfix-log.md closes it."
  );
}

for (const scenarioName of REQUIRED_SCENARIOS) {
  const scenario = (report.scenarioResults || []).find(
    (row) => row.name === scenarioName
  );
  if (!scenario || scenario.pass !== true || scenario.status !== "passed") {
    fatal(
      "MONEY-SAFETY-CONCURRENCY-006",
      path.join(dir, "report.json"),
      `Required scenario missing or failed: ${scenarioName}`,
      "Keep the unified gate narrow and decision-complete; every required scenario must pass."
    );
  }
}

for (const [attackName, attack] of Object.entries(attackEvidence)) {
  if (
    !["blocked", "idempotent-noop", "terminal-safe"].includes(
      String(attack.finalResult || "")
    )
  ) {
    fatal(
      "MONEY-SAFETY-CONCURRENCY-007",
      path.join(dir, "attack-evidence.json"),
      `Attack result is not safe for ${attackName}: ${attack.finalResult}`,
      "Every attack row must end in blocked, idempotent-noop, or terminal-safe."
    );
  }
}

const consumerClaim = chainEvidence.consumerClaim?.afterClaim;
if (
  !consumerClaim ||
  consumerClaim.netDeltaAtomic !==
    consumerClaim.vaultDeltaAtomic?.replace("-", "")
) {
  fatal(
    "MONEY-SAFETY-CONCURRENCY-008",
    path.join(dir, "chain-evidence.json"),
    "Consumer claim wallet/vault delta invariant is missing or inconsistent.",
    "Capture before/after wallet and vault balances around the consumer claim."
  );
}

if (chainEvidence.consumerClaim?.platformFeeOverdraw?.rejected !== true) {
  fatal(
    "MONEY-SAFETY-CONCURRENCY-009",
    path.join(dir, "chain-evidence.json"),
    "Platform fee overdraw negative scenario is missing or not rejected.",
    "The local chain evidence must prove withdrawPlatformFees cannot exceed platformFeePool."
  );
}

if (
  !dbEvidence.deposit ||
  !dbEvidence.withdrawalConcurrency ||
  !dbEvidence.consumerClaim
) {
  fatal(
    "MONEY-SAFETY-CONCURRENCY-010",
    path.join(dir, "db-evidence.json"),
    "DB evidence does not cover deposit, withdrawal concurrency, and claim paths together.",
    "Include all three DB evidence families in the unified evidence contract."
  );
}

const leaks = hasSecretLeak(allEvidenceText);
if (leaks.length > 0) {
  fatal(
    "MONEY-SAFETY-CONCURRENCY-011",
    dir,
    `Evidence appears to leak sensitive material: ${leaks.join(", ")}`,
    "Redact tokens, signatures, secrets, and private keys before writing evidence."
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[money-safety-concurrency] passed: ${dir}`);
