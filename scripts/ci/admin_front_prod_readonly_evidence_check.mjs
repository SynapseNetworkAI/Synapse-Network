#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_ROOT = path.join(ROOT, "output/dogfood/admin-front-prod-readonly");
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "route_results.json",
  "api_results.json",
  "console_results.json",
  "log_results.json",
];

function fatal(code, message, fix) {
  console.error(`FATAL ${code}: ${message}`);
  console.error(`Agent fix: ${fix}`);
  process.exit(1);
}

function latestDir() {
  if (process.env.ADMIN_PROD_READONLY_EVIDENCE_DIR) {
    return path.resolve(process.env.ADMIN_PROD_READONLY_EVIDENCE_DIR);
  }
  if (!fs.existsSync(DEFAULT_ROOT)) return "";
  return (
    fs
      .readdirSync(DEFAULT_ROOT)
      .map((entry) => path.join(DEFAULT_ROOT, entry))
      .filter((entry) => fs.existsSync(path.join(entry, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const dir = latestDir();
if (!dir) {
  fatal(
    "ADMIN-PROD-READONLY-001",
    "No prod readonly evidence directory found.",
    "Run npm run e2e:admin-front:prod-readonly first."
  );
}

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(dir, fileName);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fatal(
      "ADMIN-PROD-READONLY-002",
      `Required evidence file missing or empty: ${filePath}`,
      "Rerun the prod readonly verification harness."
    );
  }
}

const report = readJson(path.join(dir, "report.json"));
const routes = readJson(path.join(dir, "route_results.json"));
const api = readJson(path.join(dir, "api_results.json"));
const consoleResults = readJson(path.join(dir, "console_results.json"));
const logResults = readJson(path.join(dir, "log_results.json"));

if (report.status !== "success") {
  fatal(
    "ADMIN-PROD-READONLY-003",
    `Report status is ${report.status}`,
    "Fix the failing page, API, or log error and rerun."
  );
}
if (!Array.isArray(routes) || routes.length < 15) {
  fatal(
    "ADMIN-PROD-READONLY-004",
    "Route coverage is incomplete.",
    "Ensure the prod readonly harness crawls all required admin pages."
  );
}
if (routes.some((item) => item.ok !== true)) {
  fatal(
    "ADMIN-PROD-READONLY-005",
    "At least one route failed verification.",
    "Inspect route_results.json and repair the failing page."
  );
}
if (
  consoleResults.some(
    (item) =>
      (item.console || []).some((entry) => entry.type === "error") ||
      (item.requestFailures || []).length > 0
  )
) {
  fatal(
    "ADMIN-PROD-READONLY-006",
    "Console errors or request failures remain in the evidence bundle.",
    "Fix the front-end/runtime issue and rerun."
  );
}
if (api.some((item) => item.ok === false || Number(item.status || 0) >= 400)) {
  fatal(
    "ADMIN-PROD-READONLY-007",
    "At least one admin API request failed.",
    "Inspect api_results.json, repair the failing endpoint, and rerun."
  );
}

const logSummary = Array.isArray(logResults) ? logResults[0] : null;
if (!logSummary) {
  fatal(
    "ADMIN-PROD-READONLY-008",
    "Missing log summary.",
    "Ensure the harness writes log_results.json."
  );
}
if (logSummary.status === "ok" && Number(logSummary.count || 0) > 0) {
  fatal(
    "ADMIN-PROD-READONLY-009",
    `${logSummary.count} ERROR log entries detected in the verification window.`,
    "Fix the logged backend/frontend error and rerun."
  );
}
if (
  logSummary.status === "skipped" &&
  process.env.ADMIN_PROD_READONLY_ALLOW_LOG_SKIP !== "1"
) {
  fatal(
    "ADMIN-PROD-READONLY-010",
    `Log verification was skipped: ${logSummary.reason || "unknown reason"}`,
    "Refresh gcloud auth or set ADMIN_PROD_READONLY_ALLOW_LOG_SKIP=1 only when browser log verification is captured separately."
  );
}

console.log(`[admin-front-prod-readonly-evidence] passed: ${dir}`);
