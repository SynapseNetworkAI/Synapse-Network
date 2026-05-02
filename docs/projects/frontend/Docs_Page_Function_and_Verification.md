# Docs Page Function and Verification Matrix

- Status: canonical
- Surface: `services/docs-front` dedicated docs site
- Code paths: `services/docs-front/content/docs/`, `services/docs-front/src/app/`, `services/docs-front/scripts/generate-openapi.mjs`, `scripts/ui/verify_docs_pages.mjs`
- Entry point: `http://localhost:3001/`
- Source of truth: MDX content plus generated `services/docs-front/src/data/api-reference.json`
- Validation entry points: `npm run ci:docs-pages`, `DOCS_BASE_URL=http://localhost:3001 node scripts/ui/verify_docs_pages.mjs`
- Last verified against code: 2026-05-02

## Purpose

The dedicated docs surface is the public developer documentation for Synapse. It must explain how an owner, agent builder, provider, SDK user, or contract integrator discovers the platform, understands the architecture, and reaches the exact API or workflow page they need.

The main `services/user-front` app no longer owns public docs content. It owns product links and legacy `/docs/*` redirects into the environment-specific docs origin.

## Page Matrix

| Route                                | Function                                                                               | Required sections                                                                           | Verification must prove                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/`                                  | Docs landing page for the developer platform.                                          | Quick start, API reference, MCP, money flows, pricing, contracts, support entry cards.      | Page renders `Synapse Developer Platform`; cards link to dedicated docs routes.                       |
| `/get-started`                       | Role-oriented docs index.                                                              | Agent builders, API providers, first paid invocation.                                       | Page renders `Get Started`; role links open the flattened pages.                                      |
| `/get-started/agent-builders`        | Agent builder quick start.                                                             | Auth, budget, discovery, invocation, verification.                                          | Page renders `For Agent Builders` and includes a For AI agents summary.                               |
| `/get-started/api-providers`         | Provider onboarding quick start.                                                       | Registration, secrets, health, earnings, withdrawal.                                        | Page renders `For API Providers` and includes provider-safe policy notes.                             |
| `/get-started/first-paid-invocation` | Minimal paid invocation path.                                                          | Request example, idempotency, receipt verification.                                         | Page renders `First Paid Invocation`.                                                                 |
| `/mcp`                               | MCP server and agent tooling guide.                                                    | Install, env, tools, MCP pricing rules, `PRICE_MISMATCH` recovery.                          | Page renders `MCP / Agent Tooling` and includes `discover_services -> invoke_and_pay -> get_receipt`. |
| `/money-flows`                       | Money movement overview for consumer and provider settlement.                          | Consumer flow, provider flow, maturity states, agent withdrawal boundary.                   | Page renders `Money Flows` and includes Matured Funds, T+1, and T+7.                                  |
| `/money-flows/deposit-usdc`          | Consumer funding flow.                                                                 | Deposit intent, chain transfer, Gateway indexing, agent budget boundary.                    | Page renders `Deposit USDC`.                                                                          |
| `/money-flows/consumer-withdrawals`  | Consumer withdrawal flow.                                                              | T+1 matured funds warning, balance states, disabled button checklist.                       | Page renders `Consumer Withdrawals` and includes `Consumer withdrawals are T+1`.                      |
| `/money-flows/provider-withdrawals`  | Provider withdrawal flow.                                                              | T+7 matured funds warning, receivable states, settlement notes.                             | Page renders `Provider Withdrawals` and includes `Provider earnings are T+7`.                         |
| `/money-flows/reconciliation`        | Settlement reconciliation guide.                                                       | Receipts, receivables, withdrawal tickets, chain claims.                                    | Page renders `Reconciliation`.                                                                        |
| `/pricing-and-fees`                  | Pricing and fee policy guide.                                                          | Example values, live Gateway truth sources, fixed and token-metered agent rules.            | Page renders `Pricing & Fees` and includes `Do not hard-code fees or prices`.                         |
| `/concepts/*`                        | Conceptual model for settlement, budgets, off-chain charging, and on-chain withdrawal. | Agent settlement, budget isolation, off-chain charging, on-chain withdrawal.                | Each concept page renders its heading and a For AI agents summary.                                    |
| `/api-reference`                     | Resource-oriented API index.                                                           | Authentication, Agents, Services, Invocations, Balances, Provider Operations.               | Generated route directory links every endpoint to `/api-reference/{id}`.                              |
| `/api-reference/[id]`                | Endpoint detail page for every generated route.                                        | Method/path header, auth, params, Fumadocs OpenAPI operation, agent policy note, code tabs. | Every generated route id renders a detail page.                                                       |
| `/sdks`                              | SDK overview and language selection.                                                   | TypeScript, Python, MCP / Agent Tooling.                                                    | Page renders `SDKs`; language links point to flattened pages and canonical `/mcp`.                    |
| `/sdks/typescript`                   | TypeScript SDK usage guide.                                                            | Install, auth, invoke, receipts.                                                            | Page renders `TypeScript SDK`.                                                                        |
| `/sdks/python`                       | Python SDK usage guide.                                                                | Install, auth, invoke, receipts.                                                            | Page renders `Python SDK`.                                                                            |
| `/smart-contracts`                   | Smart contract reference index.                                                        | SynapseCore, USDC, Networks.                                                                | Page renders `Smart Contracts`.                                                                       |
| `/support`                           | Support and feedback entry point.                                                      | Docs issue, API integration, billing/deposit support.                                       | Page renders `Support`.                                                                               |

## Non-Docs Resources

`services/user-front` keeps these redirects so old links do not die:

- `/docs` -> docs origin root.
- `/docs/getting-started/:path*` -> `/get-started/:path*`.
- `/docs/sdk/:path*` -> `/sdks/:path*`.
- `/docs/contracts/:path*` -> `/smart-contracts/:path*`.
- `/docs/:path*` -> `/:path*`.

## Agent-Facing API Boundary

The API reference separates three identities:

1. `Consumer Agent` uses a limited credential for service discovery, paid invocation, and receipt lookup.
2. `Owner` uses wallet-authenticated JWT for deposits, credential issuance/revocation, and spending-limit control.
3. `Provider` uses wallet-authenticated JWT for service registration, provider secrets, earnings, health evidence, and withdrawal intents.

Do not expose owner wallet signing, direct transfers, provider management, or spend-limit mutation as autonomous agent runtime privileges. An agent can request those flows through an owner-controlled policy layer, but the public agent runtime contract remains narrow: discover, invoke with price assertion, and verify receipts.

## Pass Criteria

A docs page is considered verified only when:

1. The MDX page exists under `services/docs-front/content/docs`.
2. OpenAPI data is regenerated from `services/docs-front/src/data/endpoint-source.ts`.
3. The expected heading renders in Playwright.
4. Every expected anchor exists on the rendered page.
5. User navigation is verified by simulated click or browser click, not by screenshot alone.
6. Screenshots exist for representative visual states when running the Playwright evidence script.
