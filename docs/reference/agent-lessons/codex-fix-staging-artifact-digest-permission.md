# Agent Lessons: codex-fix-staging-artifact-digest-permission

Task: Fix staging deploy digest lookup when Artifact Registry describe requires Container Analysis permissions.
Status: Active

## Push Review

- Lesson recorded below.

## Lessons

### Lesson: Staging deploy digest lookup should avoid Container Analysis permissions

- Domain: ci
- Severity: warning
- Trigger: GitHub Actions staging deploy logged `containeranalysis.occurrences.list` permission errors while resolving an Artifact Registry image digest.
- Root cause: The workflow used `gcloud artifacts docker images describe` even though the deployer only needed the Docker manifest digest.
- Fix: Resolve pushed image digests through the Artifact Registry Docker Registry manifest endpoint and keep tag fallback controlled.
- Rule: Deploy workflows should not require vulnerability occurrence permissions unless they explicitly read vulnerability or provenance data.
- Upgrade: pr-lessons-only

### Lesson: CSV workflow scopes need exact token matching

- Domain: ci
- Severity: warning
- Trigger: A `gateway-admin` staging deploy ran the Gateway drift guard because `contains(services, 'gateway')` also matched `gateway-admin`.
- Root cause: The workflow treated a comma-separated service list as a free-text string instead of matching exact service tokens.
- Fix: Wrap the CSV with commas and check for `,gateway,` so `gateway-admin` does not trigger Gateway-only checks.
- Rule: GitHub Actions conditions over CSV fields must match delimited tokens, not substrings.
- Upgrade: pr-lessons-only
