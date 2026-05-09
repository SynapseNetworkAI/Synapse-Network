import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  OUT_DIR,
  RUN_ID,
  evidence,
  redactedObject,
} from "./staging_core_dogfood_runtime.mjs";

export function writeEvidence(report) {
  const traceText =
    evidence.trace.map((row) => JSON.stringify(row)).join("\n") + "\n";
  const tracePath = path.join(OUT_DIR, "trace.jsonl");
  fs.writeFileSync(tracePath, traceText);
  const traceDigest = crypto
    .createHash("sha256")
    .update(traceText)
    .digest("hex");
  report.traceDigest = traceDigest;
  report.evidenceFiles = {
    report: "report.json",
    markdown: "report.md",
    trace: "trace.jsonl",
    api: "api-evidence.json",
    db: "db-evidence.json",
    chain: "chain-evidence.json",
    bugfix: "bugfix-log.md",
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "api-evidence.json"),
    `${JSON.stringify(redactedObject(evidence.api), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "db-evidence.json"),
    `${JSON.stringify(redactedObject(evidence.db), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "chain-evidence.json"),
    `${JSON.stringify(redactedObject(evidence.chain), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "bugfix-log.md"),
    renderBugfixLog(evidence.bugfix)
  );
  fs.writeFileSync(path.join(OUT_DIR, "report.md"), renderMarkdown(report));
}

function renderBugfixLog(items) {
  const lines = ["# Staging Core Dogfood Bugfix Log", ""];
  if (items.length === 0) {
    lines.push("- No open bugs.");
  } else {
    for (const item of items) {
      lines.push(`## ${item.id} ${item.severity} ${item.scenario}`);
      lines.push("");
      lines.push(`- Scenario: ${item.scenario}`);
      lines.push(`- Screenshot: ${item.screenshot || "N/A"}`);
      lines.push(`- API Evidence: ${item.apiEvidence || "N/A"}`);
      lines.push(`- DB Evidence: ${item.dbEvidence || "N/A"}`);
      lines.push(`- Chain Evidence: ${item.chainEvidence || "N/A"}`);
      lines.push(`- Repro Steps: ${item.reproSteps}`);
      lines.push(`- Expected: ${item.expected}`);
      lines.push(`- Actual: ${item.actual}`);
      lines.push(`- Status: ${item.status}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderMarkdown(report) {
  return (
    [
      "# Staging Core Dogfood Evidence",
      "",
      `- Status: \`${report.status}\``,
      `- Run ID: \`${RUN_ID}\``,
      `- Generated at: \`${report.generatedAt}\``,
      `- Trace digest: \`${report.traceDigest}\``,
      "",
      "## Checks",
      "",
      "| Check | Result | Detail |",
      "| --- | --- | --- |",
      ...report.checks.map(
        (check) =>
          `| ${check.name} | ${check.ok ? "PASS" : "FAIL"} | ${String(
            check.detail || ""
          ).replace(/\|/g, "\\|")} |`
      ),
      "",
      "## Screenshots",
      "",
      ...report.screenshots.map((item) => `- \`${item}\``),
      "",
      "## Reconciliation",
      "",
      `- ledgerDelta: \`${report.reconciliation?.ledgerDelta || ""}\``,
      `- vaultDelta: \`${report.reconciliation?.vaultDelta || ""}\``,
      "",
    ].join("\n") + "\n"
  );
}
