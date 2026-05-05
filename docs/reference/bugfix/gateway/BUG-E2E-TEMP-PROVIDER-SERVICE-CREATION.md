# BUG-E2E-TEMP-PROVIDER-SERVICE-CREATION

**Status:** Fixed

- Domain: gateway / e2e / provider catalog
- Fixed in: `services/gateway/tests/e2e/helpers/service_fixtures.py`, Gateway E2E provider/API-reference tests, and legacy full-chain scripts
- Guardrail: `npm run ci:e2e-env-isolation`
- Last verified against code: 2026-05-05

## Problem

Local/staging Gateway E2E created fresh provider wallets and temporary services
such as `svc_e2e_*`, `provider_onboard_*`, and `apiref_test_*`. Repeated runs
polluted `synapse_service_manifests`, increased health-monitor pressure, and
made paid invoke evidence depend on test-owned mock provider URLs instead of the
first-party Synapse-Network-Provider catalog.

## Root Cause

The E2E fixture layer still exposed service-creation fallback helpers and a
script-owned mock HTTP service. Several tests used those helpers to cover
service registration in a live local/staging environment, mixing registry
mutation coverage with billing, invoke, and UI regression coverage.

## Fix

Gateway local/staging E2E now fails closed unless Synapse-Network-Provider
catalog services are already registered. Paid/default settlement uses
`svc_synapse_mock_cost_1usdc`; free smoke uses `svc_synapse_echo`; broader
catalog checks cover `svc_web3_sentiment_index`,
`svc_protocol_fundamental_brief`, `svc_oss_security_healthcheck`, and
`svc_deepseek_chat`.

Service registration API behavior stays covered by backend unit, router, and
service tests. Local/staging E2E no longer starts a mock provider HTTP service
or POSTs `/api/v1/services`.

## Prevention Rule

Do not add local/staging Gateway E2E cases that create providers, register
services, or rely on `GATEWAY_E2E_ALLOW_SERVICE_CREATION`. If a catalog service
is missing, run Synapse-Network-Provider onboarding `check`/`ensure` against the
target Gateway before rerunning Gateway E2E.
