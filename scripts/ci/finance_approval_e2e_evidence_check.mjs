#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFinanceSensitiveTreeHash, sha256Json } from "../lib/finance_sensitive_hash.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function latestReportPath() {
  if (process.env.ADMIN_WITHDRAWAL_APPROVAL_RECONCILIATION_REPORT) {
    return path.resolve(process.env.ADMIN_WITHDRAWAL_APPROVAL_RECONCILIATION_REPORT);
  }
  const base = path.join(ROOT, "output/dogfood/admin-withdrawal-approval");
  if (!fs.existsSync(base)) return "";
  return fs.readdirSync(base)
    .map((name) => path.join(base, name, "reconciliation-report.json"))
    .filter((filePath) => fs.existsSync(filePath))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function requireSecurityCheck(report, name) {
  const row = (report.securityChecks || []).find((item) => normalizeName(item.name) === normalizeName(name));
  if (!row || row.pass !== true) {
    fatal(
      "FIN-EVIDENCE-SECURITY",
      report.reportPath,
      `required withdrawal security scenario did not pass: ${name}`,
      "rerun npm run e2e:admin-withdrawal-approval and fix the state machine, contract ticket, or API dedupe bug before merging.",
    );
  }
}

function requireComparison(report, stage, metricName, extra = () => true) {
  const row = (report.comparisons || []).find((item) => item.stage === stage && item.metricName === metricName);
  if (!row || row.pass !== true || !extra(row)) {
    fatal(
      "FIN-EVIDENCE-COMPARISON",
      report.reportPath,
      `required expected-vs-actual comparison did not pass: ${stage} / ${metricName}`,
      "rerun the Provider withdrawal approval E2E, then inspect DB/API/chain/UI deltas and repair the mismatch.",
    );
  }
}

const reportPath = latestReportPath();
if (!reportPath || !fs.existsSync(reportPath)) {
  fatal(
    "FIN-EVIDENCE-001",
    "",
    "admin withdrawal approval reconciliation evidence is missing.",
    "run npm run e2e:admin-withdrawal-approval and keep the generated reconciliation report available for the release gate.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
report.reportPath = reportPath;

if (report.status !== "success" || (Array.isArray(report.failed) && report.failed.length > 0)) {
  fatal(
    "FIN-EVIDENCE-002",
    reportPath,
    `report status is ${report.status} with failures: ${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "fix the failed withdrawal approval E2E step and regenerate the reconciliation report.",
  );
}

const currentTree = computeFinanceSensitiveTreeHash(ROOT);
if (!report.financeSensitiveTreeHash || report.financeSensitiveTreeHash !== currentTree.hash) {
  fatal(
    "FIN-EVIDENCE-003",
    reportPath,
    "E2E evidence hash does not match the current finance-sensitive tree.",
    "rerun npm run e2e:admin-withdrawal-approval after the finance/withdrawal/review code changes, then commit the updated evidence reference if required.",
  );
}

const digest = sha256Json({
  financeSensitiveTreeHash: report.financeSensitiveTreeHash,
  fixtureHash: report.fixtureHash,
  comparisons: report.comparisons,
  securityChecks: report.securityChecks,
  txHash: report.chain?.txHash,
  withdrawalId: report.withdrawalId,
});
if (!report.evidenceDigest || report.evidenceDigest !== digest) {
  fatal(
    "FIN-EVIDENCE-004",
    reportPath,
    "E2E evidence digest cannot be recomputed from the report payload.",
    "do not hand-edit evidence; rerun the E2E generator so fixture, comparisons, security checks, and txHash produce a valid digest.",
  );
}

for (const name of [
  "duplicate approval rejected",
  "cross decision after approve rejected",
  "tampered ticket amount rejected",
  "withdraw ticket replay rejected",
  "duplicate complete rejected",
]) {
  requireSecurityCheck(report, name);
}

requireComparison(report, "approve", "Ticket amount atomic");
requireComparison(report, "chain", "Provider USDC delta atomic");
requireComparison(report, "chain", "Vault USDC delta atomic");
requireComparison(report, "complete", "DB status");
requireComparison(report, "complete", "DB txHash");
requireComparison(report, "complete", "Provider pending balance", (row) => row.actual === "0.000000");
requireComparison(report, "complete", "Provider frozen balance", (row) => row.actual === "0.000000");

if (process.exitCode) process.exit(process.exitCode);

console.log(`[finance-approval-evidence] passed: ${reportPath}`);
console.log(`[finance-approval-evidence] financeSensitiveTreeHash=${report.financeSensitiveTreeHash}`);
