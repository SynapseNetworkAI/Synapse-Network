#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(
  ROOT,
  "output/dogfood/user-front-payments-gateway-truth"
);
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-evidence.json",
  "db-evidence.json",
  "dom-evidence.json",
  "screenshot-evidence.json",
];
const REQUIRED_CHECKS = [
  "db:seed",
  "gateway:auth",
  "api-db:deposit-rows",
  "api-db:withdrawal-refund-rows",
  "db:balance-buckets",
  "projection:sort-render-limit",
  "dom:payments-table",
  "dom:pending-survives-refresh",
];
const REQUIRED_ENDPOINTS = [
  "/v1/balance",
  "/v1/balance/deposit/intents?limit=100",
  "/v1/balance/consumer/withdrawals?limit=100",
  "/v1/refunds?limit=100",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.USER_FRONT_PAYMENTS_GATEWAY_TRUTH_EVIDENCE_DIR) {
    return path.resolve(
      process.env.USER_FRONT_PAYMENTS_GATEWAY_TRUTH_EVIDENCE_DIR
    );
  }
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return (
    fs
      .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.endsWith("-local"))
      .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
      .filter((candidate) => fs.existsSync(path.join(candidate, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stringifyEvidence(...values) {
  return values
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join("\n");
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-MISSING",
    "",
    "Payments Gateway-truth E2E evidence is missing.",
    "run npm run e2e:user-front-payments-gateway-truth:local before the checker."
  );
}

if (!process.exitCode) {
  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(dir, file))) {
      fatal(
        "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-FILE",
        path.join(dir, file),
        "Evidence bundle is incomplete.",
        "rerun the E2E; do not hand-assemble partial evidence."
      );
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const api = readJson(path.join(dir, "api-evidence.json"));
const db = readJson(path.join(dir, "db-evidence.json"));
const dom = readJson(path.join(dir, "dom-evidence.json"));
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
const trace = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-STATUS",
    path.join(dir, "report.json"),
    `Evidence failed: ${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "fix the failing API/DB/DOM checkpoint and rerun the E2E."
  );
}

if (/^\s*-\s*OPEN\b/im.test(bugfixLog)) {
  fatal(
    "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-BUGFIX",
    path.join(dir, "bugfix-log.md"),
    "Bugfix log contains an open item.",
    "fix or intentionally close the bug entry before accepting the evidence."
  );
}

if (
  crypto.createHash("sha256").update(trace).digest("hex") !== report.traceDigest
) {
  fatal(
    "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-DIGEST",
    path.join(dir, "trace.jsonl"),
    "Trace digest does not match report.json.",
    "rerun the E2E; never edit evidence by hand."
  );
}

const checkMap = new Map((report.checks || []).map((row) => [row.name, row]));
for (const name of REQUIRED_CHECKS) {
  if (checkMap.get(name)?.ok !== true) {
    fatal(
      "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-CHECK",
      path.join(dir, "report.json"),
      `Required check missing or failed: ${name}`,
      "rerun the Payments Gateway-truth E2E after fixing the page or data projection."
    );
  }
}

const endpointSet = new Set(api.map((row) => row.pathname));
for (const endpoint of REQUIRED_ENDPOINTS) {
  if (!endpointSet.has(endpoint)) {
    fatal(
      "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-ENDPOINT",
      path.join(dir, "api-evidence.json"),
      `Required Gateway endpoint was not captured: ${endpoint}`,
      "capture the real Gateway API response for balance, deposit intents, withdrawals, and refunds."
    );
  }
}

if ((db.seeded?.depositRows ?? 0) < 51) {
  fatal(
    "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-SEED",
    path.join(dir, "db-evidence.json"),
    "DB fixture did not include enough deposit rows to exercise render limiting.",
    "seed at least 51 deposit rows plus withdrawal/refund rows."
  );
}

if ((db.expectedPayments?.totalRecords ?? 0) !== 53) {
  fatal(
    "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-PROJECTION",
    path.join(dir, "db-evidence.json"),
    "Merged API projection did not produce the expected 53 records.",
    "verify deposit, consumer withdrawal, and refund API rows are normalized exactly once."
  );
}

if ((db.expectedPayments?.renderedRecords || []).length !== 50) {
  fatal(
    "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-LIMIT",
    path.join(dir, "db-evidence.json"),
    "Rendered projection is not capped at 50 records.",
    "keep PAYMENTS_RENDER_LIMIT at 50 and slice after cross-source sorting."
  );
}

const domCheckpoint = dom[0] || {};
if (
  domCheckpoint.rowCount !== 50 ||
  domCheckpoint.historyHintSeen !== true ||
  domCheckpoint.pendingVisible !== true ||
  domCheckpoint.completedVisible !== true
) {
  fatal(
    "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-DOM",
    path.join(dir, "dom-evidence.json"),
    "Billing DOM does not match the required Gateway-backed table state.",
    "ensure /dashboard/billing renders the Gateway API projection, pending intent, completed deposit, 50-row cap, and limit hint."
  );
}

const evidenceText = stringifyEvidence(
  report,
  api,
  db,
  dom,
  screenshots,
  trace
);
const forbidden = [
  /2\.2605864150320387e\+58/i,
  /\bDepositInfo\b/,
  /\bWithdrawInfo\b/,
  /ticketHash\s+as\s+amount/i,
  /\bagent:agent:/i,
  /\bCounterparty\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
];
for (const pattern of forbidden) {
  if (pattern.test(evidenceText)) {
    fatal(
      "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-LEAK",
      dir,
      `Evidence contains forbidden text matching ${pattern}.`,
      "redact secrets/internal chain parsing artifacts and rerun the evidence."
    );
  }
}

if (!Array.isArray(screenshots) || screenshots.length < 1) {
  fatal(
    "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-SCREENSHOT",
    path.join(dir, "screenshot-evidence.json"),
    "Screenshot evidence is missing.",
    "capture /dashboard/billing after DOM/API/DB checkpoints pass."
  );
}

for (const row of screenshots) {
  if (
    row.forbiddenTextAbsent !== true ||
    !row.domCheckpoint ||
    !fs.existsSync(path.join(dir, row.file || ""))
  ) {
    fatal(
      "USER-FRONT-PAYMENTS-GATEWAY-TRUTH-SCREENSHOT-CHECKPOINT",
      path.join(dir, "screenshot-evidence.json"),
      "Screenshot is not bound to a DOM checkpoint or file is missing.",
      "capture screenshots only after DOM checkpoint passes and record the relative file path."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(
  `[user-front-payments-gateway-truth] evidence ok: ${path.relative(ROOT, dir)}`
);
