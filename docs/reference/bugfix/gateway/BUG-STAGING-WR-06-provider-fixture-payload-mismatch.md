# BUG-STAGING-WR-06 Staging provider review fixture selected a healthy service with the wrong invoke payload

## Symptom

After the staging fixture stopped using the dead `wr_staging_provider_*` route,
the next `provider-reject` run failed with:

```text
UPSTREAM_ERROR
upstreamStatus=422
```

## Root cause

The fixture auto-selection chose `svc_deepseek_chat`, which was healthy and
paid, but `withdrawal_review_dogfood.mjs` still sent the generic:

```json
{ "query": "withdrawal review ..." }
```

payload shape. That payload is valid for the old Postman-style fixture service,
but not for the DeepSeek service contract.

## Fix

The staging provider fixture selection now prefers candidates in a strict order,
with healthy paid `svc_synapse_mock_cost_1usdc` ahead of other services.

The dogfood runner also now builds invoke payloads by `serviceId`, so healthy
fallback services still receive a contract-compatible request body.

## Verification

- rerun `npm run e2e:withdrawal-review-dogfood:staging`
- confirm provider fixture generation prefers `svc_synapse_mock_cost_1usdc`
  when healthy
- confirm the provider invoke lane no longer fails with upstream `422`
