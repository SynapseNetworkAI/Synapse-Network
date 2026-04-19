---
Status: supplementary
Owner: frontend
Last Updated: 2026-04-18
---

# User Front Fullchain Verification Result - 2026-04-18

## Summary

This local fullchain run seeded real consumer/provider data through the gateway and verified the user-front page matrix with Playwright in `fullchain` mode.

- Mode: `fullchain`
- Base URL: `http://localhost:3000`
- Gateway: `http://127.0.0.1:8000`
- Chain ID: `31337`
- Result: `PASS`
- Passed: `50`
- Failed: `0`
- Blocked: `0`
- Warnings: `0`
- Screenshots captured: `17`

## Fixture Evidence

- Run ID: `ufc-20260418155326`
- Seeded service ID: `ufc_echo_ufc_20260418155326`
- Credential ID: `0755daac-5189-47e6-a545-ece4de54f27b`
- Invocation ID: `inv-97161e36f4604b7fbe2759abe1dd5e79`
- Deposit tx: `0x03a47c1dd741ea8425406616157ee4704beb38a860f82cd46a6b662df29f7a08`

The runtime fixture file is intentionally ignored under `tmp/user-front-fullchain/` because it contains local JWT/session material.

## Commands

```bash
npm run e2e:user-front-fullchain:seed
npm run e2e:user-front-fullchain:verify
node --check scripts/e2e/user_front_fullchain_seed.mjs
node --check scripts/ui/verify_user_front_pages.mjs
npm run ci:user-front-pages
npm run ci:docs
cd services/user-front && yarn lint
```

## Generated Report

The local generated report for this run is:

```text
output/playwright/user-front-verification/2026-04-18T163814172Z/report.md
```

`output/` is ignored and should be treated as machine-generated evidence, not source documentation.

## Bugs Fixed During This Run

- `BUG-FRONT-FULLCHAIN-01`: Marketplace treated gateway `healthy` service status as inactive.
- `BUG-FRONT-FULLCHAIN-02`: Funds data called `balanceOf` on `SynapseCore` instead of `MockUSDC`.
- `BUG-FRONT-FULLCHAIN-03`: Credential page verification registry drifted from actual `/credentials/agent/*` endpoints.

## Residual Risk

This evidence is local/staging-style fullchain verification. It does not replace production wallet, production RPC, production indexer, production monitoring, or production incident-response drills.
