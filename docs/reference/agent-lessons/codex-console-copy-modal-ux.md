# Agent Lessons: codex-console-copy-modal-ux

Task: Fix user-front console copy, feedback modal behavior, withdraw precision, and logout confirmation.
Status: Active

## Push Review

### Lesson: Merged PR branches must not be reused for follow-up PRs

- Domain: git
- Severity: warning
- Trigger: The follow-up console UX commit was first pushed to a branch whose previous PR was already merged, leaving no active PR target for the new change.
- Root cause: I reused the current working branch without checking whether its GitHub PR was still open before treating the push as a PR update.
- Fix: Created a fresh branch from latest `origin/main` and cherry-picked the validated commit before opening the follow-up PR.
- Rule: Before "submit PR" on an existing branch, check `gh pr view` state; if the PR is merged or closed and the commit is not on `main`, create a new branch from `origin/main` and cherry-pick the intended commit.
- Upgrade: pr-lessons-only
