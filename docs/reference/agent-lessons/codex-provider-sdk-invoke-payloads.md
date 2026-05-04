# Agent Lessons: codex-provider-sdk-invoke-payloads

Task: Make the existing-service invoke script work with Provider SDK registered services.
Status: Active

## Push Review

### Lesson: Invoke smoke scripts must derive payloads from discovery metadata

- Domain: gateway-runtime
- Severity: warning
- Trigger: `agent_invoke_existing_service.py` worked for a few hard-coded canonical services but failed for `svc_synapse_mock_cost_1usdc`, a Provider SDK registered first-party service.
- Root cause: The script treated unknown service IDs as unsupported instead of using discovery `quoteTemplate` samples or input schema to build a valid smoke payload.
- Fix: Add first-party Provider SDK payloads, then fall back to discovery sample, input schema required fields, and a generic smoke payload before asking for explicit `--payload-json`.
- Rule: Agent-facing invoke helpers must use live discovery metadata as the source of truth for request shape and should only require manual payload JSON when the provider schema is insufficient.
- Upgrade: pr-lessons-only
