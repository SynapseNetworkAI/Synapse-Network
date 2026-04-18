# Docs Page Function and Verification Matrix

- Status: canonical
- Surface: `services/user-front` docs site
- Code paths: `services/user-front/src/app/docs/`, `services/user-front/src/i18n/resources/*/docsPage.ts`, `scripts/ui/verify_docs_pages.mjs`
- Entry point: `http://localhost:3000/docs#introduction`
- Source of truth: `services/user-front/src/app/docs/docs-page-registry.ts`
- Validation entry points: `npm run ci:docs-pages`, `DOCS_BASE_URL=http://localhost:3000 node scripts/ui/verify_docs_pages.mjs`
- Last verified against code: 2026-04-18

## Purpose

The `/docs` surface is the public developer documentation for Synapse. It must explain how an owner, consumer agent, provider, SDK user, or contract integrator discovers the platform, understands the architecture, and reaches the exact API or workflow page they need.

This document is the functional contract for every implemented docs page. Dashboard, marketplace, provider console, and admin-front pages are intentionally out of scope.

## Page Matrix

| Route | Function | Required sections | Verification must prove |
| --- | --- | --- | --- |
| `/docs#introduction` | Docs landing page for the developer platform. | `introduction`, `architecture`, quick-start cards, platform product cards. | Page renders `Synapse Developer Platform`; quick-start and API CTA navigate to `/docs/getting-started` and `/docs/api-reference`; `#architecture` anchor exists. |
| `/docs/getting-started` | Role chooser for service consumers and providers. | Consumer card, Provider card, role comparison. | Consumer CTA opens `/docs/getting-started/consumer`; Provider CTA opens `/docs/getting-started/provider`. |
| `/docs/getting-started/consumer` | Consumer quick start from auth to paid invocation and withdrawal. | `step-auth`, `step-deposit`, `step-discover`, `step-credential`, `step-invoke`, `step-verify`, `step-withdraw`. | Each sidebar anchor exists; service discovery mentions `/marketplace`, `/marketplace/registry.json`, and `/api/v1/services/discover`; CTAs link to Concepts and TypeScript SDK. |
| `/docs/getting-started/provider` | Provider quick start from auth to registration, runtime status, earnings, and withdrawal. | `step-auth`, `step-secret`, `step-register`, `step-status`, `step-earnings`, `step-withdraw`. | Each sidebar anchor exists; runtime health explains slow lane and Force probe recovery; CTAs link to Services API and Python SDK. |
| `/docs/concepts` | Conceptual model for settlement and agent-safe invocation. | `settlement`, `service-registry`, `credentials`, `idempotency`. | Each section anchor exists; page renders `How Synapse Works`; Service Registry section links the registry concept to discovery/invoke; from `/docs/concepts#idempotency`, clicking `How Settlement Works` must navigate back to `/docs/concepts#settlement`. |
| `/docs/api-reference` | Machine-readable and human-readable API index. | Default Consumer view: `api-auth`, `api-balance`, `api-services`, `api-invocations`, `api-credentials`; Provider role-gated view: `api-provider` plus provider service management. | All visible endpoint rows link to `/docs/api-reference/{id}`; Consumer role shows discovery/invoke/credential paths; Provider role shows provider service, secret, earnings, withdrawal, and health-history paths; direct `/docs/api-reference#api-provider` opens the Provider view; role filter does not produce links outside `ROUTE_GROUPS`. |
| `/docs/api-reference/[id]` | Endpoint detail page for every route in `ROUTE_GROUPS`. | Method/path header, auth, params, request body when present, response example, error codes, agent context. | Every `ALL_ROUTES` id renders a detail page; unknown ids render the docs not-found detail state instead of crashing. |
| `/docs/sdk` | SDK overview and language selection. | `sdk-overview`, `sdk-compare`. | Page renders `SDKs`; TypeScript and Python links point to language pages. |
| `/docs/sdk/typescript` | TypeScript SDK usage guide. | Install, auth, deposit, discovery, invoke, direct call, starter services, verify, cheatsheet. | All expected anchors exist; service discovery and invoke examples render. |
| `/docs/sdk/python` | Python SDK usage guide. | `sdk-py`, install, auth, deposit, invoke, cheatsheet. | Page renders `Python SDK`; code examples and method table render. |
| `/docs/contracts` | Smart contract reference. | `contract-core`, `contract-usdc`, `contract-abi`. | Page renders `Smart Contracts`; contract cards and ABI/explorer links render. |

## Non-Docs Resources

The sidebar also contains resource entries:

- `Status Page` is currently `soon`. It must display the `SOON` marker and must not navigate.
- `Changelog` points to `/blog`. It is an internal resource link, not a `/docs` page.
- `GitHub` points to an external repository. Validation only checks that the link is external; it does not require opening the third-party site.

## Known Drift Fixed by This Contract

The Provider Guide sidebar previously pointed to non-existent anchors `#step-endpoint` and `#step-health`. The implemented provider page uses `#step-secret` and `#step-status`, so the docs navigation now follows the implemented page and the registry test guards this alignment.

The Concepts sidebar must also support reverse anchor navigation. A user landing on `/docs/concepts#idempotency` must be able to click `How Settlement Works` and land on `/docs/concepts#settlement`; screenshots are not sufficient for this requirement because the URL/hash transition is the actual functional contract.

## Agent-Facing API Boundary

The API reference separates three identities:

1. `Consumer Agent` uses a limited credential for service discovery, paid invocation, and receipt lookup.
2. `Owner` uses wallet-authenticated JWT for deposits, credential issuance/revocation, and spending-limit control.
3. `Provider` uses wallet-authenticated JWT for service registration, provider secrets, earnings, health evidence, and withdrawal intents.

Do not expose owner wallet signing, direct transfers, provider management, or spend-limit mutation as autonomous agent runtime privileges. An agent can request those flows through an owner-controlled policy layer, but the public agent runtime contract remains narrow: discover, invoke with price assertion, and verify receipts.

## Pass Criteria

A docs page is considered verified only when:

1. The registry item exists in `docs-page-registry.ts`.
2. The route is implemented or explicitly marked as `soon` / external resource.
3. The expected heading renders in Vitest or Playwright.
4. Every expected anchor exists on the rendered page.
5. User navigation is verified by simulated click or browser click, not by screenshot alone.
6. Screenshots exist for representative visual states when running the Playwright evidence script.
