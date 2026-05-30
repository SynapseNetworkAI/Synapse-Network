# Agent Lessons: codex-prod-free-invoke-discovery-fallback

Task: Make production free-invoke evidence resilient to service-id discovery search misses.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Prod free-invoke discovery must fall back to catalog listing

- Domain: ops
- Severity: warning
- Trigger: `npm run e2e:prod-free-invoke` failed when exact service-id discovery returned no row even though the service existed in the catalog.
- Root cause: The prod discovery search endpoint can rank or filter differently for exact service-id queries than for catalog listing queries.
- Fix: Make the runner retry with an empty catalog search and then exact-match the configured service id locally.
- Rule: Production free-invoke evidence should not rely on a single exact search query when validating an already configured canonical service id.
- Upgrade: not required
