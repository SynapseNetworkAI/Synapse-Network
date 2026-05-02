#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const timestamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "")
  .replace("Z", "Z");
const outDir =
  process.env.ADMIN_WITHDRAWAL_REVIEW_EVIDENCE_DIR ||
  path.join(
    ROOT,
    "output/dogfood/admin-withdrawal-review",
    `${timestamp}-local-admin-withdrawal-review`
  );

const env = {
  ...process.env,
  SYNAPSE_E2E_ENV: "local",
  ALLOW_GCP_SECRET_MANAGER: "0",
  WITHDRAWAL_REVIEW_DOGFOOD_ENV: "local",
  WITHDRAWAL_REVIEW_DOGFOOD_OUT_DIR: outDir,
  ADMIN_WITHDRAWAL_REVIEW_E2E: "1",
};

const result = spawnSync(
  process.execPath,
  [path.join(ROOT, "scripts/e2e/withdrawal_review_dogfood.mjs")],
  {
    cwd: ROOT,
    env,
    stdio: "inherit",
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
