# Agent Lessons: codex-admin-pagination-created-desc

Task: Enforce Admin pagination default created-at ordering with API, DOM, screenshot, SQL, and index evidence.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Admin pagination E2E must prove the backend sort, not just the screenshot

- Domain: admin-console
- Severity: warning
- Trigger: Adding a regression for Admin list pages that should default to `created_at DESC`.
- Root cause: Existing visual checks could pass while API adapters still sorted provider services by `updatedAt` or forum topics by pinned/activity metadata.
- Fix: Add a dedicated local E2E that seeds adversarial rows, verifies API order, SQL order, DOM first-screen order, screenshot metadata, and created-at index evidence.
- Rule: Admin list ordering regressions need backend-owned API and SQL assertions before screenshots count as evidence.
- Upgrade: not required
