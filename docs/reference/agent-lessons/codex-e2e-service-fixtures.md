# Agent Lessons: codex-e2e-service-fixtures

Task: Constrain E2E service fixtures to canonical provider services.
Status: Active

## Push Review

## Lessons

### Lesson: Ordinary E2E must not create random provider services

- Domain: e2e
- Severity: warning
- Trigger: Local gateway restart blocked because repeated E2E runs left more than 50 active test provider services and over 100 runtime health rows.
- Root cause: Invoke, billing, API reference, browser, and UI fullchain E2E paths created fresh provider services even when they only needed a callable service fixture.
- Fix: Default ordinary E2E to canonical provider services, require `GATEWAY_E2E_ALLOW_SERVICE_CREATION=true` for fallback creation, and expand cleanup/guard prefixes.
- Rule: Only provider registration/onboarding tests should create provider services by default; all other E2E flows must reuse canonical services or explicitly opt in to temporary service creation with cleanup.
- Upgrade: agents-memory

### Lesson: Root E2E scripts need explicit PR CI scope ownership

- Domain: ci
- Severity: warning
- Trigger: Pre-push classified `scripts/e2e_fullflow_test.py` as unknown and fail-closed into full CI, exposing unrelated legacy budget debt.
- Root cause: PR scope resolver knew `scripts/e2e/**` but not older root-level E2E scripts.
- Fix: Map root-level E2E scripts to the E2E fixture scope and register legacy quality-budget baselines for the large standalone scripts touched by this change.
- Rule: When changing an older root-level script, add it to PR scope ownership before push so fail-closed full CI does not mask the intended validation signal.
- Upgrade: agents-memory
