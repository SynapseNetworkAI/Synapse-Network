# Agent Lessons: codex-actions-cost-pr-gates-v3

Task: Optimize GitHub Actions cost with affected-scope PR gates and local fast pre-push checks.
Status: Active

## Push Review

- See lesson below.

## Lessons

### Lesson: Git hook tests must clear inherited GIT environment before using fixture repos

- Domain: ci
- Severity: warning
- Trigger: `pre-push` ran `resolve_pr_ci_scope.test.mjs`; fixture git commands inherited hook `GIT_*` variables and created `base/change` commits in the real worktree instead of the temp repo.
- Root cause: The test used `cwd` for fixture git commands but did not scrub Git hook environment variables such as `GIT_DIR` / `GIT_WORK_TREE`.
- Fix: Clear inherited `GIT_*` variables for fixture subprocesses.
- Rule: Tests that create nested git repositories must remove inherited Git hook environment before running `git` or nested `node` commands.
- Upgrade: agents-memory
