#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const environment = (
  process.env.INVOCATION_BILLING_MIGRATION_ENV ||
  process.env.SYNAPSE_E2E_ENV ||
  "local"
)
  .trim()
  .toLowerCase();

const requiredFiles = [
  "report.json",
  "report.md",
  "trace.jsonl",
  "bugfix-log.md",
  "migration-evidence.json",
  "api-evidence.json",
  "db-evidence.json",
  "ui-evidence.json",
  "screenshot-evidence.json",
];

function evidenceRoot() {
  if (process.env.INVOCATION_BILLING_MIGRATION_EVIDENCE_DIR) {
    return path.resolve(process.env.INVOCATION_BILLING_MIGRATION_EVIDENCE_DIR);
  }
  if (environment === "staging") {
    return path.join(
      ROOT,
      "docs/evidence/staging/invocation-billing-migration"
    );
  }
  return path.join(ROOT, "output/dogfood/invocation-billing-migration");
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  const root = evidenceRoot();
  if (process.env.INVOCATION_BILLING_MIGRATION_EVIDENCE_DIR) return root;
  if (!fs.existsSync(root)) return "";
  return (
    fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.endsWith(`-${environment}`)
      )
      .map((entry) => path.join(root, entry.name))
      .filter((candidate) => fs.existsSync(path.join(candidate, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "INVOCATION-BILLING-EVIDENCE-JSON",
      filePath,
      `cannot parse JSON: ${error.message}`,
      "rerun the E2E; do not hand-edit generated evidence."
    );
    return null;
  }
}

function decimalAtomic(value) {
  const text = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return 0n;
  const negative = text.startsWith("-");
  const normalized = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = normalized.split(".");
  const atomic =
    BigInt(whole || "0") * 1_000_000n +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0");
  return negative ? -atomic : atomic;
}

function decimalEqual(left, right) {
  return decimalAtomic(left) === decimalAtomic(right);
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function checkRequiredFiles(dir) {
  for (const fileName of requiredFiles) {
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) {
      fatal(
        "INVOCATION-BILLING-EVIDENCE-FILE",
        filePath,
        `required artifact is missing: ${fileName}`,
        "rerun npm run e2e:invocation-billing-migration:<env>."
      );
    }
  }
}

function assertCheck(report, name) {
  const row = (report.checks || []).find((item) => item.name === name);
  if (!row || row.status !== "passed") {
    fatal(
      "INVOCATION-BILLING-CHECK",
      "report.json",
      `required check is missing or failed: ${name}`,
      "fix the migration/invoke regression and regenerate evidence."
    );
  }
}

function validateReport(report, dir) {
  const digest = sha256File(path.join(dir, "trace.jsonl"));
  if (report.traceDigest !== digest) {
    fatal(
      "INVOCATION-BILLING-TRACE-DIGEST",
      "report.json",
      "report traceDigest does not match trace.jsonl.",
      "rerun the E2E; do not edit trace/report independently."
    );
  }
  if (report.status !== "success" || (report.failed || []).length > 0) {
    fatal(
      "INVOCATION-BILLING-FAILED",
      "report.json",
      `runner reported failed checks: ${(report.failed || [])
        .map((item) => item.name)
        .join(", ")}`,
      "fix failing checkpoints and rerun the gate."
    );
  }
  const bugfixLog = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
  if (/OPEN:/i.test(bugfixLog)) {
    fatal(
      "INVOCATION-BILLING-BUGFIX-OPEN",
      "bugfix-log.md",
      "bugfix log contains open items.",
      "close or fix all bugfix items before accepting evidence."
    );
  }
}

function validateMigration(migration) {
  const after = migration.afterFirstRun || {};
  const rerun = migration.afterSecondRun || {};
  validateMigrationParse(migration);
  validateMigrationCoverage(after);
  validateMigrationTotals(after);
  validateMigrationRerun(migration, after, rerun);
}

function validateMigrationParse(migration) {
  if ((migration.parseFailures || []).length === 0) return;
  fatal(
    "INVOCATION-BILLING-PARSE-FAILURES",
    "migration-evidence.json",
    "migration reported parse failures.",
    "fix malformed legacy billing KV rows or migration parser before accepting evidence."
  );
}

function validateMigrationCoverage(after) {
  if (
    Number(after.typedRowsForLegacy || 0) >= Number(after.legacyValidRows || 0)
  )
    return;
  fatal(
    "INVOCATION-BILLING-MIGRATION-COVERAGE",
    "migration-evidence.json",
    "typed table does not cover every valid legacy KV billing row.",
    "rerun the migration script and inspect failed legacy rows."
  );
}

function validateMigrationTotals(after) {
  const totalsMatch = [
    ["legacyChargedUsdc", "typedChargedUsdcForLegacy"],
    ["legacyProtocolFeeUsdc", "typedProtocolFeeUsdcForLegacy"],
    ["legacyProviderEarnedUsdc", "typedProviderEarnedUsdcForLegacy"],
  ].every(([legacyField, typedField]) =>
    decimalEqual(after[legacyField], after[typedField])
  );
  if (totalsMatch) return;
  fatal(
    "INVOCATION-BILLING-MIGRATION-TOTALS",
    "migration-evidence.json",
    "legacy KV aggregate totals do not match typed table totals.",
    "fix migration field mapping for totalCharge/protocolFee/providerEarned."
  );
}

function validateMigrationRerun(migration, after, rerun) {
  const rerunStable =
    migration.idempotentRerunUnchanged === true &&
    Number(after.typedRows || 0) === Number(rerun.typedRows || 0) &&
    decimalEqual(
      after.typedChargedUsdcForLegacy,
      rerun.typedChargedUsdcForLegacy
    );
  if (rerunStable) return;
  fatal(
    "INVOCATION-BILLING-MIGRATION-IDEMPOTENCY",
    "migration-evidence.json",
    "rerunning migration changed row count or aggregate totals.",
    "make migration ON CONFLICT idempotent and rerun evidence."
  );
}

function payloadField(payload, field) {
  return payload?.[field] == null ? "" : String(payload[field]);
}

function validateInvocation(kind, db, required) {
  const evidence = db.invocations?.[kind];
  if (!evidence?.attempted) {
    validateSkippedInvocation(kind, evidence, required);
    return;
  }
  const row = evidence.db || {};
  validateInvocationStatus(kind, row);
  validateInvocationDualWrite(kind, row);
  validateInvocationLedger(kind, row);
  validateInvocationDelta(kind, row);
}

function validateSkippedInvocation(kind, evidence, required) {
  if (!required && evidence?.skippedWithReason) return;
  fatal(
    `INVOCATION-BILLING-${kind.toUpperCase()}-MISSING`,
    "db-evidence.json",
    `${kind} invoke was required but skipped.`,
    "provide an E2E agent credential and healthy provider service, then rerun."
  );
}

function validateInvocationStatus(kind, row) {
  const status = String(row.invocation?.status || "").toUpperCase();
  if (["SUCCEEDED", "SETTLED"].includes(status)) return;
  fatal(
    `INVOCATION-BILLING-${kind.toUpperCase()}-STATUS`,
    "db-evidence.json",
    `${kind} invocation status is ${status || "missing"}.`,
    "fix invoke path and rerun the migration regression."
  );
}

function validateInvocationDualWrite(kind, row) {
  const typed = row.typedBilling || {};
  const legacy = row.legacyBilling?.payload || {};
  if (!typed.invocation_id || !row.legacyBilling) {
    fatal(
      `INVOCATION-BILLING-${kind.toUpperCase()}-DUAL-WRITE`,
      "db-evidence.json",
      `${kind} invocation is missing typed or legacy billing row.`,
      "fix dual write in Gateway invocation billing persistence."
    );
  }
  const payloadMatches = [
    ["charged_usdc", "totalCharge"],
    ["unit_price_usdc", "unitPrice"],
    ["protocol_fee_usdc", "protocolFee"],
    ["routing_tax_usdc", "routingTax"],
  ].every(([typedField, legacyField]) =>
    decimalEqual(typed[typedField], payloadField(legacy, legacyField))
  );
  if (payloadMatches) return;
  fatal(
    `INVOCATION-BILLING-${kind.toUpperCase()}-PAYLOAD`,
    "db-evidence.json",
    `${kind} typed billing payload does not match legacy billing payload.`,
    "fix typed billing projection field mapping."
  );
}

function validateInvocationLedger(kind, row) {
  if (Array.isArray(row.ledger) && row.ledger.length > 0) return;
  fatal(
    `INVOCATION-BILLING-${kind.toUpperCase()}-LEDGER`,
    "db-evidence.json",
    `${kind} invocation has no ledger evidence.`,
    "fix settlement ledger writes or DB evidence query."
  );
}

function validateInvocationDelta(kind, row) {
  if (decimalEqual(row.reconciliationDeltaUsdc, "0.000000")) return;
  fatal(
    `INVOCATION-BILLING-${kind.toUpperCase()}-RECONCILIATION`,
    "db-evidence.json",
    `${kind} reconciliation delta is ${row.reconciliationDeltaUsdc}.`,
    "fix billing/ledger consistency before accepting migration."
  );
}

function validateAdminProjection(db) {
  if (
    !db.adminProjection?.financeProjection &&
    !db.adminProjection?.activityTrendToday
  ) {
    fatal(
      "INVOCATION-BILLING-ADMIN-PROJECTION",
      "db-evidence.json",
      "admin finance/activity projection was not captured.",
      "ensure gateway-admin projection views exist and runner can read them."
    );
  }
}

function validateUiEvidence(ui, screenshots) {
  if (!ui.attempted) {
    if (!ui.skippedWithReason) {
      fatal(
        "INVOCATION-BILLING-UI-SKIP-REASON",
        "ui-evidence.json",
        "UI verification was skipped without an explicit reason.",
        "record why browser UI capture is unavailable or enable INVOCATION_BILLING_UI_CAPTURE=1."
      );
    }
    return;
  }
  for (const page of ui.pages || []) {
    if ((page.forbiddenPresent || []).length > 0) {
      fatal(
        "INVOCATION-BILLING-UI-FORBIDDEN",
        "ui-evidence.json",
        `UI page ${page.name} had forbidden text: ${page.forbiddenPresent.join(
          ", "
        )}`,
        "fix the page/API/auth state before accepting screenshot evidence."
      );
    }
  }
  if (!Array.isArray(screenshots) || screenshots.length === 0) {
    fatal(
      "INVOCATION-BILLING-SCREENSHOTS",
      "screenshot-evidence.json",
      "UI capture was attempted but no screenshot metadata was recorded.",
      "capture screenshots only after DOM/API/DB checkpoints pass."
    );
  }
}

function validateSecretLeak(dir) {
  const combined = requiredFiles
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
    .join("\n");
  const patterns = [
    /postgres(?:ql)?:\/\/[^@\s]+@/i,
    /Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
    /\bagt_[A-Za-z0-9._~+/-]{16,}/i,
    /\b0x[a-fA-F0-9]{64}\b/,
    /"(?:password|privateKey|apiKey|secret|token|credential)"\s*:\s*"(?!\[REDACTED\])/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(combined)) {
      fatal(
        "INVOCATION-BILLING-SECRET-LEAK",
        dir,
        `evidence appears to contain secret-like material matching ${pattern}.`,
        "redact runner output and regenerate evidence."
      );
    }
  }
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "INVOCATION-BILLING-EVIDENCE-MISSING",
    evidenceRoot(),
    "no invocation billing migration evidence directory found.",
    `run npm run e2e:invocation-billing-migration:${environment} first.`
  );
  process.exit(process.exitCode || 1);
}

checkRequiredFiles(dir);
const report = readJson(path.join(dir, "report.json")) || {};
const migration = readJson(path.join(dir, "migration-evidence.json")) || {};
const db = readJson(path.join(dir, "db-evidence.json")) || {};
const ui = readJson(path.join(dir, "ui-evidence.json")) || {};
const screenshots = readJson(path.join(dir, "screenshot-evidence.json")) || [];

validateReport(report, dir);
for (const name of [
  "preflight_typed_billing_schema",
  "migration_totals_match_legacy_kv",
  "migration_idempotent_rerun_unchanged",
  "admin_projection_readable",
]) {
  assertCheck(report, name);
}
validateMigration(migration);
validateInvocation(
  "fixed",
  db,
  environment === "staging" ||
    process.env.INVOCATION_BILLING_REQUIRE_INVOKE === "1"
);
validateInvocation(
  "llm",
  db,
  environment === "staging" ||
    process.env.INVOCATION_BILLING_REQUIRE_LLM === "1"
);
validateAdminProjection(db);
validateUiEvidence(ui, screenshots);
validateSecretLeak(dir);

if (process.exitCode) process.exit(process.exitCode);
console.log(`[ci:invocation-billing-migration-evidence] validated ${dir}`);
