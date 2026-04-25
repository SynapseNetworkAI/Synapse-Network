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
  "bugfix-log.md",
  "api-evidence.json",
  "db-evidence.json",
  "chain-evidence.json",
];

const REQUIRED_SCREENSHOTS = [
  "screenshots/user-deposit-entry.png",
  "screenshots/user-balance-before.png",
  "screenshots/user-balance-after.png",
  "screenshots/user-withdrawal-entry.png",
  "screenshots/admin-review.png",
  "screenshots/admin-audit.png",
  "screenshots/reconciliation.png",
];

const REQUIRED_CHECKS = [
  "preflight:staging-chain-db-api",
  "ui:screenshots",
  "deposit:chain-api-db",
  "withdrawal:small-ticket-claim-replay",
  "withdrawal:manual-review",
  "reconciliation:ledger-vault-zero",
];

const REQUIRED_TRACE_SCENARIOS = [
  "deposit",
  "consumer_withdrawal",
  "ledger_vault_reconciliation",
];

function latestEvidenceDir() {
  if (process.env.STAGING_CORE_DOGFOOD_EVIDENCE_DIR) return path.resolve(process.env.STAGING_CORE_DOGFOOD_EVIDENCE_DIR);
  if (process.env.STAGING_CORE_DOGFOOD_REPORT) return path.dirname(path.resolve(process.env.STAGING_CORE_DOGFOOD_REPORT));
  const base = path.join(ROOT, "docs/evidence/staging/core-dogfood");
  if (!fs.existsSync(base)) return "";
  return fs.readdirSync(base)
    .map((name) => path.join(base, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, "report.json")))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
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
      "STAGING-CORE-DOGFOOD-JSON",
      filePath,
      `invalid JSON evidence: ${error.message}`,
      "rerun npm run e2e:staging-core-dogfood; do not hand-edit evidence JSON.",
    );
    return null;
  }
}

function parseTrace(tracePath) {
  const lines = fs.readFileSync(tracePath, "utf8").split(/\r?\n/).filter((line) => line.trim());
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      fatal(
        "STAGING-CORE-DOGFOOD-TRACE-JSON",
        `${tracePath}:${index + 1}`,
        `trace.jsonl line is not valid JSON: ${error.message}`,
        "rerun the generator so trace.jsonl is emitted atomically.",
      );
      return null;
    }
  }).filter(Boolean);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function scanForSecrets(text) {
  const patterns = [
    /\bauthorization\s*[:=]\s*(?!\[REDACTED\])\S+/i,
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
    /"(?:password|privateKey|rawSignature|signature|jwt|adminToken|accessToken|apiKey|secret|authorization)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
    /\b(?:private[_-]?key|raw[_-]?signature|admin[_-]?token|access[_-]?token|api[_-]?key|secret|password)\s*[:=]\s*(?!\[REDACTED\])\S+/i,
    /https:\/\/(?:arb-sepolia|eth-mainnet|[a-z0-9-]+)\.[^/\s]+\/v2\/(?!\[REDACTED\])[A-Za-z0-9_-]+/i,
  ];
  return patterns.filter((pattern) => pattern.test(text)).map(String);
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "STAGING-CORE-DOGFOOD-MISSING",
    "",
    "staging core dogfood evidence is missing.",
    "run npm run e2e:staging-core-dogfood and then rerun npm run ci:staging-core-dogfood-evidence.",
  );
}

if (!process.exitCode) {
  for (const name of REQUIRED_FILES) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      fatal(
        "STAGING-CORE-DOGFOOD-FILE",
        filePath,
        `required evidence artifact is missing: ${name}`,
        "rerun npm run e2e:staging-core-dogfood; do not assemble partial evidence.",
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
const trace = parseTrace(tracePath);

if (report?.status !== "success" || (Array.isArray(report?.failed) && report.failed.length > 0)) {
  fatal(
    "STAGING-CORE-DOGFOOD-STATUS",
    reportPath,
    `report status is ${report?.status}; failures=${JSON.stringify(report?.failed || []).slice(0, 1000)}`,
    "fix the failing staging scenario, append bugfix-log notes, and rerun the dogfood gate.",
  );
}

if (report?.environment !== "staging") {
  fatal(
    "STAGING-CORE-DOGFOOD-ENV",
    reportPath,
    `expected environment=staging, got ${report?.environment}`,
    "rerun against staging only. This gate must not run against prod.",
  );
}

if (!report?.traceDigest || report.traceDigest !== sha256File(tracePath)) {
  fatal(
    "STAGING-CORE-DOGFOOD-DIGEST",
    reportPath,
    "report.json traceDigest does not match trace.jsonl.",
    "rerun the generator; do not hand-edit report.json or trace.jsonl independently.",
  );
}

if (trace.length === 0) {
  fatal(
    "STAGING-CORE-DOGFOOD-TRACE-EMPTY",
    tracePath,
    "trace.jsonl contains no checkpoints.",
    "rerun npm run e2e:staging-core-dogfood.",
  );
}

const traceScenarios = new Set(trace.map((row) => row.scenario));
for (const scenario of REQUIRED_TRACE_SCENARIOS) {
  if (!traceScenarios.has(scenario)) {
    fatal(
      "STAGING-CORE-DOGFOOD-TRACE-SCENARIO",
      tracePath,
      `trace.jsonl is missing scenario ${scenario}.`,
      "rerun the live dogfood gate so deposit, withdrawal, and reconciliation checkpoints are captured.",
    );
  }
}

const traceText = fs.readFileSync(tracePath, "utf8");
const evidenceText = [
  traceText,
  fs.readFileSync(path.join(dir, "api-evidence.json"), "utf8"),
  fs.readFileSync(path.join(dir, "db-evidence.json"), "utf8"),
  fs.readFileSync(path.join(dir, "chain-evidence.json"), "utf8"),
].join("\n");
const secretFindings = scanForSecrets(evidenceText);
if (secretFindings.length > 0) {
  fatal(
    "STAGING-CORE-DOGFOOD-SECRET",
    dir,
    `evidence contains secret-like values: ${secretFindings.join(", ")}`,
    "redact tokens, private keys, signatures, passwords, and RPC API keys before writing evidence.",
  );
}

const screenshots = new Set(report?.screenshots || []);
for (const screenshot of REQUIRED_SCREENSHOTS) {
  if (!screenshots.has(screenshot) || !fs.existsSync(path.join(dir, screenshot))) {
    fatal(
      "STAGING-CORE-DOGFOOD-SCREENSHOT",
      path.join(dir, screenshot),
      `required screenshot is missing: ${screenshot}`,
      "rerun the Playwright dogfood phase against User-front and Admin-front.",
    );
  }
}

const checks = new Map((report?.checks || []).map((check) => [check.name, check]));
for (const checkName of REQUIRED_CHECKS) {
  const check = checks.get(checkName);
  if (!check || check.ok !== true) {
    fatal(
      "STAGING-CORE-DOGFOOD-CHECK",
      reportPath,
      `required check did not pass: ${checkName}`,
      "rerun the gate after fixing the failing staging API/UI/DB/chain step.",
    );
  }
}

const reconciliation = report?.reconciliation || {};
if (reconciliation.ledgerDelta !== "0.000000" || reconciliation.vaultDelta !== "0.000000" || reconciliation.status !== "passed") {
  fatal(
    "STAGING-CORE-DOGFOOD-RECONCILIATION",
    reportPath,
    `expected zero deltas; actual=${JSON.stringify(reconciliation)}`,
    "investigate DB ledger rows, vault balance movement, and ticket completion before accepting staging.",
  );
}

const withdrawalTrace = trace.find((row) => row.scenario === "consumer_withdrawal");
if (
  withdrawalTrace?.actual?.replay?.reverted !== true ||
  withdrawalTrace?.actual?.consumed !== true
) {
  fatal(
    "STAGING-CORE-DOGFOOD-REPLAY",
    tracePath,
    `consumer withdrawal trace must prove replay rejected and ticket consumed; actual=${JSON.stringify(withdrawalTrace?.actual || {})}`,
    "rerun the small withdrawal claim/replay phase and verify SynapseCore.isTicketConsumed.",
  );
}

if (!Array.isArray(dbEvidence?.deposit) || dbEvidence.deposit[0]?.status !== "CONFIRMED") {
  fatal(
    "STAGING-CORE-DOGFOOD-DB-DEPOSIT",
    path.join(dir, "db-evidence.json"),
    "deposit DB evidence is missing or not CONFIRMED.",
    "rerun deposit/indexer and verify synapse_vault_deposits status.",
  );
}

const smallWithdrawal = Array.isArray(dbEvidence?.smallWithdrawal) ? dbEvidence.smallWithdrawal[0] : null;
if (!smallWithdrawal || String(smallWithdrawal.status || "").toUpperCase() !== "COMPLETED") {
  fatal(
    "STAGING-CORE-DOGFOOD-DB-WITHDRAWAL",
    path.join(dir, "db-evidence.json"),
    "small withdrawal DB evidence is missing or not COMPLETED.",
    "verify completion endpoint and synapse_vault_withdrawals status.",
  );
}

if (!chainEvidence?.deposit?.txHash || !chainEvidence?.finalConsumer?.vaultAtomic) {
  fatal(
    "STAGING-CORE-DOGFOOD-CHAIN",
    path.join(dir, "chain-evidence.json"),
    "chain evidence is missing deposit tx or final vault snapshot.",
    "rerun the ethers-backed chain phase.",
  );
}

if (!Array.isArray(apiEvidence) || apiEvidence.length === 0) {
  fatal(
    "STAGING-CORE-DOGFOOD-API",
    path.join(dir, "api-evidence.json"),
    "API trace evidence is empty.",
    "rerun the dogfood gate so Gateway/Admin API calls are captured.",
  );
}

if (!process.exitCode) {
  console.log(`[ci:staging-core-dogfood-evidence] validated ${dir}`);
}

process.exit(process.exitCode || 0);
