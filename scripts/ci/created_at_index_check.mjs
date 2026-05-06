#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

export const SCHEMA_FILES = [
  "infra/postgres/init/gateway/001_synapse_schema.sql",
  "services/gateway/migrations/postgres/001_synapse_schema.sql",
  "infra/postgres/init/gateway-admin/003_gateway_admin_projection_views.sql",
];

export function createdAtTables(sqlText) {
  const tables = [];
  const tablePattern =
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi;
  let match;
  while ((match = tablePattern.exec(sqlText)) !== null) {
    const tableName = match[1];
    const body = match[2];
    if (/\bcreated_at\s+TIMESTAMPTZ\b/i.test(body)) {
      tables.push(tableName);
    }
  }
  return tables;
}

export function createdAtIndexedTables(sqlText) {
  const tables = new Set();
  const indexPattern =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+[A-Za-z0-9_]+\s+ON\s+([A-Za-z0-9_]+)(?:\s+USING\s+[A-Za-z0-9_]+)?\s*\(([\s\S]*?)\)\s*(?:WHERE[\s\S]*?)?;/gi;
  let match;
  while ((match = indexPattern.exec(sqlText)) !== null) {
    const tableName = match[1];
    const columns = match[2];
    if (/\bcreated_at\b/i.test(columns)) {
      tables.add(tableName);
    }
  }
  return tables;
}

export function missingCreatedAtIndexes(sqlText) {
  const indexed = createdAtIndexedTables(sqlText);
  return createdAtTables(sqlText).filter(
    (tableName) => !indexed.has(tableName)
  );
}

function checkSchemaFile(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  const sqlText = fs.readFileSync(absolutePath, "utf8");
  return missingCreatedAtIndexes(sqlText).map((tableName) => ({
    file: relativePath,
    tableName,
  }));
}

function main() {
  const failures = SCHEMA_FILES.flatMap(checkSchemaFile);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `FATAL CREATED-AT-INDEX-MISSING: ${failure.file} ${failure.tableName}`
      );
      console.error(
        "Why dangerous: admin pagination defaults to created_at DESC, and missing indexes turn list pages into sequential scans under load."
      );
      console.error(
        `Agent fix: add CREATE INDEX IF NOT EXISTS idx_${failure.tableName}_created_at ON ${failure.tableName} (created_at DESC);`
      );
    }
    process.exit(1);
  }
  console.log("[created-at-indexes] all created_at tables are index-backed");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
