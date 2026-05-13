#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(
  process.env.REPO_ROOT ?? path.join(__dirname, "..", "..")
);
const REPORT_ROOT = path.join(REPO_ROOT, "docs", "evidence", "cost");
const NOW = new Date();
const WINDOW_DAYS = Number.parseInt(process.env.GCP_BILLING_WINDOW_DAYS ?? "7", 10);
const COMPARISON_DAYS = Number.parseInt(
  process.env.GCP_BILLING_COMPARISON_DAYS ?? "7",
  10
);
const DEFAULT_TIMEOUT_MS = Number.parseInt(
  process.env.GCP_BILLING_REVIEW_TIMEOUT_MS ?? "30000",
  10
);
const DRY_RUN = process.env.DRY_RUN === "1";
const CREATE_PR = process.env.GCP_BILLING_REVIEW_CREATE_PR !== "0";
const FIXTURE_PATH = process.env.GCP_BILLING_REVIEW_FIXTURE
  ? path.resolve(process.env.GCP_BILLING_REVIEW_FIXTURE)
  : null;

const bundleName = `${formatCompactUtc(NOW)}-gcp-billing-review`;
const outputDir = path.resolve(
  process.env.GCP_BILLING_REVIEW_OUTPUT_DIR ??
    path.join(REPORT_ROOT, bundleName)
);

class BlockedError extends Error {}

mkdirSync(outputDir, { recursive: true });

const state = {
  status: "running",
  projectId: null,
  windowStart: null,
  windowEnd: null,
  totalCost: null,
  previousTotalCost: null,
  serviceBreakdown: [],
  topSkuBreakdown: [],
  optimizationCandidates: [],
  prCreated: false,
  prUrl: null,
  blockedReason: null,
  exportTable: null,
  generatedAt: NOW.toISOString(),
};

try {
  if (process.env.GCP_BILLING_REVIEW_FORCE_BLOCKED_REASON) {
    throw new BlockedError(process.env.GCP_BILLING_REVIEW_FORCE_BLOCKED_REASON);
  }

  const preflight = runPreflight();
  state.projectId = preflight.projectId;

  const dataset = FIXTURE_PATH
    ? loadFixture(FIXTURE_PATH, state.projectId)
    : loadBillingDataset(state.projectId);

  state.exportTable = dataset.exportTable;

  const summary = summarizeBillingRows(dataset.rows);
  if (summary.totalCost === null) {
    throw new BlockedError("no_billing_rows_for_project_window");
  }

  state.windowStart = summary.windowStart;
  state.windowEnd = summary.windowEnd;
  state.totalCost = summary.totalCost;
  state.previousTotalCost = summary.previousTotalCost;
  state.serviceBreakdown = summary.serviceBreakdown;
  state.topSkuBreakdown = summary.topSkuBreakdown;
  state.optimizationCandidates = deriveOptimizationCandidates(summary);
  state.status = "success";

  writeJson("raw-billing-summary.json", {
    projectId: state.projectId,
    generatedAt: state.generatedAt,
    exportTable: state.exportTable,
    rows: dataset.rows,
    summary,
  });
  writeJson("optimization-candidates.json", state.optimizationCandidates);

  const repoPatchPlan = buildRepoPatchPlan(summary, state.optimizationCandidates);
  if (repoPatchPlan.patches.length > 0 && CREATE_PR) {
    const prResult = maybeCreatePullRequest(repoPatchPlan, summary);
    state.prCreated = prResult.created;
    state.prUrl = prResult.prUrl;
  }
} catch (error) {
  if (error instanceof BlockedError) {
    state.status = "blocked";
    state.blockedReason = error.message;
  } else {
    state.status = "failed";
    state.blockedReason = error instanceof Error ? error.message : String(error);
  }
} finally {
  writeJson("report.json", state);
  writeJson("optimization-candidates.json", state.optimizationCandidates);
  writeMarkdownReport(state);
  printSummary(state);
}

if (state.status === "blocked") {
  process.exitCode = 3;
} else if (state.status === "failed") {
  process.exitCode = 1;
}

function runPreflight() {
  const commands = ["gh", "gcloud", "bq", "jq", "node"];
  for (const command of commands) {
    ensureCommand(command);
  }

  if (!FIXTURE_PATH) {
    runCommand("gh", ["auth", "status"], {
      label: "gh auth status",
      failMessage: "gh auth status failed",
      timeoutMs: 15000,
    });

    const authList = runJsonCommand("gcloud", [
      "auth",
      "list",
      "--format=json",
    ], {
      label: "gcloud auth list",
      timeoutMs: 15000,
    });
    if (!Array.isArray(authList) || !authList.some((entry) => entry.status === "ACTIVE")) {
      throw new BlockedError("missing_active_gcloud_account");
    }
  }

  const projectId =
    process.env.GCP_PROJECT_ID ??
    readTrimmedStdout("gcloud", ["config", "get-value", "project"], {
      label: "gcloud config get-value project",
      failMessage: "unable to resolve current gcloud project",
      timeoutMs: 15000,
    });

  if (!projectId || projectId === "(unset)") {
    throw new BlockedError("missing_gcloud_project");
  }

  return { projectId };
}

function loadFixture(fixturePath, projectId) {
  if (!existsSync(fixturePath)) {
    throw new Error(`fixture file not found: ${fixturePath}`);
  }
  const payload = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(payload.rows)) {
    throw new Error("fixture must contain a rows array");
  }
  return {
    exportTable: payload.exportTable ?? {
      projectId,
      datasetId: "fixture",
      tableId: path.basename(fixturePath),
    },
    rows: payload.rows.map(normalizeBillingRow),
  };
}

function loadBillingDataset(projectId) {
  const exportTable = discoverBillingExportTable(projectId);
  if (!exportTable) {
    throw new BlockedError("missing_billing_export");
  }

  const tableFqn =
    `\`${exportTable.projectId}.${exportTable.datasetId}.${exportTable.tableId}\``;
  const sql = `
WITH line_items AS (
  SELECT
    DATE(usage_start_time) AS usage_date,
    service.description AS service_description,
    sku.description AS sku_description,
    SUM(
      CAST(cost AS NUMERIC) +
      IFNULL(
        (SELECT SUM(CAST(c.amount AS NUMERIC)) FROM UNNEST(credits) AS c),
        0
      )
    ) AS net_cost
  FROM ${tableFqn}
  WHERE project.id = '${sqlStringLiteral(projectId)}'
    AND DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL ${
      WINDOW_DAYS + COMPARISON_DAYS
    } DAY)
  GROUP BY 1, 2, 3
)
SELECT
  CAST(usage_date AS STRING) AS usage_date,
  service_description,
  sku_description,
  CAST(net_cost AS FLOAT64) AS net_cost
FROM line_items
ORDER BY usage_date DESC, net_cost DESC
`;

  const rows = runJsonCommand("bq", [
    "query",
    "--use_legacy_sql=false",
    "--format=json",
    "--quiet",
    sql,
  ], {
    label: "bq billing export query",
    timeoutMs: 120000,
  }).map(normalizeBillingRow);

  return { exportTable, rows };
}

function discoverBillingExportTable(projectId) {
  const explicit = buildExplicitExportTable(projectId);
  if (explicit) {
    return explicit;
  }

  let datasets;
  try {
    datasets = runJsonCommand("bq", [
      "ls",
      "--project_id",
      projectId,
      "--format=json",
      "--max_results=1000",
    ], {
      label: "bq ls datasets",
      timeoutMs: 20000,
    });
  } catch {
    return null;
  }

  const candidates = [];
  for (const dataset of datasets) {
    const datasetId =
      dataset?.datasetReference?.datasetId ??
      dataset?.id?.split(":")?.[1] ??
      null;
    if (!datasetId) {
      continue;
    }
    let tables;
    try {
      tables = runJsonCommand("bq", [
        "ls",
        "--project_id",
        projectId,
        "--format=json",
        "--max_results=1000",
        `${projectId}:${datasetId}`,
      ], {
        label: `bq ls ${datasetId}`,
        timeoutMs: 20000,
      });
    } catch {
      continue;
    }

    for (const table of tables) {
      const tableId = table?.tableReference?.tableId;
      const type = String(table?.type ?? "TABLE").toUpperCase();
      if (!tableId || type !== "TABLE") {
        continue;
      }
      if (!/(cloud_)?gcp?_?billing.*export|billing.*export/i.test(tableId)) {
        continue;
      }
      candidates.push({
        projectId,
        datasetId,
        tableId,
        score: scoreExportTable(tableId),
      });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score || left.tableId.localeCompare(right.tableId));
  const [winner] = candidates;
  return {
    projectId: winner.projectId,
    datasetId: winner.datasetId,
    tableId: winner.tableId,
  };
}

function buildExplicitExportTable(projectId) {
  const exportProjectId =
    process.env.GCP_BILLING_EXPORT_PROJECT_ID ?? projectId;
  const datasetId = process.env.GCP_BILLING_EXPORT_DATASET;
  const tableId = process.env.GCP_BILLING_EXPORT_TABLE;
  if (!datasetId || !tableId) {
    return null;
  }
  return { projectId: exportProjectId, datasetId, tableId };
}

function summarizeBillingRows(rows) {
  const todayUtc = startOfUtcDay(NOW);
  const recentStart = addUtcDays(todayUtc, -(WINDOW_DAYS - 1));
  const previousStart = addUtcDays(recentStart, -COMPARISON_DAYS);
  const previousEnd = addUtcDays(recentStart, -1);

  const normalizedRows = rows
    .map(normalizeBillingRow)
    .filter((row) => row.usage_date);

  const recentRows = normalizedRows.filter((row) =>
    row.date >= recentStart && row.date <= todayUtc
  );
  const previousRows = normalizedRows.filter((row) =>
    row.date >= previousStart && row.date <= previousEnd
  );

  if (recentRows.length === 0) {
    return {
      windowStart: toDateOnly(recentStart),
      windowEnd: toDateOnly(todayUtc),
      totalCost: null,
      previousTotalCost: null,
      serviceBreakdown: [],
      topSkuBreakdown: [],
    };
  }

  const recentTotal = roundCurrency(sumBy(recentRows, (row) => row.net_cost));
  const previousTotal = roundCurrency(sumBy(previousRows, (row) => row.net_cost));

  const serviceBreakdown = buildBreakdown({
    recentRows,
    previousRows,
    keyForRow: (row) => row.service_description,
    labelKey: "service",
    totalRecent: recentTotal,
  });
  const topSkuBreakdown = buildBreakdown({
    recentRows,
    previousRows,
    keyForRow: (row) => `${row.service_description} :: ${row.sku_description}`,
    labelKey: "sku",
    totalRecent: recentTotal,
  }).slice(0, 10);

  return {
    windowStart: toDateOnly(recentStart),
    windowEnd: toDateOnly(todayUtc),
    previousWindowStart: toDateOnly(previousStart),
    previousWindowEnd: toDateOnly(previousEnd),
    totalCost: recentTotal,
    previousTotalCost: previousTotal,
    serviceBreakdown,
    topSkuBreakdown,
  };
}

function deriveOptimizationCandidates(summary) {
  const candidates = [];
  const total = summary.totalCost ?? 0;
  const previousTotal = summary.previousTotalCost ?? 0;

  for (const service of summary.serviceBreakdown) {
    const lower = service.service.toLowerCase();
    if (lower.includes("cloud run") && service.sharePct >= 35) {
      candidates.push({
        id: "cloud-run-rightsize-review",
        title: "Review Cloud Run right-sizing and idle posture",
        actionability: "manual",
        evidence: {
          service: service.service,
          recentCost: service.recentCost,
          previousCost: service.previousCost,
          sharePct: service.sharePct,
        },
        suggestedAction:
          "Inspect staging/prod Cloud Run min instances, CPU, memory, and concurrency before changing live capacity. This repo can only auto-patch when a specific safe config delta is confirmed.",
      });
    }

    if (
      (lower.includes("logging") || lower.includes("monitoring")) &&
      service.sharePct >= 10
    ) {
      candidates.push({
        id: "logging-retention-sampling-review",
        title: "Review logging volume and retention",
        actionability: "manual",
        evidence: {
          service: service.service,
          recentCost: service.recentCost,
          previousCost: service.previousCost,
          sharePct: service.sharePct,
        },
        suggestedAction:
          "Check debug-log volume, retention windows, and logs-based metrics. Prefer reducing noisy staging logs before touching production observability.",
      });
    }

    if (lower.includes("scheduler") && service.recentCost >= 0.2) {
      candidates.push({
        id: "scheduler-cadence-review",
        title: "Review Scheduler cadence against current staging load",
        actionability: "manual",
        evidence: {
          service: service.service,
          recentCost: service.recentCost,
          previousCost: service.previousCost,
          sharePct: service.sharePct,
        },
        suggestedAction:
          "Verify current Cloud Scheduler cadence still matches low-traffic staging assumptions before tightening intervals further.",
      });
    }

    if (lower.includes("sql") && service.sharePct >= 25 && service.deltaCost >= 1) {
      candidates.push({
        id: "cloud-sql-tier-review",
        title: "Review Cloud SQL tier, storage growth, and backup posture",
        actionability: "manual",
        evidence: {
          service: service.service,
          recentCost: service.recentCost,
          previousCost: service.previousCost,
          sharePct: service.sharePct,
          deltaCost: service.deltaCost,
        },
        suggestedAction:
          "Re-check whether the current Cloud SQL tier, backup retention, and PITR window still match staging or production load reality.",
      });
    }
  }

  if (total > 0 && previousTotal > 0 && total > previousTotal * 1.3) {
    candidates.push({
      id: "weekly-cost-spike-investigation",
      title: "Weekly cost increased materially versus the prior window",
      actionability: "manual",
      evidence: {
        totalCost: total,
        previousTotalCost: previousTotal,
        deltaCost: roundCurrency(total - previousTotal),
      },
      suggestedAction:
        "Inspect the top delta services and SKUs before changing infra. Do not auto-reduce capacity until SLA and release evidence impact are understood.",
    });
  }

  return candidates;
}

function buildRepoPatchPlan(summary, candidates) {
  const patches = [];

  for (const candidate of candidates) {
    if (candidate.actionability !== "repo_patch") {
      continue;
    }
    if (candidate.patchPlan?.type === "update-file") {
      patches.push(candidate.patchPlan);
    }
  }

  return {
    branchName: `codex/gcp-billing-review-${formatDateYYYYMMDD(NOW)}`,
    commitMessage: "[codex] Optimize GCP cost controls from weekly billing review",
    prTitle: "[codex] Optimize GCP cost controls from weekly billing review",
    patches,
    summary,
  };
}

function maybeCreatePullRequest(plan, summary) {
  if (plan.patches.length === 0) {
    return { created: false, prUrl: null };
  }

  ensureCleanGitState();

  for (const patch of plan.patches) {
    applyRepoPatch(patch);
  }

  const touchedPaths = [...new Set(plan.patches.map((patch) => patch.path))];
  if (touchedPaths.length === 0) {
    return { created: false, prUrl: null };
  }

  if (DRY_RUN) {
    return { created: false, prUrl: null };
  }

  git(["checkout", "-B", plan.branchName]);
  git(["add", "--", ...touchedPaths]);

  if (!hasCachedDiff()) {
    return { created: false, prUrl: null };
  }

  git(["commit", "-m", plan.commitMessage]);
  git(["push", "-u", "origin", plan.branchName]);

  const body = buildPullRequestBody(summary, state.optimizationCandidates);
  const prUrl = readTrimmedStdout(
    "gh",
    [
      "pr",
      "create",
      "--title",
      plan.prTitle,
      "--body",
      body,
      "--base",
      "main",
      "--head",
      plan.branchName,
    ],
    {
      env: process.env,
      label: "gh pr create",
      failMessage: "failed to create pull request",
      timeoutMs: 120000,
    }
  );

  return { created: true, prUrl };
}

function applyRepoPatch(patch) {
  if (patch.type !== "update-file") {
    throw new Error(`unsupported repo patch type: ${patch.type}`);
  }

  const absolutePath = path.resolve(REPO_ROOT, patch.path);
  const current = readFileSync(absolutePath, "utf8");
  if (current.includes(patch.find)) {
    writeFileSync(absolutePath, current.replace(patch.find, patch.replaceWith));
    return;
  }

  if (patch.appendIfMissing) {
    writeFileSync(absolutePath, `${current}${patch.appendIfMissing}`);
    return;
  }

  throw new Error(`patch marker not found in ${patch.path}`);
}

function buildPullRequestBody(summary, candidates) {
  const topServices = summary.serviceBreakdown
    .slice(0, 3)
    .map(
      (service) =>
        `- ${service.service}: $${service.recentCost.toFixed(2)} (${service.sharePct.toFixed(
          2
        )}%)`
    )
    .join("\n");
  const candidateLines = candidates
    .map((candidate) => `- ${candidate.title}: ${candidate.suggestedAction}`)
    .join("\n");

  return [
    `Billing window: ${summary.windowStart} to ${summary.windowEnd} (UTC)`,
    "",
    "Cost evidence summary:",
    topServices || "- No service breakdown available",
    "",
    "Why this PR exists:",
    "This weekly billing review found at least one repo-local optimization that can be applied safely without changing irreversible production state.",
    "",
    "Optimization items:",
    candidateLines || "- No optimization items recorded",
    "",
    "Validation commands:",
    "- bash scripts/ops/gcp_billing_review.sh",
    "- npm run ci:docs",
    "",
    "Uncovered risks:",
    "- This automation only patches repo-local config or docs. Console-only billing changes and SLA-sensitive capacity reductions still need human review.",
  ].join("\n");
}

function buildBreakdown({ recentRows, previousRows, keyForRow, labelKey, totalRecent }) {
  const recentMap = accumulateByKey(recentRows, keyForRow);
  const previousMap = accumulateByKey(previousRows, keyForRow);
  const keys = new Set([...recentMap.keys(), ...previousMap.keys()]);

  return [...keys]
    .map((key) => {
      const recentCost = roundCurrency(recentMap.get(key) ?? 0);
      const previousCost = roundCurrency(previousMap.get(key) ?? 0);
      const deltaCost = roundCurrency(recentCost - previousCost);
      return {
        [labelKey]: key,
        recentCost,
        previousCost,
        deltaCost,
        sharePct: totalRecent > 0 ? roundPercent((recentCost / totalRecent) * 100) : 0,
      };
    })
    .sort((left, right) => right.recentCost - left.recentCost);
}

function accumulateByKey(rows, keyForRow) {
  const totals = new Map();
  for (const row of rows) {
    const key = keyForRow(row);
    totals.set(key, (totals.get(key) ?? 0) + row.net_cost);
  }
  return totals;
}

function normalizeBillingRow(row) {
  const usageDate = row.usage_date ?? row.usageDate;
  const serviceDescription =
    row.service_description ?? row.serviceDescription ?? "Unknown service";
  const skuDescription =
    row.sku_description ?? row.skuDescription ?? "Unknown SKU";
  const netCost = Number.parseFloat(String(row.net_cost ?? row.netCost ?? "0"));
  const date = usageDate ? new Date(`${usageDate}T00:00:00.000Z`) : null;

  return {
    usage_date: usageDate,
    service_description: serviceDescription,
    sku_description: skuDescription,
    net_cost: Number.isFinite(netCost) ? netCost : 0,
    date,
  };
}

function hasCachedDiff() {
  const result = git(["diff", "--cached", "--quiet"], { allowFailure: true });
  return result.status !== 0;
}

function ensureCleanGitState() {
  const result = git(["status", "--porcelain"], { allowFailure: false });
  if (result.stdout.trim().length > 0) {
    throw new BlockedError("git_worktree_not_clean_for_pr");
  }
}

function git(args, options = {}) {
  const env = { ...process.env, GIT_WORK_TREE: REPO_ROOT };
  const gitMetadataPath = path.join(REPO_ROOT, ".git");
  if (existsSync(gitMetadataPath)) {
    const stats = statSync(gitMetadataPath);
    if (stats.isDirectory()) {
      env.GIT_DIR = gitMetadataPath;
    }
  }

  return runCommand(
    "git",
    ["-C", REPO_ROOT, ...args],
    {
      env,
      allowFailure: options.allowFailure ?? false,
      label: `git ${args.join(" ")}`,
      failMessage: `git ${args.join(" ")} failed`,
    }
  );
}

function ensureCommand(command) {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`missing required command: ${command}`);
  }
}

function runJsonCommand(command, args, options = {}) {
  const result = runCommand(command, args, options);
  try {
    return JSON.parse(result.stdout || "[]");
  } catch (error) {
    throw new Error(
      `${options.label ?? `${command} ${args.join(" ")}`} returned invalid JSON`
    );
  }
}

function readTrimmedStdout(command, args, options = {}) {
  return runCommand(command, args, options).stdout.trim();
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(
        `${options.label ?? `${command} ${args.join(" ")}`} timed out after ${
          options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        }ms`
      );
    }
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    const stderr = (result.stderr || result.stdout || "").trim();
    throw new Error(options.failMessage ?? stderr ?? `${command} failed`);
  }

  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeJson(filename, value) {
  writeFileSync(
    path.join(outputDir, filename),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
}

function writeMarkdownReport(report) {
  const lines = [];
  lines.push("# GCP Billing Review");
  lines.push("");
  lines.push(`- Status: \`${report.status}\``);
  lines.push(`- Project: \`${report.projectId ?? "unknown"}\``);
  if (report.windowStart && report.windowEnd) {
    lines.push(`- Window: \`${report.windowStart}\` to \`${report.windowEnd}\` (UTC)`);
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
  lines.push("");

  lines.push("## Service Breakdown");
  lines.push("");
  if (report.serviceBreakdown.length === 0) {
    lines.push("- No service breakdown available.");
  } else {
    for (const service of report.serviceBreakdown) {
      lines.push(
        `- ${service.service}: $${service.recentCost.toFixed(2)} recent, ` +
          `$${service.previousCost.toFixed(2)} previous, ` +
          `${service.sharePct.toFixed(2)}% share`
      );
    }
  }
  lines.push("");

  lines.push("## Top SKU Deltas");
  lines.push("");
  if (report.topSkuBreakdown.length === 0) {
    lines.push("- No SKU breakdown available.");
  } else {
    for (const sku of report.topSkuBreakdown.slice(0, 10)) {
      lines.push(
        `- ${sku.sku}: $${sku.recentCost.toFixed(2)} recent, ` +
          `$${sku.previousCost.toFixed(2)} previous`
      );
    }
  }
  lines.push("");

  lines.push("## Optimization Candidates");
  lines.push("");
  if (report.optimizationCandidates.length === 0) {
    lines.push("- No deterministic repo-local patch candidates were found.");
  } else {
    for (const candidate of report.optimizationCandidates) {
      lines.push(
        `- ${candidate.title} (\`${candidate.actionability}\`): ${candidate.suggestedAction}`
      );
    }
  }

  writeFileSync(path.join(outputDir, "report.md"), `${lines.join("\n")}\n`, "utf8");
}

function printSummary(report) {
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
    `SUMMARY bundle=${outputDir} candidates=${report.optimizationCandidates.length} blocked=${report.blockedReason ?? "none"}`
  );
}

function sumBy(items, iteratee) {
  return items.reduce((total, item) => total + iteratee(item), 0);
}

function roundCurrency(value) {
  return Number.parseFloat(value.toFixed(2));
}

function roundPercent(value) {
  return Number.parseFloat(value.toFixed(2));
}

function addUtcDays(date, deltaDays) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return next;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function formatCompactUtc(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function formatDateYYYYMMDD(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function sqlStringLiteral(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function scoreExportTable(tableId) {
  let score = 0;
  if (/resource/i.test(tableId)) {
    score += 20;
  }
  if (/v1/i.test(tableId)) {
    score += 10;
  }
  if (/cloud/i.test(tableId)) {
    score += 5;
  }
  return score;
}
