# Agent Lessons: codex-admin-front-rewrite-modular

Task: Rewrite and modularize the Admin-front control console.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Restore docs-front API reference after admin-front E2E/build

- Domain: frontend
- Severity: info
- Trigger: Running admin-front local E2E or production build in this worktree.
- Root cause: The local service flow can regenerate `services/docs-front/src/data/api-reference.json` as incidental docs-front output while the PR only owns admin-front changes.
- Fix: Restore `services/docs-front/src/data/api-reference.json` before staging admin-front-only work.
- Rule: Admin-front PRs must inspect generated docs-front drift after local E2E/build and keep unrelated generated artifacts out of the commit.
- Upgrade: not required
