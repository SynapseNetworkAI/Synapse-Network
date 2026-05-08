#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE = path.join(ROOT, "output/dogfood/withdrawal-reviews-cleanup");

function fatal(code, message, fix) {
  console.error(`FATAL ${code}: ${message}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestDir() {
  if (process.env.WITHDRAWAL_REVIEWS_CLEANUP_EVIDENCE_DIR) {
    return path.resolve(process.env.WITHDRAWAL_REVIEWS_CLEANUP_EVIDENCE_DIR);
  }
  if (!fs.existsSync(BASE)) return "";
  return (
    fs
      .readdirSync(BASE)
      .map((entry) => path.join(BASE, entry))
      .filter((entry) => fs.existsSync(path.join(entry, "report.json")))
      .sort(
        (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs
      )[0] || ""
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const dir = latestDir();
if (!dir) {
  fatal(
    "WITHDRAWAL-REVIEWS-CLEANUP-001",
    "No cleanup evidence directory found.",
    "Run npm run e2e:withdrawal-reviews-cleanup:local first."
  );
}

if (!process.exitCode) {
  for (const file of [
    "report.json",
    "report.md",
    "db-evidence.json",
    "api-evidence.json",
    "dom-evidence.json",
    "trace.jsonl",
    "bugfix-log.md",
  ]) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      fatal(
        "WITHDRAWAL-REVIEWS-CLEANUP-002",
        `Missing evidence file ${file}`,
        "Rerun the local cleanup lane and keep the emitted evidence intact."
      );
    }
  }
}

if (!process.exitCode) {
  const report = readJson(path.join(dir, "report.json"));
  const db = readJson(path.join(dir, "db-evidence.json"));
  const api = readJson(path.join(dir, "api-evidence.json"));
  const dom = readJson(path.join(dir, "dom-evidence.json"));
  const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");

  if (report.status !== "success" || (report.failed || []).length !== 0) {
    fatal(
      "WITHDRAWAL-REVIEWS-CLEANUP-003",
      `Report failed: ${JSON.stringify(report.failed || []).slice(0, 600)}`,
      "Fix the cleanup lane failure and rerun the E2E."
    );
  }

  if (/open bug/i.test(bugfixLog) && !/no open bugs\./i.test(bugfixLog)) {
    fatal(
      "WITHDRAWAL-REVIEWS-CLEANUP-004",
      "bugfix-log.md still reports an open bug.",
      "Close the bug or document a real no-open-bugs result before rerunning."
    );
  }

  const beforeRows = db.before?.rows || [];
  const afterRows = db.after?.rows || [];
  if (!beforeRows.length || !afterRows.length) {
    fatal(
      "WITHDRAWAL-REVIEWS-CLEANUP-005",
      "before/after DB evidence rows are missing.",
      "Ensure the cleanup lane seeded E2E manual-review rows and persisted DB evidence."
    );
  }

  for (const row of afterRows) {
    if (String(row.status || "").toUpperCase() !== "FAILED_EXPIRED") {
      fatal(
        "WITHDRAWAL-REVIEWS-CLEANUP-006",
        `Row ${row.withdrawal_id} ended in ${row.status}, not FAILED_EXPIRED.`,
        "Reuse the real manual-review expiry path and rerun the cleanup lane."
      );
    }
  }

  if ((api.after || []).length !== 0) {
    fatal(
      "WITHDRAWAL-REVIEWS-CLEANUP-007",
      `Marked rows still appear in the admin queue: ${api.after
        .map((row) => row.withdrawalId)
        .join(", ")}`,
      "Verify the queue API filters out FAILED_EXPIRED rows and rerun."
    );
  }

  if (!dom.after?.hasEmptyState) {
    fatal(
      "WITHDRAWAL-REVIEWS-CLEANUP-008",
      "DOM evidence does not show the empty-state after cleanup.",
      "Open /withdrawal-reviews?q=admin_sort_e2e_ after cleanup and capture the resulting empty state."
    );
  }

  const beforeNonTarget = JSON.stringify(db.before?.nonTargetPending || []);
  const afterNonTarget = JSON.stringify(db.after?.nonTargetPending || []);
  if (beforeNonTarget !== afterNonTarget) {
    fatal(
      "WITHDRAWAL-REVIEWS-CLEANUP-009",
      "Non-E2E pending manual review rows changed during cleanup.",
      "Restrict cleanup selection to the known E2E markers only."
    );
  }

  const auditRows = db.after?.audits || [];
  const afterIds = new Set(afterRows.map((row) => row.withdrawal_id));
  const auditedIds = new Set(
    auditRows
      .map((row) => row.detail_json?.refundId || row.detail_json?.withdrawalId)
      .filter(Boolean)
  );
  for (const id of afterIds) {
    if (!auditedIds.has(id)) {
      fatal(
        "WITHDRAWAL-REVIEWS-CLEANUP-010",
        `Missing audit evidence for ${id}.`,
        "Reuse the expiry service instead of hard-updating statuses."
      );
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`[withdrawal-reviews-cleanup-evidence] passed: ${dir}`);
