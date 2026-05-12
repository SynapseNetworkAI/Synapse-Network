# BUG-STAGING-FULLCHAIN-01: gateway-fullchain staging blocked by relative contract path and stale test credentials

## Symptom

Fresh staging `gateway-fullchain` evidence at
`docs/evidence/release/gateway-fullchain/20260512T154318Z-staging`
failed before the money path could complete.

Two independent blockers showed up:

1. `tests/e2e/conftest.py` treated
   `GATEWAY_E2E_CONTRACT_CONFIG_PATH=services/user-front/src/contract-config.arbitrum-sepolia.example.json`
   as relative to `services/gateway/`, so pytest could not find the file.
2. Staging owner `0xce11fde2baf4fae4029954a1dd174cdabdbfe934` already had many active
   test credentials like `staging-load-*`, `wr-staging-*`, and `consumer-test-*`,
   causing `AGENT_CREDENTIAL_LIMIT_REACHED` during the release suite.

## Root cause

- The E2E conftest only resolved `GATEWAY_E2E_CONTRACT_CONFIG_PATH` literally,
  even though staging runbooks export a repo-relative path.
- The E2E cleanup helper only revoked a narrow set of prefixes and missed
  staging-specific credential names created by other staging suites.

## Fix

1. Resolve relative `GATEWAY_E2E_CONTRACT_CONFIG_PATH` values against repo root.
2. Expand `revoke_stale_e2e_agent_credentials()` to include staging prefixes:
   - `staging-load-`
   - `wr-staging-`
   - `consumer-test-`

## Verification

- Re-run fresh staging `gateway-fullchain` after code patch.
- Confirm contract config setup errors disappear.
- Confirm credential issuance no longer fails with `AGENT_CREDENTIAL_LIMIT_REACHED`
  after stale staging test credentials are revoked.
