#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const REQUIRED_FILES = [
  "report.md",
  "report.json",
  "environment-manifest.json",
  "contract-manifest.json",
  "traffic-summary.json",
  "reconciliation-summary.json",
];
const REQUIRED_LANES = ["invoke", "balance", "deposit-confirm", "withdrawal", "provider-health", "admin-finance"];

function latestReportPath() {
  if (process.env.SYNAPSE_LOCAL_LOAD_EVIDENCE_DIR) {
    return path.join(path.resolve(process.env.SYNAPSE_LOCAL_LOAD_EVIDENCE_DIR), "report.json");
  }
  if (process.env.SYNAPSE_LOCAL_LOAD_REPORT) {
    return path.resolve(process.env.SYNAPSE_LOCAL_LOAD_REPORT);
  }
  const base = path.join(ROOT, "docs/evidence/performance");
  if (!fs.existsSync(base)) return "";
  return fs.readdirSync(base)
    .filter((name) => name.endsWith("-local-production-load-rehearsal"))
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
    rehearsalRunId: report.rehearsalRunId,
    environment: report.environment,
    config: report.config,
    walletPool: report.walletPool,
    lanes: report.lanes,
    reconciliation: report.reconciliation,
    metrics: report.metrics,
    failed: report.failed,
    warnings: report.warnings,
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

function scanSecrets(outDir) {
  const offenders = [];
  const files = REQUIRED_FILES.map((name) => path.join(outDir, name)).filter((filePath) => fs.existsSync(filePath));
  const forbiddenKeyRegex = /"(?:privateKey|mnemonic|rawSignature|signature|jwt|adminToken|accessToken|authorization|cookie|secretKey)"\s*:\s*"[^"]+"/i;
  const forbiddenTokenRegex = /\b(?:Bearer\s+[A-Za-z0-9._~+/=-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,})\b/;
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    if (forbiddenKeyRegex.test(text) || forbiddenTokenRegex.test(text)) offenders.push(filePath);
  }
  return offenders;
}

const reportPath = latestReportPath();
if (!reportPath) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-001",
    "",
    "local MVP production-load rehearsal evidence is missing.",
    "run npm run perf:local-production-load-rehearsal, then rerun npm run ci:local-production-load-evidence.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

const outDir = path.dirname(reportPath);
const report = readJson(reportPath);

for (const fileName of REQUIRED_FILES) {
  const filePath = path.join(outDir, fileName);
  if (!fs.existsSync(filePath)) {
    fatal(
      "LOCAL-LOAD-EVIDENCE-002",
      filePath,
      `required local load evidence artifact is missing: ${fileName}`,
      "rerun the local production-load rehearsal; do not hand-assemble partial evidence.",
    );
  }
}

if (report.status !== "success" || (Array.isArray(report.failed) && report.failed.length > 0)) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-003",
    reportPath,
    `report status is ${report.status}; failures=${JSON.stringify(report.failed || []).slice(0, 800)}`,
    "fix the failing lane or reconciliation issue and regenerate the local load evidence.",
  );
}

if (!report.rehearsalRunId || !String(report.rehearsalRunId).startsWith("lplr-")) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-004",
    reportPath,
    "report is missing a local-production-load rehearsalRunId.",
    "rerun the local load rehearsal so every wallet, request id, and evidence artifact is scoped to a unique run id.",
  );
}

const manifest = readJson(path.join(outDir, "environment-manifest.json"));
if (manifest.rehearsalRunId !== report.rehearsalRunId) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-005",
    path.join(outDir, "environment-manifest.json"),
    "manifest run id does not match report run id.",
    "do not edit evidence by hand; rerun the rehearsal so artifacts are generated from one run.",
  );
}

const lanes = Array.isArray(report.lanes) ? report.lanes : [];
for (const laneName of REQUIRED_LANES) {
  const lane = lanes.find((row) => row.name === laneName);
  if (!lane) {
    fatal(
      "LOCAL-LOAD-EVIDENCE-006",
      reportPath,
      `required lane is missing: ${laneName}`,
      "rerun the local production-load rehearsal; required lanes are invoke, balance, deposit-confirm, withdrawal, provider-health, and admin-finance.",
    );
  } else if (Number(lane.requests || 0) <= 0) {
    fatal(
      "LOCAL-LOAD-EVIDENCE-007",
      reportPath,
      `required lane recorded no requests: ${laneName}`,
      "fix the lane task generator so each required local load lane executes at least one request.",
    );
  }
}

const metrics = report.metrics || {};
const reconciliation = report.reconciliation || {};
if (metrics.chainNonceCollisionCount !== 0 || reconciliation.chainNonceCollisionCount !== 0) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-008",
    reportPath,
    `chain nonce collisions were observed: metrics=${metrics.chainNonceCollisionCount}, reconciliation=${reconciliation.chainNonceCollisionCount}`,
    "restore per-wallet mutexes and enough temporary wallets; clean local pass requires chainNonceCollisionCount === 0.",
  );
}

if (metrics.unexpectedGateway5xx !== 0 || reconciliation.unexpectedGateway5xx !== 0) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-009",
    reportPath,
    `unexpected Gateway 5xx responses were observed: ${metrics.unexpectedGateway5xx ?? reconciliation.unexpectedGateway5xx}`,
    "inspect lane sampleErrors, fix the Gateway/admin failure, and rerun rehearsal.",
  );
}

if (metrics.abandonedInFlight !== 0 || reconciliation.abandonedInFlight !== 0 || metrics.drainExceededHardCap || reconciliation.drainExceededHardCap) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-010",
    reportPath,
    "graceful drain did not finish within the hard cap.",
    "fix hanging requests or lower local concurrency; the runner must exit deterministically before evidence is accepted.",
  );
}

if (String(reconciliation.unexplainedDeltaUsdc || "") !== "0.000000") {
  fatal(
    "LOCAL-LOAD-EVIDENCE-011",
    reportPath,
    `unexplained financial delta is not zero: ${reconciliation.unexplainedDeltaUsdc}`,
    "reconcile ledger/vault expectations for this run id and fix the money movement mismatch before accepting evidence.",
  );
}

const walletPool = report.walletPool || {};
const consumers = Array.isArray(walletPool.consumers) ? walletPool.consumers : [];
const providers = Array.isArray(walletPool.providers) ? walletPool.providers : [];
const allAddresses = [...consumers, ...providers].map((wallet) => String(wallet.address || "").toLowerCase());
if (consumers.length !== Number(walletPool.consumerWalletCount || 0) || providers.length !== Number(walletPool.providerWalletCount || 0)) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-012",
    reportPath,
    "wallet count fields do not match wallet address arrays.",
    "ensure the evidence manifest records every temporary consumer/provider wallet address and no private key material.",
  );
}
if (new Set(allAddresses).size !== allAddresses.length || allAddresses.some((address) => !/^0x[a-f0-9]{40}$/.test(address))) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-013",
    reportPath,
    "wallet address pool is missing, duplicated, or malformed.",
    "generate a fresh temporary wallet pool per REHEARSAL_RUN_ID and bind each lane to a valid address shard.",
  );
}

const secretOffenders = scanSecrets(outDir);
if (secretOffenders.length) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-014",
    secretOffenders.join(", "),
    "evidence appears to contain a private key, raw signature, JWT/admin token, cookie, or bearer token.",
    "redact secrets at generation time; never commit or accept evidence containing raw signing or auth material.",
  );
}

if (!report.evidenceDigest || report.evidenceDigest !== digest(report)) {
  fatal(
    "LOCAL-LOAD-EVIDENCE-015",
    reportPath,
    "evidence digest cannot be recomputed from report payload.",
    "do not hand-edit report.json; rerun the local production-load rehearsal.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

console.log(`[local-production-load-evidence] passed: ${reportPath}`);
console.log(`[local-production-load-evidence] lanes=${lanes.length} wallets=${allAddresses.length}`);
