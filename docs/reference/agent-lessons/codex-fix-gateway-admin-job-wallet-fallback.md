# Agent Lessons: codex-fix-gateway-admin-job-wallet-fallback

Task: Make gateway-admin staging job sync preserve its existing admin wallet env.
Status: Active

## Lessons

### Lesson: Cloud Run Job sync should preserve existing non-secret env

- Domain: staging deploy
- Severity: warning
- Trigger: `gateway-admin` staging deploy failed because the local release runner checkout did not have `GATEWAY_INTERNAL_ADMIN_WALLET`, even though the existing Cloud Run migration job already had that env configured.
- Root cause: The job sync script required local env for a stable non-secret value instead of reading and preserving the value from the current Cloud Run Job during image-only updates.
- Fix: Fall back to the existing Cloud Run Job env value before failing the sync.
- Rule: Image sync scripts should preserve existing non-secret runtime env when the deploy runner intentionally omits local environment files.
- Upgrade: none

### Lesson: Do not use Node here-doc helpers when JSON must flow on stdin

- Domain: deploy scripting
- Severity: warning
- Trigger: A shell helper piped `gcloud --format=json` into a Node script, but the Node script body was provided through a here-doc.
- Root cause: The here-doc consumed stdin, so the helper parsed an empty JSON object instead of the piped Cloud Run resource.
- Fix: Use `node -e` for small JSON parsers that must read piped input.
- Rule: If stdin carries data, pass inline Node code through `-e` or a real file, not a here-doc.
- Upgrade: none
