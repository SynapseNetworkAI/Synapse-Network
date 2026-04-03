# Provider Service Registration UI Simplification

- Status: proposed + implemented
- Surface: `http://localhost:3000/provider/services/deploy`
- Owner: `services/user-front/src/components/provider-workspace/ProviderServiceDeployPage.tsx`
- Last updated: 2026-04-03

## 1. Why this doc exists

Before this change, Provider service registration exposed too much control-plane detail in the first screen:

1. identity fields
2. agent-facing manifest fields
3. billing internals
4. runtime controls
5. gateway health and routing controls
6. raw payload previews and readiness rails

That shape was technically honest, but it made first-time provider onboarding too expensive.

There was **no dedicated UI design doc** for service registration before this file.  
Canonical truth lived only in workflow and manifest reference docs.

This document becomes the UI-level truth for how Provider onboarding should minimize input cost while preserving the real backend contract.

## 2. Design goal

Reduce the first successful provider publish flow to:

1. name the service
2. point to the invoke URL
3. set the per-call price
4. explain what the service does

Everything else should either:

1. derive automatically
2. fall back to safe platform defaults
3. move into an advanced override section

## 3. Visual thesis

The page should feel like an infra onboarding console, not a schema warehouse.

It should communicate:

1. "You can publish fast"
2. "Defaults are real, not fake UX theater"
3. "Advanced controls exist, but they are not required to go live"

## 4. Contract split

### 4.1 Must fill in the default path

These fields stay in the primary `Quick Publish` section:

1. `service_name`
2. `service_id`
3. `runtime.endpoint_url`
4. `billing.base_price_usdc`
5. `model_usage.description_for_model`
6. `io_schema.input_schema`
7. `io_schema.output_schema`

### 4.2 Auto-derived

These should derive from user input unless explicitly overridden:

1. `service_id` derives from `service_name`
2. `service_slug` derives from `service_name`

### 4.3 Platform defaults

These should not be required in the first publish path:

1. `manifest_version = 1.0.0`
2. `status = draft`
3. `price_model = fixed`
4. `settlement_currency = USDC`
5. `runtime.auth_mode = gateway_forward`
6. `runtime.timeout_ms = 15000`
7. `runtime.max_request_bytes = 4096`
8. `runtime.max_response_bytes = 4096`
9. `gateway_extensions.health_check.method = GET`
10. `gateway_extensions.health_check.path = /health`
11. `gateway_extensions.health_check.interval_sec = 10`
12. `gateway_extensions.health_check.timeout_ms = 3000`
13. `gateway_extensions.health_check.success_codes = [200]`
14. `gateway_extensions.forwarding_policy.request_id_header = X-Synapse-Request-Id`
15. `gateway_extensions.rate_limit_policy.max_qps = 50`
16. metering defaults remain platform-managed

### 4.4 Optional metadata

Useful but non-blocking fields belong in the `Optional agent metadata` disclosure:

1. `task_category`
2. `supported_languages`
3. `capabilities`
4. `limitations`
5. `examples`

### 4.5 Advanced overrides

Only power users should touch these:

1. custom `manifest_version`
2. custom `service_slug`
3. custom `settlement_currency`
4. custom `auth_mode`
5. custom timeout / payload limits / QPS
6. custom health path / probe timeout
7. multi-target routing

## 5. Page structure

The page should be split into two working layers plus one final submit strip:

### Layer A — Quick Publish

Contains:

1. minimum input form
2. optional metadata disclosure

### Layer B — Advanced Overrides

Collapsed by default.

Only opens when the provider needs:

1. non-standard runtime
2. custom routing topology
3. custom health behavior
4. contract version override

### Layer C — Publish action

Lives at the bottom of the page, not in a right rail.

Contains:

1. one short publish heading
2. one validation/error line
3. one primary submit button

## 6. Layout behavior

The page should now stay single-column for the default flow.

That means:

1. no persistent right rail
2. no readiness percentage panel
3. no raw gateway payload preview in the default publish screen
4. the form itself is the product, not a side inspector

## 7. UX rules

1. `Service ID` must auto-generate as the user types `Service Name`.
2. Providers may manually override `Service ID`, but the UI must clearly say that auto-sync is now disabled.
3. A `Re-sync from name` action must restore derived identity fields.
4. The page must state that new services land as `draft`.
5. The page must state that health, forwarding and metering defaults are platform-managed in V1.
6. The page must not present advanced controls as mandatory.
7. Hero copy should stay short enough to scan in one breath.

## 8. Why this is cheaper for the user

This cut removes the need for a provider to understand:

1. probe interval semantics
2. request tracing headers
3. billable status classes
4. metering enforcement
5. payload-size policy
6. multi-target routing

before the first publish.

The user only needs enough information to answer:

1. what the service is
2. where it runs
3. how much it costs
4. what schema it speaks

## 9. Current implementation status

Implemented in:

1. `services/user-front/src/components/provider-workspace/ProviderServiceDeployPage.tsx`
2. `services/user-front/src/components/provider-workspace/ProviderServiceDeployPage.test.tsx`

Reference docs that must stay aligned:

1. `docs/06_Reference/03_Service_Manifest_and_Runtime_Object_Reference.md`
2. `docs/03_Core_Workflows/04_Provider_Registration_and_Agreement.md`
