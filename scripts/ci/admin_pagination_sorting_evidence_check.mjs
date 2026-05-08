#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BASE = path.join(ROOT, "output/e2e/admin-pagination-sorting");
const MAX_AGE_MS = 96 * 60 * 60 * 1000;
const REQUIRED_SCREENSHOTS = [
  "withdrawal-reviews-created-desc",
  "provider-services-created-desc",
  "forum-topics-created-desc",
  "forum-response-tasks-created-desc",
];

function fatal(code, message, fix) {
  console.error(`FATAL ${code}: ${message}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestDir() {
  if (process.env.ADMIN_PAGINATION_SORTING_EVIDENCE_DIR)
    return path.resolve(process.env.ADMIN_PAGINATION_SORTING_EVIDENCE_DIR);
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
    "ADMIN-PAGINATION-SORTING-001",
    "No evidence directory found.",
    "Run npm run e2e:admin-pagination-sorting first."
  );
}

if (!process.exitCode) {
  for (const file of [
    "report.json",
    "report.md",
    "api-evidence.json",
    "sql-evidence.json",
    "screenshot-evidence.json",
  ]) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      fatal(
        "ADMIN-PAGINATION-SORTING-002",
        `Missing evidence file ${filePath}`,
        "Rerun the E2E; do not hand-build partial evidence."
      );
    }
  }
}

if (!process.exitCode) {
  const report = readJson(path.join(dir, "report.json"));
  const screenshotEvidence = readJson(
    path.join(dir, "screenshot-evidence.json")
  );
  const apiEvidence = readJson(path.join(dir, "api-evidence.json"));
  const sqlEvidence = readJson(path.join(dir, "sql-evidence.json"));
  if (report.status !== "success" || report.failed?.length) {
    fatal(
      "ADMIN-PAGINATION-SORTING-003",
      `Report did not pass: ${JSON.stringify(report.failed || []).slice(
        0,
        600
      )}`,
      "Fix the failed API/DOM/SQL check and rerun."
    );
  }
  if (
    !report.generatedAt ||
    Date.now() - Date.parse(report.generatedAt) > MAX_AGE_MS
  ) {
    fatal(
      "ADMIN-PAGINATION-SORTING-004",
      "Evidence is missing generatedAt or older than 96 hours.",
      "Rerun npm run e2e:admin-pagination-sorting."
    );
  }
  if (
    report.createdAtIndexGuard !== true ||
    !Array.isArray(sqlEvidence.createdAtIndexes) ||
    sqlEvidence.createdAtIndexes.length < 4
  ) {
    fatal(
      "ADMIN-PAGINATION-SORTING-005",
      "created_at index guard or SQL index evidence is incomplete.",
      "Run npm run ci:created-at-indexes and rerun the E2E after local migrations."
    );
  }
  for (const name of REQUIRED_SCREENSHOTS) {
    const shot = (screenshotEvidence.screenshots || []).find(
      (item) => item.name === name
    );
    if (
      !shot ||
      !fs.existsSync(shot.path) ||
      fs.statSync(shot.path).size === 0
    ) {
      fatal(
        "ADMIN-PAGINATION-SORTING-006",
        `Missing screenshot evidence ${name}`,
        "Rerun the E2E and verify the screenshot path is captured in screenshot-evidence.json."
      );
    }
  }
  for (const key of ["withdrawals", "services", "forumTopics", "forumTasks"]) {
    if (!Array.isArray(sqlEvidence[key]) || sqlEvidence[key].length < 3) {
      fatal(
        "ADMIN-PAGINATION-SORTING-007",
        `SQL evidence missing ${key}`,
        "Rerun the E2E after seed data is written successfully."
      );
    }
  }
  if (
    !Array.isArray(apiEvidence.withdrawals) ||
    apiEvidence.withdrawals.some((row) => !row.reviewExpiresAt)
  ) {
    fatal(
      "ADMIN-PAGINATION-SORTING-008",
      "API evidence is missing reviewExpiresAt for withdrawal reviews.",
      "Return reviewExpiresAt from gateway-admin and rerun the E2E."
    );
  }
  if (sqlEvidence.withdrawals.some((row) => !row.reviewExpiresAt)) {
    fatal(
      "ADMIN-PAGINATION-SORTING-009",
      "SQL evidence is missing reviewExpiresAt for seeded withdrawal reviews.",
      "Capture review expiration timestamps in SQL evidence and rerun the E2E."
    );
  }
  if (!screenshotEvidence.domEvidence?.withdrawals?.reviewExpiresAtText) {
    fatal(
      "ADMIN-PAGINATION-SORTING-010",
      "DOM evidence is missing the review expiration column text.",
      "Verify the withdrawal-reviews table renders 审批过期时间 and rerun the E2E."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`[admin-pagination-sorting-evidence] passed: ${dir}`);
