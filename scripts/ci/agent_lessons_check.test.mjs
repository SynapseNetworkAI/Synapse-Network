import test from "node:test";
import assert from "node:assert/strict";
import {
  branchSlug,
  lessonPathForBranch,
  resolveBranchName,
  shouldRequireLessons,
  validateLessonContent,
} from "./agent_lessons_check.mjs";

test("branch slug maps slash branch names to stable lesson paths", () => {
  assert.equal(branchSlug("codex/agent-a"), "codex-agent-a");
  assert.equal(
    lessonPathForBranch("feature/SDK Docs + Polish"),
    "docs/reference/agent-lessons/feature-sdk-docs-polish.md"
  );
});

test("branch resolution uses pull request head refs in detached GitHub Actions checkouts", () => {
  assert.equal(
    resolveBranchName({
      env: { GITHUB_HEAD_REF: "codex/agent-a", GITHUB_REF_NAME: "47/merge" },
      gitBranch: "HEAD",
    }),
    "codex/agent-a"
  );
  assert.equal(
    lessonPathForBranch(
      resolveBranchName({
        env: { GITHUB_HEAD_REF: "codex/agent-a" },
        gitBranch: "HEAD",
      })
    ),
    "docs/reference/agent-lessons/codex-agent-a.md"
  );
});

test("explicit branch override wins over GitHub environment and git branch", () => {
  assert.equal(
    resolveBranchName({
      env: {
        AGENT_LESSONS_BRANCH: "manual/override",
        GITHUB_HEAD_REF: "codex/agent-a",
      },
      gitBranch: "main",
    }),
    "manual/override"
  );
});

test("no-new-lessons declaration is valid", () => {
  assert.deepEqual(validateLessonContent("- No new lessons."), {
    ok: true,
    mode: "no-new-lessons",
  });
});

test("complete lesson block is valid", () => {
  const result = validateLessonContent(`
### Lesson: Deleted files must be filtered
- Domain: ci
- Severity: warning
- Trigger: Removed docs files broke path-based scanners.
- Root cause: Deleted paths were passed to Prettier.
- Fix: Use --diff-filter=ACMR.
- Rule: Ignore deleted files unless validating deletion semantics.
- Upgrade: agents-memory
`);

  assert.equal(result.ok, true);
  assert.equal(result.mode, "lesson-block");
  assert.equal(result.lessons, 1);
});

test("empty or placeholder lessons are invalid", () => {
  assert.equal(validateLessonContent("").ok, false);
  assert.equal(validateLessonContent("TODO: fill later").ok, false);
});

test("lesson block requires all structured fields", () => {
  const result = validateLessonContent(`
### Lesson: Partial
- Domain: ci
- Severity: warning
`);

  assert.equal(result.ok, false);
  assert.match(result.reason, /missing required field/i);
});

test("critical and finance lessons require durable upgrade", () => {
  const result = validateLessonContent(`
### Lesson: Money precision bug
- Domain: finance
- Severity: critical
- Trigger: Incorrect money math.
- Root cause: Float conversion.
- Fix: Use Decimal strings.
- Rule: Never use float money math.
- Upgrade: none
`);

  assert.equal(result.ok, false);
  assert.match(result.reason, /must upgrade/i);
});

test("merge-only work does not require lessons", () => {
  assert.equal(
    shouldRequireLessons({ nonMergeCommitCount: 0, hasWorktreeChanges: false }),
    false
  );
  assert.equal(
    shouldRequireLessons({ nonMergeCommitCount: 1, hasWorktreeChanges: false }),
    true
  );
  assert.equal(
    shouldRequireLessons({ nonMergeCommitCount: 0, hasWorktreeChanges: true }),
    true
  );
});
