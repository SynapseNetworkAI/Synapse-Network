import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  BlockedError,
  formatDateYYYYMMDD,
  readTrimmedStdout,
  roundCurrency,
  runCommand,
} from "./gcp_billing_review_common.mjs";

export function deriveOptimizationCandidates(summary) {
  const candidates = summary.serviceBreakdown.flatMap(candidatesForService);
  const spikeCandidate = buildWeeklySpikeCandidate(summary);
  if (spikeCandidate) {
    candidates.push(spikeCandidate);
  }
  return candidates;
}

export function buildRepoPatchPlan(summary, candidates, now) {
  const patches = candidates
    .filter((candidate) => candidate.actionability === "repo_patch")
    .map((candidate) => candidate.patchPlan)
    .filter(Boolean);

  return {
    branchName: `codex/gcp-billing-review-${formatDateYYYYMMDD(now)}`,
    commitMessage: "[codex] Optimize GCP cost controls from weekly billing review",
    prTitle: "[codex] Optimize GCP cost controls from weekly billing review",
    patches,
    summary,
  };
}

export function maybeCreatePullRequest({
  plan,
  summary,
  candidates,
  repoRoot,
  dryRun,
  env,
}) {
  if (plan.patches.length === 0) {
    return { created: false, prUrl: null };
  }

  const git = createGitClient(repoRoot, env);
  ensureCleanGitState(git);

  for (const patch of plan.patches) {
    applyRepoPatch(repoRoot, patch);
  }

  const touchedPaths = [...new Set(plan.patches.map((patch) => patch.path))];
  if (touchedPaths.length === 0 || dryRun) {
    return { created: false, prUrl: null };
  }

  git(["checkout", "-B", plan.branchName]);
  git(["add", "--", ...touchedPaths]);
  if (!hasCachedDiff(git)) {
    return { created: false, prUrl: null };
  }

  git(["commit", "-m", plan.commitMessage]);
  git(["push", "-u", "origin", plan.branchName]);

  const prUrl = readTrimmedStdout(
    "gh",
    [
      "pr",
      "create",
      "--title",
      plan.prTitle,
      "--body",
      buildPullRequestBody(summary, candidates),
      "--base",
      "main",
      "--head",
      plan.branchName,
    ],
    {
      env,
      cwd: repoRoot,
      label: "gh pr create",
      failMessage: "failed to create pull request",
      timeoutMs: 120000,
    }
  );

  return { created: true, prUrl };
}

function candidatesForService(service) {
  const lower = service.service.toLowerCase();
  return [
    buildCloudRunCandidate(service, lower),
    buildLoggingCandidate(service, lower),
    buildSchedulerCandidate(service, lower),
    buildCloudSqlCandidate(service, lower),
  ].filter(Boolean);
}

function buildCloudRunCandidate(service, lower) {
  if (!lower.includes("cloud run") || service.sharePct < 35) {
    return null;
  }
  return manualCandidate(
    "cloud-run-rightsize-review",
    "Review Cloud Run right-sizing and idle posture",
    service,
    "Inspect staging/prod Cloud Run min instances, CPU, memory, and concurrency before changing live capacity. This repo can only auto-patch when a specific safe config delta is confirmed."
  );
}

function buildLoggingCandidate(service, lower) {
  const isObservability = lower.includes("logging") || lower.includes("monitoring");
  if (!isObservability || service.sharePct < 10) {
    return null;
  }
  return manualCandidate(
    "logging-retention-sampling-review",
    "Review logging volume and retention",
    service,
    "Check debug-log volume, retention windows, and logs-based metrics. Prefer reducing noisy staging logs before touching production observability."
  );
}

function buildSchedulerCandidate(service, lower) {
  if (!lower.includes("scheduler") || service.recentCost < 0.2) {
    return null;
  }
  return manualCandidate(
    "scheduler-cadence-review",
    "Review Scheduler cadence against current staging load",
    service,
    "Verify current Cloud Scheduler cadence still matches low-traffic staging assumptions before tightening intervals further."
  );
}

function buildCloudSqlCandidate(service, lower) {
  const looksSql = lower.includes("sql");
  if (!looksSql || service.sharePct < 25 || service.deltaCost < 1) {
    return null;
  }
  return {
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
  };
}

function manualCandidate(id, title, service, suggestedAction) {
  return {
    id,
    title,
    actionability: "manual",
    evidence: {
      service: service.service,
      recentCost: service.recentCost,
      previousCost: service.previousCost,
      sharePct: service.sharePct,
    },
    suggestedAction,
  };
}

function buildWeeklySpikeCandidate(summary) {
  const total = summary.totalCost ?? 0;
  const previousTotal = summary.previousTotalCost ?? 0;
  if (total <= 0 || previousTotal <= 0 || total <= previousTotal * 1.3) {
    return null;
  }
  return {
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
  };
}

function applyRepoPatch(repoRoot, patch) {
  if (patch.type !== "update-file") {
    throw new Error(`unsupported repo patch type: ${patch.type}`);
  }

  const absolutePath = path.resolve(repoRoot, patch.path);
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
  return [
    `Billing window: ${summary.windowStart} to ${summary.windowEnd} (UTC)`,
    "",
    "Cost evidence summary:",
    ...formatTopServiceLines(summary),
    "",
    "Why this PR exists:",
    "This weekly billing review found at least one repo-local optimization that can be applied safely without changing irreversible production state.",
    "",
    "Optimization items:",
    ...formatCandidateLines(candidates),
    "",
    "Validation commands:",
    "- bash scripts/ops/gcp_billing_review.sh",
    "- npm run ci:docs",
    "",
    "Uncovered risks:",
    "- This automation only patches repo-local config or docs. Console-only billing changes and SLA-sensitive capacity reductions still need human review.",
  ].join("\n");
}

function formatTopServiceLines(summary) {
  const lines = summary.serviceBreakdown.slice(0, 3).map(
    (service) =>
      `- ${service.service}: $${service.recentCost.toFixed(2)} (${service.sharePct.toFixed(2)}%)`
  );
  return lines.length > 0 ? lines : ["- No service breakdown available"];
}

function formatCandidateLines(candidates) {
  const lines = candidates.map(
    (candidate) => `- ${candidate.title}: ${candidate.suggestedAction}`
  );
  return lines.length > 0 ? lines : ["- No optimization items recorded"];
}

function createGitClient(repoRoot, env) {
  const gitEnv = buildGitEnv(repoRoot, env);
  return (args, options = {}) =>
    runCommand("git", ["-C", repoRoot, ...args], {
      cwd: repoRoot,
      env: gitEnv,
      allowFailure: options.allowFailure ?? false,
      label: `git ${args.join(" ")}`,
      failMessage: `git ${args.join(" ")} failed`,
    });
}

function buildGitEnv(repoRoot, env) {
  const gitEnv = { ...env, GIT_WORK_TREE: repoRoot };
  const gitMetadataPath = path.join(repoRoot, ".git");
  if (existsSync(gitMetadataPath) && statSync(gitMetadataPath).isDirectory()) {
    gitEnv.GIT_DIR = gitMetadataPath;
  }
  return gitEnv;
}

function ensureCleanGitState(git) {
  const result = git(["status", "--porcelain"]);
  if (result.stdout.trim().length > 0) {
    throw new BlockedError("git_worktree_not_clean_for_pr");
  }
}

function hasCachedDiff(git) {
  const result = git(["diff", "--cached", "--quiet"], { allowFailure: true });
  return result.status !== 0;
}
