# docs-front Hard Rules

Local execution mirror for `services/docs-front/`.

## Canonical Sources

1. `docs/AGENTS.md`
2. `.github/instructions/frontend.instructions.md`
3. `.github/instructions/docs-sync.instructions.md`
4. `docs/Design.md`
5. `docs/reference/Service_Port_Map.md`

## Role Boundary

- `services/docs-front` is the public developer documentation site.
- It owns `docs.synapse-network.ai`, `docs-staging.synapse-network.ai`, `llms.txt`, `llms-full.txt`, `openapi.json`, and the docs sitemap.
- It is separate from `services/user-front`; do not import user-front React components into docs-front.
- OpenAPI generation uses `services/docs-front/src/data/endpoint-source.ts` until Gateway owns a first-class OpenAPI export.

## Local Constraints

- Package management stays on Yarn.
- Fumadocs currently pins this project to Next 16 and React 19. Keep that version boundary local to docs-front.
- Local docs run on port `3100`.
- Run `yarn generate:openapi` after API endpoint data changes.
- `public/openapi.json` and `src/data/api-reference.json` are tracked generated
  artifacts. If `yarn dev`, `yarn build`, or `yarn generate:openapi` changes
  them, commit the generated files with the same PR or explicitly restore them
  when no API reference change is intended.
- Do not leave dirty generated API artifacts when switching branches or handing
  off work; they block checkout and make unrelated docs PRs look unsafe.
- Public playground execution must stay disabled for production docs unless an explicit staging-safe execution policy is implemented.

## Visual Constraints

- Docs-front is a fixed dark Synapse developer documentation surface; do not let Fumadocs fall back to light/system theme.
- Sidebar, search, active navigation, body content, and table-of-contents must use the same dark token system.
- Headings, body copy, ordered-list markers, sidebar active/hover states, code, and callouts must stay readable on `#030405` / `#050708` backgrounds.
- Any visual theme change must run the docs browser verifier so `/get-started/agent-builders` proves heading, paragraph, ordered list, sidebar, and TOC contrast.

## Commands

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/docs-front
yarn dev
yarn build
yarn lint
```
