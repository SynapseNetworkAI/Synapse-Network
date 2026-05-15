# Docs Page Verification Runbook

- Status: canonical
- Surface: `services/docs-front` dedicated docs site
- Entry point: `http://localhost:3100/`
- Code paths: `services/docs-front/content/docs/`, `services/docs-front/src/app/`, `services/docs-front/src/data/endpoint-source.ts`, `scripts/ui/verify_docs_pages.mjs`
- Fast gate: `npm run ci:docs-pages`
- Browser evidence: `DOCS_BASE_URL=http://localhost:3100 node scripts/ui/verify_docs_pages.mjs`
- Last verified against code: 2026-05-02

## Current Model

Public docs no longer live under `services/user-front/src/app/docs`, and the main user-front app no longer serves `/docs/*` redirects. All docs content, OpenAPI generation, `llms.txt`, sitemap, robots, and OG metadata live in `services/docs-front`.

## Verification

Run:

```bash
npm run ci:docs-pages
npm run ci:docs
DOCS_BASE_URL=http://localhost:3100 node scripts/ui/verify_docs_pages.mjs
```

Required result:

- `ci:docs-pages` builds `services/docs-front` and regenerates OpenAPI from `src/data/endpoint-source.ts`.
- `ci:docs` passes docs governance and public asset checks.
- Browser verification passes every canonical docs page, generated API endpoint page, and console-error check.

## Updating Docs

When changing public docs:

1. Update MDX under `services/docs-front/content/docs`.
2. Update `services/docs-front/content/docs/meta.json` or nested `meta.json` when navigation changes.
3. Update `services/docs-front/src/data/endpoint-source.ts` only when API reference behavior changes.
4. Run `yarn generate:openapi` through `yarn build`.
5. Update `scripts/ui/verify_docs_pages.mjs` when a new page or critical phrase needs browser coverage.
