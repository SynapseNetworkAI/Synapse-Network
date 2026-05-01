#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const environment = (
  process.env.GATEWAY_PULL_HEALTH_DOGFOOD_ENV ||
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
  "screenshot-evidence.json",
  "api-evidence.json",
  "invoke-evidence.json",
];
const commonRequiredScreenshots = [
  "01-marketplace-before-restart.png",
  "02-registry-before-restart-json.png",
  "03-marketplace-immediate-after-restart-fresh.png",
  "04-health-status-after-restart.png",
  "06-marketplace-after-rehydrate.png",
];
const localOnlyScreenshots = [
  "05-marketplace-expired-snapshot-fail-closed.png",
  "07-health-status-offline.png",
  "08-marketplace-after-reonboard.png",
  "09-provider-down-marketplace-removed.png",
];
const forbiddenScreenshotText = [
  "Connect Wallet",
  "Please connect your wallet",
  "Wallet not connected",
  "Application error",
  "Internal Server Error",
  "This page could not be found",
];

function evidenceRoot() {
  if (process.env.GATEWAY_PULL_HEALTH_EVIDENCE_DIR) {
    return path.resolve(process.env.GATEWAY_PULL_HEALTH_EVIDENCE_DIR);
  }
  if (environment === "staging") {
    return path.join(ROOT, "docs/evidence/staging/gateway-pull-health");
  }
  return path.join(ROOT, "output/dogfood/gateway-pull-health");
}

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function latestEvidenceDir() {
  const root = evidenceRoot();
  if (process.env.GATEWAY_PULL_HEALTH_EVIDENCE_DIR) return root;
  if (!fs.existsSync(root)) return "";
  return (
    fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && entry.name.endsWith(`-${environment}`)
      )
      .map((entry) => path.join(root, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fatal(
      "GATEWAY-PULL-HEALTH-EVIDENCE-JSON",
      filePath,
      `cannot parse evidence JSON: ${error.message}`,
      "rerun the dogfood runner; do not hand-edit evidence."
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

function checkRequiredFiles(dir) {
  for (const fileName of requiredFiles) {
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) {
      fatal(
        "GATEWAY-PULL-HEALTH-EVIDENCE-FILE",
        filePath,
        `required artifact is missing: ${fileName}`,
        "rerun the Gateway Pull Health dogfood E2E and checker together."
      );
    }
  }
}

function assertCheck(report, name) {
  const check = (report.checks || []).find((item) => item.name === name);
  if (!check || check.status !== "passed") {
    fatal(
      "GATEWAY-PULL-HEALTH-EVIDENCE-CHECK",
      "report.json",
      `required check is missing or failed: ${name}`,
      "fix the Gateway Pull Health behavior or runner checkpoint and regenerate evidence."
    );
  }
}

function validateScreenshots(dir, screenshots) {
  const byFile = new Map(
    (screenshots || []).map((item) => [path.basename(item.file || ""), item])
  );
  const required = [...commonRequiredScreenshots];
  if (environment === "local") required.push(...localOnlyScreenshots);
  for (const fileName of required) {
    const item = byFile.get(fileName);
    const filePath = path.join(dir, "screenshots", fileName);
    if (!item || !fs.existsSync(filePath)) {
      fatal(
        "GATEWAY-PULL-HEALTH-EVIDENCE-SCREENSHOT",
        filePath,
        `required screenshot is missing: ${fileName}`,
        "rerun the dogfood runner so every UI checkpoint has a PNG and metadata."
      );
      continue;
    }
    if (item.expectedVisible !== true || item.forbiddenTextAbsent !== true) {
      fatal(
        "GATEWAY-PULL-HEALTH-SCREENSHOT-CHECKPOINT",
        filePath,
        `screenshot checkpoint failed; expectedVisible=${item.expectedVisible}, forbiddenTextAbsent=${item.forbiddenTextAbsent}`,
        "fix the page state before capture; screenshots cannot be loading, error, wallet-gated, or unrelated pages."
      );
    }
    const text = JSON.stringify(item);
    for (const forbidden of forbiddenScreenshotText) {
      if (
        text.includes(forbidden) &&
        item.forbiddenPresent?.includes?.(forbidden)
      ) {
        fatal(
          "GATEWAY-PULL-HEALTH-SCREENSHOT-FORBIDDEN",
          filePath,
          `screenshot contains forbidden UI state: ${forbidden}`,
          "capture after the expected Marketplace/API state is visible, not while an overlay or error is present."
        );
      }
    }
  }
}

function validateApiEvidence(api, expectedServiceIds) {
  const before = api.snapshots?.before_restart;
  const immediate = api.snapshots?.immediate_after_restart;
  const expired = api.snapshots?.expired_snapshots;
  const offline = api.snapshots?.offline_quarantine;
  const reonboarded = api.snapshots?.rehydrate_poll;
  const rehydrated =
    api.snapshots?.rehydrate_poll || api.snapshots?.rehydrate_timeout;
  if (!before || !immediate || !rehydrated) {
    fatal(
      "GATEWAY-PULL-HEALTH-API-SNAPSHOTS",
      "api-evidence.json",
      "before/immediate/rehydrate API snapshots are required.",
      "rerun dogfood; each screenshot needs matching registry, health, stats, and discover snapshots."
    );
    return;
  }
  for (const [label, snapshot] of Object.entries(api.snapshots || {})) {
    const diagnostics = snapshot?.registry?.diagnostics;
    const stats = snapshot?.stats;
    if (!diagnostics || !stats) continue;
    for (const [diagnosticKey, statsKey] of [
      ["registeredTotal", "registeredServices"],
      ["discoverableTotal", "discoverableServices"],
      ["staleTotal", "staleServices"],
      ["offlineTotal", "offlineServices"],
      ["unavailableTotal", "unavailableServices"],
    ]) {
      if (
        diagnostics[diagnosticKey] !== undefined &&
        stats[statsKey] !== undefined &&
        Number(diagnostics[diagnosticKey]) !== Number(stats[statsKey])
      ) {
        fatal(
          "GATEWAY-PULL-HEALTH-STATS-MISMATCH",
          "api-evidence.json",
          `${label} mismatch: registry.diagnostics.${diagnosticKey}=${diagnostics[diagnosticKey]} but network-stats.${statsKey}=${stats[statsKey]}`,
          "fix registry.json diagnostics or Gateway network-stats so all public status surfaces agree."
        );
      }
    }
  }
  const beforeIds = new Set(
    (before.registry?.services || []).map((row) => row.serviceId)
  );
  const immediateIds = new Set(
    (immediate.registry?.services || []).map((row) => row.serviceId)
  );
  const rehydratedIds = new Set(
    (rehydrated.registry?.services || []).map((row) => row.serviceId)
  );
  const healthIds = new Set(
    (immediate.health?.services || []).map((row) => row.serviceId)
  );
  for (const serviceId of expectedServiceIds) {
    if (!beforeIds.has(serviceId)) {
      fatal(
        "GATEWAY-PULL-HEALTH-BEFORE-MISSING",
        "api-evidence.json",
        `expected service is not visible before restart: ${serviceId}`,
        "onboard the provider fixture before running the dogfood E2E."
      );
    }
    if (!immediateIds.has(serviceId)) {
      fatal(
        "GATEWAY-PULL-HEALTH-FRESH-RESTART-MISSING",
        "api-evidence.json",
        `expected service disappeared immediately after fresh restart: ${serviceId}`,
        "Gateway should trust fresh persisted health snapshots across restart; only expired snapshots should fail closed."
      );
    }
    if (!healthIds.has(serviceId)) {
      fatal(
        "GATEWAY-PULL-HEALTH-REGISTRATION-LOST",
        "api-evidence.json",
        `expected service disappeared from health/status after restart: ${serviceId}`,
        "registered rows must survive restart; only health snapshots should become stale."
      );
    }
    if (!rehydratedIds.has(serviceId)) {
      fatal(
        "GATEWAY-PULL-HEALTH-REHYDRATE-MISSING",
        "api-evidence.json",
        `expected service did not reappear after health monitor rehydrate: ${serviceId}`,
        "fix provider /health, monitor jitter/worker pool, or wait window."
      );
    }
  }
  if (environment === "local") {
    if (!expired || !offline || !reonboarded) {
      fatal(
        "GATEWAY-PULL-HEALTH-LOCAL-SNAPSHOTS",
        "api-evidence.json",
        "local evidence must include expired_snapshots, offline_quarantine, and rehydrate/re-onboard snapshots.",
        "rerun local dogfood after implementing expired/offline/re-onboard checkpoints."
      );
      return;
    }
    const expiredIds = new Set(
      (expired.registry?.services || []).map((row) => row.serviceId)
    );
    for (const serviceId of expectedServiceIds) {
      if (expiredIds.has(serviceId)) {
        fatal(
          "GATEWAY-PULL-HEALTH-EXPIRED-DISCOVERABLE",
          "api-evidence.json",
          `expired health snapshot stayed discoverable: ${serviceId}`,
          "Expired health snapshots must fail closed while preserving registration rows."
        );
      }
    }
    const offlineRows = new Map(
      (offline.health?.services || []).map((row) => [row.serviceId, row])
    );
    const offlineServiceId = expectedServiceIds[0];
    const offlineRow = offlineRows.get(offlineServiceId);
    if (String(offlineRow?.status || "").toLowerCase() !== "offline") {
      fatal(
        "GATEWAY-PULL-HEALTH-OFFLINE-MISSING",
        "api-evidence.json",
        `expected first canonical service to be offline; got ${
          offlineRow?.status || "missing"
        }`,
        "offline quarantine evidence must show the service is non-discoverable and marked offline."
      );
    }
    const reonboardedIds = new Set(
      (reonboarded.registry?.services || []).map((row) => row.serviceId)
    );
    if (!reonboardedIds.has(offlineServiceId)) {
      fatal(
        "GATEWAY-PULL-HEALTH-REONBOARD-MISSING",
        "api-evidence.json",
        `re-onboarded service did not return to registry: ${offlineServiceId}`,
        "upsert the same serviceId and force-probe successfully before capturing re-onboard evidence."
      );
    }
  }
}

function validateInvokeEvidence(invoke) {
  if (invoke.attempted !== true) {
    fatal(
      "GATEWAY-PULL-HEALTH-INVOKE-MISSING",
      "invoke-evidence.json",
      "LLM no-hold path was not attempted.",
      "set GATEWAY_PULL_HEALTH_E2E_CREDENTIAL and rerun the dogfood gate."
    );
    return;
  }
  if (
    invoke.status !== 503 ||
    invoke.holdCreated !== false ||
    invoke.frozenDelta !== "0.000000"
  ) {
    fatal(
      "GATEWAY-PULL-HEALTH-INVOKE-HOLD",
      "invoke-evidence.json",
      `expected 503/no-hold evidence, got status=${invoke.status}, holdCreated=${invoke.holdCreated}, frozenDelta=${invoke.frozenDelta}`,
      "Gateway must check fresh healthy target before creating hold for LLM invocations."
    );
  }
}

function validateNoOpenBugs(dir) {
  const bugfix = fs.readFileSync(path.join(dir, "bugfix-log.md"), "utf8");
  if (!/No open bugs\./.test(bugfix) || /Status:\s*open/i.test(bugfix)) {
    fatal(
      "GATEWAY-PULL-HEALTH-BUGFIX-OPEN",
      "bugfix-log.md",
      "bugfix log contains open failures or does not explicitly state no open bugs.",
      "fix failures, rerun the dogfood E2E, and regenerate evidence."
    );
  }
}

function validateSecretScan(dir) {
  const text = requiredFiles
    .map((fileName) => fs.readFileSync(path.join(dir, fileName), "utf8"))
    .join("\n");
  const patterns = [
    /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
    /\b0x[a-fA-F0-9]{64,}\b/,
    /agt_[A-Za-z0-9._~+/-]{12,}/i,
    /postgres(?:ql)?:\/\/[^@\s]+@/i,
    /"(?:privateKey|rawSignature|jwt|adminToken|accessToken|apiKey|secret|password|token|credential)"\s*:\s*"(?!\[REDACTED\])[^"]+"/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      fatal(
        "GATEWAY-PULL-HEALTH-EVIDENCE-SECRET",
        dir,
        `evidence appears to contain a secret-like value matching ${pattern}`,
        "redact credentials, private keys, signatures, DB URLs, and tokens before writing evidence."
      );
    }
  }
}

const dir = latestEvidenceDir();
if (!dir) {
  fatal(
    "GATEWAY-PULL-HEALTH-EVIDENCE-MISSING",
    "",
    `no Gateway Pull Health dogfood evidence found for environment=${environment}`,
    `run npm run e2e:gateway-pull-health-dogfood:${environment} first.`
  );
}
if (process.exitCode) process.exit(process.exitCode);

checkRequiredFiles(dir);
if (process.exitCode) process.exit(process.exitCode);

const report = readJson(path.join(dir, "report.json"));
const screenshots = readJson(path.join(dir, "screenshot-evidence.json"));
const api = readJson(path.join(dir, "api-evidence.json"));
const invoke = readJson(path.join(dir, "invoke-evidence.json"));
if (!report || !screenshots || !api || !invoke)
  process.exit(process.exitCode || 1);

if (report.environment !== environment) {
  fatal(
    "GATEWAY-PULL-HEALTH-EVIDENCE-ENV",
    "report.json",
    `environment mismatch: expected=${environment}, actual=${report.environment}`,
    "rerun the checker with the same GATEWAY_PULL_HEALTH_DOGFOOD_ENV used by the runner."
  );
}
if (
  report.status !== "passed" ||
  !Array.isArray(report.failed) ||
  report.failed.length > 0
) {
  fatal(
    "GATEWAY-PULL-HEALTH-EVIDENCE-FAILED",
    "report.json",
    `report status=${report.status}; failed=${JSON.stringify(
      report.failed || []
    ).slice(0, 800)}`,
    "fix the failed dogfood checkpoints and regenerate evidence."
  );
}
const tracePath = path.join(dir, "trace.jsonl");
if (!report.traceDigest || report.traceDigest !== sha256File(tracePath)) {
  fatal(
    "GATEWAY-PULL-HEALTH-TRACE-DIGEST",
    tracePath,
    "trace digest does not match report.json.",
    "rerun the dogfood runner so trace and report are generated together."
  );
}

for (const checkName of [
  "before_restart_expected_services_registered",
  "before_restart_expected_services_discoverable",
  "restart_registered_not_lost",
  "restart_fresh_snapshot_expected_services_visible",
  "rehydrate_expected_services_discoverable",
  "llm_unavailable_no_hold",
]) {
  assertCheck(report, checkName);
}
if (environment === "local") {
  for (const checkName of [
    "local_cleanup_dry_evidence_available",
    "local_llm_unavailable_fixture_applied",
    "expired_snapshot_expected_services_fail_closed",
    "expired_snapshot_registration_not_lost",
    "local_offline_lifecycle_schema_available",
    "offline_service_removed_from_registry",
    "offline_reonboard_upsert_succeeded",
    "offline_reonboard_service_discoverable",
  ]) {
    assertCheck(report, checkName);
  }
  assertCheck(report, "provider_down_expected_services_removed");
}

const expectedServiceIds =
  report.expectedServiceIds || api.expectedServiceIds || [];
validateScreenshots(dir, screenshots);
validateApiEvidence(api, expectedServiceIds);
validateInvokeEvidence(invoke);
validateNoOpenBugs(dir);
validateSecretScan(dir);

if (process.exitCode) process.exit(process.exitCode);
console.log(`[ci:gateway-pull-health-dogfood-evidence] validated ${dir}`);
