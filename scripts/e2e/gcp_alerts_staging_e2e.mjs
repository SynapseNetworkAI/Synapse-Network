#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  ROOT,
  timestamp,
  requireEnv,
  redact,
  redactedJson,
  writeEvidence,
} from "./gcp_alerts_evidence_utils.mjs";

const EVIDENCE_ROOT = path.join(ROOT, "docs/evidence/staging/gcp-alerts");
const CONFIRM = "I_UNDERSTAND_THIS_SENDS_STAGING_ALERTS";
const REQUIRED_POLICIES = [
  "Synapse Staging Admin API Health Uptime Down",
  "Synapse Staging Chain RPC Unavailable",
  "Synapse Staging Cloud Run Job Failed",
  "Synapse Staging Deposit Indexer Freshness",
  "Synapse Staging Consumer Withdraw Chain Recovery Freshness",
  "Synapse Staging Withdrawal Expiry Sweeper Freshness",
  "Synapse Staging Gateway 5xx Count High",
  "Synapse Staging Gateway 5xx Rate High",
  "Synapse Staging Gateway Health Uptime Down",
  "Synapse Staging Gateway Readiness Uptime Down",
  "Synapse Staging Gateway-admin 5xx Rate High",
  "Synapse Staging Notification Outbox Drain Freshness",
  "Synapse Staging Provider Upstream Unavailable",
  "Synapse Staging Reconciliation Drift",
  "Synapse Staging User Front Uptime Down",
  "Synapse Staging Withdrawal Timeout",
];
const REQUIRED_UPTIME_CHECKS = [
  "Synapse Staging Admin API Health Uptime",
  "Synapse Staging Gateway Health Uptime",
  "Synapse Staging Gateway Readiness Uptime",
  "Synapse Staging User Front Uptime",
];
const REQUIRED_SCHEDULED_JOBS = [
  "synapse-staging-deposit-indexer-schedule",
  "synapse-staging-consumer-withdraw-chain-recovery-schedule",
  "synapse-staging-withdrawal-expiry-sweeper-schedule",
  "synapse-staging-in-app-notification-cleanup-schedule",
  "synapse-staging-notification-outbox-drain-schedule",
];

async function postSyntheticGcpAlert({ receiverUrl, token }) {
  const payload = {
    incident: {
      incident_id: `gcp-alerts-e2e-${Date.now().toString(36)}`,
      state: "open",
      policy_name: "Synapse Staging GCP Alert Receiver E2E",
      condition_name: "Synthetic staging drill",
      summary:
        "[LARK_E2E_TEST][NO_ACTION_REQUIRED] Synthetic GCP Monitoring webhook probe.",
      url: "https://console.cloud.google.com/monitoring/alerting/incidents",
      resource: {
        type: "cloud_run_revision",
        labels: { service_name: "synapse-staging-gateway-admin" },
      },
      metadata: {
        user_labels: {
          alertname: "SynapseStagingGcpAlertReceiverE2E",
          severity: "p2",
          system: "ops",
          env: "staging",
          route: "staging-drill",
          business_scenario:
            "GCP Monitoring webhook can reach gateway-admin and Lark.",
          impact: "NO_ACTION_REQUIRED staging drill.",
          trigger: "Synthetic e2e payload posted directly to receiver.",
          action: "Confirm the staging drill Lark group received the card.",
        },
      },
    },
  };
  const response = await fetch(receiverUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-synapse-gcp-alert-token": token,
    },
    body: JSON.stringify(payload),
  });
  return {
    ok: response.ok,
    httpStatus: response.status,
    body: redact(await response.text()),
  };
}

async function triggerGateway500Drill({ gatewayUrl, drillToken }) {
  const attempts = [];
  for (let index = 0; index < 20; index += 1) {
    const response = await fetch(
      `${gatewayUrl.replace(/\/$/, "")}/api/v1/ops/drills/http-500`,
      {
        headers: { "x-synapse-drill-token": drillToken },
      }
    );
    attempts.push({
      httpStatus: response.status,
      expected: 500,
      ok: response.status === 500,
    });
  }
  return attempts;
}

function gcloud(args) {
  return spawnSync("gcloud", args, { encoding: "utf8" });
}

function checkMonitoringPolicies(projectId) {
  const result = gcloud([
    "alpha",
    "monitoring",
    "policies",
    "list",
    "--project",
    projectId,
    "--filter",
    'displayName:"Synapse Staging"',
    "--format",
    "value(displayName)",
  ]);
  if (result.status !== 0) {
    return {
      status: "failed",
      detail: redact(
        result.stderr || result.stdout || "gcloud policies list failed"
      ),
      found: [],
    };
  }
  const found = new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const missing = REQUIRED_POLICIES.filter((name) => !found.has(name));
  return {
    status: missing.length === 0 ? "passed" : "failed",
    detail: missing.length
      ? `missing policies: ${missing.join(", ")}`
      : "all policies found",
    found: [...found],
  };
}

function checkUptimeChecks(projectId) {
  const result = gcloud([
    "monitoring",
    "uptime",
    "list-configs",
    "--project",
    projectId,
    "--filter",
    'displayName:"Synapse Staging"',
    "--format",
    "value(displayName)",
  ]);
  if (result.status !== 0) {
    return {
      status: "failed",
      detail: redact(
        result.stderr || result.stdout || "gcloud uptime list-configs failed"
      ),
      found: [],
    };
  }
  const found = new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const missing = REQUIRED_UPTIME_CHECKS.filter((name) => !found.has(name));
  return {
    status: missing.length === 0 ? "passed" : "failed",
    detail: missing.length
      ? `missing uptime checks: ${missing.join(", ")}`
      : "all uptime checks found",
    found: [...found],
  };
}

function checkMonitoringChannel(projectId) {
  const result = gcloud([
    "alpha",
    "monitoring",
    "channels",
    "list",
    "--project",
    projectId,
    "--filter",
    'displayName="Synapse Staging Lark Gateway-admin Receiver"',
    "--format",
    "value(name)",
  ]);
  const found = result.status === 0 && result.stdout.trim().length > 0;
  return {
    status: found ? "passed" : "failed",
    detail: found
      ? "webhook channel found"
      : redact(result.stderr || "webhook channel missing"),
  };
}

function checkScheduledJobs(projectId) {
  const result = gcloud([
    "scheduler",
    "jobs",
    "list",
    "--project",
    projectId,
    "--location",
    process.env.REGION || "us-central1",
    "--filter",
    "name:synapse-staging-",
    "--format",
    "json",
  ]);
  if (result.status !== 0) {
    return {
      status: "failed",
      detail: redact(
        result.stderr || result.stdout || "gcloud scheduler jobs list failed"
      ),
      found: [],
    };
  }
  let rows = [];
  try {
    rows = JSON.parse(result.stdout || "[]");
  } catch (error) {
    return {
      status: "failed",
      detail: redact(`failed to parse scheduler jobs JSON: ${error.message}`),
      found: [],
    };
  }
  const scheduledJobs = rows.map((row) => ({
    id: String(row.name || "")
      .split("/")
      .at(-1),
    schedule: row.schedule || "",
    state: row.state || "",
    target: String(row.httpTarget?.uri || "").replace(
      /jobs\/([^/:]+):run$/,
      "jobs/$1:run"
    ),
  }));
  const found = new Set(scheduledJobs.map((job) => job.id).filter(Boolean));
  const missing = REQUIRED_SCHEDULED_JOBS.filter((name) => !found.has(name));
  const disabled = scheduledJobs
    .filter(
      (job) =>
        REQUIRED_SCHEDULED_JOBS.includes(job.id) && job.state !== "ENABLED"
    )
    .map((job) => job.id);
  const failed = [...missing, ...disabled];
  return {
    status: failed.length === 0 ? "passed" : "failed",
    detail: failed.length
      ? `missing or disabled scheduled jobs: ${failed.join(", ")}`
      : "all scheduled Cloud Run job triggers found and enabled",
    scheduledJobs,
  };
}

async function waitForMonitoringCallback({ projectId, waitSeconds }) {
  const deadline = Date.now() + waitSeconds * 1000;
  const filter = [
    'resource.type="cloud_run_revision"',
    'resource.labels.service_name="synapse-staging-gateway-admin"',
    'textPayload:"alert_trigger=GCP_ALERT_RECEIVED"',
    '(textPayload:"synapse_staging_gateway_5xx_rate_high" OR textPayload:"synapse_staging_gateway_5xx_count_high")',
  ].join(" AND ");
  while (Date.now() < deadline) {
    const result = gcloud([
      "logging",
      "read",
      filter,
      "--project",
      projectId,
      "--freshness",
      `${Math.max(60, waitSeconds + 120)}s`,
      "--limit",
      "1",
      "--format",
      "value(textPayload)",
    ]);
    if (result.status === 0 && result.stdout.includes("GCP_ALERT_RECEIVED")) {
      const detail = result.stdout.includes(
        "synapse_staging_gateway_5xx_count_high"
      )
        ? "gateway-admin GCP callback log observed for 5xx count policy"
        : "gateway-admin GCP callback log observed for 5xx rate policy";
      return { status: "passed", detail };
    }
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  return {
    status: "failed",
    detail: `GCP callback log not observed within ${waitSeconds}s`,
  };
}

async function main() {
  if (process.env.GCP_ALERTS_STAGING_E2E_CONFIRM !== CONFIRM) {
    throw new Error(`Set GCP_ALERTS_STAGING_E2E_CONFIRM=${CONFIRM}`);
  }
  const receiverUrl = requireEnv("GCP_ALERT_RECEIVER_URL");
  const receiverToken = requireEnv("GCP_ALERT_RECEIVER_TOKEN");
  const projectId = process.env.PROJECT_ID || "fabled-archive-494108-k5";
  const outDir =
    process.env.GCP_ALERTS_STAGING_EVIDENCE_DIR ||
    path.join(EVIDENCE_ROOT, `${timestamp()}-gcp-alerts-staging`);
  const checks = [];
  const trace = [];

  checks.push({
    name: "gcp-webhook-channel-configured",
    ...checkMonitoringChannel(projectId),
  });
  checks.push({
    name: "gcp-alert-policies-configured",
    ...checkMonitoringPolicies(projectId),
  });
  checks.push({
    name: "gcp-uptime-checks-configured",
    ...checkUptimeChecks(projectId),
  });
  checks.push({
    name: "gcp-scheduled-jobs-configured",
    ...checkScheduledJobs(projectId),
  });

  const receiver = await postSyntheticGcpAlert({
    receiverUrl,
    token: receiverToken,
  });
  checks.push({
    name: "gcp-alert-receiver-synthetic-lark",
    status: receiver.ok ? "passed" : "failed",
    httpStatus: receiver.httpStatus,
    detail: receiver.ok ? "receiver accepted synthetic alert" : receiver.body,
  });
  trace.push({
    scenario: "gcp-alert-receiver-synthetic-lark",
    timestamp: new Date().toISOString(),
    method: "POST",
    path: receiverUrl,
    httpStatus: receiver.httpStatus,
    sanitizedResponse: receiver.body,
  });

  if (
    process.env.GATEWAY_STAGING_URL &&
    process.env.STAGING_ALERT_DRILL_TOKEN
  ) {
    const drillAttempts = await triggerGateway500Drill({
      gatewayUrl: process.env.GATEWAY_STAGING_URL,
      drillToken: process.env.STAGING_ALERT_DRILL_TOKEN,
    });
    const passed = drillAttempts.every((attempt) => attempt.ok);
    checks.push({
      name: "gateway-controlled-500-drill",
      status: passed ? "passed" : "failed",
      attempts: drillAttempts.length,
      detail: passed
        ? "all drill requests returned controlled 500"
        : "one or more drill requests failed",
    });
    trace.push(
      ...drillAttempts.map((attempt) => ({
        scenario: "gateway-controlled-500-drill",
        timestamp: new Date().toISOString(),
        method: "GET",
        path: `${process.env.GATEWAY_STAGING_URL}/api/v1/ops/drills/http-500`,
        httpStatus: attempt.httpStatus,
        expected: 500,
        actual: attempt.httpStatus,
      }))
    );
  }

  if (process.env.GCP_ALERTS_REQUIRE_MONITORING_DELIVERY === "true") {
    const waitSeconds = Number.parseInt(
      process.env.GCP_ALERTS_MONITORING_WAIT_SECONDS || "600",
      10
    );
    const callback = await waitForMonitoringCallback({
      projectId,
      waitSeconds,
    });
    checks.push({ name: "gcp-monitoring-callback-observed", ...callback });
    trace.push({
      scenario: "gcp-monitoring-callback-observed",
      timestamp: new Date().toISOString(),
      expected: "GCP Monitoring policy calls gateway-admin receiver",
      actual: callback.detail,
    });
  }

  const report = writeEvidence({
    outDir,
    title: "GCP Alerts Staging E2E",
    environment: "staging",
    checks: checks.map(redactedJson),
    trace,
    notes: [
      "This sends a real staging Lark alert card.",
      "This verifies GCP webhook channel, alert policies, and uptime checks exist.",
      "This verifies scheduled Cloud Run job triggers exist and are enabled.",
      "Gateway 500 drill is executed only when GATEWAY_STAGING_URL and STAGING_ALERT_DRILL_TOKEN are set.",
      "GCP policy callback wait is enabled only when GCP_ALERTS_REQUIRE_MONITORING_DELIVERY=true.",
    ],
  });
  console.log(`[gcp-alerts-staging-e2e] evidence=${outDir}`);
  console.log(`[gcp-alerts-staging-e2e] status=${report.status}`);
  if (report.status !== "passed") process.exit(1);
}

main().catch((error) => {
  console.error(
    `[gcp-alerts-staging-e2e] failed: ${error.stack || error.message}`
  );
  process.exit(1);
});
