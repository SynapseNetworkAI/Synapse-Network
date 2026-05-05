#!/usr/bin/env node

import { execSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  assertLocalHttpUrl,
  assertStagingHttpUrl,
  readDotenvFile,
  requireStagingConfirmation,
  resolveE2eEnvironment,
} from "../lib/e2e_env_guard.mjs";
import { runLocalCleanupDryEvidence as collectLocalCleanupDryEvidence } from "./gateway_pull_health_cleanup_helper.mjs";
import { ensureLocalAgentCredential as ensureLocalAgentCredentialToken } from "./gateway_pull_health_credential_helper.mjs";
import { createGatewayPullHealthPostgresHelpers } from "./gateway_pull_health_postgres_helpers.mjs";
import { createScreenshotCapture } from "./gateway_pull_health_screenshot_helper.mjs";
import { assertSeedEnvironment } from "./seed_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const environment = resolveE2eEnvironment({
  value: process.env.GATEWAY_PULL_HEALTH_DOGFOOD_ENV,
  defaultEnv: "local",
  scriptName: "gateway-pull-health-dogfood",
});
const isStaging = environment === "staging";
process.env.SYNAPSE_E2E_ENV ||= environment;

const STAGING_CONFIRM = "I_UNDERSTAND_THIS_RESTARTS_STAGING_GATEWAY";
if (isStaging) {
  requireStagingConfirmation(
    "GATEWAY_PULL_HEALTH_STAGING_CONFIRM",
    STAGING_CONFIRM
  );
}

const timestamp = generatedAt
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const runId =
  process.env.GATEWAY_PULL_HEALTH_RUN_ID ||
  `gateway-pull-health-${environment}-${Date.now().toString(36)}`;
const evidenceDir = path.resolve(
  process.env.GATEWAY_PULL_HEALTH_EVIDENCE_DIR ||
    (isStaging
      ? path.join(
          ROOT,
          "docs/evidence/staging/gateway-pull-health",
          `${timestamp}-staging`
        )
      : path.join(
          ROOT,
          "output/dogfood/gateway-pull-health",
          `${timestamp}-local`
        ))
);
const screenshotsDir = path.join(evidenceDir, "screenshots");

const gatewayBaseUrl = trimSlash(
  process.env.GATEWAY_BASE_URL ||
    process.env.GATEWAY_PULL_HEALTH_GATEWAY_BASE ||
    (isStaging
      ? "https://api-staging.synapse-network.ai"
      : "http://127.0.0.1:8000")
);
const userFrontUrl = trimSlash(
  process.env.STAGING_USER_FRONT_URL ||
    process.env.USER_FRONT_URL ||
    process.env.GATEWAY_PULL_HEALTH_USER_FRONT_URL ||
    (isStaging ? "https://staging.synapse-network.ai" : "http://localhost:3000")
);
const expectedServiceIds = (
  process.env.GATEWAY_PULL_HEALTH_EXPECTED_SERVICE_IDS ||
  "svc_synapse_echo,svc_synapse_mock_cost_1usdc,svc_web3_sentiment_index,svc_protocol_fundamental_brief,svc_oss_security_healthcheck,svc_deepseek_chat"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
let credential =
  process.env.GATEWAY_PULL_HEALTH_E2E_CREDENTIAL ||
  process.env.LLM_E2E_CREDENTIAL ||
  "";
const llmServiceId =
  process.env.GATEWAY_PULL_HEALTH_LLM_SERVICE_ID || "svc_deepseek_chat";
const gatewayLocalEnv = !isStaging
  ? {
      ...readDotenvFile(path.join(ROOT, "services/gateway/.env.local")),
      ...readDotenvFile(path.join(ROOT, "services/gateway/.env.local.private")),
      ...readDotenvFile(path.join(ROOT, "services/gateway/.env.e2e.local")),
      ...process.env,
    }
  : process.env;
const defaultLocalPostgresDsn =
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway";
const postgresDsn =
  process.env.GATEWAY_PULL_HEALTH_POSTGRES_DSN ||
  process.env.LLM_E2E_POSTGRES_DSN ||
  process.env.LOCAL_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  gatewayLocalEnv.POSTGRES_DSN ||
  (isStaging ? "" : defaultLocalPostgresDsn);
const localAdminPostgresDsn =
  process.env.GATEWAY_PULL_HEALTH_ADMIN_POSTGRES_DSN ||
  process.env.LOCAL_GATEWAY_ADMIN_POSTGRES_DSN ||
  "";
const localAdminPostgresDsnCandidates = [
  localAdminPostgresDsn,
  `postgresql://${encodeURIComponent(
    process.env.USER || "cliff"
  )}@127.0.0.1:15432/synapse_gateway`,
  "postgresql://synapse_gateway_migrator:local-dev-gateway-migrator-password@127.0.0.1:15432/synapse_gateway",
  "postgresql://synapse:local-dev-postgres-password@127.0.0.1:15432/synapse_gateway",
].filter(Boolean);
const localProviderWallet =
  process.env.GATEWAY_PULL_HEALTH_LOCAL_PROVIDER_WALLET ||
  "0x0000000000000000000000000000000000000e2e";
const jwtSecret = gatewayLocalEnv.JWT_SECRET || "";
const localOwnerByServiceId = new Map();

if (isStaging) {
  assertStagingHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
  assertStagingHttpUrl("STAGING_USER_FRONT_URL", userFrontUrl);
} else {
  assertLocalHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
  assertLocalHttpUrl("USER_FRONT_URL", userFrontUrl);
  if (process.env.ALLOW_GCP_SECRET_MANAGER === "1") {
    throw new Error("LOCAL_E2E_FORBIDS_GCP_SECRET_MANAGER");
  }
}
process.env.SYNAPSE_SEED_ENV ||= environment;
assertSeedEnvironment({
  scriptName: "gateway-pull-health-dogfood",
  allowStaging: true,
  runId,
  dsn: postgresDsn,
  urls: [gatewayBaseUrl, userFrontUrl],
});

const checks = [];
const failed = [];
const trace = [];
const bugs = [];
const screenshotEvidence = [];
const apiEvidence = {
  environment,
  expectedServiceIds,
  gatewayBaseUrl,
  userFrontUrl,
  snapshots: {},
  restart: {},
  cleanup: {},
};
const invokeEvidence = {
  environment,
  serviceId: llmServiceId,
  attempted: false,
  holdCreated: false,
  frozenDelta: "0.000000",
};

fs.mkdirSync(screenshotsDir, { recursive: true });

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function redact(value) {
  return String(value ?? "")
    .replace(/agt_[A-Za-z0-9._~+/-]+/g, "agt_[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b0x[a-fA-F0-9]{64,}\b/g, "0x[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
    .replace(
      /(password|private[_-]?key|api[_-]?key|secret|signature|token|credential)\s*[:=]\s*[^,\s"']+/gi,
      "$1=[REDACTED]"
    );
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitize(child)])
    );
  }
  if (typeof value === "string") return redact(value);
  return value;
}

function traceEvent(event, details = {}) {
  trace.push(
    sanitize({
      runId,
      timestamp: new Date().toISOString(),
      event,
      ...details,
    })
  );
}

function addBug({ scenario, expected, actual, evidence = "" }) {
  bugs.push({
    id: `GPH-${String(bugs.length + 1).padStart(3, "0")}`,
    severity: "P1",
    scenario,
    screenshot: "",
    apiEvidence: redact(evidence),
    dbEvidence: "",
    larkEvidence: "",
    reproSteps: `Run npm run e2e:gateway-pull-health-dogfood:${environment}`,
    expected,
    actual: redact(actual),
    status: "open",
  });
}

function addCheck(name, ok, details = {}, failure = "") {
  const check = {
    name,
    status: ok ? "passed" : "failed",
    details: sanitize(details),
    failure: ok ? "" : redact(failure),
  };
  checks.push(check);
  traceEvent("check", check);
  if (!ok) {
    failed.push({ name, failure: check.failure });
    addBug({
      scenario: name,
      expected: "pass",
      actual: failure || "check failed",
      evidence: JSON.stringify(details).slice(0, 1000),
    });
  }
  return ok;
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function localProviderJwt(ownerWallet = localProviderWallet) {
  if (!jwtSecret) {
    throw new Error(
      "JWT_SECRET is required for local provider fixture registration."
    );
  }
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      sub: ownerWallet,
      iat: now,
      exp: now + 3600,
      scope: "gateway-pull-health-local-provider",
    },
    jwtSecret
  );
}

async function jsonFetch(url, options = {}) {
  const started = Date.now();
  let response;
  let text = "";
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(Number(options.timeoutMs || 20_000)),
    });
    text = await response.text();
  } catch (error) {
    traceEvent("http_error", {
      url,
      method: options.method || "GET",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const result = {
    url,
    method: options.method || "GET",
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - started,
    json,
    text,
  };
  traceEvent("http", {
    url,
    method: result.method,
    status: result.status,
    durationMs: result.durationMs,
    bodyExcerpt: text.slice(0, 800),
  });
  return result;
}

async function authenticatedProviderJson(
  pathname,
  { method = "GET", body, ownerWallet = localProviderWallet } = {}
) {
  return jsonFetch(gatewayApi(pathname), {
    method,
    headers: {
      Authorization: `Bearer ${localProviderJwt(ownerWallet)}`,
      "X-User-Address": ownerWallet,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function resolveExistingLocalOwner(serviceId) {
  const safe = String(serviceId).replace(/'/g, "''");
  const row = psqlJson(
    `SELECT json_build_object('ownerId', owner_id) FROM synapse_service_manifests WHERE service_id = '${safe}' LIMIT 1;`
  );
  const ownerId = String(row?.ownerId || "");
  const match = ownerId.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : "";
}

async function ensureProviderCatalogPrerequisite() {
  for (const serviceId of expectedServiceIds) {
    const ownerWallet =
      resolveExistingLocalOwner(serviceId) || localProviderWallet;
    localOwnerByServiceId.set(serviceId, ownerWallet);
  }
  const snapshot = await collectApiSnapshot("provider_catalog_prerequisite");
  const inRegistry = expectedIdsInRegistry(snapshot);
  addCheck(
    "provider_catalog_prerequisite_registered",
    inRegistry.length === expectedServiceIds.length,
    { expectedServiceIds, presentInRegistry: inRegistry },
    "Expected Synapse-Network-Provider catalog services are missing. Run Provider onboarding `ensure` before this dogfood."
  );
  const inHealth = expectedIdsPresentInHealth(snapshot);
  addCheck(
    "provider_catalog_prerequisite_health_rows_present",
    inHealth.length === expectedServiceIds.length,
    { expectedServiceIds, presentInHealth: inHealth },
    "Expected Provider catalog services are not present in health/status."
  );
}

async function ensureLocalAgentCredential() {
  credential = await ensureLocalAgentCredentialToken({
    isStaging,
    credential,
    authenticatedProviderJson,
    localProviderWallet,
    runId,
    invokeEvidence,
    addCheck,
  });
}

function gatewayApi(pathname) {
  return `${gatewayBaseUrl}/api${pathname}`;
}

function userFrontPath(pathname) {
  return `${userFrontUrl}${pathname}`;
}

async function collectApiSnapshot(label) {
  const [registry, stats, health, discover] = await Promise.all([
    jsonFetch(userFrontPath("/marketplace/registry.json?pageSize=100")),
    jsonFetch(gatewayApi("/v1/services/network-stats")),
    jsonFetch(gatewayApi("/v1/services/health/status?includeInactive=true")),
    jsonFetch(gatewayApi("/v1/services/discover")),
  ]);
  const snapshot = {
    capturedAt: new Date().toISOString(),
    registry: registry.json,
    stats: stats.json,
    health: health.json,
    discover: discover.json,
  };
  apiEvidence.snapshots[label] = sanitize(snapshot);
  addCheck(
    `${label}_api_http_200`,
    [registry, stats, health, discover].every((item) => item.ok),
    {
      registryStatus: registry.status,
      statsStatus: stats.status,
      healthStatus: health.status,
      discoverStatus: discover.status,
    },
    "One or more Gateway Pull Health API endpoints did not return 2xx."
  );
  return snapshot;
}

function registryIds(snapshot) {
  return new Set(
    (snapshot.registry?.services || []).map((row) => row.serviceId)
  );
}

function discoverIds(snapshot) {
  return new Set(
    (snapshot.discover?.services || []).map((row) => row.serviceId)
  );
}

function healthRowsById(snapshot) {
  return new Map(
    (snapshot.health?.services || []).map((row) => [row.serviceId, row])
  );
}

function expectedIdsPresentInHealth(snapshot) {
  const rows = healthRowsById(snapshot);
  return expectedServiceIds.filter((serviceId) => rows.has(serviceId));
}

function expectedIdsInRegistry(snapshot) {
  const ids = registryIds(snapshot);
  return expectedServiceIds.filter((serviceId) => ids.has(serviceId));
}

function expectedServiceNames(snapshot) {
  const rows = snapshot.registry?.services || [];
  const names = rows
    .filter((row) => expectedServiceIds.includes(row.serviceId))
    .map((row) => row.serviceName || row.name || row.serviceId)
    .filter(Boolean);
  return names.length > 0 ? names : expectedServiceIds;
}

function expectedIdsInDiscover(snapshot) {
  const ids = discoverIds(snapshot);
  return expectedServiceIds.filter((serviceId) => ids.has(serviceId));
}

function expectedIdsWithStatus(snapshot, statuses) {
  const rows = healthRowsById(snapshot);
  return expectedServiceIds.filter((serviceId) => {
    const row = rows.get(serviceId);
    const status = String(
      row?.health?.overallStatus || row?.status || ""
    ).toLowerCase();
    return statuses.includes(status);
  });
}

function runLocalCleanupDryEvidence() {
  collectLocalCleanupDryEvidence({
    root: ROOT,
    isStaging,
    postgresDsn,
    apiEvidence,
    addCheck,
    sanitize,
    redact,
  });
}

const capturePage = createScreenshotCapture({
  screenshotsDir,
  evidenceDir,
  screenshotEvidence,
  addCheck,
  sanitize,
});

const {
  psqlJson,
  expireExpectedHealthSnapshots,
  ensureLocalOfflineLifecycleSchema,
  makeLocalLlmUnavailableForNoHold,
  markLocalServiceOffline,
  idempotencySql,
} = createGatewayPullHealthPostgresHelpers({
  root: ROOT,
  isStaging,
  postgresDsn,
  localAdminPostgresDsnCandidates,
  expectedServiceIds,
  llmServiceId,
  addCheck,
  traceEvent,
  redact,
});

function restartGateway() {
  if (process.env.GATEWAY_PULL_HEALTH_SKIP_RESTART === "1") {
    apiEvidence.restart = { mode: "skipped", triggered: false };
    return;
  }
  if (isStaging) {
    const command =
      process.env.GATEWAY_PULL_HEALTH_STAGING_RESTART_COMMAND || "";
    if (!command) {
      apiEvidence.restart = {
        mode: "external",
        triggered: false,
        note: "No restart command configured; runner assumes it is executed immediately after deploy/restart.",
      };
      traceEvent("restart_external", apiEvidence.restart);
      return;
    }
    execSync(command, {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env },
      shell: "/bin/bash",
    });
    apiEvidence.restart = {
      mode: "command",
      triggered: true,
      command: "[REDACTED_COMMAND]",
    };
    return;
  }
  const result = spawnSync("sh", ["scripts/local/restart_gateway.sh"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      SERVICE_HEALTH_MONITOR_ENABLED:
        process.env.SERVICE_HEALTH_MONITOR_ENABLED || "false",
      SERVICE_HEALTH_PROBE_INTERVAL_SEC:
        process.env.SERVICE_HEALTH_PROBE_INTERVAL_SEC || "60",
      SERVICE_HEALTH_REHYDRATE_WINDOW_SEC:
        process.env.SERVICE_HEALTH_REHYDRATE_WINDOW_SEC || "120",
      SERVICE_HEALTH_PROBE_TIMEOUT_MS:
        process.env.SERVICE_HEALTH_PROBE_TIMEOUT_MS || "1000",
      SERVICE_HEALTH_MONITOR_STEP_TIMEOUT_SEC:
        process.env.SERVICE_HEALTH_MONITOR_STEP_TIMEOUT_SEC || "30",
    },
  });
  apiEvidence.restart = {
    mode: "local-script",
    triggered: result.status === 0,
    stdout: redact(result.stdout || "").slice(-2000),
    stderr: redact(result.stderr || "").slice(-2000),
  };
  if (result.status !== 0) {
    throw new Error(
      `local gateway restart failed: ${redact(
        result.stderr || result.stdout || ""
      )}`
    );
  }
}

async function waitForGatewayHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${gatewayBaseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
      last = `${response.status} ${response.statusText}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(`gateway health did not recover: ${last}`);
}

async function waitForRehydrate(
  timeoutMs = Number(
    process.env.GATEWAY_PULL_HEALTH_REHYDRATE_WAIT_MS || 180_000
  )
) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    lastSnapshot = await collectApiSnapshot("rehydrate_poll");
    const visible = expectedIdsInRegistry(lastSnapshot);
    if (visible.length === expectedServiceIds.length) {
      return lastSnapshot;
    }
    await sleep(
      Number(process.env.GATEWAY_PULL_HEALTH_REHYDRATE_POLL_MS || 5_000)
    );
  }
  return lastSnapshot || (await collectApiSnapshot("rehydrate_timeout"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyUnavailableLlmNoHold() {
  if (!credential) {
    invokeEvidence.attempted = false;
    invokeEvidence.skipReason =
      "GATEWAY_PULL_HEALTH_E2E_CREDENTIAL or LLM_E2E_CREDENTIAL is not set.";
    addCheck(
      "llm_unavailable_no_hold",
      false,
      invokeEvidence,
      "Set GATEWAY_PULL_HEALTH_E2E_CREDENTIAL so the dogfood gate can prove unavailable LLM calls do not create holds."
    );
    return;
  }
  const idempotencyKey = `${runId}-llm-unavailable-no-hold`;
  invokeEvidence.attempted = true;
  invokeEvidence.idempotencyKey = idempotencyKey;
  invokeEvidence.beforeDb = psqlJson(idempotencySql(idempotencyKey));
  const result = await jsonFetch(gatewayApi("/v1/agent/invoke"), {
    method: "POST",
    headers: {
      "X-Credential": credential,
      "X-Request-Id": `${runId}:llm-unavailable-no-hold`,
    },
    body: JSON.stringify({
      serviceId: llmServiceId,
      idempotencyKey,
      payload: {
        body: {
          model: "deepseek-chat",
          messages: [{ role: "user", content: "health gate no hold test" }],
          max_tokens: 8,
          stream: false,
        },
      },
    }),
    timeoutMs: 30_000,
  });
  invokeEvidence.status = result.status;
  invokeEvidence.response = sanitize(result.json || result.text.slice(0, 1000));
  invokeEvidence.afterDb = psqlJson(idempotencySql(idempotencyKey));
  const responseCode =
    result.json?.detail?.code ||
    result.json?.code ||
    result.json?.errorCode ||
    result.json?.error?.code ||
    "";
  const invocationCount = Number(invokeEvidence.afterDb?.invocationCount || 0);
  invokeEvidence.holdCreated = invocationCount > 0 && result.status !== 503;
  const ok =
    result.status === 503 &&
    /PROVIDER_UNAVAILABLE|SERVICE_UNAVAILABLE|NO_HEALTHY/i.test(
      JSON.stringify(result.json || result.text)
    ) &&
    invocationCount === 0;
  addCheck(
    "llm_unavailable_no_hold",
    ok,
    {
      status: result.status,
      responseCode,
      invocationCount,
      holdCreated: invokeEvidence.holdCreated,
      frozenDelta: invokeEvidence.frozenDelta,
    },
    "Unavailable LLM invoke must return 503 and must not create invocation/hold evidence."
  );
}

function renderBugfixLog() {
  if (bugs.length === 0) {
    return "# Gateway Pull Health Dogfood Bugfix Log\n\nNo open bugs.\n";
  }
  return [
    "# Gateway Pull Health Dogfood Bugfix Log",
    "",
    ...bugs.flatMap((bug) => [
      `## ${bug.id}`,
      "",
      `- Severity: ${bug.severity}`,
      `- Scenario: ${bug.scenario}`,
      `- Screenshot: ${bug.screenshot || "n/a"}`,
      `- API Evidence: ${bug.apiEvidence || "n/a"}`,
      `- DB Evidence: ${bug.dbEvidence || "n/a"}`,
      `- Chain Evidence: n/a`,
      `- Repro Steps: ${bug.reproSteps}`,
      `- Expected: ${bug.expected}`,
      `- Actual: ${bug.actual}`,
      `- Status: ${bug.status}`,
      "",
    ]),
  ].join("\n");
}

function writeEvidence() {
  const traceText =
    trace.map((row) => JSON.stringify(sanitize(row))).join("\n") + "\n";
  const traceDigest = crypto
    .createHash("sha256")
    .update(traceText)
    .digest("hex");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "trace.jsonl"), traceText);
  fs.writeFileSync(
    path.join(evidenceDir, "screenshot-evidence.json"),
    `${JSON.stringify(screenshotEvidence.map(sanitize), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(evidenceDir, "api-evidence.json"),
    `${JSON.stringify(sanitize(apiEvidence), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(evidenceDir, "invoke-evidence.json"),
    `${JSON.stringify(sanitize(invokeEvidence), null, 2)}\n`
  );
  fs.writeFileSync(path.join(evidenceDir, "bugfix-log.md"), renderBugfixLog());
  const report = sanitize({
    status: failed.length === 0 ? "passed" : "failed",
    environment,
    runId,
    generatedAt: generatedAt.toISOString(),
    gatewayBaseUrl,
    userFrontUrl,
    expectedServiceIds,
    checks,
    failed,
    screenshots: screenshotEvidence,
    traceDigest,
  });
  fs.writeFileSync(
    path.join(evidenceDir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  fs.writeFileSync(path.join(evidenceDir, "report.md"), renderReport(report));
}

function renderReport(report) {
  return [
    "# Gateway Pull Health Dogfood Evidence",
    "",
    `- Status: ${report.status}`,
    `- Environment: ${report.environment}`,
    `- Gateway: ${report.gatewayBaseUrl}`,
    `- User-front: ${report.userFrontUrl}`,
    `- Expected services: ${report.expectedServiceIds.join(", ")}`,
    `- Trace digest: ${report.traceDigest}`,
    "",
    "## Checks",
    "",
    "| Check | Status |",
    "| --- | --- |",
    ...report.checks.map((check) => `| ${check.name} | ${check.status} |`),
    "",
    "## Screenshots",
    "",
    ...report.screenshots.map((shot) => `- ${shot.file}: ${shot.url}`),
    "",
  ].join("\n");
}

async function main() {
  const browser = await chromium.launch({
    headless: process.env.GATEWAY_PULL_HEALTH_HEADLESS !== "0",
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  try {
    runLocalCleanupDryEvidence();
    await ensureProviderCatalogPrerequisite();
    await ensureLocalAgentCredential();
    const before = await collectApiSnapshot("before_restart");
    const beforeRegistry = expectedIdsInRegistry(before);
    const beforeHealth = expectedIdsPresentInHealth(before);
    addCheck(
      "before_restart_expected_services_registered",
      beforeHealth.length === expectedServiceIds.length,
      { expectedServiceIds, presentInHealth: beforeHealth },
      "Expected services are not registered in health/status before restart."
    );
    addCheck(
      "before_restart_expected_services_discoverable",
      beforeRegistry.length === expectedServiceIds.length,
      { expectedServiceIds, presentInRegistry: beforeRegistry },
      "Expected services are not visible in registry before restart."
    );
    await capturePage({
      page,
      url: userFrontPath("/marketplace"),
      fileName: "01-marketplace-before-restart.png",
      expectedText: expectedServiceNames(before),
      apiCheckpoint: {
        registryTotal: before.registry?.total,
        expectedVisibleServiceIds: beforeRegistry,
      },
    });
    await capturePage({
      page,
      url: userFrontPath("/marketplace/registry.json?pageSize=100"),
      fileName: "02-registry-before-restart-json.png",
      expectedText: expectedServiceIds,
      apiCheckpoint: {
        registryIds: [...registryIds(before)],
        diagnostics: before.registry?.diagnostics,
      },
    });

    restartGateway();
    await waitForGatewayHealth();
    const immediate = await collectApiSnapshot("immediate_after_restart");
    const immediateRegistry = expectedIdsInRegistry(immediate);
    addCheck(
      "restart_registered_not_lost",
      expectedIdsPresentInHealth(immediate).length ===
        expectedServiceIds.length,
      {
        expectedServiceIds,
        presentInHealth: expectedIdsPresentInHealth(immediate),
        stats: immediate.stats,
      },
      "Gateway restart lost registered service rows."
    );
    addCheck(
      "restart_fresh_snapshot_expected_services_visible",
      immediateRegistry.length === expectedServiceIds.length,
      {
        expectedServiceIds,
        visibleAfterRestart: immediateRegistry,
        diagnostics: immediate.registry?.diagnostics,
      },
      "Fresh health snapshots should keep registered Provider services discoverable across Gateway restart."
    );
    await capturePage({
      page,
      url: userFrontPath("/marketplace"),
      fileName: "03-marketplace-immediate-after-restart-fresh.png",
      expectedText: expectedServiceNames(immediate),
      apiCheckpoint: {
        expectedVisibleServiceIds: immediateRegistry,
        diagnostics: immediate.registry?.diagnostics,
      },
    });
    await capturePage({
      page,
      url: gatewayApi("/v1/services/health/status?includeInactive=true"),
      fileName: "04-health-status-after-restart.png",
      expectedText: expectedServiceIds,
      apiCheckpoint: {
        healthRows: immediate.health?.services?.filter((row) =>
          expectedServiceIds.includes(row.serviceId)
        ),
      },
    });

    if (!isStaging) {
      expireExpectedHealthSnapshots();
      const expired = await collectApiSnapshot("expired_snapshots");
      const expiredVisible = expectedIdsInRegistry(expired);
      const expiredDiscover = expectedIdsInDiscover(expired);
      addCheck(
        "expired_snapshot_expected_services_fail_closed",
        expiredVisible.length === 0 && expiredDiscover.length === 0,
        {
          visibleInRegistry: expiredVisible,
          visibleInDiscover: expiredDiscover,
          diagnostics: expired.registry?.diagnostics,
        },
        "Expired health snapshots must fail closed while registration rows remain."
      );
      const expiredHealthPresent = expectedIdsPresentInHealth(expired);
      addCheck(
        "expired_snapshot_registration_not_lost",
        expiredHealthPresent.length === expectedServiceIds.length,
        {
          presentInHealth: expiredHealthPresent,
          stats: expired.stats,
        },
        "Expiring health snapshots must not delete service registrations."
      );
      await capturePage({
        page,
        url: userFrontPath("/marketplace"),
        fileName: "05-marketplace-expired-snapshot-fail-closed.png",
        expectedText: ["Agent API Marketplace"],
        forbiddenText: expectedServiceNames(before),
        apiCheckpoint: {
          expectedVisibleServiceIds: expiredVisible,
          diagnostics: expired.registry?.diagnostics,
        },
      });

      for (const serviceId of expectedServiceIds) {
        const ownerWallet =
          localOwnerByServiceId.get(serviceId) || localProviderWallet;
        await authenticatedProviderJson(`/v1/services/${serviceId}/ping`, {
          method: "POST",
          ownerWallet,
        }).catch((error) => {
          traceEvent("expired_snapshot_force_probe_error", {
            serviceId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    makeLocalLlmUnavailableForNoHold();
    await verifyUnavailableLlmNoHold();

    const rehydrated = await waitForRehydrate();
    const rehydratedRegistry = expectedIdsInRegistry(rehydrated);
    addCheck(
      "rehydrate_expected_services_discoverable",
      rehydratedRegistry.length === expectedServiceIds.length,
      {
        expectedServiceIds,
        presentInRegistry: rehydratedRegistry,
        diagnostics: rehydrated.registry?.diagnostics,
      },
      "Health monitor did not rehydrate expected services within the wait window."
    );
    await capturePage({
      page,
      url: userFrontPath("/marketplace"),
      fileName: "06-marketplace-after-rehydrate.png",
      expectedText: expectedServiceNames(rehydrated),
      apiCheckpoint: {
        expectedVisibleServiceIds: rehydratedRegistry,
        diagnostics: rehydrated.registry?.diagnostics,
      },
    });

    if (!isStaging) {
      if (process.env.GATEWAY_PULL_HEALTH_PROVIDER_DOWN_COMMAND) {
        execSync(process.env.GATEWAY_PULL_HEALTH_PROVIDER_DOWN_COMMAND, {
          cwd: ROOT,
          stdio: "pipe",
          shell: "/bin/bash",
        });
        await sleep(
          Number(
            process.env.GATEWAY_PULL_HEALTH_PROVIDER_DOWN_WAIT_MS || 70_000
          )
        );
        const providerDown = await collectApiSnapshot("provider_down");
        const downVisible = expectedIdsInRegistry(providerDown);
        addCheck(
          "provider_down_expected_services_removed",
          downVisible.length === 0,
          {
            stillVisible: downVisible,
            diagnostics: providerDown.registry?.diagnostics,
          },
          "Provider health failure did not remove expected services from Marketplace."
        );
        await capturePage({
          page,
          url: userFrontPath("/marketplace"),
          fileName: "09-provider-down-marketplace-removed.png",
          expectedText: ["Agent API Marketplace"],
          forbiddenText: expectedServiceNames(rehydrated),
          apiCheckpoint: {
            expectedVisibleServiceIds: downVisible,
            diagnostics: providerDown.registry?.diagnostics,
          },
        });
      } else {
        addCheck(
          "provider_down_expected_services_removed",
          false,
          {
            requiredEnv: "GATEWAY_PULL_HEALTH_PROVIDER_DOWN_COMMAND",
            note: "Set a local command that makes the deterministic provider /health fail, then rerun.",
          },
          "Local provider-down removal proof requires GATEWAY_PULL_HEALTH_PROVIDER_DOWN_COMMAND."
        );
      }
    }
  } finally {
    await browser.close();
    writeEvidence();
  }

  if (failed.length > 0) {
    console.error(
      `[gateway-pull-health-dogfood] failed: ${failed
        .map((item) => item.name)
        .join(", ")}`
    );
    process.exit(1);
  }
  console.log(
    `[gateway-pull-health-dogfood] evidence written to ${evidenceDir}`
  );
}

main().catch((error) => {
  addCheck(
    "runner_uncaught_error",
    false,
    {},
    error instanceof Error ? error.message : String(error)
  );
  writeEvidence();
  console.error(error);
  process.exit(1);
});
