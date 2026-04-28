#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertLocalDsn,
  assertLocalHttpUrl,
  assertLocalValue,
  assertStagingProxyDsn,
  assertStagingHttpUrl,
  projectIdFromEnv,
  readDotenvFile,
  readStagingSecret,
  resolveE2eEnvironment,
} from "../lib/e2e_env_guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const GENERATED_AT = new Date();
const ENVIRONMENT = resolveE2eEnvironment({
  value: process.env.TRANSACTION_NOTIFICATIONS_ENV,
  defaultEnv: "local",
  scriptName: "transaction-notifications",
});
process.env.SYNAPSE_E2E_ENV ||= ENVIRONMENT;
const IS_STAGING = ENVIRONMENT === "staging";
const CONFIRM = "I_UNDERSTAND_THIS_SENDS_STAGING_EMAIL_AND_LARK";
const LOCAL_REAL_CONFIRM = "I_UNDERSTAND_THIS_SENDS_REAL_LOCAL_EMAIL_AND_LARK";
const LOCAL_ENV_FILE = path.join(ROOT, "services/gateway/.env.local");
const LOCAL_PRIVATE_ENV_FILE = path.join(
  ROOT,
  "services/gateway/.env.local.private"
);
const LOCAL_E2E_ENV_FILE = path.join(ROOT, "services/gateway/.env.e2e.local");
const LOCAL_ENV = {
  ...readDotenvFile(LOCAL_ENV_FILE),
  ...readDotenvFile(LOCAL_PRIVATE_ENV_FILE),
  ...readDotenvFile(LOCAL_E2E_ENV_FILE),
};
const LOCAL_DELIVERY_MODE = (
  configValue("TRANSACTION_NOTIFICATIONS_LOCAL_DELIVERY_MODE", "fake") || "fake"
)
  .trim()
  .toLowerCase();
const IS_LOCAL_REAL = !IS_STAGING && LOCAL_DELIVERY_MODE === "real";
const RUN_ID =
  process.env.TRANSACTION_NOTIFICATIONS_RUN_ID ||
  `txn-${ENVIRONMENT}-${Date.now().toString(36)}`;
const OUT_DIR = path.resolve(
  process.env.TRANSACTION_NOTIFICATIONS_EVIDENCE_DIR ||
    (IS_STAGING
      ? path.join(
          ROOT,
          "docs/evidence/staging/transaction-notifications",
          `${formatTimestamp(GENERATED_AT)}-staging`
        )
      : path.join(
          ROOT,
          "output/dogfood/transaction-notifications",
          `${formatTimestamp(GENERATED_AT)}-${
            IS_LOCAL_REAL ? "local-real" : "local"
          }`
        ))
);

const DEFAULT_LOCAL_DSN =
  "postgresql://synapse_gateway_app:local-dev-gateway-app-password@localhost:5432/synapse_gateway";
const projectId = projectIdFromEnv();
const region = process.env.REGION || "us-central1";
const outboxJob =
  process.env.TRANSACTION_NOTIFICATIONS_OUTBOX_JOB ||
  "synapse-staging-notification-outbox-drain";
const postgresDsn = IS_STAGING
  ? process.env.STAGING_TRANSACTION_POSTGRES_DSN || ""
  : configValue("TRANSACTION_NOTIFICATIONS_POSTGRES_DSN") ||
    configValue("LOCAL_POSTGRES_DSN") ||
    configValue("POSTGRES_DSN") ||
    DEFAULT_LOCAL_DSN;
const testEmail = IS_STAGING
  ? process.env.STAGING_TRANSACTION_TEST_EMAIL || ""
  : configValue("TRANSACTION_NOTIFICATIONS_TEST_EMAIL") ||
    "transaction-e2e@synapse.test";

const steps = [];
const trace = [];
const larkPayloads = [];
fs.mkdirSync(OUT_DIR, { recursive: true });

function formatTimestamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function configValue(name, fallback = "") {
  const direct = process.env[name];
  if (direct !== undefined && direct !== "") return direct;
  const local = LOCAL_ENV[name];
  if (local !== undefined && local !== "") return local;
  return fallback;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function redact(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
    .replace(
      /https:\/\/open\.larksuite\.com\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/gi,
      "https://open.larksuite.com/open-apis/bot/v2/hook/[REDACTED]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b0x[a-fA-F0-9]{64,}\b/g, "0x[REDACTED]")
    .replace(
      /(password|secret|token|api[_-]?key|webhook)\s*[:=]\s*[^,\s"']+/gi,
      "$1=[REDACTED]"
    );
}

function addStep(name, ok, detail = "", error = "") {
  const step = {
    name,
    ok: Boolean(ok),
    detail: redact(detail),
    error: redact(error),
  };
  steps.push(step);
  trace.push({
    at: new Date().toISOString(),
    event: "step",
    name,
    ok: step.ok,
    detail: step.detail,
    error: step.error,
  });
}

function writeJson(fileName, data) {
  fs.writeFileSync(
    path.join(OUT_DIR, fileName),
    `${JSON.stringify(data, null, 2)}\n`
  );
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function runSpawn(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ status: 1, stdout, stderr: stderr || error.message });
    });
    child.on("close", (status) => {
      resolve({ status: status ?? 0, stdout, stderr });
    });
  });
}

function sqlLiteral(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function psql(sql) {
  return run("psql", [
    postgresDsn,
    "-X",
    "-q",
    "-t",
    "-A",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]);
}

function parseJsonOutput(output) {
  const lines = String(output || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep looking for the final JSON line.
    }
  }
  throw new Error(
    `No JSON payload found in command output: ${redact(output).slice(0, 500)}`
  );
}

function requireLocalDsnForStaging() {
  if (!IS_STAGING) return true;
  try {
    assertStagingProxyDsn("STAGING_TRANSACTION_POSTGRES_DSN", postgresDsn, {
      allowEmpty: false,
    });
    addStep(
      "staging_postgres_proxy",
      true,
      "Cloud SQL Auth Proxy DSN configured"
    );
    return true;
  } catch (error) {
    addStep("staging_postgres_proxy", false, "", error.message);
    return false;
  }
}

function readSecret(secretName) {
  try {
    return readStagingSecret(secretName, { projectId });
  } catch (error) {
    addStep("staging_secret_access", false, "", error.message);
    return "";
  }
}

function validateLocalProfile() {
  try {
    assertLocalDsn("TRANSACTION_NOTIFICATIONS_POSTGRES_DSN", postgresDsn, {
      allowEmpty: false,
    });
    assertLocalHttpUrl(
      "PUBLIC_GATEWAY_BASE_URL",
      configValue("PUBLIC_GATEWAY_BASE_URL", "http://127.0.0.1:8000")
    );
    assertLocalHttpUrl(
      "PUBLIC_APP_BASE_URL",
      configValue("PUBLIC_APP_BASE_URL", "http://127.0.0.1:3000")
    );
    assertLocalValue(
      "TRANSACTION_LARK_WEBHOOK_URL",
      configValue("TRANSACTION_LARK_WEBHOOK_URL"),
      {
        allowExternalWebhook: true,
      }
    );
    addStep(
      "local_env_guard",
      true,
      "local profile isolated from staging values"
    );
  } catch (error) {
    addStep("local_env_guard", false, "", error.message);
  }
}

function validateStagingProfile() {
  try {
    assertStagingHttpUrl(
      "PUBLIC_GATEWAY_BASE_URL",
      configValue(
        "PUBLIC_GATEWAY_BASE_URL",
        "https://api-staging.synapse-network.ai"
      )
    );
    assertStagingHttpUrl(
      "PUBLIC_APP_BASE_URL",
      configValue("PUBLIC_APP_BASE_URL", "https://staging.synapse-network.ai")
    );
    addStep(
      "staging_env_guard",
      true,
      "staging profile isolated from local values"
    );
  } catch (error) {
    addStep("staging_env_guard", false, "", error.message);
  }
}

async function startFakeLark() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      try {
        larkPayloads.push(JSON.parse(body || "{}"));
      } catch {
        larkPayloads.push({ raw: redact(body) });
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: 0, msg: "ok" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}/lark`,
  };
}

function cloudRunEnvCheck() {
  const required = [
    "EMAIL_OUTBOX_ENABLED",
    "EMAIL_TRANSPORT",
    "EMAIL_FROM",
    "EMAIL_REPLY_TO",
    "PUBLIC_GATEWAY_BASE_URL",
    "PUBLIC_APP_BASE_URL",
    "GMAIL_SMTP_USERNAME",
    "GMAIL_SMTP_APP_PASSWORD",
    "TRANSACTION_LARK_ENABLED",
    "TRANSACTION_LARK_WEBHOOK_URL",
    "TRANSACTION_LARK_SECRET",
    "POSTGRES_DSN",
  ];
  try {
    const output = run("gcloud", [
      "run",
      "services",
      "describe",
      "synapse-staging-gateway",
      `--project=${projectId}`,
      `--region=${region}`,
      "--format=json",
    ]);
    const service = JSON.parse(output);
    const names = new Set(
      (service.template?.containers?.[0]?.env || []).map((entry) => entry.name)
    );
    const missing = required.filter((name) => !names.has(name));
    addStep(
      "cloud_run_env",
      missing.length === 0,
      missing.length
        ? `missing=${missing.join(",")}`
        : "required env names present"
    );
    return { required, present: [...names].sort(), missing };
  } catch (error) {
    addStep("cloud_run_env", false, "", error.stderr || error.message);
    return { required, present: [], missing: required };
  }
}

async function runProbe({ larkUrl, larkSecret, drainMode }) {
  const env = {
    ...process.env,
    PYTHONPATH: path.join(ROOT, "services/gateway"),
    TRANSACTION_NOTIFICATIONS_ENV: ENVIRONMENT,
    TRANSACTION_NOTIFICATIONS_RUN_ID: RUN_ID,
    TRANSACTION_NOTIFICATIONS_POSTGRES_DSN: postgresDsn,
    TRANSACTION_NOTIFICATIONS_TEST_EMAIL: testEmail,
    TRANSACTION_NOTIFICATIONS_DRAIN_MODE: drainMode,
    ENV_FILE:
      process.env.TRANSACTION_NOTIFICATIONS_ENV_FILE ||
      "__transaction_notifications_e2e_no_env_file__",
    TRANSACTION_LARK_ENABLED: "true",
    TRANSACTION_LARK_WEBHOOK_URL: larkUrl,
    TRANSACTION_LARK_SECRET: larkSecret || "",
    TRANSACTION_LARK_TIMEOUT_SEC:
      process.env.TRANSACTION_LARK_TIMEOUT_SEC || "5",
    NO_PROXY: [
      process.env.NO_PROXY || process.env.no_proxy || "",
      "127.0.0.1",
      "localhost",
    ]
      .filter(Boolean)
      .join(","),
    no_proxy: [
      process.env.no_proxy || process.env.NO_PROXY || "",
      "127.0.0.1",
      "localhost",
    ]
      .filter(Boolean)
      .join(","),
    EMAIL_OUTBOX_ENABLED: "true",
    EMAIL_TRANSPORT: configValue("EMAIL_TRANSPORT", "gmail_smtp"),
    EMAIL_FROM: configValue(
      "EMAIL_FROM",
      "Synapse Network Local <local@synapse.test>"
    ),
    EMAIL_REPLY_TO: configValue("EMAIL_REPLY_TO", "support@synapse-network.ai"),
    GMAIL_SMTP_USERNAME: configValue("GMAIL_SMTP_USERNAME"),
    GMAIL_SMTP_APP_PASSWORD: configValue("GMAIL_SMTP_APP_PASSWORD"),
    GMAIL_SMTP_HOST: configValue("GMAIL_SMTP_HOST", "smtp.gmail.com"),
    GMAIL_SMTP_PORT: configValue("GMAIL_SMTP_PORT", "587"),
    PUBLIC_GATEWAY_BASE_URL: configValue(
      "PUBLIC_GATEWAY_BASE_URL",
      IS_STAGING
        ? "https://api-staging.synapse-network.ai"
        : "http://127.0.0.1:8000"
    ),
    PUBLIC_APP_BASE_URL: configValue(
      "PUBLIC_APP_BASE_URL",
      IS_STAGING
        ? "https://staging.synapse-network.ai"
        : "http://127.0.0.1:3000"
    ),
  };
  const result = await runSpawn(
    process.env.PYTHON || path.join(ROOT, "services/gateway/.venv/bin/python"),
    [path.join(ROOT, "scripts/e2e/transaction_notifications_probe.py")],
    { env }
  );
  if (result.status !== 0) {
    throw new Error(
      redact(result.stderr || result.stdout || `probe exited ${result.status}`)
    );
  }
  return parseJsonOutput(result.stdout);
}

function queryDbEvidence(probe) {
  const run = sqlLiteral(RUN_ID);
  const owner = sqlLiteral(probe.ownerWallet || "");
  const inAppRows = JSON.parse(
    psql(`
    SELECT COALESCE(json_agg(json_build_object(
      'eventType', event_type,
      'resourceType', resource_type,
      'resourceId', resource_id,
      'severity', severity,
      'priority', priority
    ) ORDER BY created_at)::text, '[]')
    FROM synapse_in_app_notifications
    WHERE recipient_owner_id = ${owner}
      AND payload->>'runId' = ${run};
  `).trim() || "[]"
  );
  const deliveries = JSON.parse(
    psql(`
    SELECT COALESCE(json_agg(json_build_object(
      'eventType', event_type,
      'templateKey', template_key,
      'priority', priority,
      'messageIdPresent', message_id IS NOT NULL,
      'sentAt', to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) ORDER BY sent_at)::text, '[]')
    FROM synapse_notification_delivery_log
    WHERE dedupe_key LIKE ${sqlLiteral(`%${RUN_ID}%`)};
  `).trim() || "[]"
  );
  const outboxRows = JSON.parse(
    psql(`
    SELECT COALESCE(json_agg(json_build_object(
      'eventType', event_type,
      'templateKey', template_key,
      'status', status,
      'attemptCount', attempt_count,
      'lastErrorPresent', COALESCE(last_error, '') <> ''
    ) ORDER BY created_at)::text, '[]')
    FROM synapse_notification_outbox
    WHERE dedupe_key LIKE ${sqlLiteral(`%${RUN_ID}%`)};
  `).trim() || "[]"
  );
  const deadLetters = outboxRows.filter(
    (row) => row.status === "dead_letter"
  ).length;
  return {
    inAppRows,
    deliveries,
    outboxRows,
    deadLetters,
  };
}

function runStagingOutboxJob() {
  try {
    const args = [
      "run",
      "jobs",
      "execute",
      outboxJob,
      `--region=${region}`,
      "--wait",
    ];
    if (projectId) args.push(`--project=${projectId}`);
    const output = run("gcloud", args);
    addStep("run_outbox_job", true, output.slice(0, 900));
  } catch (error) {
    addStep("run_outbox_job", false, "", error.stderr || error.message);
  }
}

function writeTraceAndReport(report) {
  const tracePath = path.join(OUT_DIR, "trace.jsonl");
  fs.writeFileSync(
    tracePath,
    trace.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
  );
  const traceDigest = sha256(fs.readFileSync(tracePath));
  report.traceDigest = traceDigest;
  writeJson("report.json", report);
  fs.writeFileSync(
    path.join(OUT_DIR, "report.md"),
    [
      "# Transaction Notifications E2E Evidence",
      "",
      `- Status: \`${report.status}\``,
      `- Environment: \`${report.environment}\``,
      `- Run ID: \`${report.runId}\``,
      `- Generated at: \`${report.generatedAt}\``,
      `- Test email hash: \`${report.testEmailHash}\``,
      `- Trace digest: \`${traceDigest}\``,
      "",
      "## Steps",
      "",
      "| Step | Result | Detail |",
      "| --- | --- | --- |",
      ...report.steps.map(
        (step) =>
          `| ${step.name} | ${step.ok ? "PASS" : "FAIL"} | ${String(
            step.detail || step.error || ""
          ).replace(/\|/g, "\\|")} |`
      ),
    ].join("\n") + "\n"
  );
  if (Array.isArray(report.failed) && report.failed.length > 0) {
    const entries = report.failed.map((step, index) =>
      [
        `## TXN-NOTIFICATION-${String(index + 1).padStart(3, "0")}`,
        "",
        "- Status: Open",
        "- Severity: P1",
        `- Scenario: ${step.name}`,
        `- Evidence: ${step.detail || "see trace.jsonl"}`,
        `- Repro Steps: run \`npm run ${
          IS_LOCAL_REAL
            ? "e2e:transaction-notifications:local-real"
            : IS_STAGING
            ? "e2e:transaction-notifications:staging"
            : "e2e:transaction-notifications:local"
        }\``,
        "- Expected: transaction notification E2E step passes",
        `- Actual: ${step.error || step.detail || "step failed"}`,
        "",
      ].join("\n")
    );
    fs.writeFileSync(
      path.join(OUT_DIR, "bugfix-log.md"),
      `# Bugfix Log\n\n${entries.join("\n")}`
    );
  } else {
    fs.writeFileSync(
      path.join(OUT_DIR, "bugfix-log.md"),
      "# Bugfix Log\n\nNo open bugs.\n"
    );
  }
}

function validateEvidence({ probe, dbEvidence, larkEvidence }) {
  const expectedTemplates = new Set(probe.expectedTemplates || []);
  const deliveryTemplates = new Set(
    (dbEvidence.deliveries || []).map((row) => row.templateKey)
  );
  const inAppEvents = new Set(
    (dbEvidence.inAppRows || []).map((row) => row.eventType)
  );
  const larkTemplates = new Set(
    (larkEvidence.cards || probe.larkResults || [])
      .map((row) => row.templateKey)
      .filter(Boolean)
  );
  const missingDelivery = [...expectedTemplates].filter(
    (key) => !deliveryTemplates.has(key)
  );
  const missingLark = [...expectedTemplates].filter(
    (key) => !larkTemplates.has(key)
  );
  const missingInApp = (probe.expectedEvents || []).filter(
    (event) => !inAppEvents.has(event)
  );

  addStep(
    "in_app_rows",
    missingInApp.length === 0,
    missingInApp.length
      ? `missing=${missingInApp.join(",")}`
      : `${inAppEvents.size} events`
  );
  addStep(
    "delivery_log",
    missingDelivery.length === 0,
    missingDelivery.length
      ? `missing=${missingDelivery.join(",")}`
      : `${deliveryTemplates.size} templates sent`
  );
  addStep(
    "lark_delivery",
    missingLark.length === 0,
    missingLark.length
      ? `missing=${missingLark.join(",")}`
      : `${larkTemplates.size} cards`
  );
  addStep(
    "no_dead_letters",
    dbEvidence.deadLetters === 0,
    `deadLetters=${dbEvidence.deadLetters}`
  );
  const sample = probe.receiptSample || {};
  const receiptOk = Boolean(
    sample.htmlContainsReceipt &&
      sample.htmlContainsAmount &&
      sample.htmlContainsStatus &&
      sample.htmlContainsReference &&
      sample.htmlContainsCta
  );
  addStep("receipt_template", receiptOk, JSON.stringify(sample));
  const actionUrl = String(sample.actionUrl || "");
  const appActionUrlOk =
    Boolean(actionUrl) &&
    !/127\.0\.0\.1:8000|api-staging\.synapse-network\.ai/i.test(actionUrl);
  addStep(
    "app_action_url",
    appActionUrlOk,
    appActionUrlOk ? actionUrl : `invalid=${actionUrl}`
  );
}

async function main() {
  let fakeLark;
  let probe = null;
  let dbEvidence = null;
  let larkEvidence = null;
  let cloudRunEnv = null;

  try {
    if (IS_STAGING) {
      if (process.env.TRANSACTION_NOTIFICATIONS_STAGING_CONFIRM !== CONFIRM) {
        addStep(
          "confirmation",
          false,
          "",
          `TRANSACTION_NOTIFICATIONS_STAGING_CONFIRM must equal ${CONFIRM}`
        );
      } else {
        addStep(
          "confirmation",
          true,
          "operator confirmed real staging Gmail and Lark send"
        );
      }
      if (!projectId)
        addStep("project_id", false, "", "PROJECT_ID is required for staging");
      else addStep("project_id", true, projectId);
      if (!testEmail)
        addStep(
          "test_email",
          false,
          "",
          "STAGING_TRANSACTION_TEST_EMAIL is required"
        );
      else addStep("test_email", true, `sha256=${sha256(testEmail)}`);
      if (!postgresDsn)
        addStep(
          "postgres_dsn",
          false,
          "",
          "STAGING_TRANSACTION_POSTGRES_DSN is required"
        );
      else addStep("postgres_dsn", true, "configured");
      requireLocalDsnForStaging();
      validateStagingProfile();
      cloudRunEnv = cloudRunEnvCheck();
    } else {
      addStep(
        "local_mode",
        true,
        IS_LOCAL_REAL
          ? "using real local Gmail SMTP and real Lark webhook"
          : "using fake Lark and fake email sender"
      );
      if (!postgresDsn)
        addStep("postgres_dsn", false, "", "POSTGRES_DSN is required");
      else addStep("postgres_dsn", true, "configured");
      validateLocalProfile();
      if (!testEmail)
        addStep(
          "test_email",
          false,
          "",
          "TRANSACTION_NOTIFICATIONS_TEST_EMAIL is required"
        );
      else addStep("test_email", true, `sha256=${sha256(testEmail)}`);
      if (IS_LOCAL_REAL) {
        if (
          process.env.TRANSACTION_NOTIFICATIONS_LOCAL_REAL_CONFIRM !==
          LOCAL_REAL_CONFIRM
        ) {
          addStep(
            "local_real_confirmation",
            false,
            "",
            `TRANSACTION_NOTIFICATIONS_LOCAL_REAL_CONFIRM must equal ${LOCAL_REAL_CONFIRM}`
          );
        } else {
          addStep(
            "local_real_confirmation",
            true,
            "operator confirmed real local Gmail and Lark send"
          );
        }
        if (/@synapse\.test$/i.test(testEmail)) {
          addStep(
            "real_test_email",
            false,
            "",
            "TRANSACTION_NOTIFICATIONS_TEST_EMAIL must be a real recipient for local-real mode"
          );
        } else {
          addStep("real_test_email", true, `sha256=${sha256(testEmail)}`);
        }
        const missingEmailConfig = [
          "GMAIL_SMTP_USERNAME",
          "GMAIL_SMTP_APP_PASSWORD",
          "EMAIL_FROM",
        ].filter((name) => !configValue(name));
        addStep(
          "real_email_config",
          missingEmailConfig.length === 0,
          missingEmailConfig.length
            ? `missing=${missingEmailConfig.join(",")}`
            : "Gmail SMTP configured",
          missingEmailConfig.length
            ? "real local email requires Gmail SMTP username, app password, and from address"
            : ""
        );
        const hasRealLarkWebhook = Boolean(
          configValue("TRANSACTION_LARK_WEBHOOK_URL") ||
            configValue("TRANSACTION_NOTIFICATIONS_LARK_URL")
        );
        addStep(
          "real_lark_webhook",
          hasRealLarkWebhook,
          hasRealLarkWebhook ? "configured" : "missing",
          hasRealLarkWebhook
            ? ""
            : "real local Lark requires TRANSACTION_LARK_WEBHOOK_URL"
        );
      }
    }

    if (!steps.some((step) => !step.ok)) {
      let larkUrl =
        configValue("TRANSACTION_LARK_WEBHOOK_URL") ||
        configValue("TRANSACTION_NOTIFICATIONS_LARK_URL") ||
        "";
      let larkSecret = configValue("TRANSACTION_LARK_SECRET") || "";
      let drainMode = "skip";
      if (IS_STAGING) {
        if (!larkUrl) {
          larkUrl = readSecret("synapse-staging-lark-webhook-staging-drill");
        }
        if (!larkSecret) {
          larkSecret = readSecret("synapse-staging-lark-secret-staging-drill");
        }
        if (!larkUrl) {
          addStep(
            "lark_webhook",
            false,
            "",
            "TRANSACTION_LARK_WEBHOOK_URL or synapse-staging-lark-webhook-staging-drill is required"
          );
        } else {
          addStep("lark_webhook", true, "configured");
        }
      } else if (IS_LOCAL_REAL) {
        drainMode = "real";
      } else {
        fakeLark = await startFakeLark();
        larkUrl = fakeLark.url;
        drainMode = "fake";
        addStep("fake_lark", true, "fake Lark sink started");
      }

      if (!steps.some((step) => !step.ok)) {
        probe = await runProbe({ larkUrl, larkSecret, drainMode });
        addStep(
          "python_probe",
          probe.status === "success",
          `templates=${(probe.expectedTemplates || []).join(",")}`
        );
      }
      if (IS_STAGING && !steps.some((step) => !step.ok)) {
        runStagingOutboxJob();
      }
    }

    if (!steps.some((step) => !step.ok) && probe) {
      dbEvidence = queryDbEvidence(probe);
      if (IS_STAGING || IS_LOCAL_REAL) {
        larkEvidence = {
          mode: IS_STAGING ? "real_lark_webhook" : "real_local_lark_webhook",
          cards: (probe.larkResults || []).filter((row) => row.ok),
          marker: "STAGING_TRANSACTION_EVENT",
          action: "NO_ACTION_REQUIRED",
        };
      } else {
        const payloadText = JSON.stringify(larkPayloads);
        const cards = larkPayloads.map((payload) => {
          const content = payload?.card?.elements?.[0]?.text?.content || "";
          const templateMatch = content.match(/\*\*Template\*\*: ([^\n]+)/);
          return {
            markerPresent: content.includes("STAGING_TRANSACTION_EVENT"),
            noActionRequired: content.includes("NO_ACTION_REQUIRED"),
            templateKey: templateMatch?.[1]?.trim() || "",
          };
        });
        larkEvidence = {
          mode: "fake_lark",
          payloadCount: larkPayloads.length,
          cards,
          noSecretLikeText:
            !/(private[_-]?key|signature|jwt|Bearer|open-apis\/bot\/v2\/hook)/i.test(
              payloadText
            ),
        };
        addStep(
          "lark_payload_redaction",
          larkEvidence.noSecretLikeText,
          `payloadCount=${larkPayloads.length}`
        );
      }
      validateEvidence({ probe, dbEvidence, larkEvidence });
    }
  } catch (error) {
    addStep("runner", false, "", error.stack || error.message);
  } finally {
    if (fakeLark?.server) {
      await new Promise((resolve) => fakeLark.server.close(resolve));
    }
  }

  writeJson("db-evidence.json", dbEvidence || {});
  writeJson("email-evidence.json", {
    fakeEmailSent: probe?.fakeEmailSent || [],
    drainStats: probe?.drainStats || null,
  });
  writeJson("lark-evidence.json", larkEvidence || {});
  if (!IS_STAGING && !IS_LOCAL_REAL)
    writeJson(
      "fake-lark-payload-summary.json",
      larkPayloads.map((payload) =>
        redact(JSON.stringify(payload)).slice(0, 1200)
      )
    );
  if (cloudRunEnv) writeJson("cloud-run-env-evidence.json", cloudRunEnv);

  const failed = steps.filter((step) => !step.ok);
  const report = {
    status: failed.length === 0 ? "success" : "failed",
    scriptVersion: "transaction-notifications-e2e:v1",
    environment: ENVIRONMENT,
    deliveryMode: IS_STAGING
      ? "staging-real"
      : IS_LOCAL_REAL
      ? "local-real"
      : "local-fake",
    runId: RUN_ID,
    generatedAt: GENERATED_AT.toISOString(),
    finishedAt: new Date().toISOString(),
    testEmailHash: sha256(testEmail || "missing"),
    expectedTemplates: probe?.expectedTemplates || [],
    expectedEvents: probe?.expectedEvents || [],
    outputFiles: [
      "report.json",
      "report.md",
      "trace.jsonl",
      "bugfix-log.md",
      "db-evidence.json",
      "email-evidence.json",
      "lark-evidence.json",
    ],
    steps,
    failed,
  };
  writeTraceAndReport(report);
  console.log(`[transaction-notifications-e2e] evidence=${OUT_DIR}`);
  console.log(
    `[transaction-notifications-e2e] status=${report.status} failed=${failed.length}`
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  addStep("runner", false, "", error.stack || error.message);
  const report = {
    status: "failed",
    scriptVersion: "transaction-notifications-e2e:v1",
    environment: ENVIRONMENT,
    runId: RUN_ID,
    generatedAt: GENERATED_AT.toISOString(),
    finishedAt: new Date().toISOString(),
    testEmailHash: sha256(testEmail || "missing"),
    expectedTemplates: [],
    expectedEvents: [],
    outputFiles: [],
    steps,
    failed: steps.filter((step) => !step.ok),
  };
  writeTraceAndReport(report);
  console.error(
    `[transaction-notifications-e2e] failed: ${redact(
      error.stack || error.message
    )}`
  );
  process.exitCode = 1;
});
