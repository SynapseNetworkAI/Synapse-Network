#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const SCAN_DIRS = ["scripts/e2e", "scripts/perf", "scripts/drills"];
const DIRECT_SECRET_RE =
  /gcloud[\s\S]{0,240}secrets[\s\S]{0,240}versions[\s\S]{0,240}access|secrets[\s\S]{0,240}versions[\s\S]{0,240}access[\s\S]{0,240}gcloud/i;
const ENV_STAGING_RE = /\.env\.staging/;
const ALLOWED_DIRECT_SECRET_FILES = new Set([
  "scripts/drills/gcp_staging_backup_restore_drill.sh",
]);
const ALLOWED_ENV_STAGING_FILES = new Set([
  "scripts/e2e/staging_smoke_e2e.mjs",
]);

function walk(dir) {
  const fullDir = path.join(ROOT, dir);
  if (!fs.existsSync(fullDir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
    const fullPath = path.join(fullDir, entry.name);
    const relPath = path.relative(ROOT, fullPath);
    if (entry.isDirectory()) {
      result.push(...walk(relPath));
    } else if (/\.(mjs|js|sh|py)$/.test(entry.name)) {
      result.push(relPath);
    }
  }
  return result;
}

function isStagingOnlyE2eFile(file) {
  const base = path.basename(file).toLowerCase();
  return (
    base.startsWith("staging_") ||
    base.includes("_staging_") ||
    base.includes("staging")
  );
}

const failures = [];
for (const file of SCAN_DIRS.flatMap(walk).sort()) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  if (DIRECT_SECRET_RE.test(text) && !ALLOWED_DIRECT_SECRET_FILES.has(file)) {
    failures.push({
      file,
      code: "E2E-ENV-SECRET-001",
      message:
        "Direct gcloud Secret Manager reads are forbidden. Use scripts/lib/e2e_env_guard.mjs secret helpers.",
    });
  }
  if (
    file.startsWith("scripts/e2e/") &&
    ENV_STAGING_RE.test(text) &&
    !ALLOWED_ENV_STAGING_FILES.has(file) &&
    !isStagingOnlyE2eFile(file)
  ) {
    failures.push({
      file,
      code: "E2E-ENV-STAGING-FILE-001",
      message:
        "Dual-mode/local E2E scripts must not load .env.staging. Use local env files for local and explicit staging env/Secret wrapper for staging.",
    });
  }
}

if (failures.length > 0) {
  console.error(
    "FATAL E2E-ENV-ISOLATION-001: E2E environment isolation check failed."
  );
  for (const failure of failures) {
    console.error(`${failure.code}: ${failure.file}: ${failure.message}`);
  }
  process.exit(1);
}

console.log("[e2e-env-isolation] passed");
