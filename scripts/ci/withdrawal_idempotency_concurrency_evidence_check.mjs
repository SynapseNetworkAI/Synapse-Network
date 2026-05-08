#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const REQUIRED_SCENARIOS = [
  "consumer-create-concurrency",
  "provider-create-concurrency",
  "consumer-idempotency",
  "provider-idempotency",
  "consumer-approve-complete-concurrency",
  "provider-approve-complete-concurrency",
  "consumer-reject-concurrency",
  "provider-reject-concurrency",
  "consumer-cross-decision",
  "provider-cross-decision",
];

const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "db-evidence.json",
  "chain-evidence.json",
  "trace.jsonl",
  "bugfix-log.md",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestReportDir() {
  if (process.env.WITHDRAWAL_IDEMPOTENCY_CONCURRENCY_EVIDENCE_DIR) {
    return path.resolve(
      process.env.WITHDRAWAL_IDEMPOTENCY_CONCURRENCY_EVIDENCE_DIR
    );
  }
  const base = path.join(
    ROOT,
    "output/dogfood/withdrawal-idempotency-concurrency"
  );
  if (!fs.existsSync(base)) return "";
  return (
    fs
      .readdirSync(base)
      .map((name) => path.join(base, name))
      .filter((dir) => fs.existsSync(path.join(dir, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  }
  return value;
}

function sha256Json(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function hasSecretLeak(text) {
  const patterns = [
    ["JWT", /eyJ[A-Za-z0-9._~+/=-]{20,}/],
    ["AUTHORIZATION", /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i],
    [
      "SENSITIVE_FIELD_VALUE",
      /"(?:privateKey|private_key|signature|authorization|access_token|token|secret|password)"\s*:\s*"(?!\[REDACTED)[^"]+"/i,
    ],
  ];
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);
}

function requireDbEvidence(key) {
  const row = dbEvidence[key];
  if (!row) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-008",
      path.join(dir, "db-evidence.json"),
      `DB evidence is missing for ${key}.`,
      "Record canonical balance and withdrawal-row state for every concurrency scenario."
    );
  }
  return row || {};
}

function statusCode(payload) {
  return (
    payload?.detail?.code ||
    payload?.error?.code ||
    payload?.code ||
    payload?.differentTxCompleteCode ||
    ""
  );
}

function requireAllStatuses(key, values, expected) {
  if (
    !Array.isArray(values) ||
    values.length !== 10 ||
    values.some((value) => Number(value) !== expected)
  ) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-STATUS",
      path.join(dir, "db-evidence.json"),
      `${key} expected 10 HTTP ${expected} rows, got ${JSON.stringify(values)}`,
      "Rerun the full concurrency E2E and fix the non-idempotent API branch."
    );
  }
}

function requireZeroBuckets(key, balance) {
  for (const field of ["pending", "frozen"]) {
    if (
      String(balance?.[field]) !== "0.000000" &&
      String(balance?.[field]) !== "0"
    ) {
      fatal(
        "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-BALANCE",
        path.join(dir, "db-evidence.json"),
        `${key} expected ${field}=0 after terminal state, got ${JSON.stringify(
          balance
        )}`,
        "Fix the CAS balance movement so terminal replay does not leave locked funds."
      );
    }
  }
}

const dir = latestReportDir();
if (!dir) {
  fatal(
    "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-001",
    "",
    "No withdrawal idempotency concurrency evidence directory was found.",
    "Run npm run e2e:withdrawal-idempotency-concurrency before this evidence gate."
  );
}

if (process.exitCode) process.exit(process.exitCode);

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath)) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-002",
      filePath,
      `Required evidence artifact is missing: ${fileName}`,
      "Rerun the E2E; do not hand-assemble partial evidence."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const dbEvidence = readJson(path.join(dir, "db-evidence.json"));
const chainEvidence = readJson(path.join(dir, "chain-evidence.json"));
const traceText = fs.readFileSync(path.join(dir, "trace.jsonl"), "utf8");
const traceRows = traceText.trim()
  ? traceText
      .trim()
      .split("\n")
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          fatal(
            "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-003",
            path.join(dir, "trace.jsonl"),
            `trace.jsonl line ${index + 1} is not valid JSON.`,
            "Regenerate trace.jsonl from the E2E runner."
          );
          return {};
        }
      })
  : [];

if (
  report.status !== "success" ||
  !Array.isArray(report.failed) ||
  report.failed.length !== 0
) {
  fatal(
    "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-004",
    path.join(dir, "report.json"),
    `Report status is ${report.status}; failures=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "Fix the failing concurrency scenario, record bugfix evidence, then rerun the E2E."
  );
}

const scenarioResults = Array.isArray(report.scenarioResults)
  ? report.scenarioResults
  : [];
for (const scenarioName of REQUIRED_SCENARIOS) {
  const scenario = scenarioResults.find((item) => item.name === scenarioName);
  if (!scenario || scenario.pass !== true || scenario.status !== "passed") {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-005",
      path.join(dir, "report.json"),
      `Required scenario is missing or failed: ${scenarioName}`,
      "Rerun the full E2E, not a narrowed command."
    );
  }
  if (
    !traceRows.some(
      (row) =>
        String(row.scenario || "").includes(
          scenarioName.split("-").slice(0, 2).join("-")
        ) || String(row.scenario || "") === scenarioName
    )
  ) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-006",
      path.join(dir, "trace.jsonl"),
      `Trace evidence is missing for scenario family: ${scenarioName}`,
      "Ensure the E2E records HTTP trace rows for every scenario."
    );
  }
}

for (const key of [
  "consumerApproveCompleteConcurrency",
  "providerApproveCompleteConcurrency",
]) {
  const item = chainEvidence[key];
  if (
    !item?.txHash ||
    item.consumed !== true ||
    item.replay?.rejected !== true
  ) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-007",
      path.join(dir, "chain-evidence.json"),
      `Chain evidence is incomplete for ${key}.`,
      "The E2E must prove claim txHash, consumed ticket, and replay rejection."
    );
  }
}

for (const key of [
  "consumerCreateConcurrency",
  "providerCreateConcurrency",
  "consumerIdempotency",
  "providerIdempotency",
  "consumerRejectConcurrency",
  "providerRejectConcurrency",
  "consumerCrossDecisionConcurrency",
  "providerCrossDecisionConcurrency",
]) {
  requireDbEvidence(key);
}

for (const key of ["consumerCreateConcurrency", "providerCreateConcurrency"]) {
  const item = requireDbEvidence(key);
  requireAllStatuses(key, item.httpStatuses, 200);
  if (Array.isArray(item.httpStatuses)) {
    const okCount = item.httpStatuses.filter(
      (status) => Number(status) === 200
    ).length;
    if (okCount !== 10) {
      fatal(
        "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-CREATE",
        path.join(dir, "db-evidence.json"),
        `${key} expected stable create responses for every concurrent replay.`,
        "Create concurrency must return the same business result without repeated lock-up."
      );
    }
  }
  if (!item.row?.ticketHash || item.row?.signaturePresent !== true) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-TICKET",
      path.join(dir, "db-evidence.json"),
      `${key} missing single signed ticket evidence.`,
      "Create exactly one withdrawal row and one signed ticket under concurrent creation."
    );
  }
  if (String(item.balance?.pending) !== String(item.row?.amount)) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-BUCKET",
      path.join(dir, "db-evidence.json"),
      `${key} pending balance does not equal the single withdrawal amount.`,
      "Fix atomic lock-up so concurrent creates do not double-move funds."
    );
  }
}

for (const key of ["consumerIdempotency", "providerIdempotency"]) {
  const item = requireDbEvidence(key);
  if (item.firstId !== item.secondId || Number(item.mismatchStatus) !== 409) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-IDEMPOTENCY",
      path.join(dir, "db-evidence.json"),
      `${key} did not return stable same-key result and 409 on mismatched payload.`,
      "Creation endpoints must persist idempotency request hash and reject key reuse with different payload."
    );
  }
  if (!Array.isArray(item.rows) || item.rows.length !== 1) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-IDEMPOTENCY-ROWS",
      path.join(dir, "db-evidence.json"),
      `${key} expected exactly one withdrawal row, got ${JSON.stringify(
        item.rows
      )}`,
      "Do not create a second order for same idempotency key."
    );
  }
}

for (const [key, expectedCode] of [
  ["consumerApproveCompleteConcurrency", "REFUND_ALREADY_COMPLETED"],
  ["providerApproveCompleteConcurrency", "WITHDRAWAL_ALREADY_COMPLETED"],
]) {
  const item = requireDbEvidence(key);
  requireAllStatuses(key, item.completeStatuses, 200);
  requireZeroBuckets(key, item.afterComplete);
  if (
    String(item.row?.status || "").toUpperCase() !== "COMPLETED" ||
    !item.row?.txHash ||
    !item.row?.ticketHash
  ) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-COMPLETE",
      path.join(dir, "db-evidence.json"),
      `${key} missing completed row, txHash, or ticketHash evidence.`,
      "Complete must advance exactly once and preserve the claimed txHash/ticketHash."
    );
  }
  if (Number(item.completeIdempotentReplayCount) !== 9) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-REPLAY",
      path.join(dir, "db-evidence.json"),
      `${key} expected 9 idempotent same-tx complete replays, got ${item.completeIdempotentReplayCount}.`,
      "Same withdrawalId and same txHash should replay as the same completed result without moving funds again."
    );
  }
  if (
    Number(item.differentTxCompleteStatus) !== 409 ||
    statusCode(item) !== expectedCode
  ) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-DIFFERENT-TX",
      path.join(dir, "db-evidence.json"),
      `${key} expected different txHash replay 409 ${expectedCode}, got ${
        item.differentTxCompleteStatus
      } ${statusCode(item)}.`,
      "Reject different txHash complete attempts after a withdrawal is already finalized."
    );
  }
  if (
    Number(item.txDedup?.dedupeRowCount) !== 1 ||
    Number(item.txDedup?.distinctTxHashCount) !== 1
  ) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-TX-DEDUP",
      path.join(dir, "db-evidence.json"),
      `${key} expected exactly one tx dedupe row, got ${JSON.stringify(
        item.txDedup
      )}`,
      "Complete callback must be guarded by withdrawalId+kind+txHash dedupe."
    );
  }
}

for (const key of ["consumerRejectConcurrency", "providerRejectConcurrency"]) {
  const item = requireDbEvidence(key);
  if (String(item.row?.status || "").toUpperCase() !== "REJECTED") {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-REJECT",
      path.join(dir, "db-evidence.json"),
      `${key} expected REJECTED final state.`,
      "Concurrent reject must resolve to one legal terminal state."
    );
  }
  requireZeroBuckets(key, item.balance);
  if (item.row?.ticketHash || item.row?.signaturePresent) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-REJECT-TICKET",
      path.join(dir, "db-evidence.json"),
      `${key} rejected row must not contain a signed ticket.`,
      "Reject must release funds without issuing a claimable ticket."
    );
  }
}

const uniqueIndexRows = Array.isArray(dbEvidence.uniqueIndexes)
  ? dbEvidence.uniqueIndexes
  : [];
for (const [tableName, needle] of [
  ["synapse_vault_withdrawals", "ticket_hash"],
  ["synapse_withdraw_tx_dedup", "tx_hash"],
  ["synapse_idempotency_keys", "idempotency_key"],
]) {
  if (
    !uniqueIndexRows.some(
      (row) =>
        row.tableName === tableName &&
        String(row.indexDef || "")
          .toLowerCase()
          .includes(needle)
    )
  ) {
    fatal(
      "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-UNIQUE-INDEX",
      path.join(dir, "db-evidence.json"),
      `Missing unique/index evidence for ${tableName}.${needle}.`,
      "Record and enforce DB-level uniqueness for ticket, tx, and idempotency keys."
    );
  }
}

const expectedDigest = sha256Json({
  scriptVersion: report.scriptVersion,
  runId: report.runId,
  scenarioResults: report.scenarioResults,
  dbEvidence,
  chainEvidence,
  failed: report.failed,
});
if (!report.evidenceDigest || report.evidenceDigest !== expectedDigest) {
  fatal(
    "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-009",
    path.join(dir, "report.json"),
    "Evidence digest cannot be recomputed from report payload and evidence files.",
    "Do not hand-edit evidence; rerun the E2E."
  );
}

const combinedEvidence = REQUIRED_FILES.map((fileName) =>
  fs.readFileSync(path.join(dir, fileName), "utf8")
).join("\n");
const leaks = hasSecretLeak(combinedEvidence);
if (leaks.length > 0) {
  fatal(
    "WITHDRAWAL-IDEMPOTENCY-CONCURRENCY-SECRET",
    dir,
    `Evidence contains secret-like material: ${leaks.join(", ")}`,
    "Delete the evidence directory, fix redaction, rerun the E2E, and never commit leaked evidence."
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[withdrawal-idempotency-concurrency-evidence] passed: ${dir}`);
console.log(
  `[withdrawal-idempotency-concurrency-evidence] scenarios=${scenarioResults.length}`
);
