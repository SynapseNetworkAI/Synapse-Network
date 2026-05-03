# Agent Lessons: codex-agent-a

Task: Split developer docs into a dedicated app, sync SDK docs, resolve PR conflicts, and add the push lessons gate.
Status: Active

## Push Review

## Lessons

### Lesson: Deleted files must be filtered before path-based CI tools

- Domain: ci
- Severity: warning
- Trigger: Removing legacy docs UI caused formatter and quality gates to receive deleted paths.
- Root cause: Path-based CI scripts used `git diff --name-only` without an active-file diff filter.
- Fix: Filter deleted files before passing paths to tools such as Prettier or Semgrep.
- Rule: Path-based CI scanners must ignore deleted files unless they explicitly validate deletion semantics.
- Upgrade: agents-memory

### Lesson: Shell compatibility matters in one-line repair commands

- Domain: ci
- Severity: warning
- Trigger: A zsh command attempted to use Bash-only `mapfile`, and a later negative test used zsh's read-only `status` variable.
- Root cause: Shell-specific syntax and reserved variables were used in ad hoc validation commands.
- Fix: Restore unintended formatting churn, use shell-compatible file-list handling, and avoid reserved shell variable names.
- Rule: For formatter repair or validation commands, verify the file list is non-empty and avoid shell-specific builtins unless the shell is pinned.
- Upgrade: agents-memory

### Lesson: Push gates must timeout optional git probes

- Domain: ci
- Severity: warning
- Trigger: The new agent lessons gate hung while probing the upstream branch with `git rev-parse @{u}`.
- Root cause: Optional git discovery used synchronous child processes without a timeout, so a local git hang could freeze pre-push.
- Fix: Add a short timeout to every git probe inside the lessons gate and fall back to the next comparison base when optional discovery fails.
- Rule: Pre-push guardrails must put timeouts around optional shell or git probes before running expensive validation.
- Upgrade: agents-memory

### Lesson: Format gates must include newly added files before commit

- Domain: ci
- Severity: warning
- Trigger: Pre-push failed after commit because the earlier format check did not include newly added lesson and CI script files.
- Root cause: The local validation was run before untracked files were staged, so path-based format scope only covered tracked changes.
- Fix: Run Prettier on the newly added files, rerun format checks, and amend the commit before pushing.
- Rule: Before committing new files, stage them or explicitly pass them to formatter and format-check commands.
- Upgrade: agents-memory

### Lesson: New root npm scripts need a CI scope mapping

- Domain: ci
- Severity: warning
- Trigger: Adding `ci:agent-lessons` to `package.json` made pre-push fail closed into full CI and hit unrelated gateway withdrawal E2E failures.
- Root cause: `resolve_pr_ci_scope.mjs` did not know this new script was a narrow guardrail, and all unknown root scripts correctly defaulted to full CI.
- Fix: Add a narrow package-script and CI-tool mapping for `ci:agent-lessons` and `scripts/ci/agent_lessons_check*.mjs`.
- Rule: Every new root `package.json` script must update PR CI scope mapping in the same commit, or the branch should intentionally accept full CI.
- Upgrade: agents-memory

### Lesson: Finance E2E example amounts must track active policy

- Domain: ci
- Severity: warning
- Trigger: Full pre-push CI failed because consumer withdrawal E2E still used a 1 USDC withdrawal after the runtime minimum moved to 10 USDC.
- Root cause: The test kept a historical example amount instead of a named policy constant and treated available balance as immediately withdrawable despite the T+1 maturity window.
- Fix: Update the E2E to use a Decimal 10 USDC minimum, send amount strings over HTTP, skip withdrawal-chain assertions when no funds are mature, and add a gateway bugfix note.
- Rule: Finance E2E tests must use named policy constants for minimums, fees, and maturity windows; do not treat available balance as withdrawable balance.
- Upgrade: bugfix-docs

### Lesson: Do not grow legacy CI coordinator files past budget

- Domain: ci
- Severity: warning
- Trigger: Adding CI scope mapping logic pushed `resolve_pr_ci_scope.mjs` over its quality budget.
- Root cause: New package-script classification was added directly to a legacy coordinator file instead of a focused helper module.
- Fix: Extract package script classification into `resolve_pr_ci_scope_package.mjs`.
- Rule: When touching CI coordinator files near their quality budget, extract cohesive helper logic instead of adding inline branches.
- Upgrade: agents-memory

### Lesson: Prefer local tool binaries before npx in pre-push gates

- Domain: ci
- Severity: warning
- Trigger: `format_check.sh` hung while probing `npx --no-install prettier --version` even though the repository had a local Prettier binary.
- Root cause: The gate checked global Prettier first, then npx, but skipped the deterministic `node_modules/.bin/prettier` path.
- Fix: Prefer `$ROOT_DIR/node_modules/.bin/prettier` before global or npx fallback.
- Rule: Pre-push gates should prefer already-installed local tool binaries and only use npx as a fallback.
- Upgrade: agents-memory
