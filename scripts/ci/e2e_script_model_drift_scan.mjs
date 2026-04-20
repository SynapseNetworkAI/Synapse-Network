#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const TARGETS = [
  "scripts/e2e/admin_withdrawal_approval_seed.mjs",
  "scripts/e2e/admin_withdrawal_approval_reconcile.mjs",
  "scripts/ui/dogfood_admin_withdrawal_approval.mjs",
];

const failures = [];

function fail(file, invariant, why, fix) {
  failures.push({ file, invariant, why, fix });
}

for (const relativePath of TARGETS) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) continue;
  const text = fs.readFileSync(filePath, "utf8");
  const intentional = text.includes("model-drift: intentional");

  if (/account_kind\s*=\s*['"]provider['"]/.test(text) && !/provider_wallet/.test(text) && !intentional) {
    fail(
      relativePath,
      "FIN-MODEL-DRIFT-001",
      "E2E script hardcodes provider account kind without provider_wallet compatibility.",
      "Agent fix: import shared account-kind constants, query schema/projection, or add a narrow `model-drift: intentional` comment with the canonical table/field reason.",
    );
  }

  if (/synapse_account_balances/.test(text) && !/synapse_ledger_accounts/.test(text) && !intentional) {
    fail(
      relativePath,
      "FIN-MODEL-DRIFT-002",
      "E2E script queries balances without joining the ledger account model.",
      "Agent fix: reconcile through canonical ledger account tables or shared API projection; do not hardcode stale balance table assumptions.",
    );
  }

  if (/(PENDING_MANUAL_REVIEW|APPROVED_AUTO|COMPLETED|REJECTED)/.test(text) && !/(WITHDRAWAL_STATUS|withdrawal status source|model-drift: intentional)/i.test(text)) {
    fail(
      relativePath,
      "FIN-MODEL-DRIFT-003",
      "E2E script embeds withdrawal status strings without documenting the status source.",
      "Agent fix: import shared status constants when available, or add a `withdrawal status source` comment pointing to the backend state machine.",
    );
  }
}

if (failures.length > 0) {
  for (const row of failures) {
    console.error(`FATAL ${row.invariant}: ${row.file}`);
    console.error(`Why dangerous: ${row.why}`);
    console.error(row.fix);
  }
  process.exit(1);
}

console.log("[e2e-model-drift] withdrawal approval scripts are aligned with current model contracts");
