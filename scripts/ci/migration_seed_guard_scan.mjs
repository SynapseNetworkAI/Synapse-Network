#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function requireFile(relativePath) {
  const absolute = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolute)) {
    failures.push(`missing required file: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

function assertContains(relativePath, pattern, message) {
  const content = requireFile(relativePath);
  if (content && !pattern.test(content)) {
    failures.push(`${relativePath}: ${message}`);
  }
}

assertContains(
  "services/gateway/scripts/deploy/migrate_db.sh",
  /I_UNDERSTAND_THIS_CHANGES_PROD/,
  "prod migration confirmation guard is missing",
);
assertContains(
  "services/gateway/scripts/deploy/migrate_db.sh",
  /PROD detected: schema\/reference migration only; test seed skipped\./,
  "prod migration must explicitly log that test seed is skipped",
);
assertContains(
  "scripts/deploy/migrate_db.sh",
  /services\/gateway\/scripts\/deploy\/migrate_db\.sh/,
  "root migration wrapper must delegate to the service-local runner",
);

const canonicalSchema = read("infra/postgres/init/gateway/001_synapse_schema.sql");
const packagedSchema = requireFile("services/gateway/migrations/postgres/001_synapse_schema.sql");
if (packagedSchema && packagedSchema !== canonicalSchema) {
  failures.push("services/gateway/migrations/postgres/001_synapse_schema.sql drifted from infra/postgres/init/gateway/001_synapse_schema.sql");
}

const seedFiles = fs
  .readdirSync(path.join(ROOT, "scripts/e2e"))
  .filter((file) => /seed|dogfood/.test(file) && file.endsWith(".mjs"))
  .map((file) => `scripts/e2e/${file}`);

for (const seedFile of seedFiles) {
  const content = read(seedFile);
  const hasSeedGuard = content.includes("assertSeedEnvironment")
    || content.includes("assertLocalOnly")
    || content.includes("assertLocalDefaults")
    || /Refusing to (run|use).*non-local/i.test(content)
    || /Refusing .*outside CHAIN_ID=31337/i.test(content);
  if (!hasSeedGuard) {
    failures.push(`${seedFile}: missing local/staging/prod seed environment guard`);
  }
}

const seedGuard = read("scripts/e2e/seed_env_guard.mjs");
if (!/prod seeds are forbidden/.test(seedGuard)) {
  failures.push("scripts/e2e/seed_env_guard.mjs: missing explicit prod seed refusal");
}

const adminReferenceSql = read("infra/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql");
const insertStatements = adminReferenceSql.match(/INSERT INTO [\s\S]*?;/g) || [];
for (const statement of insertStatements) {
  if (/admin_(roles|permissions|role_permissions|config_documents)/.test(statement) && !/ON CONFLICT/i.test(statement)) {
    failures.push("gateway-admin reference data INSERT must be idempotent with ON CONFLICT");
  }
}

if (failures.length > 0) {
  console.error("[migration-seed-guard] failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("[migration-seed-guard] passed");
