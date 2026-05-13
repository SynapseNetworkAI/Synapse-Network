#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const OUT_ROOT = path.join(ROOT, "output", "weekly-hygiene");
const now = new Date();
const timestamp = now
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");
const args = new Set(process.argv.slice(2));
const dryRun =
  args.has("--dry-run") || process.env.WEEKLY_HYGIENE_DRY_RUN === "1";
const applyCleanup =
  args.has("--apply-cleanup") ||
  process.env.WEEKLY_HYGIENE_APPLY_CLEANUP === "1";
const commandTimeoutMs = Number(
  process.env.WEEKLY_HYGIENE_COMMAND_TIMEOUT_MS || "900000"
);
const outDir = path.join(OUT_ROOT, timestamp);

const CHECKS = [
  ["code-quality-budget", "npm", ["run", "ci:quality-budget"], "code"],
  [
    "code-architecture-quality",
    "npm",
    ["run", "ci:architecture-quality"],
    "code",
  ],
  ["code-format-check", "npm", ["run", "ci:format-check"], "code"],
  ["code-diff-coverage", "npm", ["run", "ci:diff-coverage"], "code"],
  ["docs-governance", "npm", ["run", "ci:docs"], "docs"],
  [
    "money-state-idempotency",
    "npm",
    ["run", "ci:state-idempotency-safety"],
    "finance",
  ],
  [
    "money-finance-approval",
    "npm",
    ["run", "ci:finance-approval-safety"],
    "finance",
  ],
  [
    "schema-created-at-indexes",
    "npm",
    ["run", "ci:created-at-indexes"],
    "finance",
  ],
  [
    "evidence-withdrawal-idempotency",
    "npm",
    ["run", "ci:withdrawal-idempotency-concurrency-evidence"],
    "evidence",
  ],
  [
    "evidence-admin-regression",
    "npm",
    ["run", "ci:admin-regression-evidence"],
    "evidence",
  ],
  [
    "evidence-user-front-deposit-balance",
    "npm",
    ["run", "ci:user-front-deposit-balance-evidence"],
    "evidence",
  ],
  [
    "evidence-admin-pagination-sorting",
    "npm",
    ["run", "ci:admin-pagination-sorting-evidence"],
    "evidence",
  ],
  [
    "evidence-backup-restore",
    "npm",
    ["run", "ci:backup-restore-evidence"],
    "evidence",
  ],
];

const CLEANUP_TARGETS = [
  { rel: "output", retentionDays: 14, mode: "ignored-generated" },
  { rel: "coverage", retentionDays: 7, mode: "ignored-generated" },
  { rel: "coverage.xml", retentionDays: 7, mode: "ignored-generated" },
  { rel: "coverage.json", retentionDays: 7, mode: "ignored-generated" },
  { rel: ".coverage", retentionDays: 7, mode: "ignored-generated" },
  {
    rel: "services/user-front/.next",
    retentionDays: 3,
    mode: "ignored-generated",
  },
  {
    rel: "services/admin-front/.next",
    retentionDays: 3,
    mode: "ignored-generated",
  },
  {
    rel: "services/docs-front/.next",
    retentionDays: 3,
    mode: "ignored-generated",
  },
  {
    rel: "services/gateway/coverage.xml",
    retentionDays: 7,
    mode: "ignored-generated",
  },
  {
    rel: "services/gateway-admin/coverage.xml",
    retentionDays: 7,
    mode: "ignored-generated",
  },
];

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function redact(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "postgresql://[REDACTED_DSN]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(
      /\b(?:sk|pk|agt|ghp|github_pat)_[A-Za-z0-9_=-]{16,}\b/g,
      "[REDACTED_TOKEN]"
    )
    .replace(/\b0x[a-fA-F0-9]{64}\b/g, "[REDACTED_HEX_64]")
    .replace(
      /(password|secret|token|private[_-]?key)=([^\s&]+)/gi,
      "$1=[REDACTED]"
    );
}

function rel(filePath) {
  return path.relative(ROOT, filePath) || ".";
}

function statSafe(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function bytesOf(filePath) {
  const st = statSafe(filePath);
  if (!st) return 0;
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    total += bytesOf(path.join(filePath, entry.name));
  }
  return total;
}

function ageDays(st) {
  return st ? (Date.now() - st.mtimeMs) / 86_400_000 : 0;
}

function skippedCommandResult() {
  return {
    status: "skipped",
    exitCode: 0,
    durationMs: 0,
    stdoutTail: "",
    stderrTail: "dry-run: command not executed",
  };
}

function spawnCommand(command, commandArgs, options) {
  return spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: options.timeoutMs || commandTimeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });
}

function exitCodeFor(result) {
  if (result.status !== null && result.status !== undefined)
    return result.status;
  return result.signal ? 124 : 1;
}

function run(command, commandArgs, options = {}) {
  if (dryRun && options.skipInDryRun !== false) {
    return skippedCommandResult();
  }
  const started = Date.now();
  const result = spawnCommand(command, commandArgs, options);
  const exitCode = exitCodeFor(result);
  return {
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    signal: result.signal || null,
    durationMs: Date.now() - started,
    stdoutTail: tail(redact(result.stdout || "")),
    stderrTail: tail(redact(result.stderr || result.error?.message || "")),
  };
}

function tail(text, max = 6000) {
  return text.length > max ? text.slice(text.length - max) : text;
}

function cleanupAction({ currentAgeDays, retentionDays, tracked }) {
  if (tracked) {
    return {
      action: "report-only",
      reason: "tracked paths are never deleted by weekly hygiene",
    };
  }
  if (currentAgeDays < retentionDays) {
    return { action: "report-only", reason: "below retention window" };
  }
  return {
    action: applyCleanup ? "deleted" : "candidate",
    reason: applyCleanup
      ? "ignored/generated allowlist cleanup applied"
      : "ignored/generated allowlist cleanup candidate",
  };
}

function cleanupCandidate({ target, candidatePath, st, tracked }) {
  const currentAgeDays = ageDays(st);
  const plan = cleanupAction({
    currentAgeDays,
    retentionDays: target.retentionDays,
    tracked,
  });
  return {
    path: candidatePath,
    mode: target.mode,
    retentionDays: target.retentionDays,
    ageDays: Number(currentAgeDays.toFixed(2)),
    sizeBytes: bytesOf(path.join(ROOT, candidatePath)),
    tracked,
    ...plan,
  };
}

function outputChildCandidates(target, absolute) {
  const candidates = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(absolute, entry.name);
    const childRel = rel(child);
    if (childRel === rel(outDir)) continue;
    const childSt = statSafe(child);
    if (!childSt) continue;
    const candidate = cleanupCandidate({
      target,
      candidatePath: childRel,
      st: childSt,
      tracked: false,
    });
    if (candidate.action !== "candidate" && candidate.action !== "deleted") {
      continue;
    }
    if (applyCleanup) fs.rmSync(child, { recursive: true, force: true });
    candidates.push(candidate);
  }
  return candidates;
}

function targetCleanupCandidates(target) {
  const absolute = path.join(ROOT, target.rel);
  const st = statSafe(absolute);
  if (!st) return [];
  if (target.rel === "output" && st.isDirectory()) {
    return outputChildCandidates(target, absolute);
  }
  const candidate = cleanupCandidate({
    target,
    candidatePath: target.rel,
    st,
    tracked: isTracked(target.rel),
  });
  if (candidate.action === "deleted") {
    fs.rmSync(absolute, { recursive: true, force: true });
  }
  return [candidate];
}

function collectCleanupCandidates() {
  return CLEANUP_TARGETS.flatMap((target) => targetCleanupCandidates(target));
}

function isTracked(relativePath) {
  const result = spawnSync(
    "git",
    ["ls-files", "--error-unmatch", relativePath],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }
  );
  return result.status === 0;
}

function collectTrackedEvidenceCandidates() {
  const evidenceRoot = path.join(ROOT, "docs", "evidence");
  if (!fs.existsSync(evidenceRoot)) return [];
  const entries = [];
  const stack = [evidenceRoot];
  while (stack.length > 0 && entries.length < 100) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(dir, entry.name);
      stack.push(absolute);
      const candidate = trackedEvidenceCandidate(absolute);
      if (candidate) entries.push(candidate);
    }
  }
  return entries.sort((a, b) => b.ageDays - a.ageDays).slice(0, 25);
}

function trackedEvidenceCandidate(absolute) {
  const st = statSafe(absolute);
  if (!st) return null;
  const currentAgeDays = ageDays(st);
  if (currentAgeDays <= 30 || !isTracked(rel(absolute))) return null;
  return {
    path: rel(absolute),
    ageDays: Number(currentAgeDays.toFixed(2)),
    sizeBytes: bytesOf(absolute),
    action: "report-only",
    reason: "tracked evidence requires human review before deletion",
  };
}

function collectGitHygiene() {
  const branches = run(
    "git",
    [
      "for-each-ref",
      "refs/remotes/origin",
      "--format=%(refname:short)|%(committerdate:iso8601)|%(authorname)",
    ],
    { skipInDryRun: false, timeoutMs: 5000 }
  );
  const staleBranches = [];
  if (branches.status === "passed") {
    for (const line of branches.stdoutTail.split("\n")) {
      const [name, date, author] = line.split("|");
      if (!name || /origin\/(HEAD|main)$/.test(name)) continue;
      const age = (Date.now() - Date.parse(date)) / 86_400_000;
      if (Number.isFinite(age) && age > 30) {
        staleBranches.push({
          name,
          lastCommitAt: date,
          author: redact(author),
          ageDays: Number(age.toFixed(2)),
        });
      }
    }
  }

  const prList = run(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,updatedAt,mergeStateStatus,url",
    ],
    { timeoutMs: 20000 }
  );
  let stalePullRequests = [];
  if (prList.status === "passed") {
    try {
      stalePullRequests = JSON.parse(prList.stdoutTail)
        .map((pr) => ({
          number: pr.number,
          title: redact(pr.title),
          updatedAt: pr.updatedAt,
          mergeStateStatus: pr.mergeStateStatus,
          url: pr.url,
          ageDays: Number(
            ((Date.now() - Date.parse(pr.updatedAt)) / 86_400_000).toFixed(2)
          ),
        }))
        .filter((pr) => pr.ageDays > 7 || pr.mergeStateStatus === "DIRTY");
    } catch {
      stalePullRequests = [];
    }
  }
  return {
    staleBranches: staleBranches.slice(0, 25),
    stalePullRequests: stalePullRequests.slice(0, 25),
  };
}

function writeMarkdown(report) {
  const lines = [
    `# Weekly Hygiene Report: ${report.generatedAt.slice(0, 10)}`,
    "",
    `- Status: ${report.status}`,
    `- Dry run: ${report.dryRun}`,
    `- Failed checks: ${report.summary.failedChecks}`,
    `- Cleanup candidates: ${report.summary.cleanupCandidates}`,
    `- Tracked evidence candidates: ${report.summary.trackedEvidenceCandidates}`,
    "",
    "## Failed Checks",
    "",
  ];
  const failed = report.commandResults.filter(
    (item) => item.status === "failed"
  );
  if (failed.length === 0) {
    lines.push("None.");
  } else {
    for (const item of failed) {
      lines.push(`- ${item.id} (${item.group}) exit=${item.exitCode}`);
    }
  }
  lines.push("", "## Cleanup Candidates", "");
  for (const item of report.cleanupCandidates.filter(
    (c) => c.action === "candidate" || c.action === "deleted"
  )) {
    lines.push(
      `- ${item.path}: ${item.action}, ${item.ageDays}d, ${item.sizeBytes} bytes`
    );
  }
  if (!lines.at(-1)?.startsWith("- ")) lines.push("None.");
  lines.push("", "## GitHub Hygiene", "");
  for (const pr of report.githubHygiene.stalePullRequests) {
    lines.push(
      `- PR #${pr.number}: ${pr.mergeStateStatus}, ${pr.ageDays}d stale, ${pr.url}`
    );
  }
  if (!lines.at(-1)?.startsWith("- ")) lines.push("None.");
  return `${redact(lines.join("\n"))}\n`;
}

mkdirp(outDir);
const commandResults = CHECKS.map(([id, command, commandArgs, group]) => ({
  id,
  group,
  command: `${command} ${commandArgs.join(" ")}`,
  ...run(command, commandArgs),
}));
const cleanupCandidates = collectCleanupCandidates();
const trackedEvidenceCandidates = collectTrackedEvidenceCandidates();
const githubHygiene = collectGitHygiene();
const failedChecks = commandResults.filter(
  (item) => item.status === "failed"
).length;
const warningCount =
  cleanupCandidates.filter((item) => item.action === "candidate").length +
  trackedEvidenceCandidates.length +
  githubHygiene.staleBranches.length +
  githubHygiene.stalePullRequests.length;
const status =
  failedChecks > 0 || warningCount > 0 ? "attention_required" : "success";
const report = {
  schemaVersion: "weekly-hygiene:v1",
  generatedAt: now.toISOString(),
  runId: timestamp,
  mode: "report+issue",
  dryRun,
  applyCleanup,
  status,
  issueRequired: !dryRun && status !== "success",
  summary: {
    failedChecks,
    warnings: warningCount,
    cleanupCandidates: cleanupCandidates.filter(
      (item) => item.action === "candidate"
    ).length,
    trackedEvidenceCandidates: trackedEvidenceCandidates.length,
  },
  commandResults,
  cleanupCandidates,
  trackedEvidenceCandidates,
  githubHygiene,
  safety: {
    productionMutationAllowed: false,
    trackedDeletionAllowed: false,
    dbCleanupRequiresExplicitConfirmation: true,
  },
};
const markdown = writeMarkdown(report);
fs.writeFileSync(
  path.join(outDir, "report.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
fs.writeFileSync(path.join(outDir, "report.md"), markdown);
fs.writeFileSync(path.join(outDir, "issue.md"), markdown);
fs.writeFileSync(
  path.join(OUT_ROOT, "latest.json"),
  `${JSON.stringify({ reportDir: rel(outDir) }, null, 2)}\n`
);
console.log(`[weekly-hygiene] report=${rel(outDir)}`);
console.log(
  `[weekly-hygiene] status=${status} failedChecks=${failedChecks} warnings=${warningCount}`
);
