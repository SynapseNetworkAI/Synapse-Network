# Agent Lessons: codex-user-front-copyable-identifiers-followup

Task: Follow up copyable identifiers merge resolution after PR #85 was already merged.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Re-check PR state before assuming a pushed conflict fix updates it

- Domain: git
- Severity: warning
- Trigger: A conflict-resolution push targeted the original copyable identifiers branch after PR #85 had already been merged.
- Root cause: The local branch still accepted pushes, but GitHub no longer treated them as updates to the merged PR's review surface.
- Fix: Check the PR state after pushing conflict-resolution work; when the original PR is already merged, create a follow-up branch and PR for any remaining diff against `main`.
- Rule: Before declaring a conflict fix complete, verify the PR is still open and that `origin/main...HEAD` contains only the intended review diff.
- Upgrade: agents-memory
