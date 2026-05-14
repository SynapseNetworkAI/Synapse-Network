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

### Lesson: Optional project shards must check dependency files before setup

- Domain: ci
- Severity: warning
- Trigger: Full PR CI selected `sdk_python_checks` in a repository checkout that does not contain `sdk/python/requirements.txt` or `sdk/python/pyproject.toml`.
- Root cause: The workflow started the `sdk-python` job from command scope alone, so `actions/setup-python` failed while resolving a pip cache path for an optional project directory.
- Fix: Gate the `sdk-python` job on both the requested command and the presence of the SDK Python dependency files.
- Rule: Optional CI shards must verify their project directory or dependency manifest exists before invoking language setup/cache actions.
- Upgrade: pr-lessons-only
