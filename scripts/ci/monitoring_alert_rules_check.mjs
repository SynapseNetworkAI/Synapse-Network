#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const alertsDir = path.join(root, "infra/monitoring/prometheus/alerts");
const dashboardsDir = path.join(root, "infra/monitoring/grafana/dashboards");

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
