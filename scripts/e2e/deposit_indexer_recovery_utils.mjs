import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function privateKeyFromSeed(seed) {
  return `0x${crypto.createHash("sha256").update(seed).digest("hex")}`;
}

export function redact(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /"((?:password|privateKey|signature|jwt|token|secret|authorization)[^"]*)"\s*:\s*"[^"]+"/gi,
      '"$1":"[REDACTED]"'
    );
}

export function redactedObject(value) {
  return JSON.parse(redact(JSON.stringify(value ?? null)));
}

export function fail(message) {
  throw new Error(message);
}

export function assertLocalOnly(config) {
  if (config.chainId !== 31337) {
    fail(`Refusing non-local chainId=${config.chainId}`);
  }
  for (const [name, value] of [
    ["frontendUrl", config.frontendUrl],
    ["gatewayBase", config.gatewayBase],
    ["rpcUrl", config.rpcUrl],
  ]) {
    if (!isLocalUrl(value)) fail(`Refusing non-local ${name}=${value}`);
  }
  if (
    !config.postgresDsn.includes("127.0.0.1") &&
    !config.postgresDsn.includes("localhost")
  ) {
    fail("Refusing non-local Postgres DSN");
  }
  if (!config.postgresDsn.endsWith("/synapse_gateway")) {
    fail("Postgres DSN must point at local synapse_gateway");
  }
}

export function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

export function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function selectJson(config, root, sql) {
  return psqlJson(
    config,
    root,
    `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (${sql}) AS t;`
  );
}

export function decimalToAtomic(value, decimals = 6) {
  const normalized = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 0n;
  const [whole, fraction = ""] = normalized.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0").slice(0, decimals))
  );
}

export function atomicToDecimal(value, decimals = 6) {
  const atomic = BigInt(value || 0);
  const scale = 10n ** BigInt(decimals);
  return `${atomic / scale}.${String(atomic % scale).padStart(decimals, "0")}`;
}

export function addMoney(value, delta) {
  return atomicToDecimal(decimalToAtomic(value) + decimalToAtomic(delta));
}

export function assertMoneyEqual(name, actual, expected) {
  if (decimalToAtomic(actual) !== decimalToAtomic(expected)) {
    fail(`${name}: expected ${expected}, got ${actual}`);
  }
}

export function moneyCandidates(value) {
  const atomic = decimalToAtomic(value);
  const rounded = (Number(atomic) / 1_000_000).toFixed(2);
  return [
    ...new Set([
      atomicToDecimal(atomic),
      rounded,
      `$${rounded}`,
      `${rounded} USDC`,
    ]),
  ];
}

export function accountId(address) {
  return `consumer_wallet::${String(address).toLowerCase()}`;
}

export function ownerId(address) {
  return `owner:${String(address).toLowerCase()}`;
}

export function restartGateway({ config, evidence, label, overrides, root }) {
  const env = {
    ...process.env,
    STARTUP_TIMEOUT_SEC: "45",
    LOCAL_GATEWAY_POSTGRES_DSN: config.postgresDsn,
    V2_RECONCILIATION_ENABLED: "false",
    PROVIDER_WITHDRAW_EXPIRY_REAPER_ENABLED: "false",
    CONSUMER_WITHDRAW_PROCESSOR_ENABLED: "false",
    ...overrides,
  };
  const result = spawnSync("bash", ["scripts/local/restart_gateway.sh"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  evidence.api.push(
    redactedObject({
      method: "SCRIPT",
      pathname: label,
      httpStatus: result.status,
      response: result.stdout.slice(-3000),
    })
  );
  if (result.status !== 0) {
    fail(
      `${label} restart failed: ${(result.stderr || result.stdout).slice(
        -2000
      )}`
    );
  }
}

export async function fetchJson(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      return { response, payload };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

export function writeDepositRecoveryEvidence({
  config,
  evidence,
  outDir,
  status,
}) {
  const trace =
    evidence.steps
      .map((step) =>
        JSON.stringify({ generatedAt: new Date().toISOString(), ...step })
      )
      .join("\n") + "\n";
  const traceDigest = crypto.createHash("sha256").update(trace).digest("hex");
  fs.writeFileSync(path.join(outDir, "trace.jsonl"), trace);
  fs.writeFileSync(
    path.join(outDir, "api-evidence.json"),
    JSON.stringify(evidence.api, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "db-evidence.json"),
    JSON.stringify(evidence.db, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "chain-evidence.json"),
    JSON.stringify(evidence.chain, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "screenshot-evidence.json"),
    JSON.stringify(evidence.screenshots, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "bugfix-log.md"),
    evidence.failed.length
      ? "# Bugfix Log\n\nOpen failures remain.\n"
      : "# Bugfix Log\n\nNo bugs found in this run.\n"
  );
  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(
      buildReport({ config, evidence, status, traceDigest }),
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(outDir, "report.md"),
    buildReportMarkdown(status, evidence)
  );
  console.log(
    `[deposit-indexer-recovery] Report: ${path.join(outDir, "report.md")}`
  );
}

function isLocalUrl(value) {
  const url = new URL(value);
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
}

function buildReport({ config, evidence, status, traceDigest }) {
  return {
    environment: evidence.environment,
    status,
    generatedAt: evidence.generatedAt,
    runId: config.runId,
    traceDigest,
    failed: evidence.failed,
    steps: evidence.steps,
    screenshots: evidence.screenshots.map((item) => item.path),
    primaryDepositTxHash: evidence.chain.primary?.txHash,
    backfillDepositTxHash: evidence.chain.backfill?.txHash,
    depositUsdc: config.depositUsdc,
  };
}

function buildReportMarkdown(status, evidence) {
  return [
    "# Deposit Indexer Recovery E2E",
    "",
    `- Status: ${status}`,
    `- Failed: ${evidence.failed.length}`,
    "",
    "## Steps",
    "",
    ...evidence.steps.map(
      (step) =>
        `- ${step.ok ? "PASS" : "FAIL"} ${step.name}${
          step.detail ? ` - ${step.detail}` : ""
        }`
    ),
    "",
  ].join("\n");
}

function psqlJson(config, root, sql) {
  const result = spawnSync(
    "psql",
    [
      config.postgresDsn,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: root, encoding: "utf8" }
  );
  if (result.status !== 0) {
    fail(`psql failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}
