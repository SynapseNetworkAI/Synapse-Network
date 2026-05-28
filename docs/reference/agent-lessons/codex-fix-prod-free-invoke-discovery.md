# Agent Lessons: codex/fix-prod-free-invoke-discovery

### Lesson: Production evidence runners must follow the canonical Agent API, not legacy marketplace shortcuts.

- Domain: production-e2e
- Severity: warning
- Trigger: Production free-invoke validation failed because the runner queried legacy marketplace discovery.
- Root cause: The evidence runner still used `GET /api/v1/services/discover`, while production free catalog services are exposed through Agent discovery.
- Fix: The runner now calls `POST /api/v1/agent/discovery/search`, then invokes the discovered free service and fetches the receipt.
- Rule: Production invoke evidence must use the public Agent contract: discovery search, invoke, and receipt fetch.
- Upgrade: prod-release-validation

### Lesson: UI raw-error gates must block concrete raw errors, not normal product vocabulary.

- Domain: frontend-evidence
- Severity: warning
- Trigger: Production UI evidence failed on a healthy Invocations page because normal copy contained `ledger`.
- Root cause: The screenshot/DOM raw-error regex mixed concrete raw errors with broad product vocabulary.
- Fix: The gate now rejects concrete leaks such as `503`, `HTTPException`, `RPC Error`, `CHAIN_RPC`, `PROVIDER_`, and `WITHDRAW_`.
- Rule: Browser evidence should block raw technical errors, not ordinary user-facing nouns that can appear in non-error page copy.
- Upgrade: evidence-quality
