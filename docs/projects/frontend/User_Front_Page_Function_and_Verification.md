# User Front Page Function and Verification

- Status: canonical
- Code paths: `services/user-front/src/app/`, `services/user-front/src/components/`, `scripts/ui/verify_user_front_pages.mjs`, `scripts/ui/verify_user_front_i18n.mjs`
- Scope: `services/user-front`
- Last updated: 2026-05-04
- Last verified against code: 2026-05-04
- Verification registry: `services/user-front/src/app/user-front-page-registry.json`
- Automated checks: `npm run ci:user-front-pages`, `npm run ci:user-front-i18n`, `npm run ci:user-front-i18n-dom`, `USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_pages.mjs`, `USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_i18n.mjs`

## Purpose

This document defines what every user-front page is supposed to do, how it should be verified, and how to decide whether the page is implemented, visually coherent, and backed by real data.

The source of truth for the page inventory is `services/user-front/src/app/user-front-page-registry.json`. The registry is tested against the actual Next.js `src/app` file tree, so a new page cannot silently appear without a function and verification entry.

## Verification Model

Use three layers together:

1. **Registry/Vitest verification** confirms every `page.tsx` and `route.ts` has a documented purpose, interactions, data source, visual verification mode, and redirect status.
2. **Browser click verification** confirms real navigation, global Quick Access search, redirects, hash anchors, marketplace controls, console errors, screenshots, and basic layout guards.
3. **Backend truth verification** confirms data-backed public pages call real gateway endpoints and render from those responses. Wallet/JWT pages require an authenticated fixture before their data truth can be marked fully passed.
4. **i18n DOM verification** confirms user-visible copy, placeholders, aria labels, modal text, and action feedback render correctly in both `en` and `zh`.

There are two browser modes:

- **Smoke mode** proves routes, copy, redirects, clicks, public gateway calls, and screenshots. Authenticated consumer/provider data may be reported as blocked when no wallet/JWT fixture is supplied.
- **Fullchain mode** runs `scripts/e2e/user_front_fullchain_seed.mjs` first, then opens the browser with seeded consumer/provider wallet sessions. Fullchain mode is the only mode allowed to claim `blocked=0` for authenticated balances, payments, credentials, invocations, provider earnings, provider services, health, and withdrawal pages.

Screenshots are evidence for visual review. They are not enough by themselves to prove functional correctness. Functional correctness requires simulated clicks and route/API assertions.

## Page Inventory

| Page                          | Status                 | Main Function                                                                     | Data Source                                                           | Verification                                                                                               |
| ----------------------------- | ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/`                           | implemented            | Landing page, role selection, network counters                                    | `GET /api/v1/services/network-stats`, `GET /api/v1/services/discover` | Click CTAs, screenshot, real backend response                                                              |
| `/marketplace`                | implemented            | Callable service catalog with search, tags, list rows, pagination                 | `GET /api/v1/services/discover`                                       | Controls test, screenshot, real backend response                                                           |
| `/marketplace/registry.json`  | implemented API        | Agent-facing callable registry JSON                                               | `GET /api/v1/services/discover`                                       | JSON schema, pagination, available-only filtering                                                          |
| `/about`                      | thin page              | Minimal public description                                                        | Static                                                                | Render smoke                                                                                               |
| `/blog`                       | thin page              | Minimal blog shell                                                                | Static                                                                | Render smoke                                                                                               |
| `/docs` and docs children     | external redirects     | Legacy docs URLs redirect to `NEXT_PUBLIC_DOCS_BASE_URL`                          | None                                                                  | Redirect checks in docs-front browser verification                                                         |
| `/dashboard`                  | compatibility redirect | Role-aware dashboard entry                                                        | None                                                                  | Redirect test                                                                                              |
| `/dashboard/overview`         | implemented            | Consumer overview and high-level account state                                    | Gateway balance/indexer                                               | Authenticated smoke; header shows Connect Wallet when disconnected and short wallet address when connected |
| `/dashboard/billing`          | implemented            | Payments ledger for deposits, usage, refunds, withdrawals                         | Gateway deposit intents + chain tx links                              | Authenticated smoke; deposit Completed means Gateway credited spendable balance                            |
| `/dashboard/billing/credits`  | implemented            | Spendable, pending/syncing, frozen credits; deposit, spend cap, voucher, withdraw | Gateway balance buckets + wallet USDC/gas + chain                     | Authenticated smoke; deposit confirm must preflight USDC/gas before wallet prompts                         |
| `/dashboard/buy`              | implemented            | Deposit/buy shortcut                                                              | Wallet + chain                                                        | Wallet fixture required                                                                                    |
| `/dashboard/discovery`        | implemented            | Consumer service discovery                                                        | Gateway service discovery                                             | Browser/API smoke                                                                                          |
| `/dashboard/credentials`      | implemented            | Agent credentials, limits, revocation                                             | Gateway credential APIs                                               | Authenticated smoke; full data requires wallet/JWT                                                         |
| `/dashboard/invocations`      | implemented            | Invocation history and support-guided refund/dispute path                         | Gateway usage API + support contact config                            | Authenticated smoke; show only Invocation ID as the user-facing call identifier; no inline refund action   |
| `/dashboard/services`         | implemented            | Owner/provider-owned service registry view                                        | Authenticated service registry APIs                                   | Authenticated smoke                                                                                        |
| `/dashboard/agents`           | implemented            | Agent workspace and credential linking                                            | localStorage + gateway credentials                                    | Fullchain must show seeded credential and `callsUsed >= 100`; empty state is a failure                     |
| `/dashboard/audit`            | implemented            | Consumer audit/risk view                                                          | Gateway usage/audit projections                                       | Authenticated smoke                                                                                        |
| `/dashboard/developer`        | implemented            | Developer resource hub                                                            | Static                                                                | Render smoke                                                                                               |
| `/dashboard/settlement`       | preview                | Reconciliation preview                                                            | Static preview                                                        | Render smoke; not a production reconciliation source                                                       |
| `/dashboard/account/settings` | implemented            | Profile and notification settings                                                 | Auth profile APIs                                                     | Authenticated smoke                                                                                        |
| `/dashboard/router`           | redirect               | Legacy billing route                                                              | None                                                                  | Redirects to `/dashboard/billing`                                                                          |
| `/dashboard/console`          | redirect               | Legacy provider console route                                                     | None                                                                  | Redirects to `/provider/console`                                                                           |
| `/dashboard/agents/workspace` | redirect               | Legacy agent workspace route                                                      | None                                                                  | Redirects to `/dashboard/agents`                                                                           |
| `/provider`                   | redirect               | Provider root                                                                     | None                                                                  | Redirects to `/provider/console`                                                                           |
| `/provider/console`           | implemented            | Provider business console                                                         | Provider earnings/services APIs                                       | Authenticated smoke; full data requires wallet/JWT                                                         |
| `/provider/services`          | implemented            | Provider service lifecycle management                                             | Provider services APIs                                                | Authenticated smoke                                                                                        |
| `/provider/services/deploy`   | implemented            | Manifest builder and publish form                                                 | `POST /api/v1/services`                                               | Form smoke; publish requires auth fixture                                                                  |
| `/provider/health`            | implemented            | Provider health, probe history, slow lane                                         | Service health history APIs                                           | Authenticated smoke                                                                                        |
| `/provider/secrets`           | implemented            | Provider secret issuance and revocation                                           | Provider secret APIs                                                  | Authenticated smoke                                                                                        |
| `/provider/usage`             | implemented            | Provider usage analytics                                                          | Usage/earnings APIs                                                   | Authenticated smoke                                                                                        |
| `/provider/withdraw`          | implemented            | Provider receivable withdrawal                                                    | Gateway + wallet + chain                                              | Authenticated smoke; full data requires wallet/JWT                                                         |
| `/provider/withdraw/history`  | implemented            | Provider withdrawal/invocation history                                            | Withdrawals/usage APIs                                                | Authenticated smoke                                                                                        |
| `/provider/sell`              | redirect               | Legacy provider sell route                                                        | None                                                                  | Redirects to `/provider/console`                                                                           |
| `/provider/settlements`       | redirect               | Legacy settlements route                                                          | None                                                                  | Redirects to `/provider/withdraw`                                                                          |

## Not Implemented vs Redirect vs Thin

Current code has no unmapped Next route. The following are intentional compatibility redirects, not missing pages:

- `/dashboard`
- `/dashboard/router`
- `/dashboard/console`
- `/dashboard/agents/workspace`
- `/provider`
- `/provider/sell`
- `/provider/settlements`

The following are implemented but thin content surfaces:

- `/about`
- `/blog`

If they are expected to become production marketing pages, create a separate content/design task rather than treating them as broken routes.

## Global Navigation

The console navbar includes a Quick Access search dialog for jumping between consumer, provider, and public pages.

Verification requirements:

- The search button or `Ctrl+K` opens the dialog from console pages.
- Clicking a filtered result navigates to the result's canonical route.
- Pressing `Enter` activates the highlighted result.
- Selecting the current route closes the dialog without issuing a redundant route push.
- Browser evidence includes screenshots for the open dialog, a filtered result, and the destination page after navigation.

## Functional Success Criteria

A page passes functional verification only when:

- The route renders without a Next not-found page.
- The expected heading or unique text appears.
- Global Quick Access result clicks navigate to the exact target route.
- Page-level primary buttons or links navigate to the expected route.
- Redirect routes land on their documented target.
- Main-site `/docs/*` URLs redirect to the dedicated docs origin.
- Browser console has no uncaught application errors.
- Public data-backed pages call the real backend when `USER_FRONT_VERIFY_REAL_BACKEND=1`.
- Authenticated data-backed pages are either verified with wallet/JWT fixtures or explicitly marked blocked.
- User-facing copy, toast/confirm text, placeholders, aria labels, and visible errors are sourced from typed i18n resources and pass `npm run ci:user-front-i18n`.
- User-facing copy changes must include DOM assertions in both `en` and `zh` for the affected component/page and pass `npm run ci:user-front-i18n-dom`.

## i18n Regression Matrix

Use this focused matrix whenever changing console copy, modals, placeholders, toast text, or page-level labels.

| Surface                                | DOM assertions                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credits / `/dashboard/billing/credits` | English and Chinese spendable/pending/frozen balances, voucher copy, purchase/withdraw labels, and no stale `X may give out free credits` text                  |
| Consumer withdraw modal                | English and Chinese heading, amount/reason labels, hints, action button, and invalid amount toast                                                               |
| Deposit modal                          | Caller-provided localized title, balance labels, transaction summary, permit/deposit progress labels, and close aria label                                      |
| Provider withdraw                      | English and Chinese page title/history labels plus localized error-code toast for T+7 maturity, minimum amount, insufficient receivable, and pending withdrawal |
| Agent credentials                      | English and Chinese page title, table headers, search placeholder, revoke confirmation modal, and revoke toast                                                  |
| Agents workspace                       | English and Chinese list pane title, create CTA, manage CTA, and no stale English CTA copy in Chinese mode                                                      |
| QuickStartGuide                        | English and Chinese stepper labels, deposit modal labels, and validation messages                                                                               |
| PaidInvokePanel                        | English and Chinese panel labels, unavailable hints, success toast, and result labels                                                                           |
| RolePathCards                          | English mode must not leak fixed Chinese onboarding text; Chinese mode must not leak English onboarding sentences                                               |
| Feedback                               | English and Chinese title, category label, placeholder, submit button, and close aria label                                                                     |
| Wallet login intent                    | English and Chinese purpose/domain/wallet/network/no-funds copy, fresh nonce retry behavior, and neutral user-cancel toast                                      |
| Wallet rejection                       | `4001` / `ACTION_REJECTED` from login, deposit, and withdrawal flows clears loading and does not show raw wallet/backend error text                             |

## Wallet Trust UX

All wallet actions must use a Synapse-owned explanation layer before opening the wallet extension. Native wallet popups cannot be fully styled, so trust comes from matching the preflight preview to the wallet prompt.

- Login signatures use SIWE-compatible copy with environment-aware domain/URI, wallet, chain ID, nonce, issued time, expiration time, and the statement that no transaction or fund movement is authorized.
- Each login attempt or retry requests a fresh `/api/v1/auth/challenge`; cancelled, expired, or failed challenges are never reused.
- Deposit shows Permit authorization first, then Vault deposit transaction. Permit is gasless; the vault transaction needs native gas.
- Consumer and provider withdrawals explain matured funds, Gateway-issued tickets, deadline, vault contract, amount, and native gas before the wallet claim.
- Wallet rejection is a neutral user cancellation. UI must reset loading state and show localized cancellation copy, not a red error toast.

## Visual and Component Coordination Criteria

Visual verification uses screenshots plus deterministic layout guards:

- Desktop viewport must not have horizontal overflow.
- Primary controls must be visible above the fold for core pages.
- Marketplace search, tag filters, list rows, and pagination controls must be visible and aligned as a single control group.
- Empty, loading, and error states must use the same visual system as the page body.
- Consumer dashboard and provider console should preserve the established dark, high-contrast, green-accent design language.
- Screenshot evidence should include at least home, marketplace, docs, consumer overview, credits, credentials, invocations, provider console, provider services, provider health, and provider withdraw.

Screenshots are necessary for visual confidence, but a screenshot alone does not prove a button works. Buttons, redirects, filters, and anchors require browser click automation.

## Real Backend Data Criteria

For public pages:

- `/` must call the gateway public network stats endpoint or its service discovery fallback.
- `/marketplace` must call service discovery and render either callable services or the real empty state.
- `/marketplace/registry.json` must return `status=success`, pagination metadata, and no service with `isActive=false` or `runtimeAvailable=false`.

For authenticated pages:

- Full data verification requires a wallet/JWT fixture and, for chain-backed flows, local chain contracts.
- Without credentials, the acceptable pass is only unauthenticated rendering plus a clear blocked data-truth marker.
- A page must not silently show hard-coded fake balances, fake withdrawals, or fake provider earnings as if they were real backend data.

## Automation

Run registry checks:

```bash
npm run ci:user-front-pages
```

Run i18n static and DOM regression checks:

```bash
npm run ci:user-front-i18n
npm run ci:user-front-i18n-dom
```

Run browser navigation and screenshot verification:

```bash
USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_pages.mjs
```

Run browser i18n DOM verification after starting user-front:

```bash
USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_i18n.mjs
```

Run real backend-enforced verification:

```bash
USER_FRONT_BASE_URL=http://localhost:3000 \
USER_FRONT_VERIFY_REAL_BACKEND=1 \
USER_FRONT_GATEWAY_HEALTH_URL=http://127.0.0.1:8000/health \
node scripts/ui/verify_user_front_pages.mjs
```

Run local fullchain verification:

```bash
npm run e2e:user-front-fullchain
```

Fullchain mode performs the following setup before browser assertions:

- Authenticates consumer and provider local wallets.
- Mints `1000.00` local MockUSDC, tops the consumer wallet up to `10 ETH`, approves SynapseCore, deposits to the gateway balance ledger, and registers the deposit intent.
- Issues provider and agent credentials.
- Starts three local mock provider upstreams.
- Registers three active callable provider services priced at `0.10`, `0.25`, and `0.50` USDC and waits for health/discovery.
- Invokes those services 100 times with one consumer agent credential using a deterministic `34 / 33 / 33` split.
- Reconciles consumer charge, platform fee, and provider net from gateway usage receipts with USDC atomic `BigInt` math.
- Verifies consumer balance, usage records, provider receivable, provider service health, provider usage, and withdrawal capability through gateway APIs and visible UI evidence.

The final fullchain report only passes when `failed=0` and `blocked=0`.

The browser script writes:

- `output/playwright/user-front-verification/<timestamp>/report.md`
- `output/playwright/user-front-verification/<timestamp>/report.json`
- core page screenshots

The output directory is evidence, not source code. Do not commit generated screenshots unless a release evidence bundle explicitly asks for them.
