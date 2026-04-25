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
  "Synapse Staging Gateway 5xx Rate High",
  "Synapse Staging Withdrawal Timeout",
  "Synapse Staging Reconciliation Drift",
];

async function postSyntheticGcpAlert({ receiverUrl, token }) {
  const payload = {
    incident: {
      incident_id: `gcp-alerts-e2e-${Date.now().toString(36)}`,
      state: "open",
      policy_name: "Synapse Staging GCP Alert Receiver E2E",
      condition_name: "Synthetic staging drill",
      summary: "[LARK_E2E_TEST][NO_ACTION_REQUIRED] Synthetic GCP Monitoring webhook probe.",
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
          business_scenario: "GCP Monitoring webhook can reach gateway-admin and Lark.",
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
    const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/api/v1/ops/drills/http-500`, {
      headers: { "x-synapse-drill-token": drillToken },
    });
    attempts.push({ httpStatus: response.status, expected: 500, ok: response.status === 500 });
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
      detail: redact(result.stderr || result.stdout || "gcloud policies list failed"),
      found: [],
    };
  }
  const found = new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = REQUIRED_POLICIES.filter((name) => !found.has(name));
  return {
    status: missing.length === 0 ? "passed" : "failed",
    detail: missing.length ? `missing policies: ${missing.join(", ")}` : "all policies found",
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
    detail: found ? "webhook channel found" : redact(result.stderr || "webhook channel missing"),
  };
}

async function waitForMonitoringCallback({ projectId, waitSeconds }) {
  const deadline = Date.now() + waitSeconds * 1000;
  const filter = [
    'resource.type="cloud_run_revision"',
    'resource.labels.service_name="synapse-staging-gateway-admin"',
    'textPayload:"alert_trigger=GCP_ALERT_RECEIVED"',
    'textPayload:"SynapseStagingGateway5xxRateHigh"',
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
      return { status: "passed", detail: "gateway-admin GCP callback log observed" };
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
  const outDir = process.env.GCP_ALERTS_STAGING_EVIDENCE_DIR
    || path.join(EVIDENCE_ROOT, `${timestamp()}-gcp-alerts-staging`);
  const checks = [];
  const trace = [];

  const receiver = await postSyntheticGcpAlert({ receiverUrl, token: receiverToken });
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

  if (process.env.GATEWAY_STAGING_URL && process.env.STAGING_ALERT_DRILL_TOKEN) {
    const drillAttempts = await triggerGateway500Drill({
      gatewayUrl: process.env.GATEWAY_STAGING_URL,
      drillToken: process.env.STAGING_ALERT_DRILL_TOKEN,
    });
    const passed = drillAttempts.every((attempt) => attempt.ok);
    checks.push({
      name: "gateway-controlled-500-drill",
      status: passed ? "passed" : "failed",
      attempts: drillAttempts.length,
      detail: passed ? "all drill requests returned controlled 500" : "one or more drill requests failed",
    });
    trace.push(...drillAttempts.map((attempt) => ({
      scenario: "gateway-controlled-500-drill",
      timestamp: new Date().toISOString(),
      method: "GET",
      path: `${process.env.GATEWAY_STAGING_URL}/api/v1/ops/drills/http-500`,
      httpStatus: attempt.httpStatus,
      expected: 500,
      actual: attempt.httpStatus,
    })));
  }

  if (process.env.GCP_ALERTS_REQUIRE_MONITORING_DELIVERY === "true") {
    checks.push({ name: "gcp-webhook-channel-configured", ...checkMonitoringChannel(projectId) });
    checks.push({ name: "gcp-alert-policies-configured", ...checkMonitoringPolicies(projectId) });
    const waitSeconds = Number.parseInt(process.env.GCP_ALERTS_MONITORING_WAIT_SECONDS || "600", 10);
    const callback = await waitForMonitoringCallback({ projectId, waitSeconds });
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
      "Gateway 500 drill is executed only when GATEWAY_STAGING_URL and STAGING_ALERT_DRILL_TOKEN are set.",
      "GCP policy callback wait is enabled only when GCP_ALERTS_REQUIRE_MONITORING_DELIVERY=true.",
    ],
  });
  console.log(`[gcp-alerts-staging-e2e] evidence=${outDir}`);
  console.log(`[gcp-alerts-staging-e2e] status=${report.status}`);
  if (report.status !== "passed") process.exit(1);
}

main().catch((error) => {
  console.error(`[gcp-alerts-staging-e2e] failed: ${error.stack || error.message}`);
  process.exit(1);
});
