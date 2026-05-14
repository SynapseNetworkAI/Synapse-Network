#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BlockedError,
  formatCompactUtc,
} from "./gcp_billing_review_common.mjs";
import {
  loadBillingDataset,
  loadFixture,
  runPreflight,
  summarizeBillingRows,
} from "./gcp_billing_review_billing.mjs";
import {
  buildRepoPatchPlan,
  deriveOptimizationCandidates,
  maybeCreatePullRequest,
} from "./gcp_billing_review_repo.mjs";
import {
  printSummary,
  writeJson,
  writeMarkdownReport,
} from "./gcp_billing_review_report.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(
  process.env.REPO_ROOT ?? path.join(__dirname, "..", "..")
);
const REPORT_ROOT = path.join(REPO_ROOT, "docs", "evidence", "cost");
const NOW = new Date();
const WINDOW_DAYS = Number.parseInt(
  process.env.GCP_BILLING_WINDOW_DAYS ?? "7",
  10
);
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

  const preflight = runPreflight({
    fixturePath: FIXTURE_PATH,
    env: process.env,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  });
  state.projectId = preflight.projectId;

  const dataset = FIXTURE_PATH
    ? loadFixture(FIXTURE_PATH, state.projectId)
    : loadBillingDataset({
        projectId: state.projectId,
        env: process.env,
        windowDays: WINDOW_DAYS,
        comparisonDays: COMPARISON_DAYS,
      });

  state.exportTable = dataset.exportTable;

  const summary = summarizeBillingRows(dataset.rows, {
    now: NOW,
    windowDays: WINDOW_DAYS,
    comparisonDays: COMPARISON_DAYS,
  });
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

  writeJson(outputDir, "raw-billing-summary.json", {
    projectId: state.projectId,
    generatedAt: state.generatedAt,
    exportTable: state.exportTable,
    rows: dataset.rows,
    summary,
  });
  writeJson(
    outputDir,
    "optimization-candidates.json",
    state.optimizationCandidates
  );

  const repoPatchPlan = buildRepoPatchPlan(
    summary,
    state.optimizationCandidates,
    NOW
  );
  if (repoPatchPlan.patches.length > 0 && CREATE_PR) {
    const prResult = maybeCreatePullRequest({
      plan: repoPatchPlan,
      summary,
      candidates: state.optimizationCandidates,
      repoRoot: REPO_ROOT,
      dryRun: DRY_RUN,
      env: process.env,
    });
    state.prCreated = prResult.created;
    state.prUrl = prResult.prUrl;
  }
} catch (error) {
  if (error instanceof BlockedError) {
    state.status = "blocked";
    state.blockedReason = error.message;
  } else {
    state.status = "failed";
    state.blockedReason =
      error instanceof Error ? error.message : String(error);
  }
} finally {
  writeJson(outputDir, "report.json", state);
  writeJson(
    outputDir,
    "optimization-candidates.json",
    state.optimizationCandidates
  );
  writeMarkdownReport(outputDir, state);
  printSummary(outputDir, state);
}

if (state.status === "blocked") {
  process.exitCode = 3;
} else if (state.status === "failed") {
  process.exitCode = 1;
}
