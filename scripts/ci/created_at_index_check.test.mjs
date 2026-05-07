import assert from "node:assert/strict";
import test from "node:test";

import {
  createdAtIndexedTables,
  createdAtTables,
  missingCreatedAtIndexes,
} from "./created_at_index_check.mjs";

test("createdAtTables finds tables with created_at columns", () => {
  const sql = `
CREATE TABLE IF NOT EXISTS ignored_table (
    id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS indexed_table (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

  assert.deepEqual(createdAtTables(sql), ["indexed_table"]);
});

test("createdAtIndexedTables accepts single and composite created_at indexes", () => {
  const sql = `
CREATE INDEX IF NOT EXISTS idx_single
ON indexed_table (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_composite
ON composite_table (owner_id, created_at DESC);
`;

  assert.deepEqual([...createdAtIndexedTables(sql)].sort(), [
    "composite_table",
    "indexed_table",
  ]);
});

test("missingCreatedAtIndexes reports only created_at tables without indexes", () => {
  const sql = `
CREATE TABLE IF NOT EXISTS missing_table (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS indexed_table (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indexed_table_created_at
ON indexed_table (created_at DESC);
`;

  assert.deepEqual(missingCreatedAtIndexes(sql), ["missing_table"]);
});
