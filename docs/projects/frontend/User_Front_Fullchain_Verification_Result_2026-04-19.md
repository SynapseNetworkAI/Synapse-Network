---
Status: supplementary
Owner: frontend
Last Updated: 2026-04-19
---

# User Front Fullchain Verification Result - 2026-04-19

## Summary

This local fullchain run seeded real consumer/provider data through the gateway and verified the user-front page matrix with Playwright in `fullchain` mode. Unlike the previous single-call fixture, this run used three real local HTTP provider endpoints and 100 paid invocations.

- Mode: `fullchain`
- Base URL: `http://localhost:3000`
- Gateway: `http://127.0.0.1:8000`
- Chain ID: `31337`
- Commit at run start: `c77f2c9a`
- Result: `PASS`
- Passed: `50`
- Failed: `0`
- Blocked: `0`
- Warnings: `0`
- Screenshots captured: `17`

## Fixture Evidence

- Run ID: `ufc-20260419011119`
- Consumer wallet: `0x918e89c214a446c58F284392BD09C046E7E3270b`
- Provider wallet: `0x073a27097B8af5B0A3bdDc18c45750aA6bA33A10`
- Deposit amount: `1000.00 USDC`
- Deposit tx: `0xd257d970ff6238fd31e1f8afc5908181d1d3fb5566423a4ee0d68415b4209f32`
- Services:
  - `ufc_echo_basic_ufc_20260419011119` at `0.10 USDC`
  - `ufc_echo_plus_ufc_20260419011119` at `0.25 USDC`
  - `ufc_echo_pro_ufc_20260419011119` at `0.50 USDC`
- Agent credential ID: `8adc115d-feb6-4580-a226-d476381da908`
- Agent credential calls used: `100`
- Invocation distribution: `34 / 33 / 33`
- Invocation count: `100`
- First invocation ID: `inv-b24e7fda74e84146a5986891a277bcf0`
- Last invocation ID: `inv-cdf4d8065cf94231937174a406462372`

The runtime fixture file is intentionally ignored under `tmp/user-front-fullchain/` because it contains local JWT/session material, private keys, and the agent credential token.

## Reconciliation

- Total consumer charge from gateway usage receipts: `28.160000 USDC`
- Total platform fee from gateway usage receipts: `2.825000 USDC`
- Total provider net from gateway usage receipts: `25.335000 USDC`
- Consumer balance after invoke from gateway API: `981.339900 USDC`
- Credits page displayed final balance as `$981.33`; the verifier accepted the display formatting while enforcing exact gateway/fixture value at 6-decimal precision.
- Provider receivable after invoke from gateway API: `25.785 USDC`; this includes prior local fixture earnings in addition to the current run.
- Provider usage page and provider invocation history both showed seeded `ufc_echo_pro_ufc_20260419011119` rows.

## Commands

```bash
node --check scripts/e2e/user_front_fullchain_seed.mjs
node --check scripts/ui/verify_user_front_pages.mjs
npm run e2e:user-front-fullchain:seed
npm run e2e:user-front-fullchain:verify
npm run ci:user-front-pages
npm run ci:docs
cd services/user-front && yarn test src/app/marketplace/registry.json/route.test.ts
cd services/user-front && yarn lint
npm run ci:frontend
```

All commands above passed after the registry query fix and the `runtimeAvailable` type contract fix.

## Generated Report

The local generated report for this run is:

```text
output/playwright/user-front-verification/2026-04-19T013454624Z/report.md
```

`output/` is ignored and should be treated as machine-generated evidence, not source documentation.

## Key Page Evidence

- Marketplace registry: `3 services returned, total=3`.
- Dashboard overview: gateway balance API returned `981.339900`, credential API returned `callsUsed=100`.
- Payments: ledger displayed the seeded `1000.00 USDC` deposit.
- Credits: displayed final consumer balance and matched gateway balance within the display-format tolerance.
- Credentials: displayed seeded token prefix `agt_7e64c9`, active status, and `100 / 500`.
- Agents: displayed seeded agent `ufc-agent-ufc-20260419011119`; after selecting it, the page showed `callsUsed=100`.
- Invocations: displayed seeded usage rows from the 100-call run.
- Provider console: displayed provider earnings and verified three provider services through gateway API.
- Provider services and health: verified three seeded services as active and runtime available.
- Provider withdraw: displayed provider receivable `25.785`.
- Provider invocation history: displayed seeded pro-service usage rows.

## Bugs Fixed During This Run

- `BUG-FRONT-FULLCHAIN-04`: `/marketplace/registry.json?q=<runId>` did not pass the query to gateway discovery, so seeded callable services were missing from the agent-facing registry.

## Residual Risk

This evidence is local/staging-style fullchain verification. It does not replace production wallet, production RPC, production indexer, production monitoring, load tests, chaos drills, or production Go/No-Go evidence.
