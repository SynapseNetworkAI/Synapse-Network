#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ENVIRONMENT = process.env.LLM_DEEPSEEK_E2E_ENV || "local";
const EVIDENCE_ROOT =
  ENVIRONMENT === "staging"
    ? path.join(ROOT, "docs/evidence/staging/llm-deepseek")
    : path.join(ROOT, "output/dogfood/llm-deepseek");
const REQUIRED_FILES = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "api-evidence.json",
  "db-evidence.json",
  "bugfix-log.md",
];

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  if (process.env.LLM_DEEPSEEK_E2E_EVIDENCE_DIR)
    return path.resolve(process.env.LLM_DEEPSEEK_E2E_EVIDENCE_DIR);
  if (!fs.existsSync(EVIDENCE_ROOT)) return "";
  return (
    fs
      .readdirSync(EVIDENCE_ROOT, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && entry.name.endsWith("-llm-deepseek-e2e")
      )
      .map((entry) => path.join(EVIDENCE_ROOT, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "LLM-DEEPSEEK-EVIDENCE-002",
      filePath,
      `evidence JSON cannot be parsed: ${error.message}`,
      `rerun npm run e2e:llm-deepseek:${ENVIRONMENT}; do not hand-edit evidence.`
    );
    return null;
  }
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function parseUsdcMicros(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-001",
    "",
    "LLM DeepSeek evidence directory is missing.",
    `run npm run e2e:llm-deepseek:${ENVIRONMENT} and then rerun this checker.`
  );
}
if (process.exitCode) process.exit(process.exitCode);

for (const name of REQUIRED_FILES) {
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) {
    fatal(
      "LLM-DEEPSEEK-EVIDENCE-003",
      filePath,
      `required LLM evidence artifact is missing: ${name}`,
      `rerun npm run e2e:llm-deepseek:${ENVIRONMENT}; do not assemble partial evidence by hand.`
    );
  }
}
if (process.exitCode) process.exit(process.exitCode);

const reportPath = path.join(dir, "report.json");
const report = readJson(reportPath);
const apiEvidence = readJson(path.join(dir, "api-evidence.json"));
if (!report || !apiEvidence) process.exit(process.exitCode || 1);

if (
  report.status !== "passed" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-004",
    reportPath,
    `LLM report is not passed; status=${report.status}; failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 1000)}`,
    "fix the LLM invoke/billing failure and regenerate evidence."
  );
}

if (report.environment !== ENVIRONMENT) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-005",
    reportPath,
    `evidence environment mismatch; expected=${ENVIRONMENT}, actual=${report.environment}`,
    `rerun the ${ENVIRONMENT} LLM DeepSeek E2E command.`
  );
}

const generatedAt = Date.parse(report.generatedAt || "");
const maxAgeHours = Number(process.env.LLM_DEEPSEEK_E2E_MAX_AGE_HOURS || "72");
const ageHours = (Date.now() - generatedAt) / 3_600_000;
if (
  !Number.isFinite(generatedAt) ||
  ageHours < -0.1 ||
  ageHours > maxAgeHours
) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-006",
    reportPath,
    `LLM evidence is stale or invalid; age=${
      Number.isFinite(ageHours) ? ageHours.toFixed(2) : "invalid"
    }h, max=${maxAgeHours}h`,
    `rerun npm run e2e:llm-deepseek:${ENVIRONMENT}.`
  );
}

const tracePath = path.join(dir, "trace.jsonl");
if (sha256File(tracePath) !== report.traceDigest) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-007",
    tracePath,
    "trace.jsonl digest does not match report.json traceDigest.",
    "rerun the E2E; do not modify trace evidence by hand."
  );
}

const billing = report.billing || {};
const failureScenarios = Array.isArray(report.failureScenarios)
  ? report.failureScenarios
  : [];
const usage = billing.usage || {};
const synapse = billing.synapse || {};
const expected = parseUsdcMicros(billing.expectedChargedUsdc);
const actual = parseUsdcMicros(synapse.chargedUsdc);
const hold = parseUsdcMicros(synapse.holdUsdc);
const released = parseUsdcMicros(synapse.releasedUsdc);
const provider = parseUsdcMicros(synapse.providerRevenueUsdc);
const platform = parseUsdcMicros(synapse.platformFeeUsdc);

if (
  !Number.isInteger(usage.inputTokens) ||
  !Number.isInteger(usage.outputTokens) ||
  !Number.isInteger(usage.totalTokens)
) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-008",
    reportPath,
    "LLM usage must include integer inputTokens/outputTokens/totalTokens.",
    "fix provider usage normalization and rerun evidence."
  );
}

if (synapse.priceModel !== "token_metered") {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-009",
    reportPath,
    `Synapse billing priceModel must be token_metered; actual=${synapse.priceModel}`,
    "route DeepSeek through the LLM token-metered billing path."
  );
}

if (expected == null || actual == null || expected !== actual) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-010",
    reportPath,
    `chargedUsdc mismatch; expected=${billing.expectedChargedUsdc}, actual=${synapse.chargedUsdc}`,
    "fix token price/usage charge calculation; do not accept drift."
  );
}

if (
  hold == null ||
  released == null ||
  actual == null ||
  hold < actual ||
  released !== hold - actual
) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-011",
    reportPath,
    `hold/release invariant failed; hold=${synapse.holdUsdc}, charged=${synapse.chargedUsdc}, released=${synapse.releasedUsdc}`,
    "fix LLM pre-auth hold settlement before rerunning evidence."
  );
}

if (
  provider == null ||
  platform == null ||
  actual == null ||
  provider + platform !== actual
) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-012",
    reportPath,
    `revenue split invariant failed; provider=${synapse.providerRevenueUsdc}, platform=${synapse.platformFeeUsdc}, charged=${synapse.chargedUsdc}`,
    "fix provider/platform split accounting before rerunning evidence."
  );
}

if (ENVIRONMENT === "local") {
  const byScenario = Object.fromEntries(
    failureScenarios.map((scenario) => [scenario.scenario, scenario])
  );
  for (const name of [
    "timeout_no_charge",
    "missing_usage_no_charge",
    "slow_success_charges",
  ]) {
    if (!byScenario[name]) {
      fatal(
        "LLM-DEEPSEEK-EVIDENCE-015",
        reportPath,
        `local LLM failure-path scenario is missing: ${name}`,
        "rerun npm run e2e:llm-deepseek:local with local fake failure fixtures enabled."
      );
    }
  }

  for (const name of ["timeout_no_charge", "missing_usage_no_charge"]) {
    const scenario = byScenario[name] || {};
    const charged = parseUsdcMicros(scenario.chargedUsdc);
    const providerRevenue = parseUsdcMicros(scenario.providerRevenueUsdc);
    const platformFee = parseUsdcMicros(scenario.platformFeeUsdc);
    if (
      scenario.holdReleased !== true ||
      charged !== 0n ||
      providerRevenue !== 0n ||
      platformFee !== 0n ||
      !String(scenario.invocation?.status || "").startsWith("FAILED")
    ) {
      fatal(
        "LLM-DEEPSEEK-EVIDENCE-016",
        reportPath,
        `${name} must release the full hold and charge no parties; evidence=${JSON.stringify(
          scenario
        ).slice(0, 1000)}`,
        "fix LLM failure settlement so timeout/missing usage never captures estimated hold."
      );
    }
  }

  const slowSuccess = byScenario.slow_success_charges || {};
  if (
    parseUsdcMicros(slowSuccess.chargedUsdc) == null ||
    parseUsdcMicros(slowSuccess.chargedUsdc) <= 0n ||
    !slowSuccess.billingEvidence?.usage ||
    slowSuccess.billingEvidence?.synapse?.priceModel !== "token_metered"
  ) {
    fatal(
      "LLM-DEEPSEEK-EVIDENCE-017",
      reportPath,
      "slow_success_charges must prove slow in-time LLM calls still charge by final usage.",
      "fix local slow-success fixture or LLM usage settlement evidence."
    );
  }
}

const allText = REQUIRED_FILES.map((name) =>
  fs.readFileSync(path.join(dir, name), "utf8")
).join("\n");
for (const pattern of [
  /agt_[A-Za-z0-9._~+/-]{12,}/,
  /sk-[A-Za-z0-9_-]{16,}/,
  /0x[a-fA-F0-9]{64}/,
  /private[_-]?key/i,
]) {
  if (pattern.test(allText)) {
    fatal(
      "LLM-DEEPSEEK-EVIDENCE-013",
      dir,
      `evidence appears to contain a secret-like value matching ${pattern}`,
      "redact secrets and regenerate evidence."
    );
  }
}

const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
if (/Status:\s*open/i.test(bugfixLog)) {
  fatal(
    "LLM-DEEPSEEK-EVIDENCE-014",
    path.join(dir, "bugfix-log.md"),
    "bugfix-log.md still contains open bugs.",
    "fix the bug, mark it closed only through regenerated passing evidence, and rerun checker."
  );
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`[ci:llm-deepseek-${ENVIRONMENT}-evidence] validated ${dir}`);
