import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function writeJson(outputDir, filename, value) {
  ensureOutputDir(outputDir);
  writeFileSync(
    path.join(outputDir, filename),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
}

export function writeMarkdownReport(outputDir, report) {
  ensureOutputDir(outputDir);
  const sections = [
    "# GCP Billing Review",
    "",
    ...renderSummarySection(report),
    "",
    "## Service Breakdown",
    "",
    ...renderServiceBreakdown(report),
    "",
    "## Top SKU Deltas",
    "",
    ...renderSkuBreakdown(report),
    "",
    "## Optimization Candidates",
    "",
    ...renderOptimizationCandidates(report),
  ];
  writeFileSync(
    path.join(outputDir, "report.md"),
    `${sections.join("\n")}\n`,
    "utf8"
  );
}

export function printSummary(outputDir, report) {
  const topService = report.serviceBreakdown[0]?.service ?? "n/a";
  console.log(`STATUS ${report.status}`);
  console.log(`PROJECT ${report.projectId ?? "unknown"}`);
  if (typeof report.totalCost === "number") {
    console.log(`TOTAL_COST ${report.totalCost.toFixed(2)}`);
  }
  console.log(`TOP_SERVICE ${topService}`);
  for (const candidate of report.optimizationCandidates) {
    console.log(
      `OPTIMIZATION_CANDIDATE ${candidate.id} ${candidate.actionability} ${candidate.title}`
    );
  }
  if (report.status === "blocked" && report.blockedReason) {
    console.log(`BLOCKED ${report.blockedReason}`);
  }
  console.log(`PR_CREATED ${report.prCreated ? "yes" : "no"}`);
  if (report.prUrl) {
    console.log(`PR_URL ${report.prUrl}`);
  }
  console.log(
    `SUMMARY bundle=${outputDir} candidates=${
      report.optimizationCandidates.length
    } blocked=${report.blockedReason ?? "none"}`
  );
}

function ensureOutputDir(outputDir) {
  mkdirSync(outputDir, { recursive: true });
}

function renderSummarySection(report) {
  const lines = [
    `- Status: \`${report.status}\``,
    `- Project: \`${report.projectId ?? "unknown"}\``,
  ];
  if (report.windowStart && report.windowEnd) {
    lines.push(
      `- Window: \`${report.windowStart}\` to \`${report.windowEnd}\` (UTC)`
    );
  }
  if (typeof report.totalCost === "number") {
    lines.push(`- Recent 7d total: \`$${report.totalCost.toFixed(2)}\``);
  }
  if (typeof report.previousTotalCost === "number") {
    lines.push(`- Prior 7d total: \`$${report.previousTotalCost.toFixed(2)}\``);
  }
  if (report.blockedReason) {
    lines.push(`- Blocked reason: \`${report.blockedReason}\``);
  }
  lines.push(`- PR created: \`${report.prCreated ? "yes" : "no"}\``);
  if (report.prUrl) {
    lines.push(`- PR URL: ${report.prUrl}`);
  }
  return lines;
}

function renderServiceBreakdown(report) {
  if (report.serviceBreakdown.length === 0) {
    return ["- No service breakdown available."];
  }
  return report.serviceBreakdown.map(
    (service) =>
      `- ${service.service}: $${service.recentCost.toFixed(2)} recent, ` +
      `$${service.previousCost.toFixed(2)} previous, ` +
      `${service.sharePct.toFixed(2)}% share`
  );
}

function renderSkuBreakdown(report) {
  if (report.topSkuBreakdown.length === 0) {
    return ["- No SKU breakdown available."];
  }
  return report.topSkuBreakdown
    .slice(0, 10)
    .map(
      (sku) =>
        `- ${sku.sku}: $${sku.recentCost.toFixed(2)} recent, ` +
        `$${sku.previousCost.toFixed(2)} previous`
    );
}

function renderOptimizationCandidates(report) {
  if (report.optimizationCandidates.length === 0) {
    return ["- No deterministic repo-local patch candidates were found."];
  }
  return report.optimizationCandidates.map(
    (candidate) =>
      `- ${candidate.title} (\`${candidate.actionability}\`): ${candidate.suggestedAction}`
  );
}
