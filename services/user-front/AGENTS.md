# frontend Hard Rules

Local execution mirror for `services/user-front/`.

## Canonical Sources

1. `docs/AGENTS.md`
2. `.github/instructions/frontend.instructions.md`
3. `docs/03_Projects/frontend/Frontend_Agent_Rules.md`
4. `docs/Design.md`
5. `docs/reference/Service_Port_Map.md`

## Role Boundary

- `services/user-front` is the owner and developer facing product frontend.
- It must express the agent-first payment story clearly, but it is not the settlement source of truth.
- Do not invent backend truth for balances, service status, or runtime policy in the UI.

## Local Constraints

- Package management for `services/user-front` stays on Yarn.
- Use the development server during iteration.
- `yarn dev` and `yarn build` must pass `node scripts/validate_env.mjs` before Next starts or builds. Do not bypass this preflight; missing support contact or API endpoints must fail fast.
- Local docs links must use `NEXT_PUBLIC_DOCS_BASE_URL=http://localhost:3100`; staging/prod use the docs domains.
- Browser code must read public env with explicit static keys such as `process.env.NEXT_PUBLIC_SUPPORT_EMAIL`; do not use dynamic `process.env[name]`, because Next.js will not reliably inline it into client bundles.
- Local and release startup must prove HTTP health after the process opens a port. A listening port alone is not a successful frontend start.
- Keep copy, IA, and user flows aligned with canonical product docs and i18n resources.
- Wallet and payment-related UX should hide avoidable Web3 complexity rather than exposing raw protocol mechanics.

## Commands

```bash
cd /Users/cliff/workspace/Synapse-Network/services/user-front
yarn dev
yarn test

cd /Users/cliff/workspace/Synapse-Network
npm run ci:frontend
```
