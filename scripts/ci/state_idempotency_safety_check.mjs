#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

function fatal(code, file, why, fix) {
  console.error(`FATAL ${code}${file ? `: ${file}` : ""}`);
  console.error(`Why dangerous: ${why}`);
  console.error(`Agent fix: ${fix}`);
  process.exitCode = 1;
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function changedFiles() {
  if (process.env.STATE_IDEMPOTENCY_SCOPE === "full") {
    return [];
  }
  const out = execFileSync(
    "git",
    ["-C", ROOT, "status", "--short", "--untracked-files=all"],
    { encoding: "utf8" }
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^.. /, "").replace(/^.+ -> /, ""))
    .filter((file) => fs.existsSync(path.join(ROOT, file)));
}

function assertContains(file, needle, code, why, fix) {
  if (!read(file).includes(needle)) {
    fatal(code, file, why, fix);
  }
}

const withdrawMixin =
  "services/gateway/src/storage/postgres/repositories/finance_atomic_withdraw_mixin.py";
const depositMixin =
  "services/gateway/src/storage/postgres/repositories/finance_atomic_deposit_mixin.py";
const providerWithdrawService =
  "services/gateway/src/services/provider/withdraw_service.py";
const refundExecMixin =
  "services/gateway/src/services/owner/finance_refund_exec_mixin.py";
const balanceWithdrawRouter =
  "services/gateway/src/api/routers/balance_withdraw.py";
const balanceDepositRouter =
  "services/gateway/src/api/routers/balance_deposit.py";

for (const file of [
  withdrawMixin,
  depositMixin,
  providerWithdrawService,
  refundExecMixin,
  balanceWithdrawRouter,
  balanceDepositRouter,
]) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    fatal(
      "STATE-IDEMPOTENCY-000",
      file,
      "A finance-state safety guard target is missing.",
      "Update state_idempotency_safety_check.mjs after moving finance state files."
    );
  }
}

assertContains(
  withdrawMixin,
  "FOR UPDATE",
  "STATE-IDEMPOTENCY-001",
  "withdraw complete must lock the target order row before binding txHash or consuming pending funds.",
  "Make complete_withdraw_tx_atomic select the withdrawal row FOR UPDATE."
);
assertContains(
  withdrawMixin,
  "UPDATE synapse_account_balances",
  "STATE-IDEMPOTENCY-002",
  "withdraw complete must consume pending funds in the same database transaction as final status.",
  "Move pending-balance consumption into complete_withdraw_tx_atomic."
);
assertContains(
  withdrawMixin,
  "pending_balance = pending_balance -",
  "STATE-IDEMPOTENCY-003",
  "withdraw complete must only subtract pending once through an atomic SQL delta.",
  "Use an atomic pending_balance decrement guarded by pending_balance >= amount."
);
assertContains(
  withdrawMixin,
  "status = ANY",
  "STATE-IDEMPOTENCY-004",
  "withdraw complete must be a CAS transition from allowed active statuses, not an unconditional status update.",
  "Add expected-status filtering to the final UPDATE synapse_vault_withdrawals statement."
);
assertContains(
  withdrawMixin,
  "WITHDRAWAL_PENDING_BALANCE_INCONSISTENT",
  "STATE-IDEMPOTENCY-005",
  "pending-bucket inconsistency must fail closed instead of marking the order completed.",
  "Raise a clear lock inconsistency error when pending balance cannot be consumed."
);
assertContains(
  depositMixin,
  'row.status.upper() == "CONFIRMED"',
  "STATE-IDEMPOTENCY-006",
  "deposit confirm replay must return the confirmed row without replaying pending-to-available movement.",
  "Keep an early CONFIRMED check before any balance or audit mutation."
);
assertContains(
  depositMixin,
  "eventKey=command.event_key",
  "STATE-IDEMPOTENCY-007",
  "callers need a durable signal that a confirm call performed the first confirmation.",
  "Return eventKey only on the first successful confirm so audit/outbox can dedupe replays."
);
assertContains(
  depositMixin,
  "AND status IN ('PENDING_CONFIRMATION', 'PENDING')",
  "STATE-IDEMPOTENCY-007A",
  "deposit confirm must be a CAS transition from pending statuses, not an unconditional status update.",
  "Add expected-status filtering to UPDATE synapse_vault_deposits."
);
assertContains(
  depositMixin,
  "cur.rowcount != 1",
  "STATE-IDEMPOTENCY-007B",
  "deposit confirm must fail closed when the CAS update did not advance exactly one order row.",
  "Check rowcount after UPDATE synapse_vault_deposits and raise on mismatch."
);
assertContains(
  providerWithdrawService,
  "if not used_atomic_complete:",
  "STATE-IDEMPOTENCY-008",
  "provider complete must not consume pending twice after the storage atomic already consumed it.",
  "Skip service-layer pending consumption when complete_withdraw_tx_atomic is used."
);
assertContains(
  refundExecMixin,
  "if not used_atomic_complete:",
  "STATE-IDEMPOTENCY-009",
  "consumer/refund complete must not consume pending twice after the storage atomic already consumed it.",
  "Skip service-layer pending consumption when complete_withdraw_tx_atomic is used."
);
assertContains(
  balanceWithdrawRouter,
  'result.get("idempotentReplay")',
  "STATE-IDEMPOTENCY-010",
  "duplicate provider complete must not enqueue duplicate transaction notifications.",
  "Gate complete notifications on the idempotentReplay marker."
);
assertContains(
  balanceDepositRouter,
  'confirmed.get("eventKey")',
  "STATE-IDEMPOTENCY-011",
  "duplicate deposit confirm must not enqueue duplicate deposit notifications.",
  "Only schedule deposit-confirmed notifications when the returned eventKey matches this confirm event."
);

const highRiskRewriteTables = [
  "synapse_account_balances",
  "synapse_vault_withdrawals",
  "synapse_vault_deposits",
  "synapse_ledger_entries",
  "synapse_withdraw_tx_dedup",
];
const highRiskStatusTables = [
  "synapse_vault_withdrawals",
  "synapse_vault_deposits",
  "admin_approvals",
  "admin_execution_jobs",
  "synapse_forum_response_tasks",
  "synapse_forum_topics",
];
for (const file of changedFiles()) {
  if (!/\.(py|sql|mjs|sh)$/.test(file)) continue;
  const text = read(file);
  for (const table of highRiskRewriteTables) {
    const pattern = new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, "i");
    if (pattern.test(text)) {
      fatal(
        "STATE-IDEMPOTENCY-012",
        file,
        `Full-row deletion from ${table} in changed code can erase idempotency or funds evidence.`,
        "Replace full rewrite/delete with keyed CAS, tombstone, or an explicitly test-only helper outside runtime paths."
      );
    }
  }
  for (const table of highRiskStatusTables) {
    const pattern = new RegExp(
      `UPDATE\\s+${table}\\b[\\s\\S]{0,900}?SET[\\s\\S]{0,500}?status\\s*=`,
      "gi"
    );
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const snippet = text.slice(match.index ?? 0, (match.index ?? 0) + 1600);
      if (!/WHERE[\s\S]{0,900}status\s*(?:=|IN|= ANY)/i.test(snippet)) {
        fatal(
          "STATE-IDEMPOTENCY-013",
          file,
          `Status update on ${table} does not visibly include an expected-status condition near the UPDATE.`,
          "Make state transitions keyed by business id and guarded by expected status CAS."
        );
      }
    }
  }
}

if (!process.exitCode) {
  console.log("[state-idempotency-safety] passed");
}
