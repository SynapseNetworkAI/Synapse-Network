# BUG-ADMIN-FRONT-01 Admin Front Next Build Route Module Race

## Status

Fixed on 2026-04-17.

## Symptom

The pre-push quality gate failed during `services/admin-front` production build:

```text
PageNotFoundError: Cannot find module for page: /_document
```

The failure appeared during `Collecting page data` after a successful compile. A direct
rerun could pass, which made the build nondeterministic in local quality gates.

## Root Cause

`services/admin-front` ran `next build` without first removing `.next`, and the default
Next.js build worker mode could intermittently fail to resolve a freshly compiled app-router
page module during page-data collection. A rerun could pass, which made the local pre-push
gate nondeterministic.

`services/user-front` already used a deterministic clean build, but `admin-front` had not
been aligned with that pattern.

## Fix

`services/admin-front/package.json` now defines a deterministic clean build and uses a
single Next.js build worker for local quality gates:

```json
"clean": "rm -rf .next",
"build": "yarn clean && NEXT_PRIVATE_BUILD_WORKER=1 next build"
```

## Verification

```bash
cd services/admin-front
yarn build
```
