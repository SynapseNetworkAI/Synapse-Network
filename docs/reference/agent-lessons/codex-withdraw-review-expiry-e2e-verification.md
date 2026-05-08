# Agent Lessons: codex-withdraw-review-expiry-e2e-verification

Task: Add withdrawal review expiry visibility and local E2E evidence coverage.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Verify local admin ports belong to the active worktree before trusting E2E evidence

- Domain: e2e
- Severity: warning
- Trigger: Admin withdrawal-review E2E showed stale API/schema behavior even though the current branch code had already changed.
- Root cause: Port `3200` and `8300` were being served by a sibling Synapse worktree, so DOM and API evidence came from the wrong checkout.
- Fix: Before running admin withdrawal-review gates, confirm the cwd behind `3200` and `8300`, or restart the local app stack from the active worktree first.
- Rule: If admin-front or gateway-admin evidence looks one schema behind, verify port ownership before debugging the application logic.
- Upgrade: agents-memory
