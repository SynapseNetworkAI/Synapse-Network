#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  ROOT,
  timestamp,
  writeEvidence,
  redactedJson,
} from "./gcp_alerts_evidence_utils.mjs";

const EVIDENCE_ROOT = path.join(ROOT, "output/dogfood/gcp-alerts");

function runProbe({ name, cwd, pythonBin, script }) {
  const out = path.join(os.tmpdir(), `${name}-${Date.now().toString(36)}.json`);
  const result = spawnSync(pythonBin, [script, "--out", out], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: cwd,
    },
  });
  if (result.status !== 0) {
    return {
      checks: [{
        name,
        status: "failed",
        detail: `${name} failed with exit=${result.status}`,
        actual: `${result.stderr || result.stdout || ""}`.slice(0, 1200),
      }],
      trace: [{
        scenario: name,
        httpStatus: 0,
        stderr: result.stderr || "",
        stdout: result.stdout || "",
      }],
    };
  }
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

function main() {
  const outDir = process.env.GCP_ALERTS_LOCAL_EVIDENCE_DIR
    || path.join(EVIDENCE_ROOT, `${timestamp()}-local-gcp-alerts`);
  const gatewayAdmin = runProbe({
    name: "gateway-admin-alert-receiver-probe",
    cwd: path.join(ROOT, "services/gateway-admin"),
    pythonBin: path.join(ROOT, "services/gateway-admin/.venv/bin/python"),
    script: path.join(ROOT, "scripts/e2e/gcp_alerts_gateway_admin_probe.py"),
  });
  const gateway = runProbe({
    name: "gateway-alert-drill-probe",
    cwd: path.join(ROOT, "services/gateway"),
    pythonBin: path.join(ROOT, "services/gateway/.venv/bin/python"),
    script: path.join(ROOT, "scripts/e2e/gcp_alerts_gateway_drill_probe.py"),
  });
  const checks = [...gatewayAdmin.checks, ...gateway.checks].map(redactedJson);
  const trace = [...gatewayAdmin.trace, ...gateway.trace].map((entry) => ({
    runId: "local-gcp-alerts",
    timestamp: new Date().toISOString(),
    ...redactedJson(entry),
  }));
  const report = writeEvidence({
    outDir,
    title: "GCP Alerts Local E2E",
    environment: "local",
    checks,
    trace,
    notes: [
      "Local E2E uses a fake Lark HTTP sink and FastAPI in-process clients.",
      "No real GCP resources or Lark webhooks are called.",
    ],
  });
  console.log(`[gcp-alerts-local-e2e] evidence=${outDir}`);
  console.log(`[gcp-alerts-local-e2e] status=${report.status}`);
  if (report.status !== "passed") process.exit(1);
}

main();
