# Agent Lessons: codex-codex-token-optimization-docs

Task: Add Codex high-frequency token optimization guidance without increasing startup context.
Status: Active

## Push Review

## Lessons

### Lesson: Token-saving guidance should be routed, not copied into bridge files

- Domain: docs
- Severity: warning
- Trigger: Adding high-frequency Codex operating policy could have expanded `AGENTS.md` and increased every session's startup context.
- Root cause: Durable process guidance is useful, but bridge files are loaded broadly and become a recurring token cost.
- Fix: Put the full policy in `docs/reference/Codex_Token_Optimization.md` and add only short routing links to entrypoints and task maps.
- Rule: When guidance is useful but not required for every task, store it in reference docs and link it from the shortest relevant entrypoint.
- Upgrade: agents-memory
