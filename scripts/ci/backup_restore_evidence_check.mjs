#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const evidenceRoot = path.join(root, "docs/evidence/recovery");
const requiredFiles = [
  "backup-manifest.json",
  "environment-manifest.json",
  "reconciliation-summary.json",
  "restore-validation.json",
];

function fail(message, fix) {
  console.error(`FATAL BACKUP-RESTORE-EVIDENCE-001: ${message}`);
  if (fix) console.error(`Agent fix: ${fix}`);
  process.exit(1);
}

function latestEvidenceDir() {
  if (process.env.SYNAPSE_BACKUP_RESTORE_EVIDENCE_DIR) {
    return path.resolve(process.env.SYNAPSE_BACKUP_RESTORE_EVIDENCE_DIR);
  }
  if (!fs.existsSync(evidenceRoot)) {
    fail("recovery evidence directory does not exist", "Run npm run drill:backup-restore:staging and commit the generated evidence path.");
  }
  const dirs = fs
    .readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("-backup-restore-drill"))
    .map((entry) => path.join(evidenceRoot, entry.name))
    .sort();
  if (dirs.length === 0) {
    fail("no backup restore evidence bundle found", "Run npm run drill:backup-restore:staging and rerun this evidence check.");
  }
  return dirs.at(-1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${filePath} is not valid JSON: ${error.message}`, "Regenerate the backup restore evidence instead of hand-editing JSON.");
  }
}

function stableDigest(dir) {
  const hash = crypto.createHash("sha256");
  for (const fileName of requiredFiles.toSorted()) {
    const parsed = readJson(path.join(dir, fileName));
    hash.update(fileName);
    hash.update(JSON.stringify(parsed));
  }
  return hash.digest("hex");
}

const dir = latestEvidenceDir();
for (const fileName of [...requiredFiles, "report.json", "report.md"]) {
  if (!fs.existsSync(path.join(dir, fileName))) {
    fail(`missing ${fileName} in ${dir}`, "Regenerate the full backup restore evidence bundle.");
  }
}

const report = readJson(path.join(dir, "report.json"));
if (report.status !== "success") {
  fail(`report status is ${report.status}`, "Fix the failed restore drill and regenerate report.json with status=success.");
}
if (Array.isArray(report.failed) && report.failed.length > 0) {
  fail(`report contains failed checks: ${report.failed.join(", ")}`, "Resolve every failed restore validation before using this evidence.");
}

const generatedAt = Date.parse(report.generatedAt || "");
if (!Number.isFinite(generatedAt)) {
  fail("report.generatedAt is missing or invalid", "Write an ISO generatedAt timestamp into report.json.");
}
const maxAgeHours = Number(process.env.SYNAPSE_BACKUP_RESTORE_MAX_AGE_HOURS || "72");
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (ageHours < -0.1 || ageHours > maxAgeHours) {
  fail(`backup restore evidence is stale (${ageHours.toFixed(2)}h old, max ${maxAgeHours}h)`, "Rerun npm run drill:backup-restore:staging to produce fresh evidence.");
}

const digest = stableDigest(dir);
if (report.evidenceDigest !== digest) {
  fail("evidenceDigest does not match core evidence JSON files", "Regenerate the report with scripts/drills/backup_restore_report.mjs; do not hand-edit evidence.");
}

const reconciliation = readJson(path.join(dir, "reconciliation-summary.json"));
const delta = reconciliation?.postgresLedgerVault?.unexplainedDeltaUsdc;
if (delta !== "0.000000") {
  fail(`Postgres ledger/vault unexplained delta is ${delta}`, "Fix restore reconciliation; clean evidence requires 0.000000 unexplained delta.");
}

const validation = readJson(path.join(dir, "restore-validation.json"));
if (validation?.postgres?.status !== "success") {
  fail(`Postgres restore status is ${validation?.postgres?.status || "missing"}`, "Run the Postgres restore validation against an isolated restored database.");
}
const rowCounts = validation?.postgres?.rowCounts || {};
for (const tableName of [
  "synapse_ledger_entries",
  "synapse_vault_withdrawals",
  "synapse_vault_deposits",
  "synapse_deposit_attempts",
]) {
  if (!Number.isFinite(Number(rowCounts[tableName]))) {
    fail(`missing restored row count for ${tableName}`, "Regenerate restore-validation.json from scripts/drills/postgres_restore_validate.sh.");
  }
}

console.log(`[ci:backup-restore-evidence] validated ${dir}`);
