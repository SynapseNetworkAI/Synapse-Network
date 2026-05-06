#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const EVIDENCE_ROOT = path.join(
  ROOT,
  "output/dogfood/admin-dashboard-projection-readmodel"
);
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "api-evidence.json",
  "sql-evidence.json",
  "dom-evidence.json",
  "screenshot-evidence.json",
];
const REQUIRED_CHECKS = [
  "sql:projection-native-column-queries",
  "admin:login",
  "api:dashboard-endpoints",
  "api-sql:finance-money-fields",
  "api-sql:finance-count-fields",
  "api-sql:activity-trends",
  "api-sql:operations",
  "dom:/dashboard/overview",
  "dom:/finance",
  "dom:/dashboard/runtime",
  "dom:console-errors",
];
const REQUIRED_ENDPOINTS = [
  "/api/admin/v1/dashboard/overview",
  "/api/admin/v1/dashboard/finance-overview",
  "/api/admin/v1/dashboard/activity-trends",
  "/api/admin/v1/dashboard/operations-overview",
  "/api/admin/v1/dashboard/system-status",
];
const REQUIRED_SCREENSHOTS = [
  "screenshots/overview-readmodel.png",
  "screenshots/finance-readmodel.png",
  "screenshots/runtime-readmodel.png",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.ADMIN_DASHBOARD_PROJECTION_READMODEL_EVIDENCE_DIR) {
    return path.resolve(
      process.env.ADMIN_DASHBOARD_PROJECTION_READMODEL_EVIDENCE_DIR
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
    "ADMIN-DASHBOARD-READMODEL-MISSING",
    "",
    "Admin dashboard projection read-model evidence is missing.",
    "run npm run e2e:admin-dashboard-projection-readmodel:local before the checker."
  );
}

if (!process.exitCode) {
  for (const file of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(dir, file))) {
      fatal(
        "ADMIN-DASHBOARD-READMODEL-FILE",
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
const sql = readJson(path.join(dir, "sql-evidence.json"));
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
    "ADMIN-DASHBOARD-READMODEL-STATUS",
    path.join(dir, "report.json"),
    `Evidence failed: ${JSON.stringify(report.failed || []).slice(0, 1000)}`,
    "fix the failing API/SQL/DOM checkpoint and rerun the E2E."
  );
}

if (/^\s*-\s*OPEN\b/im.test(bugfixLog)) {
  fatal(
    "ADMIN-DASHBOARD-READMODEL-BUGFIX",
    path.join(dir, "bugfix-log.md"),
    "Bugfix log contains an open item.",
    "fix or intentionally close the bug entry before accepting the evidence."
  );
}

if (
  crypto.createHash("sha256").update(trace).digest("hex") !== report.traceDigest
) {
  fatal(
    "ADMIN-DASHBOARD-READMODEL-DIGEST",
    path.join(dir, "trace.jsonl"),
    "Trace digest does not match report.json.",
    "rerun the E2E; never edit evidence by hand."
  );
}

const checkMap = new Map((report.checks || []).map((row) => [row.name, row]));
for (const name of REQUIRED_CHECKS) {
  if (checkMap.get(name)?.ok !== true) {
    fatal(
      "ADMIN-DASHBOARD-READMODEL-CHECK",
      path.join(dir, "report.json"),
      `Required check missing or failed: ${name}`,
      "rerun the E2E after fixing the dashboard projection read-model path."
    );
  }
}

const endpointSet = new Set(api.map((row) => row.pathname));
for (const endpoint of REQUIRED_ENDPOINTS) {
  if (!endpointSet.has(endpoint)) {
    fatal(
      "ADMIN-DASHBOARD-READMODEL-ENDPOINT",
      path.join(dir, "api-evidence.json"),
      `Required Admin API endpoint was not captured: ${endpoint}`,
      "capture every dashboard endpoint used by Admin-front overview, finance, and runtime pages."
    );
  }
}

for (const query of sql.queries || []) {
  if (
    query.forbiddenAbsent?.rowToJson !== true ||
    query.forbiddenAbsent?.projectionSelectStar !== true
  ) {
    fatal(
      "ADMIN-DASHBOARD-READMODEL-SQL",
      path.join(dir, "sql-evidence.json"),
      `SQL evidence used forbidden projection query shape: ${query.name}`,
      "use explicit projection columns; never row_to_json or SELECT * dashboard projections."
    );
  }
}

if (
  !sql.financeProjection ||
  !Array.isArray(sql.activityTrendProjection) ||
  !sql.operationsProjection ||
  !sql.dashboardProjection
) {
  fatal(
    "ADMIN-DASHBOARD-READMODEL-SQL-PROJECTION",
    path.join(dir, "sql-evidence.json"),
    "SQL projection evidence is missing one or more required projection views.",
    "query finance, activity trend, operations, and dashboard projections with explicit columns."
  );
}

const domRoutes = new Set(dom.map((row) => row.route));
for (const route of ["/dashboard/overview", "/finance", "/dashboard/runtime"]) {
  if (!domRoutes.has(route)) {
    fatal(
      "ADMIN-DASHBOARD-READMODEL-DOM",
      path.join(dir, "dom-evidence.json"),
      `DOM evidence missing required route: ${route}`,
      "visit overview, finance, and runtime pages after API/SQL checkpoints pass."
    );
  }
}

for (const file of REQUIRED_SCREENSHOTS) {
  if (!fs.existsSync(path.join(dir, file))) {
    fatal(
      "ADMIN-DASHBOARD-READMODEL-SCREENSHOT-FILE",
      path.join(dir, "screenshot-evidence.json"),
      `Required screenshot file missing: ${file}`,
      "capture screenshots only after DOM/API/SQL checkpoints pass."
    );
  }
}

for (const row of screenshots) {
  if (
    row.forbiddenTextAbsent !== true ||
    !row.domCheckpoint ||
    !row.apiCheckpoint ||
    !row.sqlCheckpoint ||
    !fs.existsSync(path.join(dir, row.file || ""))
  ) {
    fatal(
      "ADMIN-DASHBOARD-READMODEL-SCREENSHOT-CHECKPOINT",
      path.join(dir, "screenshot-evidence.json"),
      "Screenshot is missing DOM/API/SQL checkpoint binding or file is missing.",
      "record screenshot evidence with file/url/expectedText/forbiddenTextAbsent/domCheckpoint/apiCheckpoint/sqlCheckpoint/capturedAt."
    );
  }
}

const evidenceText = stringifyEvidence(
  report,
  api,
  sql,
  dom,
  screenshots,
  trace
);
const forbidden = [
  /\brow_to_json\b/i,
  /select\s+\*\s+from\s+synapse_admin_dashboard_.*projection/i,
  /Internal server error/i,
  /str has no attribute isoformat/i,
  /datetime - str/i,
  /Failed to fetch/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/i,
];
for (const pattern of forbidden) {
  if (pattern.test(evidenceText)) {
    fatal(
      "ADMIN-DASHBOARD-READMODEL-LEAK",
      dir,
      `Evidence contains forbidden text matching ${pattern}.`,
      "redact secrets/error overlays and ensure evidence queries stay on explicit typed projection columns."
    );
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(
  `[admin-dashboard-projection-readmodel] evidence ok: ${path.relative(
    ROOT,
    dir
  )}`
);
