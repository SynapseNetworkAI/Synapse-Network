#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(
  ROOT,
  "output/dogfood/deposit-indexer-recovery"
);
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-evidence.json",
  "db-evidence.json",
  "chain-evidence.json",
  "screenshot-evidence.json",
];
const REQUIRED_STEPS = [
  "preflight:local-api-db-chain-ui",
  "task_down_pending_ui",
  "restart_auto_credit",
  "replay_safe",
  "missed_intent_backfill",
  "invalid_event_no_credit",
];
const REQUIRED_SCREENSHOTS = [
  "screenshots/billing-pending-before-indexer.png",
  "screenshots/credits-pending-before-indexer.png",
  "screenshots/billing-completed-after-indexer.png",
  "screenshots/credits-available-after-indexer.png",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.DEPOSIT_INDEXER_RECOVERY_EVIDENCE_DIR) {
    return path.resolve(process.env.DEPOSIT_INDEXER_RECOVERY_EVIDENCE_DIR);
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

function decimalToAtomic(value, decimals = 6) {
  const normalized = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0").slice(0, decimals))
  );
}

function addMoney(value, delta) {
  return decimalToAtomic(value) + decimalToAtomic(delta);
}

function atomicToDecimal(value, decimals = 6) {
  const atomic = BigInt(value || 0);
  const scale = 10n ** BigInt(decimals);
  return `${atomic / scale}.${String(atomic % scale).padStart(decimals, "0")}`;
}

function requireFile(dir, file) {
  if (!fs.existsSync(path.join(dir, file))) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-FILE",
      path.join(dir, file),
      "Evidence bundle is incomplete.",
      "rerun npm run e2e:deposit-indexer-recovery:local."
    );
  }
}

function requireStep(report, stepName, dir) {
  const row = (report.steps || []).find((step) => step.name === stepName);
  if (row?.ok !== true) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-STEP",
      path.join(dir, "report.json"),
      `Required step missing or failed: ${stepName}`,
      "fix the scenario and rerun the E2E."
    );
  }
}

function requireScreenshot(report, dir, screenshot) {
  if (
    !report.screenshots?.includes(screenshot) ||
    !fs.existsSync(path.join(dir, screenshot))
  ) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-SCREENSHOT",
      path.join(dir, screenshot),
      `Required screenshot missing: ${screenshot}`,
      "rerun the browser phase; screenshots must be DOM/API/DB-bound."
    );
  }
}

function requireDigest(report, dir) {
  const trace = fs.readFileSync(path.join(dir, "trace.jsonl"));
  const digest = crypto.createHash("sha256").update(trace).digest("hex");
  if (digest !== report.traceDigest) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-DIGEST",
      path.join(dir, "trace.jsonl"),
      "Trace digest does not match report.json.",
      "rerun the E2E; do not edit evidence by hand."
    );
  }
}

function requireReportClean(report, dir) {
  if (
    report.environment !== "local" ||
    report.status !== "success" ||
    (report.failed || []).length > 0
  ) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-STATUS",
      path.join(dir, "report.json"),
      `Evidence failed: env=${report.environment} status=${report.status}`,
      "rerun against local services until all failures are fixed."
    );
  }
}

function requireScreenshotMetadata(screenshots, dir) {
  const byPath = new Map((screenshots || []).map((item) => [item.path, item]));
  const pending = byPath.get("screenshots/billing-pending-before-indexer.png");
  const completed = byPath.get(
    "screenshots/billing-completed-after-indexer.png"
  );
  if (pending?.sqlStatus !== "PENDING_CONFIRMATION") {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-PENDING-SHOT",
      path.join(dir, "screenshot-evidence.json"),
      "Pending screenshot is not bound to PENDING_CONFIRMATION.",
      "bind screenshot metadata to SQL status."
    );
  }
  if (completed?.sqlStatus !== "CONFIRMED") {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-COMPLETED-SHOT",
      path.join(dir, "screenshot-evidence.json"),
      "Completed screenshot is not bound to CONFIRMED.",
      "bind screenshot metadata to SQL status."
    );
  }
  for (const row of screenshots || []) {
    if (row.forbiddenTextAbsent !== true) {
      fatal(
        "DEPOSIT-INDEXER-RECOVERY-SCREENSHOT-MASK",
        path.join(dir, "screenshot-evidence.json"),
        `Screenshot ${row.path} lacks forbiddenTextAbsent=true.`,
        "reject AuthMask/loading/error screenshots."
      );
    }
  }
}

function requireTaskDown(db, amount, dir) {
  const before = db.taskDown?.beforeBalance || {};
  const pending = db.taskDown?.pendingBalance || {};
  const deposit = db.taskDown?.deposits?.[0] || {};
  if (deposit.status !== "PENDING_CONFIRMATION") {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-PENDING-DB",
      path.join(dir, "db-evidence.json"),
      `Task-down deposit status is ${deposit.status}`,
      "capture the pre-indexer pending state."
    );
  }
  if (
    decimalToAtomic(pending.available_balance) !==
    decimalToAtomic(before.available_balance)
  ) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-PENDING-AVAILABLE",
      path.join(dir, "db-evidence.json"),
      "Available balance changed while indexer was disabled.",
      "deposit intent must reserve pending only."
    );
  }
  if (
    decimalToAtomic(pending.pending_balance) !==
    addMoney(before.pending_balance, amount)
  ) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-PENDING-BUCKET",
      path.join(dir, "db-evidence.json"),
      "Pending balance did not increase by the deposit amount.",
      "fix deposit intent pending bucket movement."
    );
  }
}

function dbEvidencePath(dir) {
  return path.join(dir, "db-evidence.json");
}

function requireStatus({ actual, expected, code, dir, message, fix }) {
  if (actual !== expected) {
    fatal(code, dbEvidencePath(dir), message(actual), fix);
  }
}

function requireMoneyEqual({ actual, expected, code, dir, message, fix }) {
  if (decimalToAtomic(actual) !== decimalToAtomic(expected)) {
    fatal(code, dbEvidencePath(dir), message, fix);
  }
}

function requireAuditRows(db, dir) {
  const rows = db.autoCredit?.auditRows;
  if (!Array.isArray(rows) || rows.length === 0) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-AUDIT",
      dbEvidencePath(dir),
      "Missing CONSUMER_DEPOSIT_CONFIRMED audit evidence.",
      "ensure atomic confirm writes audit evidence."
    );
  }
}

function requireFinalCredit(db, amount, dir) {
  const before = db.taskDown?.beforeBalance || {};
  const final = db.autoCredit?.balance || {};
  const deposit = db.autoCredit?.deposits?.[0] || {};
  requireStatus({
    actual: deposit.status,
    expected: "CONFIRMED",
    code: "DEPOSIT-INDEXER-RECOVERY-FINAL-DB",
    dir,
    message: (status) => `Auto-credit status is ${status}`,
    fix: "indexer recovery must confirm the deposit.",
  });
  requireMoneyEqual({
    actual: final.available_balance,
    expected: atomicToDecimal(addMoney(before.available_balance, amount)),
    code: "DEPOSIT-INDEXER-RECOVERY-FINAL-AVAILABLE",
    dir,
    message:
      "Available balance did not increase by exactly the deposit amount.",
    fix: "fix indexer pending->available movement.",
  });
  requireMoneyEqual({
    actual: final.pending_balance,
    expected: before.pending_balance,
    code: "DEPOSIT-INDEXER-RECOVERY-FINAL-PENDING",
    dir,
    message: "Pending balance did not return to its original value.",
    fix: "fix indexer pending bucket release.",
  });
  requireAuditRows(db, dir);
}

function requireReplaySafe(db, dir) {
  const final = db.autoCredit?.balance || {};
  const replay = db.replay?.balance || {};
  if (
    decimalToAtomic(replay.available_balance) !==
    decimalToAtomic(final.available_balance)
  ) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-REPLAY-AVAILABLE",
      path.join(dir, "db-evidence.json"),
      "Replay changed available balance.",
      "make deposit event processing idempotent."
    );
  }
  if (
    decimalToAtomic(replay.pending_balance) !==
    decimalToAtomic(final.pending_balance)
  ) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-REPLAY-PENDING",
      path.join(dir, "db-evidence.json"),
      "Replay changed pending balance.",
      "make deposit event processing idempotent."
    );
  }
}

function requireBackfill(db, amount, dir) {
  const before = db.backfill?.beforeBalance || {};
  const final = db.backfill?.finalBalance || {};
  const deposit = db.backfill?.deposits?.[0] || {};
  if (deposit.status !== "CONFIRMED") {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-BACKFILL",
      path.join(dir, "db-evidence.json"),
      `Backfill status is ${deposit.status}`,
      "backfill must create and confirm the recovery intent."
    );
  }
  if (
    decimalToAtomic(final.available_balance) !==
    addMoney(before.available_balance, amount)
  ) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-BACKFILL-BALANCE",
      path.join(dir, "db-evidence.json"),
      "Backfill did not credit the available balance exactly once.",
      "fix recovery intent registration/confirmation."
    );
  }
}

function requireInvalidNoCredit(db, dir) {
  const before = db.invalidEvent?.beforeBalance || {};
  const after = db.invalidEvent?.afterBalance || {};
  const deposit = db.invalidEvent?.deposits?.[0] || {};
  if (deposit.status !== "FAILED") {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-INVALID-STATUS",
      path.join(dir, "db-evidence.json"),
      `Invalid event status is ${deposit.status}`,
      "invalid tx should fail or remain non-confirmed, never credit."
    );
  }
  if (
    decimalToAtomic(after.available_balance) !==
    decimalToAtomic(before.available_balance)
  ) {
    fatal(
      "DEPOSIT-INDEXER-RECOVERY-INVALID-CREDIT",
      path.join(dir, "db-evidence.json"),
      "Invalid event changed available balance.",
      "do not force-credit without a matching current contract event."
    );
  }
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "DEPOSIT-INDEXER-RECOVERY-MISSING",
    "",
    "Deposit indexer recovery evidence is missing.",
    "run npm run e2e:deposit-indexer-recovery:local."
  );
  process.exit(process.exitCode);
}

for (const file of REQUIRED_FILES) requireFile(dir, file);
if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const db = readJson(path.join(dir, "db-evidence.json"));
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
const bugfix = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");

requireReportClean(report, dir);
requireDigest(report, dir);
for (const stepName of REQUIRED_STEPS) requireStep(report, stepName, dir);
for (const screenshot of REQUIRED_SCREENSHOTS)
  requireScreenshot(report, dir, screenshot);
requireScreenshotMetadata(screenshots, dir);
requireTaskDown(db, report.depositUsdc, dir);
requireFinalCredit(db, report.depositUsdc, dir);
requireReplaySafe(db, dir);
requireBackfill(db, report.depositUsdc, dir);
requireInvalidNoCredit(db, dir);

if (!bugfix.includes("No bugs found")) {
  fatal(
    "DEPOSIT-INDEXER-RECOVERY-BUGFIX",
    path.join(dir, "bugfix-log.md"),
    "Bugfix log still has open failures.",
    "fix the bug and rerun the E2E."
  );
}
if (process.exitCode) process.exit(process.exitCode);
console.log(`[deposit-indexer-recovery-evidence] passed: ${dir}`);
