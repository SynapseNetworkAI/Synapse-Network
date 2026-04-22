#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const alertsDir = path.join(root, "infra/monitoring/prometheus/alerts");
const dashboardsDir = path.join(root, "infra/monitoring/grafana/dashboards");
const alertmanagerPath = path.join(root, "infra/monitoring/alertmanager/alertmanager.yml");
const larkEnvPath = path.join(root, "infra/monitoring/alertmanager/lark.env.example");
const larkRelayPath = path.join(root, "scripts/ops/lark_alert_relay.mjs");

function fail(message, fix) {
  console.error(`FATAL MONITORING-001: ${message}`);
  if (fix) console.error(`Agent fix: ${fix}`);
  process.exit(1);
}

function requireFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing required monitoring file ${filePath}`, "Create the missing alert/dashboard artifact and rerun npm run ci:monitoring-alert-rules.");
  }
}

requireFile(path.join(alertsDir, "synapse-core-alerts.yml"));
requireFile(path.join(dashboardsDir, "synapse-production-overview.json"));
requireFile(alertmanagerPath);
requireFile(larkEnvPath);
requireFile(larkRelayPath);

const alertFiles = fs.readdirSync(alertsDir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
if (alertFiles.length === 0) {
  fail("no Prometheus alert rule files found", "Add at least one alerts YAML file under infra/monitoring/prometheus/alerts.");
}

for (const fileName of alertFiles) {
  const filePath = path.join(alertsDir, fileName);
  const text = fs.readFileSync(filePath, "utf8");
  for (const token of ["groups:", "alert:", "expr:", "labels:", "annotations:"]) {
    if (!text.includes(token)) {
      fail(`${fileName} does not look like a Prometheus rules file; missing ${token}`, "Use Prometheus rule YAML with groups/rules/alert/expr/labels/annotations.");
    }
  }
  if (text.includes("SynapseDrill") && !text.includes('is_drill: "true"')) {
    fail(`${fileName} contains drill alerts without is_drill=true`, "Add is_drill=\"true\", env=\"staging\", and severity=\"drill\" labels so drills never page production on-call.");
  }
  if (/pagerduty/i.test(text) && /is_drill:\s*"?true"?/i.test(text)) {
    fail(`${fileName} appears to route drill alerts to PagerDuty`, "Route drill alerts only to the staging drill channel.");
  }
  for (const block of text.split(/\n\s+- alert:\s+/).slice(1)) {
    const alertName = block.split(/\r?\n/, 1)[0].trim();
    const isProductionSeverity = /severity:\s*p[0-2]\b/.test(block);
    if (!isProductionSeverity) continue;
    for (const token of ["system:", "env:", "runbook:"]) {
      if (!block.includes(token)) {
        fail(`${fileName} alert ${alertName} is missing ${token}`, "P0/P1/P2 alerts must include severity, system, env, and runbook so Lark routing and cards stay deterministic.");
      }
    }
  }
}

const alertmanagerText = fs.readFileSync(alertmanagerPath, "utf8");
for (const token of [
  "receiver: blackhole-missing-env",
  "receiver: lark-staging-drill",
  "receiver: lark-p0-war-room",
  "receiver: lark-prod-alerts",
  'is_drill="true"',
  'env="staging"',
  'severity="p0"',
  'severity=~"p1|p2"',
  "/lark/p0-war-room",
  "/lark/prod-alerts",
  "/lark/staging-drill",
  "send_resolved: true",
]) {
  if (!alertmanagerText.includes(token)) {
    fail(`Alertmanager config missing ${token}`, "Keep Alertmanager as the only routing source and wire the three Lark Relay endpoints explicitly.");
  }
}
if (/pagerduty/i.test(alertmanagerText)) {
  fail("Alertmanager config references PagerDuty", "V1 Lark routing must not page PagerDuty, especially for staging drills.");
}
if (/open\.(feishu|larksuite)\.com\/open-apis\/bot\/v2\/hook/i.test(alertmanagerText)) {
  fail("Alertmanager config contains a direct Lark webhook URL", "Point Alertmanager at the internal Lark Relay endpoints and keep real Lark webhooks in secrets.");
}

const larkEnvText = fs.readFileSync(larkEnvPath, "utf8");
for (const token of [
  "LARK_WEBHOOK_P0_WAR_ROOM=",
  "LARK_SECRET_P0_WAR_ROOM=",
  "LARK_WEBHOOK_PROD_ALERTS=",
  "LARK_SECRET_PROD_ALERTS=",
  "LARK_WEBHOOK_STAGING_DRILL=",
  "LARK_SECRET_STAGING_DRILL=",
]) {
  if (!larkEnvText.includes(token)) {
    fail(`Lark env example missing ${token}`, "Document every required Relay webhook and signing secret as an empty placeholder.");
  }
}
if (/open\.(feishu|larksuite)\.com\/open-apis\/bot\/v2\/hook/i.test(larkEnvText)) {
  fail("Lark env example contains a real-looking webhook URL", "Never commit Lark webhook URLs; leave placeholders empty.");
}

const larkRelayText = fs.readFileSync(larkRelayPath, "utf8");
for (const token of [
  "MAX_EXCERPT_LINES = 5",
  "MAX_EXCERPT_CHARS = 1000",
  "MAX_CARD_BYTES = 24 * 1024",
  "foldedCount",
  "alerts[0]",
  "另外 ${foldedCount} 条同组告警已折叠",
  "compact",
  "getEndpointConfig(endpointPath",
]) {
  if (!larkRelayText.includes(token)) {
    fail(`Lark Relay missing required batching/safety token: ${token}`, "Relay must truncate by line+char, fold Alertmanager batches, compact oversized cards, and route only by endpoint.");
  }
}
if (/for\s*\([^)]*alerts/i.test(larkRelayText) || /alerts\.map\s*\(/i.test(larkRelayText)) {
  fail("Lark Relay appears to iterate over alerts[] for card content", "Do not expand full Alertmanager batches into one Lark card; show the first alert and fold the rest.");
}
if (/open\.(feishu|larksuite)\.com\/open-apis\/bot\/v2\/hook/i.test(larkRelayText)) {
  fail("Lark Relay source contains a direct Lark webhook URL", "Read webhooks from environment variables only.");
}

const dashboards = fs.readdirSync(dashboardsDir).filter((name) => name.endsWith(".json"));
if (dashboards.length === 0) {
  fail("no Grafana dashboards found", "Add at least one dashboard JSON under infra/monitoring/grafana/dashboards.");
}

const requiredPanels = [
  "Gateway SLO",
  "Finance Anomaly",
  "Withdrawal",
  "Provider Health",
  "Analytics Pipeline",
  "Admin Ops",
  "DB Health",
];

for (const dashboardName of dashboards) {
  const dashboardPath = path.join(dashboardsDir, dashboardName);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(dashboardPath, "utf8"));
  } catch (error) {
    fail(`${dashboardName} is not valid JSON: ${error.message}`, "Fix the Grafana dashboard JSON and rerun the monitoring gate.");
  }
  const panelTitles = JSON.stringify((parsed.panels || []).map((panel) => panel.title || ""));
  for (const required of requiredPanels) {
    if (!panelTitles.includes(required)) {
      fail(`${dashboardName} missing required panel family: ${required}`, "Add the required production dashboard panel so launch monitoring evidence is complete.");
    }
  }
}

console.log("[ci:monitoring-alert-rules] monitoring alert rules and dashboards validated");
