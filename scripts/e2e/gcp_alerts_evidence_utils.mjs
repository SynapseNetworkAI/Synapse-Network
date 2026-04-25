import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);

export function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function redact(raw) {
  return String(raw ?? "")
    .replace(
      /(authorization|bearer|token|secret|password|private[_-]?key|signature|cookie)\s*[:=]\s*[^,\s\\]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b0x[a-fA-F0-9]{64,}\b/g, "[REDACTED_HEX]")
    .replace(/open-apis\/bot\/v2\/hook\/[A-Za-z0-9._~+/-]+/g, "open-apis/bot/v2/hook/[REDACTED]");
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

export function redactedJson(value) {
  return JSON.parse(redact(JSON.stringify(value ?? null)));
}

export function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function writeEvidence({ outDir, title, environment, checks, trace, notes = [] }) {
  fs.mkdirSync(outDir, { recursive: true });
  const sanitizedTrace = trace.map((entry) => redactedJson(entry));
  const traceText = sanitizedTrace.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  fs.writeFileSync(path.join(outDir, "trace.jsonl"), traceText);

  const traceDigest = sha256(traceText);
  const failed = checks.filter((check) => check.status !== "passed");
  const bugfix = failed.map((check, index) => ({
    id: `BUG-${String(index + 1).padStart(3, "0")}`,
    severity: check.severity || "P1",
    scenario: check.name,
    evidence: check.evidence || check.detail || "",
    reproSteps: check.reproSteps || "Run the GCP alerts E2E command.",
    expected: check.expected || "Scenario passes.",
    actual: check.actual || check.detail || "Scenario failed.",
    status: "open",
  }));
  const report = {
    status: failed.length === 0 ? "passed" : "failed",
    generatedAt: new Date().toISOString(),
    environment,
    checks: checks.map((check) => redactedJson(check)),
    failed: failed.map((check) => redactedJson(check)),
    traceDigest,
    notes,
  };

  fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "bugfix-log.md"), renderBugfixLog(bugfix));
  fs.writeFileSync(path.join(outDir, "report.md"), renderMarkdown({ title, report }));
  return report;
}

function renderBugfixLog(entries) {
  if (entries.length === 0) {
    return "# Bugfix Log\n\nNo open bugs.\n";
  }
  return [
    "# Bugfix Log",
    "",
    ...entries.flatMap((entry) => [
      `## ${entry.id} - ${entry.scenario}`,
      "",
      `- Severity: ${entry.severity}`,
      `- Status: ${entry.status}`,
      `- Evidence: ${redact(entry.evidence)}`,
      `- Repro Steps: ${redact(entry.reproSteps)}`,
      `- Expected: ${redact(entry.expected)}`,
      `- Actual: ${redact(entry.actual)}`,
      "",
    ]),
  ].join("\n");
}

function renderMarkdown({ title, report }) {
  return [
    `# ${title}`,
    "",
    `- Status: ${report.status}`,
    `- Environment: ${report.environment}`,
    `- Generated: ${report.generatedAt}`,
    `- Checks: ${report.checks.length}`,
    `- Failed: ${report.failed.length}`,
    `- Trace digest: ${report.traceDigest}`,
    "",
    "| Check | Status |",
    "|---|---|",
    ...report.checks.map((check) => `| ${check.name} | ${check.status} |`),
    "",
  ].join("\n");
}
