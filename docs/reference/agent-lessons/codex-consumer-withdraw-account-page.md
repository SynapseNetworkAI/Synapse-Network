# Agent Lessons: codex-consumer-withdraw-account-page

Task: Split Consumer withdraw into Account and keep withdrawal UX business-safe.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Branch renames need matching PR lessons files

- Domain: ci
- Severity: warning
- Trigger: The original feature branch was already tied to a merged PR, so the work was pushed on a new branch, but CI looked for the new branch-specific lessons file.
- Root cause: The publish flow reused the previous branch lesson file after creating `codex/consumer-withdraw-account-page`.
- Fix: Add a lessons file for the new branch slug and keep the existing lesson record reviewable.
- Rule: Whenever a PR is moved to a new branch, create or copy the branch-specific `docs/reference/agent-lessons/<branch-slug>.md` before pushing.
- Upgrade: agents-memory
