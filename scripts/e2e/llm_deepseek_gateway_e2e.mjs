#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const ENVIRONMENT = env("LLM_DEEPSEEK_E2E_ENV", process.env.NODE_ENV === "production" ? "staging" : "local");
const IS_STAGING = ENVIRONMENT === "staging";
const RUN_ID = env("LLM_DEEPSEEK_E2E_RUN_ID", `llm-deepseek-${Date.now().toString(36)}`);
const OUT_DIR = path.resolve(
  env(
    "LLM_DEEPSEEK_E2E_EVIDENCE_DIR",
    IS_STAGING
      ? path.join(ROOT, "docs/evidence/staging/llm-deepseek", `${formatTimestamp(GENERATED_AT)}-llm-deepseek-e2e`)
      : path.join(ROOT, "output/dogfood/llm-deepseek", `${formatTimestamp(GENERATED_AT)}-llm-deepseek-e2e`),
  ),
);

loadEnvFile(path.join(ROOT, "services/gateway/.env.local"));
loadEnvFile(path.join(ROOT, "services/gateway/.env.local.private"));
if (IS_STAGING) loadEnvFile(path.join(ROOT, "services/gateway/.env.staging"));

const config = {
  gatewayBaseUrl: trimTrailingSlash(
    env("LLM_E2E_GATEWAY_BASE", IS_STAGING ? "https://api-staging.synapse-network.ai" : "http://127.0.0.1:8000"),
  ),
  serviceId: env("LLM_E2E_SERVICE_ID", "svc_deepseek_chat"),
  credential: env("LLM_E2E_CREDENTIAL", ""),
  maxCostUsdc: env("LLM_E2E_MAX_COST_USDC", ""),
  inputPricePer1MUsdc: env("LLM_E2E_INPUT_PRICE_PER_1M_USDC", ""),
  outputPricePer1MUsdc: env("LLM_E2E_OUTPUT_PRICE_PER_1M_USDC", ""),
  model: env("LLM_E2E_MODEL", "deepseek-chat"),
  prompt: env(
    "LLM_E2E_PROMPT",
    "Reply with exactly one short sentence: Synapse token-metered LLM billing smoke test passed.",
  ),
  maxTokens: Number(env("LLM_E2E_MAX_TOKENS", "32")),
  postgresDsn: env("LLM_E2E_POSTGRES_DSN", env("POSTGRES_DSN", "")),
  requireDb: env("LLM_E2E_REQUIRE_DB", "0") === "1",
};

const checks = [];
const failed = [];
const traceRows = [];
const bugRows = [];

fs.mkdirSync(OUT_DIR, { recursive: true });

function formatTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function env(name, fallback = "") {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : fallback;
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function redact(value) {
  if (value == null) return value;
  return String(value)
    .replace(/agt_[A-Za-z0-9._~+/-]+/g, "agt_[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/0x[a-fA-F0-9]{64,}/g, "0x[REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]")
    .replace(/(password|private[_-]?key|api[_-]?key|secret|token|credential)\s*[:=]\s*[^,\s"']+/gi, "$1=[REDACTED]");
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, next]) => [key, sanitize(next)]));
  }
  if (typeof value === "string") return redact(value);
  return value;
}

function addBug({ scenario, expected, actual, evidence = "" }) {
  bugRows.push({
    id: `LLM-DEEPSEEK-E2E-${String(bugRows.length + 1).padStart(3, "0")}`,
    severity: "P1",
    scenario,
    evidence: redact(evidence),
    reproSteps: `Run npm run e2e:llm-deepseek:${IS_STAGING ? "staging" : "local"}`,
    expected,
    actual: redact(actual),
    status: "open",
  });
}

function addCheck(name, ok, details = {}, failure = "") {
  const passed = Boolean(ok);
  const check = { name, ok: passed, details: sanitize(details), failure: passed ? "" : redact(failure) };
  checks.push(check);
  if (!passed) {
    failed.push({ name, failure: check.failure });
    addBug({ scenario: name, expected: "pass", actual: failure || "check failed", evidence: JSON.stringify(details).slice(0, 1000) });
  }
  return check;
}

function addTrace({ scenario, method = "CHECKPOINT", requestPath = "", status = 0, durationMs = 0, request = {}, response = {}, ok = false }) {
  traceRows.push({
    runId: RUN_ID,
    scenario,
    requestId: `${RUN_ID}:${scenario}:${traceRows.length + 1}`,
    timestamp: new Date().toISOString(),
    method,
    path: requestPath,
    httpStatus: status,
    durationMs,
    expected: "pass",
    actual: ok ? "pass" : "fail",
    sanitizedRequest: sanitize(request),
    sanitizedResponse: sanitize(response),
    ledgerDelta: "",
    vaultDelta: "",
    ticketHash: "",
    txHash: "",
    reconciliationStatus: ok ? "passed" : "failed",
  });
}

function parseUsdcMicros(value) {
  const text = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid USDC decimal: ${text}`);
  const [whole, fractional = ""] = text.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((fractional + "000000").slice(0, 6));
}

function formatUsdcMicros(micros) {
  const sign = micros < 0n ? "-" : "";
  const abs = micros < 0n ? -micros : micros;
  const whole = abs / 1_000_000n;
  const fractional = String(abs % 1_000_000n).padStart(6, "0");
  return `${sign}${whole}.${fractional}`;
}

function ceilDiv(numerator, denominator) {
  return numerator <= 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function expectedChargeMicros({ inputTokens, outputTokens, inputPricePer1MUsdc, outputPricePer1MUsdc }) {
  const inputPriceMicros = parseUsdcMicros(inputPricePer1MUsdc);
  const outputPriceMicros = parseUsdcMicros(outputPricePer1MUsdc);
  const numerator = BigInt(inputTokens) * inputPriceMicros + BigInt(outputTokens) * outputPriceMicros;
  return ceilDiv(numerator, 1_000_000n);
}

async function timedJsonFetch(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // caller records parse failure
  }
  return { status: response.status, ok: response.ok, durationMs: Date.now() - started, text, json };
}

async function discoverService() {
  const url = `${config.gatewayBaseUrl}/api/v1/services/discover`;
  const result = await timedJsonFetch(url, { method: "GET" });
  const services = Array.isArray(result.json?.services) ? result.json.services : [];
  const service = services.find((item) => item.id === config.serviceId || item.serviceId === config.serviceId);
  addCheck("discover_deepseek_service", Boolean(service), {
    url,
    status: result.status,
    serviceId: config.serviceId,
    totalServices: services.length,
    service: service ? {
      id: service.id || service.serviceId,
      name: service.name || service.serviceName,
      priceModel: service.priceModel,
      serviceKind: service.serviceKind,
      metering: service.metering,
    } : null,
  }, service ? "" : "DeepSeek service is not discoverable from Gateway.");
  addTrace({
    scenario: "discover_deepseek_service",
    method: "GET",
    requestPath: "/api/v1/services/discover",
    status: result.status,
    durationMs: result.durationMs,
    response: { serviceId: service?.id || service?.serviceId, totalServices: services.length },
    ok: Boolean(service),
  });
  return service || null;
}

function resolvePrice(discoveredService, key, envValue, fallback = "") {
  if (envValue) return envValue;
  const metering = discoveredService?.metering || discoveredService?.pricing || {};
  return (
    metering[key] ||
    metering[key.replace("Usdc", "USDC")] ||
    discoveredService?.[key] ||
    fallback
  );
}

async function invokeDeepSeek() {
  const idempotencyKey = `${RUN_ID}-invoke-001`;
  const body = {
    serviceId: config.serviceId,
    idempotencyKey,
    payload: {
      body: {
        model: config.model,
        messages: [
          { role: "system", content: "You are a terse billing smoke-test assistant." },
          { role: "user", content: config.prompt },
        ],
        max_tokens: config.maxTokens,
        temperature: 0,
      },
    },
  };
  if (config.maxCostUsdc) body.maxCostUsdc = config.maxCostUsdc;

  const result = await timedJsonFetch(`${config.gatewayBaseUrl}/api/v1/agent/invoke`, {
    method: "POST",
    headers: {
      "X-Credential": config.credential,
      "X-Request-Id": `${RUN_ID}:invoke`,
    },
    body: JSON.stringify(body),
  });
  addTrace({
    scenario: "invoke_deepseek_chat",
    method: "POST",
    requestPath: "/api/v1/agent/invoke",
    status: result.status,
    durationMs: result.durationMs,
    request: { ...body, credential: "[REDACTED]" },
    response: result.json || result.text.slice(0, 1000),
    ok: result.ok && result.json?.status === "SUCCEEDED",
  });
  addCheck("invoke_deepseek_chat", result.ok && result.json?.status === "SUCCEEDED", {
    status: result.status,
    durationMs: result.durationMs,
    invocationId: result.json?.invocationId,
    chargedUsdc: result.json?.chargedUsdc,
    error: result.json?.error,
  }, `DeepSeek Gateway invoke failed: status=${result.status} body=${result.text.slice(0, 1200)}`);
  return result;
}

function validateBilling(responseJson, discoveredService) {
  const result = responseJson?.result || {};
  const usage = result.usage || {};
  const synapse = result.synapse || {};
  const inputTokens = Number(usage.inputTokens ?? usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = Number(usage.outputTokens ?? usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = Number(usage.totalTokens ?? usage.total_tokens);
  const inputPrice = resolvePrice(discoveredService, "inputPricePer1MTokensUsdc", config.inputPricePer1MUsdc);
  const outputPrice = resolvePrice(discoveredService, "outputPricePer1MTokensUsdc", config.outputPricePer1MUsdc);
  const hasUsage = Number.isInteger(inputTokens) && inputTokens >= 0
    && Number.isInteger(outputTokens) && outputTokens >= 0
    && Number.isInteger(totalTokens) && totalTokens >= inputTokens + outputTokens;
  addCheck("llm_usage_present", hasUsage, { usage }, "LLM response must include final integer input/output/total token usage.");
  const hasSynapse = synapse.priceModel === "token_metered"
    && synapse.holdUsdc
    && synapse.chargedUsdc
    && synapse.releasedUsdc
    && synapse.providerRevenueUsdc
    && synapse.platformFeeUsdc;
  addCheck("synapse_billing_metadata_present", hasSynapse, { synapse }, "LLM response must include Synapse token-metered billing metadata.");
  const hasPrices = Boolean(inputPrice && outputPrice);
  addCheck("llm_token_prices_available", hasPrices, { inputPrice, outputPrice }, "Set LLM_E2E_INPUT_PRICE_PER_1M_USDC and LLM_E2E_OUTPUT_PRICE_PER_1M_USDC or expose prices in discovery.");
  if (!hasUsage || !hasSynapse || !hasPrices) return null;

  const expectedMicros = expectedChargeMicros({
    inputTokens,
    outputTokens,
    inputPricePer1MUsdc: inputPrice,
    outputPricePer1MUsdc: outputPrice,
  });
  const actualMicros = parseUsdcMicros(synapse.chargedUsdc);
  const holdMicros = parseUsdcMicros(synapse.holdUsdc);
  const releasedMicros = parseUsdcMicros(synapse.releasedUsdc);
  const providerRevenueMicros = parseUsdcMicros(synapse.providerRevenueUsdc);
  const platformFeeMicros = parseUsdcMicros(synapse.platformFeeUsdc);
  const chargedMatches = actualMicros === expectedMicros;
  const releasedMatches = releasedMicros === holdMicros - actualMicros;
  const splitMatches = providerRevenueMicros + platformFeeMicros === actualMicros;
  addCheck("llm_charge_formula_exact", chargedMatches, {
    inputTokens,
    outputTokens,
    inputPrice,
    outputPrice,
    expectedChargedUsdc: formatUsdcMicros(expectedMicros),
    actualChargedUsdc: synapse.chargedUsdc,
  }, "chargedUsdc must equal ceil_to_6_decimals(tokens * pricePer1M / 1,000,000).");
  addCheck("llm_hold_release_exact", releasedMatches && holdMicros >= actualMicros, {
    holdUsdc: synapse.holdUsdc,
    chargedUsdc: synapse.chargedUsdc,
    releasedUsdc: synapse.releasedUsdc,
  }, "releasedUsdc must equal holdUsdc - chargedUsdc and hold must cover charge.");
  addCheck("llm_revenue_split_balances", splitMatches, {
    chargedUsdc: synapse.chargedUsdc,
    providerRevenueUsdc: synapse.providerRevenueUsdc,
    platformFeeUsdc: synapse.platformFeeUsdc,
  }, "provider revenue plus platform fee must equal the actual LLM charge.");
  return {
    usage: { inputTokens, outputTokens, totalTokens },
    synapse,
    expectedChargedUsdc: formatUsdcMicros(expectedMicros),
  };
}

function queryPostgresInvocation(invocationId) {
  if (!config.postgresDsn || !invocationId) {
    addCheck("postgres_invocation_evidence", !config.requireDb, { skipped: true, reason: "LLM_E2E_POSTGRES_DSN not set" }, "DB evidence required but LLM_E2E_POSTGRES_DSN is missing.");
    return null;
  }
  try {
    const safeInvocationId = String(invocationId).replace(/'/g, "''");
    const sql = `SELECT json_build_object('invocation_id', invocation_id, 'service_id', service_id, 'status', status, 'charged_usdc', charged_usdc::text, 'result_json', result_json)::text FROM synapse_invocations WHERE invocation_id = '${safeInvocationId}'`;
    const output = execFileSync("psql", [config.postgresDsn, "-v", "ON_ERROR_STOP=1", "-tAc", sql], {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || "" },
      input: "",
    }).trim();
    const parsed = output ? JSON.parse(output) : null;
    addCheck("postgres_invocation_evidence", Boolean(parsed && parsed.status === "SUCCEEDED"), {
      invocationId,
      row: parsed ? { ...parsed, result_json: parsed.result_json ? "[present]" : null } : null,
    }, "Postgres invocation row must exist and be SUCCEEDED.");
    return parsed;
  } catch (error) {
    addCheck("postgres_invocation_evidence", false, { invocationId }, `Postgres evidence query failed: ${error.message}`);
    return null;
  }
}

function writeOutputs({ discoveredService, invokeResponse, billingEvidence, dbEvidence }) {
  const tracePath = path.join(OUT_DIR, "trace.jsonl");
  fs.writeFileSync(tracePath, traceRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  const traceDigest = crypto.createHash("sha256").update(fs.readFileSync(tracePath)).digest("hex");
  const report = {
    scriptVersion: "llm-deepseek-gateway-e2e:v1",
    environment: ENVIRONMENT,
    status: failed.length === 0 ? "passed" : "failed",
    generatedAt: GENERATED_AT.toISOString(),
    runId: RUN_ID,
    gatewayBaseUrl: config.gatewayBaseUrl,
    serviceId: config.serviceId,
    checks,
    failed,
    traceDigest,
    invocationId: invokeResponse?.invocationId || "",
    billing: billingEvidence,
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "api-evidence.json"), JSON.stringify(sanitize({
    discoveredService,
    invokeResponse,
    billingEvidence,
  }), null, 2) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "db-evidence.json"), JSON.stringify(sanitize(dbEvidence || { skipped: true }), null, 2) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "bugfix-log.md"), renderBugfixLog());
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), renderReport(report));
}

function renderBugfixLog() {
  if (bugRows.length === 0) {
    return "# LLM DeepSeek E2E Bugfix Log\n\nNo open bugs.\n";
  }
  return [
    "# LLM DeepSeek E2E Bugfix Log",
    "",
    ...bugRows.flatMap((bug) => [
      `## ${bug.id}`,
      "",
      `- Severity: ${bug.severity}`,
      `- Scenario: ${bug.scenario}`,
      `- Evidence: ${bug.evidence || "n/a"}`,
      `- Repro Steps: ${bug.reproSteps}`,
      `- Expected: ${bug.expected}`,
      `- Actual: ${bug.actual}`,
      `- Status: ${bug.status}`,
      "",
    ]),
  ].join("\n");
}

function renderReport(report) {
  return [
    "# LLM DeepSeek Gateway E2E",
    "",
    `- Environment: ${report.environment}`,
    `- Status: ${report.status}`,
    `- Generated at: ${report.generatedAt}`,
    `- Gateway: ${report.gatewayBaseUrl}`,
    `- Service: ${report.serviceId}`,
    `- Invocation: ${report.invocationId || "n/a"}`,
    `- Trace digest: ${report.traceDigest}`,
    "",
    "## Checks",
    "",
    "| Check | Status |",
    "| --- | --- |",
    ...report.checks.map((check) => `| ${check.name} | ${check.ok ? "PASS" : "FAIL"} |`),
    "",
  ].join("\n");
}

async function main() {
  if (IS_STAGING && env("LLM_DEEPSEEK_E2E_CONFIRM") !== "I_UNDERSTAND_THIS_CALLS_LIVE_LLM_AND_CHARGES_STAGING") {
    throw new Error("Set LLM_DEEPSEEK_E2E_CONFIRM=I_UNDERSTAND_THIS_CALLS_LIVE_LLM_AND_CHARGES_STAGING for staging.");
  }
  if (!config.credential) {
    throw new Error("LLM_E2E_CREDENTIAL is required. Use a staging/local test agent credential token, never a production credential.");
  }
  const discoveredService = await discoverService();
  const invoke = await invokeDeepSeek();
  const invokeJson = invoke.json || {};
  const billingEvidence = validateBilling(invokeJson, discoveredService);
  const dbEvidence = queryPostgresInvocation(invokeJson.invocationId);
  writeOutputs({
    discoveredService,
    invokeResponse: invokeJson,
    billingEvidence,
    dbEvidence,
  });
  console.log(`[llm-deepseek-e2e] evidence=${OUT_DIR}`);
  console.log(`[llm-deepseek-e2e] status=${failed.length === 0 ? "passed" : "failed"} failed=${failed.length}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  addCheck("runner_uncaught_error", false, {}, error.stack || error.message);
  writeOutputs({ discoveredService: null, invokeResponse: null, billingEvidence: null, dbEvidence: null });
  console.error(`[llm-deepseek-e2e] failed: ${redact(error.stack || error.message)}`);
  process.exit(1);
});
