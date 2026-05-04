# Agent Lessons: codex-github-actions-node24-runtime

Task: Force GitHub Actions JavaScript actions onto Node 24 and add workflow runtime guardrails.
Status: Active

## Push Review

## Lessons

### Lesson: New CI guard scripts need explicit formatter coverage before staging

- Domain: ci
- Severity: warning
- Trigger: A new untracked `scripts/ci/*.mjs` guard passed the root changed-file format check scope but failed when checked directly with Prettier.
- Root cause: The root format gate only inspected tracked changed files, so a newly added untracked script could escape until staging or commit time.
- Fix: Run Prettier directly on the new guard script before staging, then rerun `npm run ci:format-check`.
- Rule: Newly added CI scripts must be explicitly Prettier-checked before commit, even if the changed-file format gate is already green.
- Upgrade: agents-memory
