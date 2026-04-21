#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const REQUIRED_SCENARIOS = [
  "consumer-normal-claim",
  "consumer-expired-reaper",
  "consumer-soft-revoke-race-claim",
  "consumer-soft-revoke-expire",
  "provider-normal-claim",
  "provider-expired-reaper",
  "provider-soft-revoke-race-claim",
  "provider-soft-revoke-expire",
  "consumer-replay-attack",
  "provider-onchain-revert-retry",
];

const REQUIRED_FILES = [
  "report.md",
  "report.json",
  "environment-manifest.json",
  "contract-manifest.json",
  ...REQUIRED_SCENARIOS.map((name) => `${name}.json`),
];

function latestReportPath() {
  if (process.env.WITHDRAWAL_ONE_TICKET_EVIDENCE_DIR) {
    return path.join(path.resolve(process.env.WITHDRAWAL_ONE_TICKET_EVIDENCE_DIR), "report.json");
  }
  if (process.env.WITHDRAWAL_ONE_TICKET_REPORT) {
    return path.resolve(process.env.WITHDRAWAL_ONE_TICKET_REPORT);
  }
  const base = path.join(ROOT, "docs/evidence/release/withdrawal-one-ticket");
  if (!fs.existsSync(base)) return "";
  return fs.readdirSync(base)
    .map((name) => path.join(base, name, "report.json"))
    .filter((filePath) => fs.existsSync(filePath))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(report) {
  return crypto.createHash("sha256").update(JSON.stringify(stable({
    scriptVersion: report.scriptVersion,
    environment: report.environment,
    chain: report.chain,
    scenarioFiles: report.scenarioFiles,
    scenarioResults: report.scenarioResults,
    negativeScenarios: report.negativeScenarios,
    comparisons: report.comparisons,
    failed: report.failed,
  }))).digest("hex");
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const reportPath = latestReportPath();
if (!reportPath) {
  fatal(
    "WITHDRAWAL-ONE-TICKET-EVIDENCE-001",
    "",
    "one-ticket withdrawal release evidence is missing.",
    "run npm run e2e:withdrawal-one-ticket-evidence and commit or point WITHDRAWAL_ONE_TICKET_EVIDENCE_DIR at the generated evidence bundle.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

const outDir = path.dirname(reportPath);
const report = readJson(reportPath);

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(outDir, fileName);
  if (!fs.existsSync(filePath)) {
    fatal(
      "WITHDRAWAL-ONE-TICKET-EVIDENCE-002",
      filePath,
      `required one-ticket evidence artifact is missing: ${fileName}`,
      "rerun the evidence runner; do not hand-assemble partial withdrawal evidence.",
    );
  }
}

if (report.status !== "success" || (Array.isArray(report.failed) && report.failed.length > 0)) {
  fatal(
    "WITHDRAWAL-ONE-TICKET-EVIDENCE-003",
    reportPath,
    `report status is ${report.status}; failures=${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "fix the failing withdrawal scenario and regenerate the evidence bundle.",
  );
}

const scenarioResults = Array.isArray(report.scenarioResults) ? report.scenarioResults : [];
for (const name of REQUIRED_SCENARIOS) {
  const result = scenarioResults.find((scenario) => scenario.name === name);
  if (!result || result.pass !== true || result.status !== "passed") {
    fatal(
      "WITHDRAWAL-ONE-TICKET-EVIDENCE-004",
      reportPath,
      `required scenario is missing or not passed: ${name}`,
      "rerun the full 10-scenario one-ticket evidence runner; all scenarios must pass for release evidence.",
    );
  }
  const scenario = readJson(path.join(outDir, `${name}.json`));
  if (scenario.pass !== true || scenario.status !== "passed") {
    fatal(
      "WITHDRAWAL-ONE-TICKET-EVIDENCE-005",
      path.join(outDir, `${name}.json`),
      `scenario file is not passing: ${name}`,
      "do not edit scenario JSON by hand; rerun the one-ticket evidence runner after fixing the underlying chain or gateway failure.",
    );
  }
}

const negative = report.negativeScenarios || {};
if (!negative["consumer-replay-attack"] || !negative["provider-onchain-revert-retry"]) {
  fatal(
    "WITHDRAWAL-ONE-TICKET-EVIDENCE-006",
    reportPath,
    "negative scenario evidence is incomplete; replay and low-gas retry are release blockers.",
    "ensure report.json contains negativeScenarios.consumer-replay-attack and negativeScenarios.provider-onchain-revert-retry.",
  );
}

const replayScenario = readJson(path.join(outDir, "consumer-replay-attack.json"));
const lowGasScenario = readJson(path.join(outDir, "provider-onchain-revert-retry.json"));
const replayChecks = Object.fromEntries((replayScenario.comparisons || []).map((row) => [row.metric, row.pass]));
const lowGasChecks = Object.fromEntries((lowGasScenario.comparisons || []).map((row) => [row.metric, row.pass]));

for (const metric of ["replayReverted", "gatewayStatusAfterReplay", "noSecondWalletDelta", "ticketConsumed"]) {
  if (replayChecks[metric] !== true) {
    fatal(
      "WITHDRAWAL-ONE-TICKET-EVIDENCE-007",
      path.join(outDir, "consumer-replay-attack.json"),
      `consumer replay check failed or is missing: ${metric}`,
      "fix replay protection evidence: the second claim must revert and Gateway must remain COMPLETED with no second balance delta.",
    );
  }
}

for (const metric of ["lowGasReverted", "consumedAfterLowGas", "gatewayNotFailedAfterLowGas", "retryReceiptStatus", "finalGatewayStatus"]) {
  if (lowGasChecks[metric] !== true) {
    fatal(
      "WITHDRAWAL-ONE-TICKET-EVIDENCE-008",
      path.join(outDir, "provider-onchain-revert-retry.json"),
      `provider low-gas retry check failed or is missing: ${metric}`,
      "fix low-gas retry evidence: the first failed receipt must not consume the ticket or fail the business withdrawal, and normal-gas retry must complete.",
    );
  }
}

if (!Array.isArray(report.comparisons) || report.comparisons.some((row) => row.pass !== true)) {
  fatal(
    "WITHDRAWAL-ONE-TICKET-EVIDENCE-009",
    reportPath,
    "one or more expected-vs-actual comparisons failed.",
    "inspect report.md, fix the withdrawal lifecycle break, and rerun the evidence runner.",
  );
}

if (!report.evidenceDigest || report.evidenceDigest !== digest(report)) {
  fatal(
    "WITHDRAWAL-ONE-TICKET-EVIDENCE-010",
    reportPath,
    "evidence digest cannot be recomputed from report payload.",
    "do not hand-edit report.json; rerun the evidence generator.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[withdrawal-one-ticket-evidence] passed: ${reportPath}`);
console.log(`[withdrawal-one-ticket-evidence] scenarios=${scenarioResults.length}`);
