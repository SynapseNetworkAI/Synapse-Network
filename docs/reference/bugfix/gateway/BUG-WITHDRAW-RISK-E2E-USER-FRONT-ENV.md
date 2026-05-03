# BUG-WITHDRAW-RISK-E2E-USER-FRONT-ENV

## Status

Fixed in local startup harness.

## Symptom

`npm run e2e:withdrawal-risk-policy` failed before running the browser checks after it restarted user-front:

```text
[user-front-env] Configuration preflight failed.
- NEXT_PUBLIC_GATEWAY_BASE_URL: missing
- NEXT_PUBLIC_ANALYTICS_ENDPOINT: missing
- NEXT_PUBLIC_APP_ENV: missing
- NEXT_PUBLIC_SUPPORT_EMAIL or NEXT_PUBLIC_SUPPORT_PORTAL_URL: missing
```

## Root Cause

`scripts/local/setup_local_env.sh` started `services/user-front` with plain `yarn dev`, while the current frontend preflight requires the public env contract.

## Fix

The local setup script now starts user-front with the same local public env defaults used by `start_all_services.sh`.

## Verification

```bash
npm run e2e:withdrawal-risk-policy
```
