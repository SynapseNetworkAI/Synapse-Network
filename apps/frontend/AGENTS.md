# frontend Hard Rules

Local execution mirror for `apps/frontend/`.

Canonical rules doc:

1. `docs/AGENTS.md`
2. `docs/03_Projects/frontend/Frontend_Agent_Rules.md`

## Must-Follow Rules

1. Use the development server during iteration.
2. Do not run production build inside the interactive agent workflow.
3. Package management for `apps/frontend` stays on Yarn.
4. Prefer TypeScript for new components and utilities.
5. Keep page IA, product wording, and behavior aligned with root `docs/` and `docs/Design.md`.

## Common Commands

```bash
cd /Users/cliff/workspace/Synapse-Network/apps/frontend
yarn dev
yarn test

cd /Users/cliff/workspace/Synapse-Network
npm run ci:frontend
```