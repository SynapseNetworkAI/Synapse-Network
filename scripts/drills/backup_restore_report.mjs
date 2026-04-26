#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve(process.env.SYNAPSE_DRILL_OUT_DIR || "");
if (!outDir || !fs.existsSync(outDir)) {
  console.error("FATAL BACKUP-RESTORE-REPORT-001: SYNAPSE_DRILL_OUT_DIR must point to an evidence directory.");
  process.exit(1);
}

const coreFiles = [
  "backup-manifest.json",
  "environment-manifest.json",
  "reconciliation-summary.json",
  "restore-validation.json",
];

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(outDir, name), "utf8"));
}

function digest() {
  const hash = crypto.createHash("sha256");
  for (const name of coreFiles.toSorted()) {
    hash.update(name);
    hash.update(JSON.stringify(readJson(name)));
  }
  return hash.digest("hex");
}

for (const name of coreFiles) {
  if (!fs.existsSync(path.join(outDir, name))) {
    console.error(`FATAL BACKUP-RESTORE-REPORT-002: missing ${name}`);
    process.exit(1);
  }
}

const environment = readJson("environment-manifest.json");
const backup = readJson("backup-manifest.json");
const restore = readJson("restore-validation.json");
const reconciliation = readJson("reconciliation-summary.json");

const failed = [];
if (reconciliation?.postgresLedgerVault?.unexplainedDeltaUsdc !== "0.000000") {
  failed.push("postgres_ledger_vault_delta");
}
if (restore?.postgres?.status !== "success") {
  failed.push("postgres_restore_validation");
}

const report = {
  status: failed.length === 0 ? "success" : "failed",
  failed,
  generatedAt: new Date().toISOString(),
  environment: environment.environment,
  gitCommit: environment.gitCommit,
  backupStartedAt: backup.backupStartedAt,
  restoreFinishedAt: new Date().toISOString(),
  evidenceDigest: digest(),
};

fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(
  path.join(outDir, "report.md"),
  [
    "# Backup Restore Drill Report",
    "",
    `- Status: \`${report.status}\``,
    `- Environment: \`${report.environment}\``,
    `- Git commit: \`${report.gitCommit}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Evidence digest: \`${report.evidenceDigest}\``,
    "",
    "## Checks",
    "",
    `- Postgres restore status: \`${restore?.postgres?.status || "missing"}\``,
    `- Postgres unexplained delta: \`${reconciliation?.postgresLedgerVault?.unexplainedDeltaUsdc}\``,
    "- ClickHouse/Kafka restore: `not required for MVP Postgres-only staging`",
  ].join("\n") + "\n",
);

console.log(`[drill:backup-restore] wrote ${path.join(outDir, "report.json")}`);
