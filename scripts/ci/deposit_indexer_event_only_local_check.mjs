#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(ROOT, "docs/evidence/performance");

const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "api-evidence.json",
  "db-evidence.json",
  "dom-evidence.json",
  "log-evidence.json",
  "screenshot-evidence.json",
  "rpc-cu-comparison.json",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.DEPOSIT_INDEXER_EVENT_ONLY_EVIDENCE_DIR) {
    return path.resolve(process.env.DEPOSIT_INDEXER_EVENT_ONLY_EVIDENCE_DIR);
  }
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return (
    fs
      .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.includes("local-deposit-indexer-event-only")
      )
      .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
      .filter((candidate) => fs.existsSync(path.join(candidate, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-001",
    "",
    "deposit-indexer event-only evidence bundle is missing.",
    "run npm run e2e:deposit-indexer-event-only:local first."
  );
}

if (!process.exitCode) {
  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(dir, file))) {
      fatal(
        "DEPOSIT-INDEXER-EVENT-ONLY-002",
        path.join(dir, file),
        "evidence bundle is incomplete.",
        "rerun the event-only local evidence generator."
      );
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const db = readJson(path.join(dir, "db-evidence.json"));
const dom = readJson(path.join(dir, "dom-evidence.json"));
const api = readJson(path.join(dir, "api-evidence.json"));
const logs = readJson(path.join(dir, "log-evidence.json"));
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
const rpc = readJson(path.join(dir, "rpc-cu-comparison.json"));
const traceText = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-003",
    path.join(dir, "report.json"),
    `report status is ${report.status}; failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "fix the failing event-only or DOM/DB check and regenerate the evidence bundle."
  );
}

if (
  crypto.createHash("sha256").update(traceText).digest("hex") !==
  report.traceDigest
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-004",
    path.join(dir, "trace.jsonl"),
    "trace digest does not match report.json.",
    "rerun the event-only evidence generator; do not hand-edit report.json or trace.jsonl."
  );
}

const checkMap = new Map((report.checks || []).map((row) => [row.name, row]));
for (const name of [
  "preflight:local",
  "event-trigger:no-scheduler-preflight",
  "event-trigger-no-scheduler-confirmation",
  "alchemy-webhook:preflight",
  "alchemy-webhook:pending-before-replay",
  "alchemy-webhook:invalid-signature",
  "alchemy-webhook-signed-replay",
  "alchemy-webhook:duplicate-safe",
  "alchemy-webhook:unknown-intent-no-credit",
  "alchemy-webhook:db-dom-consistent",
  "event-only:uses-getLogs",
  "chunking:evidence-present",
  "finality-buffer:evidence-present",
  "deposit:single-business-row",
  "deposit:event-key-dedup",
  "payments:db-dom-consistent",
]) {
  if (checkMap.get(name)?.ok !== true) {
    fatal(
      "DEPOSIT-INDEXER-EVENT-ONLY-005",
      path.join(dir, "report.json"),
      `required check missing or failed: ${name}`,
      "fix the failing event-only checkpoint and rerun the local lane."
    );
  }
}

if (
  !Array.isArray(db.depositRows) ||
  db.depositRows.length !== 1 ||
  String(db.depositRows[0]?.status || "").toUpperCase() !== "CONFIRMED"
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-006",
    path.join(dir, "db-evidence.json"),
    "depositRows must contain exactly one confirmed business row.",
    "make the event-only lane persist a single confirmed deposit row snapshot."
  );
}

const webhookDb = db.alchemyWebhook || {};
if (
  !Array.isArray(webhookDb.confirmedRows) ||
  webhookDb.confirmedRows.length !== 1 ||
  String(webhookDb.confirmedRows[0]?.status || "").toUpperCase() !== "CONFIRMED"
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-006A",
    path.join(dir, "db-evidence.json"),
    "alchemy webhook confirmedRows must contain exactly one confirmed business row.",
    "persist the signed webhook replay DB snapshot after confirmation."
  );
}

if (
  !Array.isArray(api) ||
  !api.some(
    (entry) =>
      entry.pathname === "/internal/webhooks/alchemy/deposits" &&
      entry.httpStatus === 200
  ) ||
  !api.some(
    (entry) =>
      entry.pathname === "/internal/webhooks/alchemy/deposits" &&
      entry.httpStatus === 401
  )
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-006B",
    path.join(dir, "api-evidence.json"),
    "alchemy webhook API evidence must include both 200 and 401 callback attempts.",
    "record invalid-signature and successful signed replay calls in api-evidence.json."
  );
}

if (!Array.isArray(db.processedEventKeys) || db.processedEventKeys.length < 1) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-007",
    path.join(dir, "db-evidence.json"),
    "processed deposit event key evidence is missing.",
    "record processed_deposit_event_keys after the worker tick."
  );
}

const chunking = db.chunkingEvidence || {};
if (
  Number(chunking.maxLogBlockRange || 0) !== 2000 ||
  !Array.isArray(chunking.plannedChunks) ||
  chunking.plannedChunks.length < 2 ||
  Number(chunking.rpcMethodCounts?.eth_getLogs || 0) < 2 ||
  Number(chunking.rpcMethodCounts?.eth_getBlockByNumber || 0) !== 0
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-008",
    path.join(dir, "db-evidence.json"),
    "chunking or event-only RPC method evidence is incomplete.",
    "ensure the event-only worker tick is captured through an RPC proxy and emits multiple getLogs chunks without block scans."
  );
}

const finality = db.finalityEvidence || {};
if (
  finality.mode !== "confirmations" ||
  Number(finality.bufferBlocks || 0) < 1 ||
  Number(finality.lastScannedBlock || 0) > Number(finality.confirmedHead || 0)
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-009",
    path.join(dir, "db-evidence.json"),
    "finality buffer evidence is incomplete or lastScannedBlock advanced past confirmedHead.",
    "record confirmedHead and lastScannedBlock from runtime state under the configured finality buffer."
  );
}

if (
  !dom?.payments ||
  !Array.isArray(dom.payments.rows) ||
  dom.payments.rows.length < 1 ||
  typeof dom.payments.topRow !== "string" ||
  dom.payments.noDuplicateTxHash !== true
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-010",
    path.join(dir, "dom-evidence.json"),
    "payments DOM evidence is incomplete or duplicate protection failed.",
    "capture Payments history DOM evidence from user-front and persist row text plus duplicate guard."
  );
}

if (
  !dom?.alchemyWebhook?.payments ||
  dom.alchemyWebhook.payments.noDuplicateTxHash !== true
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-010A",
    path.join(dir, "dom-evidence.json"),
    "alchemy webhook DOM evidence is incomplete or duplicate protection failed.",
    "capture a dedicated Billing/Payments screenshot after signed webhook confirmation."
  );
}

const paymentsShot = Array.isArray(screenshots)
  ? screenshots.find((row) => row.file === "screenshots/payments-history.png")
  : null;
if (!paymentsShot || paymentsShot.forbiddenTextAbsent !== true) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-011",
    path.join(dir, "screenshot-evidence.json"),
    "payments screenshot evidence is missing or not DOM-verified.",
    "capture payments-history.png only after the DOM checkpoint passes."
  );
}

const webhookShot = Array.isArray(screenshots)
  ? screenshots.find((row) => row.file === "screenshots/payments-history-webhook.png")
  : null;
if (!webhookShot || webhookShot.forbiddenTextAbsent !== true) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-011A",
    path.join(dir, "screenshot-evidence.json"),
    "signed webhook payments screenshot evidence is missing or not DOM-verified.",
    "capture payments-history-webhook.png only after the signed webhook DOM checkpoint passes."
  );
}

if (!Array.isArray(logs?.webhookSignals) || logs.webhookSignals.length < 1) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-011B",
    path.join(dir, "log-evidence.json"),
    "alchemy webhook log evidence is missing.",
    "persist the recent gateway log lines that show webhook or trigger activity."
  );
}

if (
  rpc?.before?.rpcRequestsPerTick !== 202 ||
  rpc?.after?.rpcRequestsPerTick !== 3 ||
  rpc?.delta?.rpcRequestsReductionPct !== -98.52 ||
  rpc?.delta?.cuReductionPct !== -98.35 ||
  !(rpc.after.cuPerMonth < rpc.before.cuPerMonth)
) {
  fatal(
    "DEPOSIT-INDEXER-EVENT-ONLY-012",
    path.join(dir, "rpc-cu-comparison.json"),
    "RPC/CU comparison evidence does not match the expected baseline reduction.",
    "write the confirmed before/after baseline and reduction summary into rpc-cu-comparison.json."
  );
}

console.log(
  `[deposit-indexer-event-only-local] passed: ${path.join(dir, "report.json")}`
);
