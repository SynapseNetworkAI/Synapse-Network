# BUG-STAGING-PROVIDER-01: canonical paid mock service returns provider 404 in staging

## Symptom

Fresh staging `gateway-fullchain` runs reached the real invoke step but failed with:

- Gateway: `502 UPSTREAM_ERROR`
- Provider upstream status: `404`
- Path: `/provider-services/synapse-mock-cost-1usdc/invoke`

Fresh failing evidence:

- `docs/evidence/release/gateway-fullchain/20260512T154706Z-staging`
- `docs/evidence/release/gateway-fullchain/20260512T155214Z-staging`

## What we verified

1. Unsigned direct POST to
   `https://provider-staging.synapse-network.ai/provider-services/synapse-mock-cost-1usdc/invoke`
   returns `401 GATEWAY_SIGNATURE_REQUIRED`, so the public route exists.
2. Signed Gateway invoke for `svc_synapse_echo` succeeds end-to-end, so gateway
   provider signature wiring is healthy.
3. Signed Gateway invoke for `svc_synapse_mock_cost_1usdc` consistently returns
   provider `404`.

This isolates the issue to the staging canonical paid mock service mapping,
not the general Gateway → Provider signed invoke path.

## Root cause

Staging catalog/runtime drift:

- `svc_synapse_mock_cost_1usdc` is intended to be a fixed-price mock service
  whose behavior matches an echo-style implementation.
- The staging endpoint mapping points at
  `/provider-services/synapse-mock-cost-1usdc/invoke`, but the signed runtime
  path behind that catalog entry does not resolve successfully in the Provider
  runtime.

## Repair strategy

Short-term staging repair:

1. Point the canonical paid mock endpoint to the known-good echo implementation:
   `https://provider-staging.synapse-network.ai/provider-services/synapse-echo/invoke`
2. Re-run fresh staging `gateway-fullchain`
3. Confirm `chargedUsdc=1.000000` still comes from the Gateway service manifest,
   while the upstream business response remains echo-style and stable.

Long-term fix:

- Repair the Provider catalog/runtime source of truth so
  `synapse-mock-cost-1usdc` resolves natively again instead of relying on the
  staging echo implementation.
