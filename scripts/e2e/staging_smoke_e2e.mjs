#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectIdFromEnv, readStagingSecret } from "../lib/e2e_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const RUN_ID =
  process.env.STAGING_SMOKE_RUN_ID ||
  `staging-smoke-${Date.now().toString(36)}`;
const OUT_DIR = path.resolve(
  process.env.STAGING_SMOKE_EVIDENCE_DIR ||
    path.join(
      ROOT,
      "docs/evidence/staging/smoke",
      `${formatTimestamp(GENERATED_AT)}-staging-smoke`
    )
);
const SCREENSHOT_DIR = path.join(OUT_DIR, "screenshots");
const DEFAULT_CONTRACT_CONFIG = path.join(
  ROOT,
  "services/user-front/src/contract-config.arbitrum-sepolia.example.json"
);

loadEnvFile(
  process.env.ENV_FILE || path.join(ROOT, "services/gateway/.env.staging")
);

const config = {
  userFrontUrl: env(
    "STAGING_USER_FRONT_URL",
    "https://staging.synapse-network.ai"
  ),
  gatewayUrl: env(
    "STAGING_GATEWAY_URL",
    "https://api-staging.synapse-network.ai"
  ),
  adminFrontUrl: env(
    "STAGING_ADMIN_FRONT_URL",
    "https://admin-staging.synapse-network.ai"
  ),
  docsFrontUrl: env(
    "STAGING_DOCS_FRONT_URL",
    "https://docs-staging.synapse-network.ai"
  ),
  adminApiUrl: env(
    "STAGING_ADMIN_API_URL",
    "https://admin-api-staging.synapse-network.ai"
  ),
  rpcUrl: resolveRpcUrl(),
  expectedChainId: Number(env("STAGING_EXPECTED_CHAIN_ID", "421614")),
  contractConfigPath: path.resolve(
    env("STAGING_CONTRACT_CONFIG_PATH", DEFAULT_CONTRACT_CONFIG)
  ),
};

const checks = [];
const traceRows = [];

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function formatTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim()
    ? process.env[name].trim()
    : fallback;
}

function readGcloudSecret(secretId) {
  const projectId = projectIdFromEnv() || "fabled-archive-494108-k5";
  if (!secretId || !projectId) return "";
  try {
    return readStagingSecret(secretId, { projectId });
  } catch {
    return "";
  }
}

function resolveRpcUrl() {
  const direct = env(
    "STAGING_RPC_URL",
    env("ARBITRUM_SEPOLIA_RPC_URL", env("RPC_URL", ""))
  );
  if (direct && !/replace-with|PLACEHOLDER/i.test(direct)) return direct;
  const secretId = env(
    "STAGING_RPC_SECRET_ID",
    "synapse-staging-arbitrum-sepolia-rpc-url"
  );
  return readGcloudSecret(secretId);
}

function redact(value) {
  if (value == null) return value;
  return String(value)
    .replace(
      /https:\/\/([^/\s]+)\/v2\/[A-Za-z0-9_-]+/g,
      "https://$1/v2/[REDACTED]"
    )
    .replace(/0x[a-fA-F0-9]{64,}/g, "0x[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /(authorization|password|private[_-]?key|api[_-]?key|secret|token)\s*[:=]\s*[^,\s"']+/gi,
      "$1=[REDACTED]"
    );
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [
        key,
        isSensitiveKey(key) ? "[REDACTED]" : sanitize(next),
      ])
    );
  }
  if (typeof value === "string") return redact(value);
  return value;
}

function isSensitiveKey(key) {
  return /^(?:privateKey|rawSignature|jwt|adminToken|accessToken|apiKey|secret|password|token)$/i.test(
    String(key || "")
  );
}

function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function addCheck(name, ok, details = {}, error = "") {
  const check = {
    name,
    ok: Boolean(ok),
    details: sanitize(details),
    error: redact(error || ""),
  };
  checks.push(check);
  return check;
}

function addTrace({
  scenario,
  method = "CHECKPOINT",
  path: requestPath = "",
  httpStatus = 0,
  durationMs = 0,
  expected = "pass",
  actual = "",
  ok = false,
}) {
  traceRows.push({
    runId: RUN_ID,
    scenario,
    requestId: `${RUN_ID}:${scenario}:${traceRows.length + 1}`,
    timestamp: new Date().toISOString(),
    method,
    path: requestPath,
    httpStatus,
    durationMs,
    sanitizedRequest: {},
    sanitizedResponse: { actual: redact(actual) },
    expected,
    actual: redact(actual),
    ledgerDelta: "",
    vaultDelta: "",
    ticketHash: "",
    txHash: "",
    reconciliationStatus: ok ? "passed" : "failed",
  });
}

async function timedFetch(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    redirect: "manual",
    ...options,
    headers: {
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - started,
    headers: Object.fromEntries(response.headers.entries()),
    text,
  };
}

async function checkHttp(
  name,
  url,
  { expectJson = false, allowStatuses = [200] } = {}
) {
  try {
    const result = await timedFetch(url);
    const ok = allowStatuses.includes(result.status);
    let json = null;
    if (expectJson && result.text.trim()) {
      try {
        json = JSON.parse(result.text);
      } catch {
        // recorded below
      }
    }
    addCheck(name, ok && (!expectJson || json !== null), {
      url,
      status: result.status,
      durationMs: result.durationMs,
      bodyExcerpt: result.text.slice(0, 600),
      json,
    });
    addTrace({
      scenario: name,
      method: "GET",
      path: new URL(url).pathname,
      httpStatus: result.status,
      durationMs: result.durationMs,
      actual: `${result.status} ${result.text.slice(0, 120)}`,
      ok: ok && (!expectJson || json !== null),
    });
  } catch (error) {
    addCheck(name, false, { url }, error.message);
    addTrace({
      scenario: name,
      method: "GET",
      path: url,
      actual: error.message,
      ok: false,
    });
  }
}

async function checkCors(name, url, origin, method = "GET") {
  try {
    const result = await timedFetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers":
          "content-type,authorization,x-user-address,x-idempotency-key",
      },
    });
    const allowOrigin = result.headers["access-control-allow-origin"] || "";
    const ok =
      result.status >= 200 &&
      result.status < 300 &&
      (allowOrigin === "*" || allowOrigin === origin);
    addCheck(name, ok, {
      url,
      origin,
      status: result.status,
      durationMs: result.durationMs,
      accessControlAllowOrigin: allowOrigin,
      accessControlAllowMethods:
        result.headers["access-control-allow-methods"] || "",
    });
    addTrace({
      scenario: name,
      method: "OPTIONS",
      path: new URL(url).pathname,
      httpStatus: result.status,
      durationMs: result.durationMs,
      expected: `2xx with Access-Control-Allow-Origin=${origin}`,
      actual: `${result.status} ${allowOrigin}`,
      ok,
    });
  } catch (error) {
    addCheck(name, false, { url, origin }, error.message);
    addTrace({
      scenario: name,
      method: "OPTIONS",
      path: url,
      actual: error.message,
      ok: false,
    });
  }
}

async function rpc(method, params = []) {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(JSON.stringify(payload.error));
  return payload.result;
}

async function checkRpcAndContracts() {
  if (!config.rpcUrl || /replace-with|PLACEHOLDER/i.test(config.rpcUrl)) {
    addCheck(
      "rpc_config_present",
      false,
      { rpcUrlConfigured: Boolean(config.rpcUrl) },
      "Arbitrum Sepolia RPC URL is not configured."
    );
    return;
  }
  let contractConfig = {};
  try {
    contractConfig = JSON.parse(
      fs.readFileSync(config.contractConfigPath, "utf8")
    );
  } catch (error) {
    addCheck(
      "contract_config_read",
      false,
      { path: config.contractConfigPath },
      error.message
    );
    return;
  }
  addCheck("contract_config_read", true, {
    path: config.contractConfigPath,
    chainId: contractConfig.chainId,
    SynapseCore: contractConfig.SynapseCore,
    MockUSDC: contractConfig.MockUSDC,
  });

  try {
    const chainId = Number.parseInt(await rpc("eth_chainId"), 16);
    const blockNumber = Number.parseInt(await rpc("eth_blockNumber"), 16);
    const ok = chainId === config.expectedChainId && blockNumber > 0;
    addCheck("arbitrum_sepolia_rpc", ok, {
      chainId,
      expectedChainId: config.expectedChainId,
      blockNumber,
    });
    addTrace({
      scenario: "arbitrum_sepolia_rpc",
      method: "RPC",
      path: "eth_chainId,eth_blockNumber",
      httpStatus: ok ? 200 : 500,
      expected: `chainId=${config.expectedChainId}`,
      actual: `chainId=${chainId} block=${blockNumber}`,
      ok,
    });
  } catch (error) {
    addCheck("arbitrum_sepolia_rpc", false, {}, error.message);
    addTrace({
      scenario: "arbitrum_sepolia_rpc",
      method: "RPC",
      path: "eth_chainId",
      actual: error.message,
      ok: false,
    });
  }

  for (const [name, address] of Object.entries({
    SynapseCore: contractConfig.SynapseCore,
    MockUSDC: contractConfig.MockUSDC,
  })) {
    try {
      const code = await rpc("eth_getCode", [address, "latest"]);
      const ok = typeof code === "string" && code !== "0x" && code.length > 10;
      addCheck(`contract_bytecode_${name}`, ok, {
        address,
        codeHash: crypto
          .createHash("sha256")
          .update(String(code))
          .digest("hex"),
        codeBytesApprox: Math.max(0, (String(code).length - 2) / 2),
      });
      addTrace({
        scenario: `contract_bytecode_${name}`,
        method: "RPC",
        path: "eth_getCode",
        httpStatus: ok ? 200 : 500,
        expected: "non-empty bytecode",
        actual: ok ? "bytecode present" : "empty bytecode",
        ok,
      });
    } catch (error) {
      addCheck(`contract_bytecode_${name}`, false, { address }, error.message);
      addTrace({
        scenario: `contract_bytecode_${name}`,
        method: "RPC",
        path: "eth_getCode",
        actual: error.message,
        ok: false,
      });
    }
  }
}

function writeEvidence() {
  const tracePath = path.join(OUT_DIR, "trace.jsonl");
  fs.writeFileSync(
    tracePath,
    traceRows.map((row) => JSON.stringify(row)).join("\n") + "\n"
  );
  const failed = checks.filter((check) => !check.ok);
  const report = {
    status: failed.length === 0 ? "success" : "failed",
    scriptVersion: "staging-smoke:v1",
    runId: RUN_ID,
    generatedAt: GENERATED_AT.toISOString(),
    finishedAt: new Date().toISOString(),
    environment: "staging",
    endpoints: {
      userFrontUrl: config.userFrontUrl,
      gatewayUrl: config.gatewayUrl,
      adminFrontUrl: config.adminFrontUrl,
      docsFrontUrl: config.docsFrontUrl,
      adminApiUrl: config.adminApiUrl,
      rpcUrl: redact(config.rpcUrl),
    },
    checks,
    failed,
    traceDigest: sha256File(tracePath),
    traceLineCount: traceRows.length,
  };
  const reportPath = path.join(OUT_DIR, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# Staging MVP Smoke Evidence",
    "",
    `- Status: \`${report.status}\``,
    `- Run ID: \`${RUN_ID}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Trace digest: \`${report.traceDigest}\``,
    "",
    "## Checks",
    "",
    "| Check | Result | Detail |",
    "| --- | --- | --- |",
    ...checks.map(
      (check) =>
        `| ${check.name} | ${check.ok ? "PASS" : "FAIL"} | ${String(
          check.error || check.details?.status || "ok"
        ).replace(/\|/g, "\\|")} |`
    ),
    "",
    "## Failures",
    "",
    ...(failed.length
      ? failed.map(
          (check) =>
            `- ${check.name}: ${
              check.error || JSON.stringify(check.details).slice(0, 300)
            }`
        )
      : ["- none"]),
  ];
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), `${lines.join("\n")}\n`);
  fs.writeFileSync(
    path.join(OUT_DIR, "environment-manifest.json"),
    `${JSON.stringify(report.endpoints, null, 2)}\n`
  );
  return report;
}

async function main() {
  await checkHttp("gateway_health", `${config.gatewayUrl}/health`, {
    expectJson: true,
  });
  await checkHttp("gateway_readiness", `${config.gatewayUrl}/readiness`, {
    expectJson: true,
  });
  await checkHttp(
    "gateway_service_discovery",
    `${config.gatewayUrl}/api/v1/services/discover`,
    { expectJson: true, allowStatuses: [200, 401, 403] }
  );
  await checkHttp("gateway_admin_health", `${config.adminApiUrl}/health`, {
    expectJson: true,
  });
  await checkHttp("user_front_home", config.userFrontUrl, {
    allowStatuses: [200, 301, 302, 307, 308],
  });
  await checkHttp("admin_front_login", `${config.adminFrontUrl}/login`, {
    allowStatuses: [200, 301, 302, 307, 308],
  });
  await checkHttp("docs_front_home", config.docsFrontUrl, {
    allowStatuses: [200, 301, 302, 307, 308],
  });
  await checkHttp("docs_front_llms", `${config.docsFrontUrl}/llms.txt`);
  await checkHttp(
    "docs_front_llms_full",
    `${config.docsFrontUrl}/llms-full.txt`
  );
  await checkHttp("docs_front_sitemap", `${config.docsFrontUrl}/sitemap.xml`);
  await checkHttp("docs_front_openapi", `${config.docsFrontUrl}/openapi.json`, {
    expectJson: true,
  });
  await checkHttp("docs_front_sdks", `${config.docsFrontUrl}/sdks`, {
    allowStatuses: [200, 301, 302, 307, 308],
  });
  await checkHttp(
    "docs_front_api_reference",
    `${config.docsFrontUrl}/api-reference`,
    {
      allowStatuses: [200, 301, 302, 307, 308],
    }
  );
  await checkCors(
    "gateway_cors_user_front",
    `${config.gatewayUrl}/api/v1/services/discover`,
    config.userFrontUrl,
    "GET"
  );
  await checkCors(
    "gateway_admin_cors_admin_front",
    `${config.adminApiUrl}/api/admin/v1/auth/login`,
    config.adminFrontUrl,
    "POST"
  );
  await checkRpcAndContracts();
  const report = writeEvidence();
  console.log(`[staging-smoke] evidence=${OUT_DIR}`);
  console.log(
    `[staging-smoke] status=${report.status} checks=${checks.length} failed=${report.failed.length}`
  );
  if (report.status !== "success") process.exitCode = 1;
}

main().catch((error) => {
  addCheck("runner", false, {}, error.stack || error.message);
  const report = writeEvidence();
  console.error(`[staging-smoke] failed: ${error.stack || error.message}`);
  console.error(`[staging-smoke] evidence=${OUT_DIR}`);
  process.exitCode = report.status === "success" ? 0 : 1;
});
