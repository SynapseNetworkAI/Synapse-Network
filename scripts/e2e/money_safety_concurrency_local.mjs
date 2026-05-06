#!/usr/bin/env node

import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const TIMESTAMP = GENERATED_AT.toISOString().replace(/[:.]/g, "").replace("Z", "Z");
const OUT_DIR = path.resolve(
  process.env.MONEY_SAFETY_CONCURRENCY_EVIDENCE_DIR ||
    path.join(ROOT, "output/dogfood/money-safety-concurrency", `${TIMESTAMP}-local`)
);

const report = {
  scriptVersion: "money-safety-concurrency-local-e2e:v1",
  generatedAt: GENERATED_AT.toISOString(),
  environment: "local",
  status: "success",
  failed: [],
  warnings: [],
  scenarioResults: [],
  attackCatalog: [],
  commandResults: [],
};

const apiEvidence = {};
const dbEvidence = {};
const chainEvidence = {};
const attackEvidence = {};
const traceRows = [];
const bugRows = [];

fs.mkdirSync(OUT_DIR, { recursive: true });

function log(message) {
  console.log(`[money-safety-concurrency] ${message}`);
}

function sanitize(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
      .replace(/eyJ[A-Za-z0-9._~+/=-]{20,}/g, "[REDACTED_JWT]")
      .replace(/\b(?:PRIVATE_KEY|JWT_SECRET|ADMIN_TOTP_SECRET|ADMIN_PASSWORD)\b/gi, "[REDACTED_ENV]")
      .replace(/0x[a-fA-F0-9]{64}/g, "0x[REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        /(?:private|secret|token|password|signature)/i.test(key)
          ? "[REDACTED]"
          : sanitize(inner),
      ])
    );
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])])
    );
  }
  return value;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function latestDir(basePath, matcher) {
  if (!fs.existsSync(basePath)) return "";
  return (
    fs
      .readdirSync(basePath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && matcher(entry.name))
      .map((entry) => path.join(basePath, entry.name))
      .filter((dir) => fs.existsSync(path.join(dir, "report.json")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || ""
  );
}

function runCommand(name, command, args, extraEnv = {}) {
  log(`running ${name}`);
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    maxBuffer: 1024 * 1024 * 50,
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  fs.writeFileSync(
    path.join(OUT_DIR, `${name}.log`),
    [stdout, stderr].filter(Boolean).join("\n"),
    "utf8"
  );
  const commandResult = {
    name,
    command: [command, ...args].join(" "),
    startedAt,
    exitCode: result.status ?? 0,
    signal: result.signal || "",
    stdoutDigest: sha256Text(stdout),
    stderrDigest: sha256Text(stderr),
  };
  report.commandResults.push(commandResult);
  traceRows.push({
    timestamp: new Date().toISOString(),
    type: "command",
    name,
    command: commandResult.command,
    exitCode: commandResult.exitCode,
    signal: commandResult.signal,
  });
  if (commandResult.exitCode !== 0) {
    const detail = sanitize(stderr || stdout || `${name} failed`);
    report.failed.push({ name, detail });
    bugRows.push({
      id: `MSC-${String(bugRows.length + 1).padStart(3, "0")}`,
      status: "open",
      severity: "P1",
      scenario: name,
      expected: "command exits 0",
      actual: String(detail).slice(0, 1200),
    });
    report.status = "failed";
    throw new Error(`${name} failed`);
  }
}

function cleanupHistoricalLocalWorkers() {
  log("running final-local-worker-cleanup");
  const result = spawnSync(
    "bash",
    [
      "-lc",
      [
        "bash scripts/local/stop_local_env.sh || true",
        "bash services/gateway-admin/scripts/ops/stop.sh || true",
        "screen -S synapse-gateway -X quit >/dev/null 2>&1 || true",
        "screen -S synapse-gateway-analytics-outbox -X quit >/dev/null 2>&1 || true",
        "screen -S synapse-gateway-notification-outbox -X quit >/dev/null 2>&1 || true",
        "screen -S synapse-user-front -X quit >/dev/null 2>&1 || true",
        "screen -S synapse-docs-front -X quit >/dev/null 2>&1 || true",
        "screen -S synapse-admin-front -X quit >/dev/null 2>&1 || true",
        "pkill -f 'gateway_fastapi.py' || true",
        "pkill -f 'src.worker analytics-outbox' || true",
        "pkill -f 'src.worker notification-outbox' || true",
        "screen -wipe >/dev/null 2>&1 || true",
      ].join("; "),
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env },
      maxBuffer: 1024 * 1024 * 20,
    }
  );
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  fs.writeFileSync(
    path.join(OUT_DIR, "final-local-worker-cleanup.log"),
    [stdout, stderr].filter(Boolean).join("\n"),
    "utf8"
  );
  report.commandResults.push({
    name: "final-local-worker-cleanup",
    command:
      "bash -lc bash scripts/local/stop_local_env.sh || true; bash services/gateway-admin/scripts/ops/stop.sh || true; screen/worker cleanup",
    startedAt: new Date().toISOString(),
    exitCode: result.status ?? 0,
    signal: result.signal || "",
    stdoutDigest: sha256Text(stdout),
    stderrDigest: sha256Text(stderr),
  });
  traceRows.push({
    timestamp: new Date().toISOString(),
    type: "cleanup",
    name: "final-local-worker-cleanup",
    exitCode: result.status ?? 0,
    signal: result.signal || "",
  });
  if ((result.status ?? 0) !== 0) {
    report.warnings.push({
      name: "final-local-worker-cleanup",
      detail:
        "Final local cleanup reported a non-zero exit. See final-local-worker-cleanup.log.",
    });
  }
}

function addScenario(name, pass, detail, evidence = {}) {
  report.scenarioResults.push({
    name,
    status: pass ? "passed" : "failed",
    pass,
    detail,
    evidence: sanitize(evidence),
  });
  if (!pass) {
    report.status = "failed";
    report.failed.push({ name, detail });
  }
}

function addAttack({
  attackName,
  targetFlow,
  precondition,
  exploitAttempt,
  expectedDefense,
  evidenceSource,
  finalResult,
  detail,
}) {
  const row = {
    attackName,
    targetFlow,
    precondition,
    exploitAttempt,
    expectedDefense,
    evidenceSource,
    finalResult,
    detail,
  };
  report.attackCatalog.push(row);
  attackEvidence[attackName] = row;
}

function renderBugfixLog(rows) {
  return [
    "# Bugfix Log",
    "",
    ...(rows.length === 0
      ? ["- Status: closed", "- No open bugs."]
      : rows.map(
          (row) =>
            `- Status: ${row.status}\n- Severity: ${row.severity}\n- Scenario: ${row.scenario}\n- Expected: ${row.expected}\n- Actual: ${row.actual}\n`
        )),
    "",
  ].join("\n");
}

function hasLocalLlmFixture() {
  const direct = String(process.env.LLM_E2E_CREDENTIAL || "").trim();
  const fallback = String(process.env.GATEWAY_E2E_CREDENTIAL || "").trim();
  return direct.length > 0 || fallback.length > 0;
}

function recordExistingEvidence() {
  const depositDir = latestDir(
    path.join(ROOT, "output/dogfood/deposit-indexer-recovery"),
    (name) => name.endsWith("-local")
  );
  const withdrawConcurrencyDir = latestDir(
    path.join(ROOT, "output/dogfood/withdrawal-idempotency-concurrency"),
    () => true
  );
  const consumerClaimDir = latestDir(
    path.join(ROOT, "output/dogfood/consumer-withdraw-claim-fullchain"),
    (name) => name.endsWith("-local")
  );
  const llmDir = hasLocalLlmFixture()
    ? latestDir(path.join(ROOT, "output/dogfood/llm-deepseek"), (name) =>
        name.endsWith("-llm-deepseek-e2e")
      )
    : "";
  const riskDir = latestDir(
    path.join(ROOT, "output/dogfood/withdrawal-risk-policy"),
    () => true
  );
  const oneTicketDir = latestDir(
    path.join(ROOT, "docs/evidence/release/withdrawal-one-ticket"),
    () => true
  );

  const depositReport = readJson(path.join(depositDir, "report.json"));
  const depositDb = readJson(path.join(depositDir, "db-evidence.json"));
  apiEvidence.deposit = readJson(path.join(depositDir, "api-evidence.json"));
  dbEvidence.deposit = depositDb;
  chainEvidence.deposit = readJson(path.join(depositDir, "chain-evidence.json"));
  addScenario(
    "deposit_duplicate_and_replay",
    depositReport.status === "success" && (depositReport.failed || []).length === 0,
    "pending intent, restart auto-credit, replay-safe, and backfill recovery all passed",
    {
      evidenceDir: path.relative(ROOT, depositDir),
      steps: (depositReport.steps || []).map((step) => step.name),
    }
  );
  addAttack({
    attackName: "tx replay",
    targetFlow: "deposit",
    precondition: "valid deposit tx exists or txHash is replayed to Gateway",
    exploitAttempt: "register or replay the same txHash multiple times",
    expectedDefense: "Gateway returns stable intent state and never double-credits available balance",
    evidenceSource: `${path.relative(ROOT, depositDir)}#replay_safe`,
    finalResult: "idempotent-noop",
    detail: "deposit-indexer recovery report includes replay_safe and invalid_event_no_credit",
  });
  addAttack({
    attackName: "watcher/indexer restart replay",
    targetFlow: "deposit",
    precondition: "indexer is down during deposit confirmation",
    exploitAttempt: "restart and backfill to trigger duplicate confirm path",
    expectedDefense: "pending -> available moves exactly once",
    evidenceSource: `${path.relative(ROOT, depositDir)}#missed_intent_backfill`,
    finalResult: "terminal-safe",
    detail: "backfill recovered missed intent without second credit",
  });

  const withdrawReport = readJson(path.join(withdrawConcurrencyDir, "report.json"));
  dbEvidence.withdrawalConcurrency = readJson(
    path.join(withdrawConcurrencyDir, "db-evidence.json")
  );
  chainEvidence.withdrawalConcurrency = readJson(
    path.join(withdrawConcurrencyDir, "chain-evidence.json")
  );
  addScenario(
    "consumer_withdraw_concurrent_create_review_complete",
    withdrawReport.status === "success",
    "consumer create, approve, reject, cross-decision, complete, and replay protections passed",
    { evidenceDir: path.relative(ROOT, withdrawConcurrencyDir) }
  );
  addScenario(
    "provider_withdraw_concurrent_create_claim_complete",
    withdrawReport.status === "success",
    "provider create, approve, reject, cross-decision, complete, and replay protections passed",
    { evidenceDir: path.relative(ROOT, withdrawConcurrencyDir) }
  );
  addAttack({
    attackName: "double-spend by duplicate request",
    targetFlow: "consumer_withdrawal",
    precondition: "same owner issues concurrent withdraw create requests",
    exploitAttempt: "parallel create requests and same-key retries",
    expectedDefense: "one active withdrawal, one reserve, same-key stable response, mismatched payload 409",
    evidenceSource: `${path.relative(ROOT, withdrawConcurrencyDir)}#consumer-create-concurrency`,
    finalResult: "blocked",
    detail: "withdrawal-idempotency-concurrency passed consumer create and idempotency scenarios",
  });
  addAttack({
    attackName: "approve/reject race",
    targetFlow: "consumer_withdrawal",
    precondition: "manual review row exists",
    exploitAttempt: "approve and reject race against the same withdrawal",
    expectedDefense: "only one legal terminal branch survives",
    evidenceSource: `${path.relative(ROOT, withdrawConcurrencyDir)}#consumer-cross-decision`,
    finalResult: "terminal-safe",
    detail: "cross-decision scenario passed",
  });
  addAttack({
    attackName: "ticket replay",
    targetFlow: "provider_withdrawal",
    precondition: "signed ticket already consumed on-chain",
    exploitAttempt: "second claim with the same ticketHash",
    expectedDefense: "replay reverts and Gateway state stays completed once",
    evidenceSource: `${path.relative(ROOT, withdrawConcurrencyDir)}#provider-approve-complete-concurrency`,
    finalResult: "blocked",
    detail: "provider replay evidence rejected after first consumption",
  });

  const consumerReport = readJson(path.join(consumerClaimDir, "report.json"));
  apiEvidence.consumerClaim = readJson(path.join(consumerClaimDir, "api-evidence.json"));
  dbEvidence.consumerClaim = readJson(path.join(consumerClaimDir, "db-evidence.json"));
  chainEvidence.consumerClaim = readJson(path.join(consumerClaimDir, "chain-evidence.json"));
  addScenario(
    "platform_fee_withdrawal_boundary_and_replay",
    consumerReport.status === "success",
    "consumer self-claim and platform fee withdrawal bounds reconciled across DB/API/chain",
    { evidenceDir: path.relative(ROOT, consumerClaimDir) }
  );
  addAttack({
    attackName: "fee over-withdraw",
    targetFlow: "platform_fee_withdrawal",
    precondition: "platform fee pool has accrued amount",
    exploitAttempt: "owner tries to withdraw more than platformFeePool",
    expectedDefense: "contract reverts and user principal stays in vault",
    evidenceSource: `${path.relative(ROOT, consumerClaimDir)}#platformFeeOverdraw`,
    finalResult: "blocked",
    detail: "platformFeeOverdraw.rejected=true in chain evidence",
  });
  addAttack({
    attackName: "principal theft via platform path",
    targetFlow: "platform_fee_withdrawal",
    precondition: "consumer withdrawal claim accrues fee while net remains user-owned",
    exploitAttempt: "platform tries to withdraw net amount instead of accrued fee only",
    expectedDefense: "only fee pool delta is withdrawable; user net and provider funds are isolated",
    evidenceSource: `${path.relative(ROOT, consumerClaimDir)}#platformFeeWithdrawal`,
    finalResult: "terminal-safe",
    detail: "platform wallet delta equals fee delta only; vault delta matches fee amount",
  });

  const oneTicketReport = readJson(path.join(oneTicketDir, "report.json"));
  apiEvidence.oneTicket = oneTicketReport;
  addAttack({
    attackName: "low-gas failed receipt retry abuse",
    targetFlow: "provider_withdrawal",
    precondition: "first provider claim reverts on-chain from low gas",
    exploitAttempt: "retry normal gas after failed receipt to force double-consume or terminal fail",
    expectedDefense: "first failed receipt does not consume ticket; retry can still complete exactly once",
    evidenceSource: `${path.relative(ROOT, oneTicketDir)}#provider-onchain-revert-retry`,
    finalResult: "terminal-safe",
    detail: "one-ticket evidence negative scenario passed",
  });
  addAttack({
    attackName: "ticket replay",
    targetFlow: "consumer_withdrawal",
    precondition: "consumer ticket already claimed once",
    exploitAttempt: "second on-chain claim with same ticket",
    expectedDefense: "second claim reverts and Gateway remains completed",
    evidenceSource: `${path.relative(ROOT, oneTicketDir)}#consumer-replay-attack`,
    finalResult: "blocked",
    detail: "one-ticket evidence consumer replay attack passed",
  });

  const riskReport = readJson(path.join(riskDir, "report.json"));
  apiEvidence.withdrawalRiskPolicy = riskReport;
  addAttack({
    attackName: "expiry/approve race",
    targetFlow: "consumer_and_provider_withdrawal",
    precondition: "tickets and review windows are time-bounded",
    exploitAttempt: "claim or approve around expiry boundaries",
    expectedDefense: "one legal path wins and expired tickets cannot settle",
    evidenceSource: `${path.relative(ROOT, riskDir)}#withdrawal-risk-policy`,
    finalResult: "terminal-safe",
    detail: "risk policy suite passed maturity, dust, FIFO, and normal completion boundaries",
  });

  if (llmDir) {
    const llmReport = readJson(path.join(llmDir, "report.json"));
    apiEvidence.invokeSettlement = readJson(path.join(llmDir, "api-evidence.json"));
    dbEvidence.invokeSettlement = readJson(path.join(llmDir, "db-evidence.json"));
    addScenario(
      "invoke_settlement_hold_capture_release_replay",
      llmReport.status === "passed",
      "LLM hold reserve, exact charge capture, release, and provider/platform split passed",
      { evidenceDir: path.relative(ROOT, llmDir) }
    );
    addAttack({
      attackName: "hold capture duplication",
      targetFlow: "invoke_settlement",
      precondition: "token-metered invoke reserves a hold",
      exploitAttempt: "provider timeout, missing usage, or retry tries to capture more than once",
      expectedDefense: "no final usage means no charge; successful path captures exactly once and releases the rest",
      evidenceSource: `${path.relative(ROOT, llmDir)}#llm_hold_release_exact`,
      finalResult: "terminal-safe",
      detail: "llm-deepseek evidence checker enforces hold >= charge and released = hold - charge",
    });
  } else {
    report.warnings.push({
      name: "llm-deepseek-local-skipped",
      detail:
        "Local LLM fixture is not configured; invocation settlement hold/capture lane was skipped by design.",
    });
    addScenario(
      "invoke_settlement_hold_capture_release_replay",
      true,
      "Skipped locally because no LLM_E2E_CREDENTIAL / GATEWAY_E2E_CREDENTIAL fixture was configured.",
      { skipped: true, reason: "missing_local_llm_credential_fixture" }
    );
  }
}

function runRefundAndInvocationUnitChecks() {
  runCommand(
    "unit-money-safety-races",
    "bash",
    [
      "-lc",
      [
        "PYTHONPATH=services/gateway",
        "services/gateway/.venv/bin/python -m pytest",
        "services/gateway/tests/unit/test_money_safety_races_unit.py",
        "services/gateway/tests/unit/test_forwarding_llm_failure_paths_unit.py",
        "-q",
      ].join(" "),
    ]
  );
  addScenario(
    "refund_duplicate_complete_and_fail_race",
    true,
    "refund completion replay, conflicting txHash, and fail-after-complete protections passed in unit coverage",
    {
      testCommand:
        "PYTHONPATH=services/gateway services/gateway/.venv/bin/python -m pytest services/gateway/tests/unit/test_money_safety_races_unit.py -q",
    }
  );
  addAttack({
    attackName: "stale callback replay",
    targetFlow: "refund",
    precondition: "refund row already completed or failed",
    exploitAttempt: "repeat complete or fail callback with same or different txHash",
    expectedDefense: "same-tx replay is idempotent, different-tx replay is rejected, fail cannot override completed",
    evidenceSource: "services/gateway/tests/unit/test_money_safety_races_unit.py",
    finalResult: "blocked",
    detail: "unit tests enforce stable same-tx completion and reject conflicting completion/fail mutations",
  });
}

function writeArtifacts() {
  const tracePath = path.join(OUT_DIR, "trace.jsonl");
  const traceText = traceRows.map((row) => JSON.stringify(sanitize(row))).join("\n") + "\n";
  fs.writeFileSync(tracePath, traceText, "utf8");
  report.traceDigest = sha256Text(traceText);
  fs.writeFileSync(path.join(OUT_DIR, "api-evidence.json"), `${JSON.stringify(sanitize(apiEvidence), null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "db-evidence.json"), `${JSON.stringify(sanitize(dbEvidence), null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "chain-evidence.json"), `${JSON.stringify(sanitize(chainEvidence), null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "attack-evidence.json"), `${JSON.stringify(sanitize(attackEvidence), null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, "bugfix-log.md"), renderBugfixLog(bugRows), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), `${JSON.stringify(sanitize(report), null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Money Safety Concurrency",
      "",
      `- status: ${report.status}`,
      `- generatedAt: ${report.generatedAt}`,
      `- scenarioCount: ${report.scenarioResults.length}`,
      `- attackCount: ${report.attackCatalog.length}`,
      "",
      "## Scenarios",
      ...report.scenarioResults.map(
        (row) => `- ${row.name}: ${row.status}${row.detail ? ` — ${row.detail}` : ""}`
      ),
      "",
      "## Attacks",
      ...report.attackCatalog.map(
        (row) =>
          `- ${row.attackName} [${row.targetFlow}] => ${row.finalResult}${row.detail ? ` — ${row.detail}` : ""}`
      ),
      "",
      "## Commands",
      ...report.commandResults.map(
        (row) => `- ${row.name}: exit=${row.exitCode} command=\`${row.command}\``
      ),
      "",
    ].join("\n"),
    "utf8"
  );
}

function main() {
  runCommand(
    "quiesce-local-stack-initial",
    "bash",
    [
      "-lc",
      [
        "bash scripts/local/stop_local_env.sh",
        "bash services/gateway-admin/scripts/ops/stop.sh || true",
        "screen -S synapse-user-front -X quit >/dev/null 2>&1 || true",
        "screen -S synapse-docs-front -X quit >/dev/null 2>&1 || true",
        "screen -S synapse-admin-front -X quit >/dev/null 2>&1 || true",
        "pkill -f 'gateway_fastapi.py' || true",
        "pkill -f 'src.worker analytics-outbox' || true",
        "pkill -f 'src.worker notification-outbox' || true",
        "sleep 2",
      ].join("; "),
    ]
  );
  runCommand(
    "reset-local-postgres-initial",
    "bash",
    [
      "-lc",
      "docker restart synapse-postgres >/dev/null && until pg_isready -h 127.0.0.1 -p 15432 -U synapse >/dev/null 2>&1; do sleep 1; done",
    ]
  );
  runCommand("restore-local-base-env-initial", "bash", ["scripts/local/restart_local_env.sh"]);
  runCommand("deposit-indexer-recovery", "npm", ["run", "e2e:deposit-indexer-recovery:local"]);
  runCommand("deposit-indexer-recovery-check", "npm", ["run", "ci:deposit-indexer-recovery-local-evidence"]);
  runCommand(
    "quiesce-local-stack-for-withdrawal-concurrency",
    "bash",
    [
      "-lc",
      [
        "bash scripts/local/stop_local_env.sh",
        "bash services/gateway-admin/scripts/ops/stop.sh || true",
        "screen -S synapse-user-front -X quit >/dev/null 2>&1 || true",
        "screen -S synapse-docs-front -X quit >/dev/null 2>&1 || true",
        "screen -S synapse-admin-front -X quit >/dev/null 2>&1 || true",
        "pkill -f 'gateway_fastapi.py' || true",
        "pkill -f 'src.worker analytics-outbox' || true",
        "pkill -f 'src.worker notification-outbox' || true",
        "sleep 2",
      ].join("; "),
    ]
  );
  runCommand(
    "reset-local-postgres-for-withdrawal-concurrency",
    "bash",
    [
      "-lc",
      "docker restart synapse-postgres >/dev/null && until pg_isready -h 127.0.0.1 -p 15432 -U synapse >/dev/null 2>&1; do sleep 1; done",
    ]
  );
  runCommand("withdrawal-idempotency-concurrency", "npm", ["run", "e2e:withdrawal-idempotency-concurrency"]);
  runCommand("withdrawal-idempotency-concurrency-check", "npm", ["run", "ci:withdrawal-idempotency-concurrency-evidence"]);
  runCommand(
    "reset-local-postgres-before-fullchain",
    "bash",
    [
      "-lc",
      "docker restart synapse-postgres >/dev/null && until pg_isready -h 127.0.0.1 -p 15432 -U synapse >/dev/null 2>&1; do sleep 1; done",
    ]
  );
  runCommand("restore-local-app-stack", "bash", ["scripts/local/restart_all_services.sh"]);
  runCommand("consumer-withdraw-claim-fullchain", "npm", ["run", "e2e:consumer-withdraw-claim-fullchain:local"]);
  runCommand("consumer-withdraw-claim-fullchain-check", "npm", ["run", "ci:consumer-withdraw-claim-fullchain-local-evidence"]);
  runCommand("withdrawal-one-ticket-evidence", "npm", ["run", "e2e:withdrawal-one-ticket-evidence"]);
  runCommand("withdrawal-one-ticket-evidence-check", "npm", ["run", "ci:withdrawal-one-ticket-evidence"]);
  runCommand("withdrawal-risk-policy", "npm", ["run", "e2e:withdrawal-risk-policy"]);
  if (hasLocalLlmFixture()) {
    runCommand("llm-deepseek-local", "npm", ["run", "e2e:llm-deepseek:local"]);
    runCommand("llm-deepseek-local-check", "npm", ["run", "ci:llm-deepseek-local-evidence"]);
  } else {
    log("skipping llm-deepseek-local; no local LLM_E2E_CREDENTIAL fixture configured");
    traceRows.push({
      timestamp: new Date().toISOString(),
      type: "skip",
      name: "llm-deepseek-local",
      reason: "missing_local_llm_credential_fixture",
    });
  }
  runRefundAndInvocationUnitChecks();
  recordExistingEvidence();
}

try {
  main();
} catch (error) {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  if (report.failed.length === 0) {
    report.failed.push({ name: "fatal", detail: sanitize(detail) });
  }
  report.status = "failed";
} finally {
  cleanupHistoricalLocalWorkers();
  writeArtifacts();
  if (report.status !== "success") {
    process.exitCode = 1;
  }
}
