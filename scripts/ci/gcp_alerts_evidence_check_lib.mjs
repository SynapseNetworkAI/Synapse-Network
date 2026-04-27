import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);

const SECRET_PATTERN =
  /(open-apis\/bot\/v2\/hook|private[_-]?key|authorization|bearer\s+[a-z0-9._~+/=-]{8,}|password|signature=|token=|0x[a-f0-9]{64,})/i;

export function fail(message, fix) {
  console.error(`FATAL GCP-ALERTS-EVIDENCE: ${message}`);
  if (fix) console.error(`Agent fix: ${fix}`);
  process.exit(1);
}

export function latestEvidenceDir({ envName, evidenceRoot, overrideEnv }) {
  const override = process.env[overrideEnv];
  if (override) return path.resolve(override);
  if (!fs.existsSync(evidenceRoot)) return "";
  const suffix = envName === "local" ? "-local-gcp-alerts" : "-gcp-alerts-staging";
  const dirs = fs
    .readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
    .map((entry) => path.join(evidenceRoot, entry.name))
    .sort();
  return dirs.at(-1) || "";
}

export function validateGcpAlertsEvidence({
  dir,
  requiredChecks,
  optionalPassedChecks = [],
  requireMonitoringDelivery = false,
}) {
  if (!dir) {
    fail("missing GCP alerts evidence", "Run the matching npm run e2e:gcp-alerts:* command first.");
  }

  const reportPath = path.join(dir, "report.json");
  const tracePath = path.join(dir, "trace.jsonl");
  const bugfixPath = path.join(dir, "bugfix-log.md");
  if (!fs.existsSync(reportPath) || !fs.existsSync(tracePath) || !fs.existsSync(bugfixPath)) {
    fail(
      "report.json, trace.jsonl, or bugfix-log.md missing",
      "Rerun the e2e script; evidence must be generated atomically.",
    );
  }

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const traceText = fs.readFileSync(tracePath, "utf8");
  const bugfixText = fs.readFileSync(bugfixPath, "utf8");
  if (report.status !== "passed" || (report.failed || []).length !== 0) {
    fail("report status is not passed", "Fix the failed alert path and rerun the E2E.");
  }
  if (!traceText.trim()) {
    fail("trace.jsonl is empty", "Rerun the e2e script so receiver/API evidence is recorded.");
  }
  const digest = crypto.createHash("sha256").update(traceText).digest("hex");
  if (report.traceDigest !== digest) {
    fail("trace digest mismatch", "Rerun the e2e script; report.json and trace.jsonl must be generated together.");
  }
  if (!/No open bugs\./.test(bugfixText)) {
    fail("bugfix-log.md contains open bugs", "Fix the bugs and rerun the E2E until the bugfix log is clean.");
  }
  const evidenceText = `${traceText}\n${JSON.stringify(report)}\n${bugfixText}`;
  if (SECRET_PATTERN.test(evidenceText)) {
    fail("secret-like value found in evidence", "Delete the evidence, fix redaction, and rerun.");
  }

  const checks = new Map((report.checks || []).map((check) => [check.name, check]));
  for (const name of requiredChecks) {
    const check = checks.get(name);
    if (!check) {
      fail(`required check missing: ${name}`, "Rerun the E2E script for the correct environment.");
    }
    if (check.status !== "passed") {
      fail(`required check failed: ${name}`, "Fix the failing scenario and rerun.");
    }
  }

  for (const name of optionalPassedChecks) {
    const check = checks.get(name);
    if (check && check.status !== "passed") {
      fail(`optional executed check failed: ${name}`, "Fix the failing scenario or omit the optional env for this run.");
    }
  }

  if (requireMonitoringDelivery) {
    for (const name of [
      "gcp-webhook-channel-configured",
      "gcp-alert-policies-configured",
      "gcp-uptime-checks-configured",
      "gcp-scheduled-jobs-configured",
      "gcp-monitoring-callback-observed",
    ]) {
      const check = checks.get(name);
      if (!check || check.status !== "passed") {
        fail(
          `monitoring delivery check failed or missing: ${name}`,
          "Keep GCP_ALERTS_REQUIRE_MONITORING_DELIVERY=true and rerun after fixing GCP alert policy delivery.",
        );
      }
    }
  }

  return dir;
}
