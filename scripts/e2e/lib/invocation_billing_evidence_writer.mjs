import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function writeInvocationBillingEvidence(ctx) {
  const {
    apiEvidence,
    checks,
    dbEvidence,
    environment,
    evidenceDir,
    failed,
    generatedAt,
    migrationEvidence,
    reportName,
    runId,
    sanitize,
    screenshotEvidence,
    trace,
    uiEvidence,
  } = ctx;
  const traceText =
    trace.map((row) => JSON.stringify(sanitize(row))).join("\n") + "\n";
  fs.writeFileSync(path.join(evidenceDir, "trace.jsonl"), traceText);
  const traceDigest = crypto
    .createHash("sha256")
    .update(traceText)
    .digest("hex");
  const report = sanitize({
    status: failed.length ? "failed" : "success",
    environment,
    runId,
    generatedAt: generatedAt.toISOString(),
    evidenceDir,
    failed,
    checks,
    traceDigest,
    files: {
      migration: "migration-evidence.json",
      api: "api-evidence.json",
      db: "db-evidence.json",
      ui: "ui-evidence.json",
      screenshots: "screenshot-evidence.json",
    },
  });
  writeJson(evidenceDir, "report.json", report);
  writeJson(
    evidenceDir,
    "migration-evidence.json",
    sanitize(migrationEvidence)
  );
  writeJson(evidenceDir, "api-evidence.json", sanitize(apiEvidence));
  writeJson(evidenceDir, "db-evidence.json", sanitize(dbEvidence));
  writeJson(evidenceDir, "ui-evidence.json", sanitize(uiEvidence));
  writeJson(
    evidenceDir,
    "screenshot-evidence.json",
    sanitize(screenshotEvidence)
  );
  fs.writeFileSync(
    path.join(evidenceDir, "bugfix-log.md"),
    renderBugfixLog(failed)
  );
  fs.writeFileSync(
    path.join(evidenceDir, "report.md"),
    renderReport({ report, reportName })
  );
}

function writeJson(dir, fileName, payload) {
  fs.writeFileSync(
    path.join(dir, fileName),
    `${JSON.stringify(payload, null, 2)}\n`
  );
}

function renderBugfixLog(failed) {
  if (!failed.length)
    return "# Invocation Billing Migration Bugfix Log\n\nNo open bugs.\n";
  return `# Invocation Billing Migration Bugfix Log\n\n${failed
    .map((item) => `- OPEN: ${item.name} - ${item.error}`)
    .join("\n")}\n`;
}

function renderReport({ report, reportName }) {
  return [
    `# ${reportName}`,
    "",
    `- Status: ${report.status}`,
    `- Environment: ${report.environment}`,
    `- Run ID: ${report.runId}`,
    `- Failed checks: ${report.failed.length}`,
    `- Evidence: ${report.evidenceDir}`,
    "",
  ].join("\n");
}
