#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_ROOT = path.join(ROOT, "output/dogfood/admin-regression");
const MAX_AGE_MS = 96 * 60 * 60 * 1000;
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "expected_state.json",
  "sql_evidence.json",
  "screenshot_evidence.json",
  "function_results.json",
  "function_results.md",
  "bugfix-log.md",
];

const REQUIRED_FUNCTION_IDS = [
  "auth-mfa-session",
  "dashboard-overview",
  "dashboard-runtime",
  "dashboard-system-diagnostics",
  "analytics-overview",
  "analytics-consumer-funnel",
  "analytics-invocation-revenue",
  "analytics-provider-revenue",
  "analytics-money-flow",
  "analytics-risk-health",
  "analytics-data-quality",
  "finance-reconciliation",
  "platform-safe-draft",
  "approvals-withdrawal-review",
  "execution-risk-audit",
  "users-rbac-menu",
  "config-business-policy",
  "provider-services",
  "forum-support",
  "notifications",
  "withdrawal-finalization-concurrency",
];

function fatal(code, message, fix) {
  console.error(`FATAL ${code}: ${message}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestDir() {
  if (process.env.ADMIN_REGRESSION_EVIDENCE_DIR) {
    return path.resolve(process.env.ADMIN_REGRESSION_EVIDENCE_DIR);
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

function hasSecretLeak(text) {
  const patterns = [
    /https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\//i,
    /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
    /"(?:privateKey|private_key|authorization|access_token|token|secret|password)"\s*:\s*"(?!\[REDACTED)[^"]+"/i,
    /0x[a-fA-F0-9]{64}/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

const dir = latestDir();
if (!dir) {
  fatal(
    "ADMIN-REGRESSION-001",
    "No admin regression evidence directory found.",
    "Run npm run e2e:admin-regression first."
  );
}

if (!process.exitCode) {
  for (const fileName of REQUIRED_FILES) {
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      fatal(
        "ADMIN-REGRESSION-002",
        `Required evidence file missing or empty: ${filePath}`,
        "Rerun the E2E; do not hand-build partial admin regression evidence."
      );
    }
  }
}

if (!process.exitCode) {
  const report = readJson(path.join(dir, "report.json"));
  const expected = readJson(path.join(dir, "expected_state.json"));
  const sqlEvidence = readJson(path.join(dir, "sql_evidence.json"));
  const screenshotEvidence = readJson(
    path.join(dir, "screenshot_evidence.json")
  );
  const functionResultsFile = readJson(path.join(dir, "function_results.json"));
  const functionResults = Array.isArray(functionResultsFile)
    ? functionResultsFile
    : functionResultsFile.results || [];

  if (report.status !== "success") {
    fatal(
      "ADMIN-REGRESSION-003",
      `Report status is ${report.status}; failedSteps=${JSON.stringify(
        report.failedSteps || []
      ).slice(0, 600)}`,
      "Fix the failed admin regression step or SQL/screenshot evidence gap and rerun."
    );
  }
  if (
    !report.generatedAt ||
    Date.now() - Date.parse(report.generatedAt) > MAX_AGE_MS
  ) {
    fatal(
      "ADMIN-REGRESSION-004",
      "Evidence is missing generatedAt or is older than 96 hours.",
      "Rerun npm run e2e:admin-regression."
    );
  }
  if (expected.analyticsSource !== "postgres") {
    fatal(
      "ADMIN-REGRESSION-005",
      `Analytics source must be postgres, got ${expected.analyticsSource}`,
      "Set ADMIN_ANALYTICS_SOURCE=postgres and ensure gateway-admin uses PostgresAnalyticsDashboardRepository."
    );
  }
  const probes = [...(sqlEvidence.admin || []), ...(sqlEvidence.gateway || [])];
  const failedProbes = probes.filter((probe) => probe.ok !== true);
  if (failedProbes.length > 0 || probes.length < 8) {
    fatal(
      "ADMIN-REGRESSION-006",
      `SQL evidence probes failed or are incomplete: ${JSON.stringify(
        failedProbes
      ).slice(0, 1000)}`,
      "Fix the failing SQL query/table state and rerun the regression."
    );
  }
  const analyticsProbe = (sqlEvidence.gateway || []).find(
    (probe) => probe.name === "analytics-postgres-only"
  );
  if (analyticsProbe?.data?.source !== "postgres") {
    fatal(
      "ADMIN-REGRESSION-007",
      "Analytics SQL evidence did not declare source=postgres.",
      "Use Postgres analytics evidence, not ClickHouse evidence, for admin-regression."
    );
  }
  const adminConfigProbe = (sqlEvidence.admin || []).find(
    (probe) => probe.name === "business-policy-config-admin"
  );
  const runtimeConfigProbe = (sqlEvidence.gateway || []).find(
    (probe) => probe.name === "business-policy-config-runtime"
  );
  if (
    adminConfigProbe?.data?.exists !== true ||
    !adminConfigProbe?.data?.lastPublishedAudit ||
    runtimeConfigProbe?.data?.exists !== true ||
    JSON.stringify(adminConfigProbe?.data?.publishedPayload ?? null) !==
      JSON.stringify(runtimeConfigProbe?.data?.payload ?? null) ||
    Number(adminConfigProbe?.data?.publishedVersion ?? -1) !==
      Number(runtimeConfigProbe?.data?.publishedVersion ?? -2)
  ) {
    fatal(
      "ADMIN-REGRESSION-CONFIG-001",
      `Business policy config SQL evidence is incomplete or mismatched. admin=${JSON.stringify(
        adminConfigProbe?.data || null
      ).slice(0, 600)} runtime=${JSON.stringify(
        runtimeConfigProbe?.data || null
      ).slice(0, 600)}`,
      "Run the config center round-trip and ensure admin_config_documents and synapse_business_policy_config stay in sync."
    );
  }
  const configRoundTrip = (screenshotEvidence.backendConsistencyEvidence || []).find(
    (entry) => entry?.businessPolicyRoundTrip
  )?.businessPolicyRoundTrip;
  if (
    !configRoundTrip ||
    configRoundTrip.restored !== true ||
    !configRoundTrip.originalValue ||
    !configRoundTrip.updatedValue ||
    configRoundTrip.originalValue !== configRoundTrip.restoredValue
  ) {
    fatal(
      "ADMIN-REGRESSION-CONFIG-002",
      `Config round-trip evidence missing or not restored: ${JSON.stringify(
        configRoundTrip || null
      ).slice(0, 600)}`,
      "Ensure /config saves a draft, publishes the changed alertDeltaUsdc, then restores and republishes the original value."
    );
  }
  const coverage = screenshotEvidence.requiredKeywordCoverage || {};
  const missing = Object.entries(coverage).filter(([, ok]) => ok !== true);
  if (missing.length > 0) {
    fatal(
      "ADMIN-REGRESSION-008",
      `Screenshot/DOM evidence missing required surfaces: ${missing
        .map(([key]) => key)
        .join(", ")}`,
      "Ensure browser dogfood captures final-state screenshots for every required admin surface."
    );
  }
  const pageAssertions = screenshotEvidence.pageAssertions || [];
  if (!pageAssertions.length) {
    fatal(
      "ADMIN-REGRESSION-009",
      "Screenshot evidence is not bound to page-level DOM assertions.",
      "Update the UI dogfood report to include pageSummaries/DOM assertions, then rerun."
    );
  }
  const functionResultIds = new Set(
    functionResults.map((result) => result.functionId)
  );
  const missingFunctionIds = REQUIRED_FUNCTION_IDS.filter(
    (id) => !functionResultIds.has(id)
  );
  const failedFunctionResults = functionResults.filter(
    (result) => result.status !== "passed" || result.verified !== true
  );
  if (
    missingFunctionIds.length > 0 ||
    failedFunctionResults.length > 0 ||
    functionResults.length < REQUIRED_FUNCTION_IDS.length
  ) {
    fatal(
      "ADMIN-REGRESSION-010",
      `Function-level regression evidence incomplete. missing=${missingFunctionIds.join(
        ","
      )}; failed=${failedFunctionResults
        .map((result) => `${result.functionId}:${result.failedChecks || []}`)
        .join(",")
        .slice(0, 1000)}`,
      "Fix the failed function surface or its SQL/API/DOM/screenshot binding and rerun admin-regression."
    );
  }
  const combined = REQUIRED_FILES.map((fileName) =>
    fs.readFileSync(path.join(dir, fileName), "utf8")
  ).join("\n");
  if (hasSecretLeak(combined)) {
    fatal(
      "ADMIN-REGRESSION-SECRET",
      "Evidence contains secret-like material.",
      "Delete the evidence directory, fix redaction, and rerun."
    );
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`[admin-regression-evidence] passed: ${dir}`);
