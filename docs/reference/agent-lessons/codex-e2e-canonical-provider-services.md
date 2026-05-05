# Agent Lessons: codex-e2e-provider-catalog-services

Task: Make Gateway local/staging E2E reuse Synapse-Network-Provider registered services instead of creating temporary providers/services.
Status: Active

## Push Review

## Lessons

### Lesson: Environment E2E should consume catalog fixtures, not mutate service registration

- Domain: gateway-e2e
- Severity: warning
- Trigger: Local/staging E2E had started accumulating `svc_e2e_*`, `provider_onboard_*`, and `apiref_test_*` services in the registry.
- Root cause: Registration coverage and billing/invoke regression coverage shared the same live E2E path.
- Fix: Gateway E2E now uses the Synapse-Network-Provider catalog, with `svc_synapse_mock_cost_1usdc` as the default paid service and `svc_synapse_echo` as the free smoke service.
- Rule: Local/staging Gateway E2E must fail closed when the Provider catalog is missing; service-registration behavior belongs in backend unit/router/service tests or Provider onboarding.
- Upgrade: agents-memory
