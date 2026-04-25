#!/usr/bin/env node

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(ROOT, "scripts/ci/staging_core_dogfood_evidence_check.mjs");

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function makeEvidence(mutator = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "staging-core-dogfood-"));
  fs.mkdirSync(path.join(dir, "screenshots"), { recursive: true });
  const screenshots = [
    "screenshots/user-deposit-entry.png",
    "screenshots/user-balance-before.png",
    "screenshots/user-balance-after.png",
    "screenshots/user-withdrawal-entry.png",
    "screenshots/admin-review.png",
    "screenshots/admin-audit.png",
    "screenshots/reconciliation.png",
  ];
  for (const screenshot of screenshots) {
    fs.writeFileSync(path.join(dir, screenshot), "png-fixture");
  }
  const traceRows = [
    { runId: "fixture", scenario: "deposit", timestamp: "2026-04-25T00:00:00.000Z", txHash: "0xabc" },
    {
      runId: "fixture",
      scenario: "consumer_withdrawal",
      timestamp: "2026-04-25T00:00:01.000Z",
      actual: { replay: { reverted: true }, consumed: true },
      ticketHash: "0xdef",
    },
    {
      runId: "fixture",
      scenario: "ledger_vault_reconciliation",
      timestamp: "2026-04-25T00:00:02.000Z",
      ledgerDelta: "0.000000",
      vaultDelta: "0.000000",
      reconciliationStatus: "passed",
    },
  ];
  let traceText = traceRows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const report = {
    status: "success",
    environment: "staging",
    traceDigest: crypto.createHash("sha256").update(traceText).digest("hex"),
    failed: [],
    checks: [
      { name: "preflight:staging-chain-db-api", ok: true },
      { name: "ui:screenshots", ok: true },
      { name: "deposit:chain-api-db", ok: true },
      { name: "withdrawal:small-ticket-claim-replay", ok: true },
      { name: "withdrawal:manual-review", ok: true },
      { name: "reconciliation:ledger-vault-zero", ok: true },
    ],
    screenshots,
    reconciliation: { ledgerDelta: "0.000000", vaultDelta: "0.000000", status: "passed" },
  };
  const api = [{ method: "GET", path: "/health", httpStatus: 200 }];
  const db = {
    deposit: [{ status: "CONFIRMED", tx_hash: "0xabc" }],
    smallWithdrawal: [{ status: "COMPLETED", withdrawal_id: "wd_fixture" }],
  };
  const chain = { deposit: { txHash: "0xabc" }, finalConsumer: { vaultAtomic: "1" } };
  const state = { report, traceRows, api, db, chain, screenshots };
  mutator(state, dir);
  traceText = state.traceText ?? state.traceRows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  if (state.recomputeDigest !== false) {
    state.report.traceDigest = crypto.createHash("sha256").update(traceText).digest("hex");
  }
  fs.writeFileSync(path.join(dir, "trace.jsonl"), traceText);
  writeJson(path.join(dir, "report.json"), state.report);
  fs.writeFileSync(path.join(dir, "report.md"), "# fixture\n");
  fs.writeFileSync(path.join(dir, "bugfix-log.md"), "- No open bugs.\n");
  writeJson(path.join(dir, "api-evidence.json"), state.api);
  writeJson(path.join(dir, "db-evidence.json"), state.db);
  writeJson(path.join(dir, "chain-evidence.json"), state.chain);
  return dir;
}

function runChecker(dir) {
  return spawnSync(process.execPath, [CHECKER], {
    cwd: ROOT,
    env: { ...process.env, STAGING_CORE_DOGFOOD_EVIDENCE_DIR: dir },
    encoding: "utf8",
  });
}

test("valid fixture evidence passes", () => {
  const dir = makeEvidence();
  const result = runChecker(dir);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("missing required screenshot fails", () => {
  const dir = makeEvidence((_state, evidenceDir) => {
    fs.rmSync(path.join(evidenceDir, "screenshots/admin-review.png"));
  });
  const result = runChecker(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /STAGING-CORE-DOGFOOD-SCREENSHOT/);
});

test("tampered trace digest fails", () => {
  const dir = makeEvidence((state) => {
    state.report.traceDigest = "bad";
    state.recomputeDigest = false;
  });
  const result = runChecker(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /STAGING-CORE-DOGFOOD-DIGEST/);
});

test("secret-like trace fails", () => {
  const dir = makeEvidence((state) => {
    state.traceRows.push({ scenario: "bad", authorization: "Bearer abc.def.ghi" });
  });
  const result = runChecker(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /STAGING-CORE-DOGFOOD-SECRET/);
});

test("non-zero reconciliation fails", () => {
  const dir = makeEvidence((state) => {
    state.report.reconciliation.ledgerDelta = "1.000000";
  });
  const result = runChecker(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /STAGING-CORE-DOGFOOD-RECONCILIATION/);
});

test("missing replay rejection fails", () => {
  const dir = makeEvidence((state) => {
    state.traceRows[1].actual.replay.reverted = false;
  });
  const result = runChecker(dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /STAGING-CORE-DOGFOOD-REPLAY/);
});
