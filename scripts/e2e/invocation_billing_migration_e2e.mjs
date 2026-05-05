#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertLocalHttpUrl,
  assertStagingHttpUrl,
  requireStagingConfirmation,
  resolveE2eEnvironment,
} from "../lib/e2e_env_guard.mjs";
import { writeInvocationBillingEvidence } from "./lib/invocation_billing_evidence_writer.mjs";
import { localLegacyFixtureSql } from "./lib/invocation_billing_migration_sql.mjs";
import { runInvocationBillingUiCapture } from "./lib/invocation_billing_ui_capture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const generatedAt = new Date();
const environment = resolveE2eEnvironment({
  value: process.env.INVOCATION_BILLING_MIGRATION_ENV,
  defaultEnv: "local",
  scriptName: "invocation-billing-migration",
});
const isStaging = environment === "staging";
const runId =
  process.env.INVOCATION_BILLING_MIGRATION_RUN_ID ||
  `invocation-billing-${environment}-${Date.now().toString(36)}`;
const evidenceDir = path.resolve(
  process.env.INVOCATION_BILLING_MIGRATION_EVIDENCE_DIR ||
    (isStaging
      ? path.join(
          ROOT,
          "docs/evidence/staging/invocation-billing-migration",
          `${formatTimestamp(generatedAt)}-staging`
        )
      : path.join(
          ROOT,
          "output/dogfood/invocation-billing-migration",
          `${formatTimestamp(generatedAt)}-local`
        ))
);
const screenshotsDir = path.join(evidenceDir, "screenshots");

if (isStaging) {
  requireStagingConfirmation(
    "INVOCATION_BILLING_STAGING_CONFIRM",
    "I_UNDERSTAND_THIS_MUTATES_STAGING_BILLING_PROJECTION"
  );
} else if (
  process.env.INVOCATION_BILLING_MIGRATION_CONFIRM !==
  "I_UNDERSTAND_THIS_MIGRATES_FINANCIAL_BILLING_STATE"
) {
  throw new Error(
    "local E2E requires INVOCATION_BILLING_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_MIGRATES_FINANCIAL_BILLING_STATE"
  );
}

const gatewayBaseUrl = trimSlash(
  process.env.GATEWAY_BASE_URL ||
    (isStaging
      ? "https://api-staging.synapse-network.ai"
      : "http://127.0.0.1:8000")
);
const userFrontUrl = trimSlash(
  process.env.STAGING_USER_FRONT_URL ||
    process.env.USER_FRONT_URL ||
    (isStaging ? "https://staging.synapse-network.ai" : "http://localhost:3000")
);
const adminFrontUrl = trimSlash(
  process.env.STAGING_ADMIN_FRONT_URL ||
    process.env.ADMIN_FRONT_URL ||
    (isStaging
      ? "https://admin-staging.synapse-network.ai"
      : "http://localhost:3200")
);
const adminApiUrl = trimSlash(
  process.env.STAGING_ADMIN_API_URL ||
    process.env.ADMIN_API_URL ||
    (isStaging
      ? "https://admin-api-staging.synapse-network.ai"
      : "http://127.0.0.1:8300")
);
const postgresDsn =
  process.env.INVOCATION_BILLING_POSTGRES_DSN ||
  process.env.STAGING_POSTGRES_DSN ||
  process.env.POSTGRES_DSN ||
  (isStaging
    ? ""
    : "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway");
const migrationDsn =
  process.env.INVOCATION_BILLING_MIGRATION_DSN ||
  process.env.STAGING_POSTGRES_MIGRATOR_DSN ||
  process.env.POSTGRES_MIGRATOR_DSN ||
  process.env.MIGRATION_DSN ||
  postgresDsn;
const agentCredential =
  process.env.STAGING_E2E_AGENT_CREDENTIAL ||
  process.env.INVOCATION_BILLING_E2E_AGENT_CREDENTIAL ||
  process.env.GATEWAY_E2E_CREDENTIAL ||
  "";
const fixedServiceId =
  process.env.INVOCATION_BILLING_FIXED_SERVICE_ID ||
  "svc_oss_security_healthcheck";
const llmServiceId =
  process.env.INVOCATION_BILLING_LLM_SERVICE_ID || "svc_deepseek_chat";
const requireInvoke =
  process.env.INVOCATION_BILLING_REQUIRE_INVOKE === "1" || isStaging;
const requireLlm =
  process.env.INVOCATION_BILLING_REQUIRE_LLM === "1" || isStaging;

if (isStaging) {
  assertStagingHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
  assertStagingHttpUrl("STAGING_USER_FRONT_URL", userFrontUrl);
  assertStagingHttpUrl("STAGING_ADMIN_FRONT_URL", adminFrontUrl);
  assertStagingHttpUrl("STAGING_ADMIN_API_URL", adminApiUrl);
} else {
  assertLocalHttpUrl("GATEWAY_BASE_URL", gatewayBaseUrl);
  assertLocalHttpUrl("USER_FRONT_URL", userFrontUrl);
  assertLocalHttpUrl("ADMIN_FRONT_URL", adminFrontUrl);
  if (process.env.ALLOW_GCP_SECRET_MANAGER === "1") {
    throw new Error("LOCAL_E2E_FORBIDS_GCP_SECRET_MANAGER");
  }
}
if (!postgresDsn || !migrationDsn) {
  throw new Error(
    "Postgres DSN and migration DSN are required for invocation billing evidence."
  );
}

const checks = [];
const failed = [];
const trace = [];
const migrationEvidence = {
  environment,
  runId,
  legacyFixture: { attempted: false },
  before: null,
  afterFirstRun: null,
  afterSecondRun: null,
  idempotentRerunUnchanged: false,
  parseFailures: [],
  scriptRuns: [],
};
const apiEvidence = {
  environment,
  gatewayBaseUrl,
  userFrontUrl,
  adminApiUrl,
  calls: [],
};
const dbEvidence = { environment, invocations: {}, adminProjection: null };
const uiEvidence = {
  environment,
  attempted: false,
  skippedWithReason:
    "Browser UI capture is optional for this DB-first migration gate.",
  pages: [],
};
const screenshotEvidence = [];

fs.mkdirSync(screenshotsDir, { recursive: true });

function formatTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isSensitiveKey(key) {
  return /(?:password|privateKey|apiKey|secret|signature|token|credential|dsn|authorization)/i.test(
    String(key || "")
  );
}

function redact(value) {
  return String(value ?? "")
    .replace(/agt_[A-Za-z0-9._~+/-]+/g, "agt_[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
    .replace(/\b0x[a-fA-F0-9]{64,}\b/g, "0x[REDACTED]")
    .replace(
      /(password|private[_-]?key|api[_-]?key|secret|signature|token|credential)\s*[:=]\s*[^,\s"']+/gi,
      "$1=[REDACTED]"
    );
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        isSensitiveKey(key) ? "[REDACTED]" : sanitize(child),
      ])
    );
  }
  return typeof value === "string" ? redact(value) : value;
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

function addCheck(name, ok, details = {}, error = "") {
  const record = {
    name,
    status: ok ? "passed" : "failed",
    ok: Boolean(ok),
    details: sanitize(details),
    error: redact(error),
  };
  checks.push(record);
  if (!ok) failed.push(record);
  traceEvent("check", record);
  console.log(`[invocation-billing-migration] ${ok ? "PASS" : "FAIL"} ${name}`);
  return record;
}

function psql(args, { input = "", readOnly = false, dsn = postgresDsn } = {}) {
  return spawnSync(
    "psql",
    [dsn, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
      input,
      env: {
        ...process.env,
        ...(readOnly
          ? { PGOPTIONS: "-c default_transaction_read_only=on" }
          : {}),
      },
    }
  );
}

function psqlScalar(sql, options = {}) {
  const result = psql(["-t", "-A", "-c", sql], options);
  if (result.status !== 0) {
    return { error: redact(result.stderr || result.stdout || "") };
  }
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
}

function psqlJson(sql, options = {}) {
  const raw = psqlScalar(sql, options);
  if (typeof raw !== "string") return raw;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw: redact(raw) };
  }
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function decimalAtomic(value) {
  const text = String(value ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return 0n;
  const negative = text.startsWith("-");
  const normalized = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = normalized.split(".");
  const atomic =
    BigInt(whole || "0") * 1_000_000n +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0");
  return negative ? -atomic : atomic;
}

function decimalEqual(left, right) {
  return decimalAtomic(left) === decimalAtomic(right);
}

function gatewayApi(pathname) {
  return `${gatewayBaseUrl}/api${
    pathname.startsWith("/") ? pathname : `/${pathname}`
  }`;
}

async function timedJsonFetch(url, options = {}) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json,*/*;q=0.8",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: redact(text.slice(0, 1000)) };
    }
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - started,
      json: sanitize(json),
      text: redact(text.slice(0, 2000)),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - started,
      json: null,
      text: redact(error?.message || String(error)),
    };
  }
}

async function recordApi(label, url, options = {}) {
  const result = await timedJsonFetch(url, options);
  apiEvidence.calls.push(
    sanitize({
      label,
      url,
      status: result.status,
      durationMs: result.durationMs,
      json: result.json,
    })
  );
  traceEvent("api", {
    label,
    url,
    status: result.status,
    durationMs: result.durationMs,
  });
  return result;
}

async function verifyPreflight() {
  const urls = [
    ["gateway_health", `${gatewayBaseUrl}/health`],
    ["gateway_readiness", `${gatewayBaseUrl}/readiness`],
    ["user_front_registry", `${userFrontUrl}/marketplace/registry.json`],
    ["admin_api_health", `${adminApiUrl}/health`],
  ];
  for (const [name, url] of urls) {
    const result = await recordApi(`preflight:${name}`, url, {
      headers: { Accept: "*/*" },
    });
    addCheck(`preflight_${name}`, result.status >= 200 && result.status < 500, {
      status: result.status,
      durationMs: result.durationMs,
    });
  }
  const schema = psqlJson(
    `
    SELECT json_build_object(
      'typedTableExists', to_regclass('public.synapse_invocation_billing') IS NOT NULL,
      'typedPrimaryKey', EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        WHERE c.relname = 'synapse_invocation_billing' AND i.indisprimary
      ),
      'updatedIndexExists', to_regclass('public.idx_synapse_invocation_billing_updated') IS NOT NULL
    )::text;
  `,
    { readOnly: true }
  );
  dbEvidence.schema = sanitize(schema);
  addCheck(
    "preflight_typed_billing_schema",
    schema?.typedTableExists === true && schema?.typedPrimaryKey === true,
    schema || {},
    "synapse_invocation_billing table and primary key must exist."
  );
}

function aggregateBillingSnapshot(label) {
  const snapshot = psqlJson(
    `
    WITH legacy AS (
      SELECT
        substring(rs.state_key FROM '^invocation_billing::(.+)$') AS invocation_id,
        rs.payload
      FROM synapse_runtime_state rs
      WHERE rs.state_key LIKE 'invocation_billing::%'
    ),
    legacy_valid AS (
      SELECT legacy.invocation_id, legacy.payload
      FROM legacy
      JOIN synapse_invocations inv ON inv.invocation_id = legacy.invocation_id
      WHERE jsonb_typeof(legacy.payload) = 'object'
    ),
    typed_for_legacy AS (
      SELECT billing.*
      FROM synapse_invocation_billing billing
      JOIN legacy_valid legacy ON legacy.invocation_id = billing.invocation_id
    )
    SELECT json_build_object(
      'label', ${sqlLiteral(label)},
      'legacyRows', (SELECT count(*) FROM legacy),
      'legacyValidRows', (SELECT count(*) FROM legacy_valid),
      'typedRows', (SELECT count(*) FROM synapse_invocation_billing),
      'typedRowsForLegacy', (SELECT count(*) FROM typed_for_legacy),
      'legacyChargedUsdc', COALESCE((SELECT sum(COALESCE(NULLIF(payload->>'totalCharge', '')::numeric, 0)) FROM legacy_valid), 0)::numeric(36, 6)::text,
      'typedChargedUsdcForLegacy', COALESCE((SELECT sum(charged_usdc) FROM typed_for_legacy), 0)::numeric(36, 6)::text,
      'legacyProtocolFeeUsdc', COALESCE((SELECT sum(COALESCE(NULLIF(payload->>'protocolFee', '')::numeric, 0)) FROM legacy_valid), 0)::numeric(36, 6)::text,
      'typedProtocolFeeUsdcForLegacy', COALESCE((SELECT sum(protocol_fee_usdc) FROM typed_for_legacy), 0)::numeric(36, 6)::text,
      'legacyProviderEarnedUsdc', COALESCE((SELECT sum(GREATEST(COALESCE(NULLIF(payload->>'unitPrice', '')::numeric, 0) - COALESCE(NULLIF(payload->>'protocolFee', '')::numeric, 0), 0)) FROM legacy_valid), 0)::numeric(36, 6)::text,
      'typedProviderEarnedUsdcForLegacy', COALESCE((SELECT sum(provider_earned_usdc) FROM typed_for_legacy), 0)::numeric(36, 6)::text,
      'serviceRegistrationCount', (SELECT count(*) FROM synapse_service_manifests)
    )::text;
  `,
    { readOnly: true }
  );
  return sanitize(snapshot);
}

function seedLocalLegacyFixtures() {
  if (isStaging) {
    migrationEvidence.legacyFixture = {
      attempted: false,
      skippedWithReason: "staging_read_existing_legacy_rows_only",
    };
    return;
  }
  const result = psql(["-t", "-A", "-c", localLegacyFixtureSql(runId)], {
    dsn: migrationDsn,
  });
  const rows = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  migrationEvidence.legacyFixture = sanitize({
    attempted: true,
    status: result.status,
    rows,
    stderr: result.stderr,
  });
  addCheck(
    "local_legacy_fixture_seeded",
    result.status === 0 && rows.length >= 2,
    migrationEvidence.legacyFixture,
    "Local E2E must seed fixed and LLM-like legacy invocation_billing KV fixtures."
  );
}

function runMigrationScript(label) {
  const env = {
    ...process.env,
    INVOCATION_BILLING_MIGRATION_CONFIRM:
      "I_UNDERSTAND_THIS_MIGRATES_FINANCIAL_BILLING_STATE",
    MIGRATION_DSN: migrationDsn,
    POSTGRES_DSN: migrationDsn,
  };
  const started = Date.now();
  const result = spawnSync(
    "bash",
    [
      "services/gateway/scripts/deploy/migrate_invocation_billing_runtime_state.sh",
      environment,
    ],
    { cwd: ROOT, encoding: "utf8", env }
  );
  const evidence = sanitize({
    label,
    status: result.status,
    durationMs: Date.now() - started,
    stdout: result.stdout.slice(0, 6000),
    stderr: result.stderr.slice(0, 2000),
  });
  migrationEvidence.scriptRuns.push(evidence);
  addCheck(
    `migration_script_${label}`,
    result.status === 0,
    evidence,
    "Controlled invocation billing migration script must complete without parse failures."
  );
  return evidence;
}

function verifyMigrationTotals() {
  const after = migrationEvidence.afterFirstRun || {};
  const rerun = migrationEvidence.afterSecondRun || {};
  const totalsOk =
    Number(after.typedRowsForLegacy || 0) >=
      Number(after.legacyValidRows || 0) &&
    decimalEqual(after.legacyChargedUsdc, after.typedChargedUsdcForLegacy) &&
    decimalEqual(
      after.legacyProtocolFeeUsdc,
      after.typedProtocolFeeUsdcForLegacy
    ) &&
    decimalEqual(
      after.legacyProviderEarnedUsdc,
      after.typedProviderEarnedUsdcForLegacy
    );
  migrationEvidence.idempotentRerunUnchanged =
    Number(after.typedRows || 0) === Number(rerun.typedRows || 0) &&
    decimalEqual(
      after.typedChargedUsdcForLegacy,
      rerun.typedChargedUsdcForLegacy
    ) &&
    decimalEqual(
      after.typedProtocolFeeUsdcForLegacy,
      rerun.typedProtocolFeeUsdcForLegacy
    ) &&
    decimalEqual(
      after.typedProviderEarnedUsdcForLegacy,
      rerun.typedProviderEarnedUsdcForLegacy
    );
  addCheck(
    "migration_totals_match_legacy_kv",
    totalsOk,
    { after },
    "Typed invocation billing totals for migrated legacy keys must equal legacy KV totals."
  );
  addCheck(
    "migration_idempotent_rerun_unchanged",
    migrationEvidence.idempotentRerunUnchanged,
    { after, rerun },
    "Rerunning the migration must not duplicate rows or alter migrated aggregate totals."
  );
}

async function discoverService(serviceId) {
  const result = await recordApi(
    `discover:${serviceId}`,
    gatewayApi(`/v1/services/discover?pageSize=100`)
  );
  const services = result.json?.services || result.json?.data?.services || [];
  return (
    services.find(
      (service) => (service.serviceId || service.service_id) === serviceId
    ) || null
  );
}

function servicePriceUsdc(service) {
  return String(
    [
      service?.basePriceUsdc,
      service?.costUsdc,
      service?.priceUsdc,
      service?.price?.amountUsdc,
      service?.pricing?.basePriceUsdc,
      service?.pricing?.amount,
    ].find((value) => value != null && value !== "") || ""
  );
}

function fixedPayload(serviceId) {
  if (serviceId === "svc_oss_security_healthcheck") {
    return {
      repoUrl: "https://github.com/SynapseNetworkAI/Synapse-Network-Sdk",
      packageList: ["lodash@4.17.19", "requests==2.19.1"],
      ecosystem: "mixed",
    };
  }
  return { query: `invocation billing migration ${runId}` };
}

async function invokeService({ serviceId, kind }) {
  if (!agentCredential) {
    return {
      attempted: false,
      skippedWithReason: "No staging/local E2E agent credential configured.",
    };
  }
  const service = await discoverService(serviceId);
  if (!service) {
    return {
      attempted: false,
      skippedWithReason: `${serviceId} is not discoverable.`,
    };
  }
  const idempotencyKey = `${runId}:${kind}:${Date.now().toString(36)}`;
  const body =
    kind === "llm"
      ? {
          serviceId,
          idempotencyKey,
          responseMode: "sync",
          payload: {
            body: {
              model: "deepseek-v4-pro",
              messages: [
                {
                  role: "system",
                  content:
                    "You are a concise staging billing regression checker.",
                },
                {
                  role: "user",
                  content:
                    "Reply with one short billing migration success sentence.",
                },
              ],
              stream: false,
              max_tokens: 24,
              temperature: 0,
            },
          },
        }
      : {
          serviceId,
          idempotencyKey,
          costUsdc: servicePriceUsdc(service),
          responseMode: "sync",
          payload: { body: fixedPayload(serviceId) },
        };
  const result = await recordApi(
    `invoke:${kind}:${serviceId}`,
    gatewayApi("/v1/agent/invoke"),
    {
      method: "POST",
      headers: {
        "X-Credential": agentCredential,
        "X-Request-Id": idempotencyKey,
      },
      body: JSON.stringify(body),
    }
  );
  const invocationId =
    result.json?.invocationId ||
    result.json?.invocation_id ||
    result.json?.receipt?.invocationId ||
    result.json?.data?.invocationId ||
    result.json?.data?.receipt?.invocationId ||
    "";
  const db = invocationId ? readInvocationEvidence(invocationId) : null;
  const evidence = sanitize({
    attempted: true,
    serviceId,
    kind,
    status: result.status,
    ok: result.ok,
    invocationId,
    response: result.json || result.text,
    db,
  });
  dbEvidence.invocations[kind] = evidence;
  return evidence;
}

function readInvocationEvidence(invocationId) {
  return psqlJson(
    `
    SELECT json_build_object(
      'invocation', (
        SELECT row_to_json(t)
        FROM (
          SELECT invocation_id, service_id, status, charged_usdc::text, error_code, created_at, updated_at
          FROM synapse_invocations
          WHERE invocation_id = ${sqlLiteral(invocationId)}
          LIMIT 1
        ) t
      ),
      'typedBilling', (
        SELECT row_to_json(t)
        FROM (
          SELECT invocation_id, business_type, charged_usdc::text, unit_price_usdc::text,
                 protocol_fee_usdc::text, routing_tax_usdc::text, provider_earned_usdc::text,
                 payload, updated_at
          FROM synapse_invocation_billing
          WHERE invocation_id = ${sqlLiteral(invocationId)}
          LIMIT 1
        ) t
      ),
      'legacyBilling', (
        SELECT json_build_object('stateKey', state_key, 'payload', payload, 'updatedAt', updated_at)
        FROM synapse_runtime_state
        WHERE state_key = CONCAT('invocation_billing::', ${sqlLiteral(
          invocationId
        )})
        LIMIT 1
      ),
      'ledger', COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT reference_type, reference_id, business_type, debit_account_id, credit_account_id,
                 amount_usdc::text, status, created_at
          FROM synapse_ledger_entries
          WHERE reference_id = ${sqlLiteral(invocationId)}
          ORDER BY created_at
          LIMIT 20
        ) t
      ), '[]'::json),
      'audit', COALESCE((
        SELECT json_agg(row_to_json(t))
        FROM (
          SELECT event_type, business_type, service_id, invocation_id, amount_delta::text,
                 result_status, error_code, created_at
          FROM synapse_audit_events
          WHERE invocation_id = ${sqlLiteral(invocationId)}
          ORDER BY created_at
          LIMIT 20
        ) t
      ), '[]'::json),
      'reconciliationDeltaUsdc', (
        WITH typed AS (
          SELECT COALESCE(charged_usdc, 0) AS charged
          FROM synapse_invocation_billing
          WHERE invocation_id = ${sqlLiteral(invocationId)}
        ),
        ledger_total AS (
          SELECT COALESCE(sum(amount_usdc), 0) AS total
          FROM synapse_ledger_entries
          WHERE reference_id = ${sqlLiteral(invocationId)}
            AND status = 'posted'
        )
        SELECT (COALESCE((SELECT charged FROM typed), 0) - COALESCE((SELECT max(total) FROM ledger_total), 0))::numeric(36, 6)::text
      )
    )::text;
  `,
    { readOnly: true }
  );
}

function payloadField(payload, name) {
  return payload?.[name] == null ? "" : String(payload[name]);
}

function verifyInvocation(kind, evidence, required) {
  if (!evidence?.attempted) {
    addCheck(
      `${kind}_invoke_skipped_with_reason`,
      !required && Boolean(evidence?.skippedWithReason),
      evidence || {},
      `${kind} invoke is required in this environment but was skipped.`
    );
    return;
  }
  const db = evidence.db || {};
  const invocationStatus = String(db.invocation?.status || "").toUpperCase();
  const typed = db.typedBilling || {};
  const legacy = db.legacyBilling?.payload || {};
  const statusOk = ["SUCCEEDED", "SETTLED"].includes(invocationStatus);
  const billingPresent =
    Boolean(typed.invocation_id || typed.invocationId) &&
    Boolean(db.legacyBilling);
  const payloadOk =
    decimalEqual(typed.charged_usdc, payloadField(legacy, "totalCharge")) &&
    decimalEqual(typed.unit_price_usdc, payloadField(legacy, "unitPrice")) &&
    decimalEqual(
      typed.protocol_fee_usdc,
      payloadField(legacy, "protocolFee")
    ) &&
    decimalEqual(typed.routing_tax_usdc, payloadField(legacy, "routingTax"));
  const ledgerOk = Array.isArray(db.ledger) && db.ledger.length > 0;
  const auditOk =
    Array.isArray(db.audit) &&
    db.audit.some(
      (row) =>
        !row.error_code &&
        String(row.result_status || "").toLowerCase() !== "failed"
    );
  addCheck(`${kind}_invoke_succeeded`, statusOk, {
    invocationStatus,
    invocationId: evidence.invocationId,
  });
  addCheck(`${kind}_billing_dual_written`, billingPresent && payloadOk, {
    invocationId: evidence.invocationId,
    typed,
    legacy,
  });
  addCheck(`${kind}_ledger_audit_present`, ledgerOk && auditOk, {
    ledgerCount: db.ledger?.length || 0,
    auditCount: db.audit?.length || 0,
  });
  addCheck(
    `${kind}_reconciliation_delta_zero`,
    decimalEqual(db.reconciliationDeltaUsdc, "0.000000"),
    { reconciliationDeltaUsdc: db.reconciliationDeltaUsdc }
  );
}

async function runBusinessRegression() {
  const fixed = await invokeService({
    serviceId: fixedServiceId,
    kind: "fixed",
  });
  verifyInvocation("fixed", fixed, requireInvoke);
  const llm = await invokeService({ serviceId: llmServiceId, kind: "llm" });
  verifyInvocation("llm", llm, requireLlm);
}

function readAdminProjection() {
  const projection = psqlJson(
    `
    SELECT json_build_object(
      'financeProjection', (
        SELECT row_to_json(t)
        FROM (
          SELECT today_invocation_count, today_platform_fee_earned_usdc::text,
                 today_provider_earned_usdc::text, projected_at
          FROM synapse_admin_dashboard_finance_projection
          ORDER BY projected_at DESC NULLS LAST
          LIMIT 1
        ) t
      ),
      'activityTrendToday', (
        SELECT row_to_json(t)
        FROM (
          SELECT bucket_date, invocation_count, platform_fee_earned_usdc::text,
                 provider_earned_usdc::text
          FROM synapse_admin_dashboard_activity_trend_projection
          ORDER BY bucket_date DESC
          LIMIT 1
        ) t
      ),
      'typedToday', (
        SELECT json_build_object(
          'invocationCount', count(*),
          'platformFeeUsdc', COALESCE(sum(protocol_fee_usdc), 0)::numeric(36, 6)::text,
          'providerEarnedUsdc', COALESCE(sum(provider_earned_usdc), 0)::numeric(36, 6)::text
        )
        FROM synapse_invocation_billing
        WHERE updated_at >= date_trunc('day', NOW())
      )
    )::text;
  `,
    { readOnly: true }
  );
  dbEvidence.adminProjection = sanitize(projection);
  addCheck(
    "admin_projection_readable",
    Boolean(projection?.financeProjection || projection?.activityTrendToday),
    projection || {},
    "Admin finance projection must be readable after typed billing migration."
  );
  return projection;
}

function writeEvidence() {
  writeInvocationBillingEvidence({
    apiEvidence,
    checks,
    dbEvidence,
    environment,
    evidenceDir,
    failed,
    generatedAt,
    migrationEvidence,
    reportName: "Invocation Billing Migration E2E",
    runId,
    sanitize,
    screenshotEvidence,
    trace,
    uiEvidence,
  });
}

async function main() {
  traceEvent("start", {
    environment,
    gatewayBaseUrl,
    userFrontUrl,
    adminFrontUrl,
  });
  await verifyPreflight();
  seedLocalLegacyFixtures();
  migrationEvidence.before = aggregateBillingSnapshot("before");
  runMigrationScript("first");
  migrationEvidence.afterFirstRun = aggregateBillingSnapshot("after_first_run");
  runMigrationScript("second");
  migrationEvidence.afterSecondRun =
    aggregateBillingSnapshot("after_second_run");
  verifyMigrationTotals();
  await runBusinessRegression();
  readAdminProjection();
  await runInvocationBillingUiCapture({
    addCheck,
    adminFrontUrl,
    evidenceDir,
    screenshotEvidence,
    uiEvidence,
    userFrontUrl,
  });
  writeEvidence();

  if (failed.length) {
    console.error(
      `[invocation-billing-migration] failed: ${failed
        .map((item) => item.name)
        .join(", ")}`
    );
    console.error(`[invocation-billing-migration] evidence: ${evidenceDir}`);
    process.exit(1);
  }
  console.log(
    `[invocation-billing-migration] evidence written to ${evidenceDir}`
  );
}

main().catch((error) => {
  addCheck(
    "runner_uncaught_error",
    false,
    {},
    error?.stack || error?.message || String(error)
  );
  writeEvidence();
  console.error(error);
  process.exit(1);
});
