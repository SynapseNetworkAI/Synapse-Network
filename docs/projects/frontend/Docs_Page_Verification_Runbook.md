# Docs Page Verification Runbook

- Status: canonical
- Surface: `services/docs-front` dedicated docs site
- Entry point: `http://localhost:3100/`
- Code paths: `services/docs-front/content/docs/`, `services/docs-front/src/app/`, `services/docs-front/src/data/endpoint-source.ts`, `scripts/ui/verify_docs_pages.mjs`
- Public source mirror: `../Synapse-Network-Docs/content/docs/`
- Fast gate: `npm run ci:docs-pages`
- Browser evidence: `DOCS_BASE_URL=http://localhost:3100 node scripts/ui/verify_docs_pages.mjs`
- Last verified against code: 2026-05-02

## Current Model

Public docs no longer live under `services/user-front/src/app/docs`. The main user-front app keeps `/docs/*` redirects through `NEXT_PUBLIC_DOCS_BASE_URL`; all docs content, OpenAPI generation, `llms.txt`, sitemap, robots, and OG metadata live in `services/docs-front`.

## Verification

Run:

```bash
npm run ci:docs-pages
npm run ci:docs
DOCS_BASE_URL=http://localhost:3100 node scripts/ui/verify_docs_pages.mjs
npm run docs:sync-public-mirror
npm run e2e:prod-public-docs-links
npm run ci:prod-public-docs-links-evidence
```

Required result:

- `ci:docs-pages` builds `services/docs-front` and regenerates OpenAPI from `src/data/endpoint-source.ts`.
- `ci:docs` passes docs governance and public asset checks.
- Browser verification passes every docs page, legacy `/docs/*` redirect, generated API endpoint page, and console-error check.
- The public mirror repo is refreshed under `../Synapse-Network-Docs/content/docs/`.
- Prod public-link validation proves `www`, docs pages, markdown export, public GitHub source links, gateway health, and protected admin gates behave as expected.

## Updating Docs

When changing public docs:

1. Update MDX under `services/docs-front/content/docs`.
2. Update `services/docs-front/content/docs/meta.json` or nested `meta.json` when navigation changes.
3. Update `services/docs-front/src/data/endpoint-source.ts` only when API reference behavior changes.
4. Run `yarn generate:openapi` through `yarn build`.
5. Run `npm run docs:sync-public-mirror` so public source links stay aligned with the rendered docs tree.
6. Update `scripts/ui/verify_docs_pages.mjs` or `scripts/e2e/prod_public_docs_links_e2e.mjs` when a new page or critical phrase needs local or prod coverage.
