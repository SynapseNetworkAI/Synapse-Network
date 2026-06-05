# Codex Lessons: AI visibility IndexNow submissions

### Lesson: IndexNow submissions need public key files per host

- Domain: SEO public assets and AI visibility
- Severity: normal
- Trigger: Adding IndexNow submission support for both `www.synapse-network.ai` and `docs.synapse-network.ai`.
- Root cause: IndexNow verifies ownership by fetching a public key file on the same host as the submitted URLs, so multi-host submission cannot rely on a single key file location.
- Fix: Host the same public key file under both hosts and submit separate dry-run-gated URL batches per host.
- Rule: Treat IndexNow keys as public ownership proofs, not secrets, and keep search-engine notifications dry-run by default until production assets are live.
- Upgrade: PR lesson only.
