#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);

const REQUIRED_LESSON_FIELDS = [
  "Domain",
  "Severity",
  "Trigger",
  "Root cause",
  "Fix",
  "Rule",
  "Upgrade",
];

export function branchSlug(branchName) {
  const slug = String(branchName || "")
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "detached-head";
}

export function lessonPathForBranch(branchName) {
  return `docs/reference/agent-lessons/${branchSlug(branchName)}.md`;
}

export function validateLessonContent(content) {
  const text = String(content || "");
  if (!text.trim()) {
    return { ok: false, reason: "lesson file is empty" };
  }
  if (/\b(TODO|TBD|PLACEHOLDER|FIXME)\b/i.test(text)) {
    return { ok: false, reason: "lesson file contains placeholder text" };
  }

  if (/\bNo new lessons\./i.test(text)) {
    return { ok: true, mode: "no-new-lessons" };
  }

  const lessonBlocks = text
    .split(/^###\s+Lesson:\s+/m)
    .slice(1)
    .map((block) => block.trim())
    .filter(Boolean);

  if (lessonBlocks.length === 0) {
    return {
      ok: false,
      reason:
        "lesson file must contain `No new lessons.` or at least one `### Lesson:` block",
    };
  }

  for (const [index, block] of lessonBlocks.entries()) {
    for (const field of REQUIRED_LESSON_FIELDS) {
      const fieldPattern = new RegExp(
        `^-\\s*${escapeRegExp(field)}:\\s*\\S`,
        "im"
      );
      if (!fieldPattern.test(block)) {
        return {
          ok: false,
          reason: `lesson ${index + 1} is missing required field: ${field}`,
        };
      }
    }

    const domain = fieldValue(block, "Domain").toLowerCase();
    const severity = fieldValue(block, "Severity").toLowerCase();
    const upgrade = fieldValue(block, "Upgrade").toLowerCase();
    const needsDurableUpgrade =
      severity === "critical" ||
      /(^|[^a-z])(finance|security|money)([^a-z]|$)/i.test(domain);

    if (
      needsDurableUpgrade &&
      /^(none|pr-lessons-only|local-only)$/i.test(upgrade)
    ) {
      return {
        ok: false,
        reason:
          "critical, finance, security, or money lessons must upgrade to Agents-Memory or bugfix docs",
      };
    }
  }

  return { ok: true, mode: "lesson-block", lessons: lessonBlocks.length };
}

export function shouldRequireLessons({
  nonMergeCommitCount,
  hasWorktreeChanges,
}) {
  return Number(nonMergeCommitCount) > 0 || Boolean(hasWorktreeChanges);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldValue(block, field) {
  const match = block.match(
    new RegExp(`^-\\s*${escapeRegExp(field)}:\\s*(.+)$`, "im")
  );
  return match ? match[1].trim() : "";
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "pipe"],
    timeout: Number(process.env.AGENT_LESSONS_GIT_TIMEOUT_MS || 5000),
    killSignal: "SIGKILL",
  }).trim();
}

function tryGit(args) {
  try {
    return git(args, { quiet: true });
  } catch {
    return "";
  }
}

function currentBranch() {
  const override = process.env.AGENT_LESSONS_BRANCH;
  if (override) return override;
  return tryGit(["rev-parse", "--abbrev-ref", "HEAD"]) || "detached-head";
}

function comparisonBase() {
  const override = process.env.AGENT_LESSONS_BASE_REF;
  if (override) return override;

  const upstream = tryGit([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  if (upstream) return upstream;

  const originMain = tryGit(["rev-parse", "--verify", "origin/main"]);
  if (originMain) {
    return tryGit(["merge-base", "origin/main", "HEAD"]) || "origin/main";
  }

  return "";
}

function commitsSince(base) {
  if (!base) return [];
  const output = tryGit(["log", "--format=%H%x09%P%x09%s", `${base}..HEAD`]);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}

function nonMergeCommitCount(commits) {
  return commits.filter((line) => {
    const [, parents = ""] = line.split("\t");
    return parents.trim().split(/\s+/).filter(Boolean).length <= 1;
  }).length;
}

function hasWorktreeChanges() {
  return Boolean(tryGit(["status", "--short"]));
}

function fail(message, lessonPath) {
  console.error(`FATAL AGENT-LESSONS-001: ${message}`);
  console.error(
    "Why dangerous: repeated agent mistakes stay invisible and keep resurfacing in later pushes."
  );
  console.error(
    `Agent fix: create or update ${lessonPath} with either \`No new lessons.\` or a structured \`### Lesson:\` block, then rerun npm run ci:agent-lessons.`
  );
  process.exit(1);
}

function main() {
  const branch = currentBranch();
  const base = comparisonBase();
  const commits = commitsSince(base);
  const nonMergeCount = nonMergeCommitCount(commits);
  const dirty = hasWorktreeChanges();
  const lessonPath =
    process.env.AGENT_LESSONS_FILE || lessonPathForBranch(branch);
  const absoluteLessonPath = resolve(REPO_ROOT, lessonPath);

  if (
    !shouldRequireLessons({
      nonMergeCommitCount: nonMergeCount,
      hasWorktreeChanges: dirty,
    })
  ) {
    console.log("[agent-lessons] no non-merge branch work to review");
    return;
  }

  if (!existsSync(absoluteLessonPath)) {
    fail(
      `missing agent lessons file for branch ${branch}: ${lessonPath}`,
      lessonPath
    );
  }

  const validation = validateLessonContent(
    readFileSync(absoluteLessonPath, "utf8")
  );
  if (!validation.ok) {
    fail(
      `${basename(lessonPath)} is invalid: ${validation.reason}`,
      lessonPath
    );
  }

  console.log(
    `[agent-lessons] ${lessonPath} ok (${validation.mode}; nonMergeCommits=${nonMergeCount}; dirty=${dirty})`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
