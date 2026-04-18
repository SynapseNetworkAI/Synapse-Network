# Docs Page Verification Runbook

- Status: canonical
- Surface: `http://localhost:3000/docs#introduction`
- Code paths: `services/user-front/src/app/docs/`, `services/user-front/src/i18n/resources/*/docsPage.ts`, `scripts/ui/verify_docs_pages.mjs`
- Fast gate: `npm run ci:docs-pages`
- Browser evidence: `DOCS_BASE_URL=http://localhost:3000 node scripts/ui/verify_docs_pages.mjs`
- Last verified against code: 2026-04-18

## Verification Strategy

Use two layers because they answer different questions:

| Question | Verification method | Why |
| --- | --- | --- |
| Does the page/component render the right content? | Vitest + Testing Library | Fast, deterministic, works without a running browser server. |
| Does clicking navigate to the intended route or anchor? | Vitest for component-level navigation and Playwright for browser-level navigation. | Click behavior is a functional requirement. |
| Does the page look correct to a human reviewer? | Playwright screenshots. | Screenshots are evidence, not the primary pass/fail mechanism. |
| Are there unimplemented docs pages? | Registry tests. | Prevents hidden sidebar links and API endpoint ids from drifting out of implementation. |

## Fast Local Verification

Run:

```bash
npm run ci:docs-pages
npm run ci:docs
npm run ci:frontend
```

Required result:

- `ci:docs-pages` passes all `services/user-front/src/app/docs` tests.
- `ci:docs` passes governance and docs constraints.
- `ci:frontend` passes lint, tests, and build.

## Browser Verification

Start the docs site:

```bash
cd services/user-front
yarn dev
```

Run the browser verification:

```bash
DOCS_BASE_URL=http://localhost:3000 node scripts/ui/verify_docs_pages.mjs
```

The script writes:

- `output/playwright/docs-verification/<timestamp>/report.json`
- `output/playwright/docs-verification/<timestamp>/report.md`
- Representative screenshots for overview, consumer guide, provider guide, API reference, one endpoint detail, SDK, and contracts.

Required result:

- `report.json.failed.length === 0`
- `report.md` shows every step as `PASS`
- Screenshots are present and readable
- No uncaught browser console errors were observed

## What Counts as a Pass

- Page-root links must update the browser URL to the expected route.
- Hash links must either scroll to an existing DOM id or update URL to the hash route.
- Concepts reverse navigation must be checked explicitly: start at `/docs/concepts#idempotency`, click `How Settlement Works`, and assert the browser reaches `/docs/concepts#settlement`.
- API endpoint links must open `/docs/api-reference/{id}` for every `ROUTE_GROUPS` route id.
- API Reference role filters must be checked for both `Consumer` and `Provider`. Provider must expose provider service management, provider secrets, earnings, withdrawal, and health-history endpoints; Consumer must not show provider-only control-plane endpoints. Direct `/docs/api-reference#api-provider` must switch to the Provider view and render the provider-only anchor.
- `Status Page` must remain non-navigating and show a `soon` marker.
- External resource links must be recorded as out-of-docs resources; the script must not require third-party availability.

## What Counts as a Failure

- A sidebar item points to a missing anchor.
- A docs route has no corresponding registry entry.
- An API endpoint id exists in `ROUTE_GROUPS` but cannot render a detail page.
- A click leaves the browser on the wrong URL.
- A page renders without its expected heading.
- Provider role filtering hides provider-only API docs or leaks them into the Consumer-only view.
- Any uncaught browser exception appears during the Playwright run.

## Updating the Docs Surface

When adding or renaming docs pages:

1. Update the route/page component.
2. Update `nav-tree.ts` if the page appears in sidebar navigation.
3. Update `docs-page-registry.ts` with heading, anchors, and verification mode.
4. Add or adjust Vitest coverage.
5. Run `npm run ci:docs-pages`.
6. If the change affects visible navigation, rerun `scripts/ui/verify_docs_pages.mjs` and attach the new report.
