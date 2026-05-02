# Synapse Docs Front

Dedicated developer documentation site for Synapse Network.

## Domains

| Environment | URL                                       |
| ----------- | ----------------------------------------- |
| Local       | `http://localhost:3001`                   |
| Staging     | `https://docs-staging.synapse-network.ai` |
| Production  | `https://docs.synapse-network.ai`         |

## Commands

```bash
yarn install --frozen-lockfile
yarn generate:openapi
yarn dev
yarn lint
yarn build
```

The dev server runs on port `3001`.

## Ownership

- MDX content: `content/docs`
- App routes: `src/app`
- Docs components: `src/components/docs`
- Generated OpenAPI: `public/openapi.json`
- Generated API index: `src/data/api-reference.json`
- Source endpoint data: `src/data/endpoint-source.ts`

`services/user-front` links to this app through `NEXT_PUBLIC_DOCS_BASE_URL` and keeps `/docs/*` redirects for old URLs.
