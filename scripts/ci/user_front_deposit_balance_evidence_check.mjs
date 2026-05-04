#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(
  ROOT,
  "output/dogfood/user-front-deposit-balance"
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
const REQUIRED_SCREENSHOTS = [
  "screenshots/billing-deposit-pending.png",
  "screenshots/credits-before-confirm.png",
  "screenshots/billing-deposit-completed.png",
  "screenshots/credits-after-confirm.png",
];
const REQUIRED_STEPS = [
  "preflight:local-api-db-chain-ui",
  "chain:deposit",
  "db:pending-deposit",
  "db:confirmed-deposit-and-replay-safe",
  "ui:screenshots-dom-sql-bound",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.USER_FRONT_DEPOSIT_BALANCE_EVIDENCE_DIR) {
    return path.resolve(process.env.USER_FRONT_DEPOSIT_BALANCE_EVIDENCE_DIR);
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

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-MISSING",
    "",
    "User-front deposit balance evidence is missing.",
    "run npm run e2e:user-front-deposit-balance and rerun this checker."
  );
}

if (!process.exitCode) {
  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(dir, file))) {
      fatal(
        "USER-FRONT-DEPOSIT-BALANCE-FILE",
        path.join(dir, file),
        "Evidence bundle is incomplete.",
        "rerun the deposit balance E2E; do not hand-assemble partial evidence."
      );
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const db = readJson(path.join(dir, "db-evidence.json"));
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
const trace = fs.readFileSync(path.join(dir, "trace.jsonl"));

if (report.environment !== "local") {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-ENV",
    path.join(dir, "report.json"),
    `Expected local evidence, got ${report.environment}`,
    "rerun the local-only E2E against localhost services."
  );
}
if (
  report.status !== "success" ||
  (Array.isArray(report.failed) && report.failed.length > 0)
) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-STATUS",
    path.join(dir, "report.json"),
    `Evidence did not pass: status=${report.status}, failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "fix the failing scenario and rerun npm run e2e:user-front-deposit-balance."
  );
}
if (
  crypto.createHash("sha256").update(trace).digest("hex") !== report.traceDigest
) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-DIGEST",
    path.join(dir, "trace.jsonl"),
    "trace digest does not match report.json.",
    "rerun the E2E; do not edit evidence by hand."
  );
}

const stepMap = new Map((report.steps || []).map((step) => [step.name, step]));
for (const step of REQUIRED_STEPS) {
  if (stepMap.get(step)?.ok !== true) {
    fatal(
      "USER-FRONT-DEPOSIT-BALANCE-STEP",
      path.join(dir, "report.json"),
      `Required step is missing or failed: ${step}`,
      "rerun the E2E and keep iterating until all required steps pass."
    );
  }
}

for (const screenshot of REQUIRED_SCREENSHOTS) {
  if (
    !report.screenshots?.includes(screenshot) ||
    !fs.existsSync(path.join(dir, screenshot))
  ) {
    fatal(
      "USER-FRONT-DEPOSIT-BALANCE-SCREENSHOT",
      path.join(dir, screenshot),
      `Required screenshot is missing: ${screenshot}`,
      "rerun the Playwright phase so DOM-bound screenshots are captured."
    );
  }
}

const screenshotMap = new Map(
  (screenshots || []).map((row) => [row.path, row])
);
if (
  screenshotMap.get("screenshots/billing-deposit-pending.png")?.sqlStatus !==
  "PENDING_CONFIRMATION"
) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-PENDING-SHOT",
    path.join(dir, "screenshot-evidence.json"),
    "Pending screenshot is not bound to SQL status PENDING_CONFIRMATION.",
    "bind every screenshot to the matching SQL status and DOM assertion."
  );
}
if (
  screenshotMap.get("screenshots/billing-deposit-completed.png")?.sqlStatus !==
  "CONFIRMED"
) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-COMPLETED-SHOT",
    path.join(dir, "screenshot-evidence.json"),
    "Completed screenshot is not bound to SQL status CONFIRMED.",
    "bind every screenshot to the matching SQL status and DOM assertion."
  );
}

const amount = String(report.depositUsdc || "");
const before = db.beforeBalance || {};
const pending = db.pending?.balance || {};
const final = db.final?.balance || {};
const replay = db.replay?.balance || {};
const pendingDeposit = db.pending?.deposits?.[0] || {};
const finalDeposit = db.final?.deposits?.[0] || {};

if (pendingDeposit.status !== "PENDING_CONFIRMATION") {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-PENDING-DB",
    path.join(dir, "db-evidence.json"),
    `Pending deposit status is ${pendingDeposit.status}`,
    "ensure the E2E captures the pre-confirm state before calling confirm."
  );
}
if (finalDeposit.status !== "CONFIRMED") {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-FINAL-DB",
    path.join(dir, "db-evidence.json"),
    `Final deposit status is ${finalDeposit.status}`,
    "ensure Gateway confirm advanced the deposit intent to CONFIRMED."
  );
}
if (
  decimalToAtomic(pending.available_balance) !==
  decimalToAtomic(before.available_balance)
) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-PENDING-AVAILABLE",
    path.join(dir, "db-evidence.json"),
    "Pending phase changed available_balance before Gateway confirmation.",
    "deposit intent must only add pending balance until confirm."
  );
}
if (
  decimalToAtomic(pending.pending_balance) !==
  addMoney(before.pending_balance, amount)
) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-PENDING-BUCKET",
    path.join(dir, "db-evidence.json"),
    "Pending balance did not increase by the deposit amount.",
    "fix deposit intent pending bucket movement and rerun."
  );
}
if (
  decimalToAtomic(final.available_balance) !==
  addMoney(before.available_balance, amount)
) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-FINAL-AVAILABLE",
    path.join(dir, "db-evidence.json"),
    "Final available_balance did not increase by exactly the deposit amount.",
    "fix confirm pending->available movement and rerun."
  );
}
if (
  decimalToAtomic(final.pending_balance) !==
  decimalToAtomic(before.pending_balance)
) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-FINAL-PENDING",
    path.join(dir, "db-evidence.json"),
    "Final pending_balance did not return to the pre-deposit value.",
    "fix confirm pending bucket release and rerun."
  );
}
if (
  decimalToAtomic(replay.available_balance) !==
    decimalToAtomic(final.available_balance) ||
  decimalToAtomic(replay.pending_balance) !==
    decimalToAtomic(final.pending_balance)
) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-REPLAY",
    path.join(dir, "db-evidence.json"),
    "Replay changed balance buckets after final confirmation.",
    "fix duplicate intent/confirm idempotency and rerun."
  );
}

if (!Array.isArray(db.final?.auditRows) || db.final.auditRows.length === 0) {
  fatal(
    "USER-FRONT-DEPOSIT-BALANCE-AUDIT",
    path.join(dir, "db-evidence.json"),
    "Final evidence lacks CONSUMER_DEPOSIT_CONFIRMED audit rows.",
    "ensure confirm writes audit evidence and rerun."
  );
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`[user-front-deposit-balance-evidence] passed: ${dir}`);
