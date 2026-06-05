# SEO Public Assets Runbook

Synapse user-front publishes crawler-facing assets from `services/user-front`:

- `public/llms.txt` -> `https://www.synapse-network.ai/llms.txt`
- `public/robots.txt` -> `https://www.synapse-network.ai/robots.txt`
- `public/4f58d9a2e2c84f85a5f3b5baf9a65c7d.txt` -> `https://www.synapse-network.ai/4f58d9a2e2c84f85a5f3b5baf9a65c7d.txt`
- `src/app/sitemap.ts` -> `https://www.synapse-network.ai/sitemap.xml`
- `src/app/layout.tsx` -> homepage metadata, OpenGraph, and Twitter metadata

Synapse docs-front publishes crawler-facing developer docs assets from
`services/docs-front`:

- `public/4f58d9a2e2c84f85a5f3b5baf9a65c7d.txt` -> `https://docs.synapse-network.ai/4f58d9a2e2c84f85a5f3b5baf9a65c7d.txt`
- `src/app/llms.txt/route.ts` -> `https://docs.synapse-network.ai/llms.txt`
- `src/app/llms-full.txt/route.ts` -> `https://docs.synapse-network.ai/llms-full.txt`
- `src/app/robots.ts` -> `https://docs.synapse-network.ai/robots.txt`
- `src/app/sitemap.ts` -> `https://docs.synapse-network.ai/sitemap.xml`
- `src/app/layout.tsx` -> docs metadata and OpenGraph metadata

## Hard Rules

- Use HTTPS only for the canonical production domain. `http://synapse-network.ai` and `http://www.synapse-network.ai` must never appear in `llms.txt`, `robots.txt`, sitemap output, or metadata.
- Redirect `https://synapse-network.ai/*` permanently to the matching `https://www.synapse-network.ai/*` URL. The bare host can serve as an ingress alias, but it must not be a second canonical answer-engine host.
- Keep the sitemap path singular and stable: `https://www.synapse-network.ai/sitemap.xml`.
- Keep docs sitemap singular and stable: `https://docs.synapse-network.ai/sitemap.xml`.
- Do not use or reference `sitemap.website.xml`.
- Do not add docs `.md` mirror routes for crawlers; docs-front owns `llms.txt` and `llms-full.txt` instead.
- Do not list private app surfaces in `llms.txt` or sitemap: `/dashboard`, `/provider`, `/api`, or `/marketplace/registry.json`.
- Keep the public AI payment landing pages listed in the user-front sitemap:
  `/ai-agent-payments` and `/agent-payment-api`.
- Do not list main-site `/docs/*` routes in the user-front sitemap. They are redirects; canonical docs URLs live on `docs.synapse-network.ai`.
- Explicitly allow answer-engine crawlers in both user-front and docs-front
  robots assets: `OAI-SearchBot`, `ChatGPT-User`, `GPTBot`, `ClaudeBot`,
  `Claude-User`, `Claude-SearchBot`, `anthropic-ai`, `PerplexityBot`,
  `Bingbot`, and `Google-Extended`.
- Keep the public IndexNow key file hosted on both `www` and `docs` before
  running IndexNow submissions. The key is not a secret; it is the ownership
  proof file that search engines fetch.
- Do not hand-write JSON-LD in V1; title, description, OG, Twitter, sitemap, robots, and `llms.txt` are the SEO contract.

## IndexNow Submission

After a production deploy that changes answer-engine assets, run a dry-run first:

```bash
npm run seo:indexnow:ai-visibility
```

The dry-run prints the exact `www.synapse-network.ai` and
`docs.synapse-network.ai` URL batches, key file locations, and IndexNow
endpoint. After confirming both key files are live, submit the changed URLs:

```bash
npm run seo:indexnow:ai-visibility -- --execute
```

Submit only after production is live. IndexNow accepts one host per request, so
the script sends separate batches for `www` and `docs` instead of mixing hosts.
The URL list intentionally covers the public `AI Agent Payments` pages, MCP paid
API docs, `llms.txt`, `llms-full.txt`, robots, and sitemaps.

## XML Pollution Check

Browser extensions can inject scripts into the DOM view of XML pages. Treat browser-copied XML as untrusted when it contains values such as `chrome-extension://` or `<script>`.

Use `curl` to verify the server response:

```bash
curl -fsS https://www.synapse-network.ai/sitemap.xml | sed -n '1,40p'
curl -fsS https://www.synapse-network.ai/robots.txt
curl -I -sS https://synapse-network.ai/ | grep -E 'HTTP/.* 30(1|8)|Location: https://www.synapse-network.ai/'
```

The sitemap response must start with XML and must not contain `<script`, `chrome-extension://`, `http://synapse-network.ai`, `http://www.synapse-network.ai`, or `sitemap.website.xml`.

## Validation

Run the static PR gate:

```bash
npm run ci:ai-visibility-assets
npm run seo:indexnow:ai-visibility
npm run ci:seo-public-assets
```

`ci:ai-visibility-assets` validates the `AI Agent Payments` docs-front feed
bundle before external GPT/Claude/Grok probes: seven docs pages, frontmatter,
first answer blocks, category-specific facts, docs sitemap entries, docs
`llms.txt`, docs-front AI crawler robots rules, user-front `llms.txt`,
user-front AI crawler robots rules, and user-front sitemap routes.

Run live dogfood after deploy:

```bash
SEO_PUBLIC_ASSETS_ENV=staging \
SEO_PUBLIC_ASSETS_BASE_URL=https://staging.synapse-network.ai \
npm run e2e:seo-public-assets:staging

npm run ci:seo-public-assets-evidence
```

The live E2E evidence includes homepage metadata, `llms.txt`, robots, sitemap,
screenshots, internal links, and the production bare-domain redirect to `www`.

Production validation is read-only:

```bash
SEO_PUBLIC_ASSETS_ENV=prod \
SEO_PUBLIC_ASSETS_BASE_URL=https://www.synapse-network.ai \
npm run e2e:seo-public-assets:prod

npm run ci:seo-public-assets-evidence
```
