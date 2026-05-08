# Frontend Agent Rules

## Role

1. `apps/frontend/` is the owner-facing Synapse console.
2. It is not the admin control plane.
3. It should optimize for owner clarity while preserving the agent-first runtime contract.

## Runtime Workflow

1. Use the development server during iteration.
2. Do not run production build inside the interactive agent workflow.
3. If dependencies change, update the correct lockfile and restart the dev server.

Recommended local commands:

```bash
cd /Users/cliff/workspace/Synapse-Network/apps/frontend
yarn dev
yarn test
```

Repository-level gate:

```bash
cd /Users/cliff/workspace/Synapse-Network
npm run ci:frontend
```

## Coding Rules

1. Prefer TypeScript for new components and utilities.
2. Co-locate component-specific styles when practical.
3. Prefer shared components and shared hooks over page-local duplication.
4. Keep product wording, IA, and interaction semantics aligned with root `docs/`.
5. List/feed/forum/marketplace pages are scanning surfaces; do not inline-expand heavy create, edit, feedback, or confirmation forms inside the list flow. Use the existing modal/popup system for those workflows.
6. Do not use sidebar expansion, right-side drawers, or slide-out panels for feedback, create, edit, detail, review, logout, or finance confirmation flows. Use modal/popup primitives; sidebars are navigation only.
7. Scope errors to the interaction surface that created them: modal action errors stay inside the modal, and list/data loading errors stay with the list.

## Design Alignment

When working on `apps/frontend`, treat these as the primary design and product sources:

1. `docs/Design.md`
2. `docs/01_Product_Frontend/README.md`
3. `docs/06_Reference/04_Development_Testing_and_Integration_Reference.md`

Frontend must preserve:

1. infrastructure-grade credibility
2. clean information hierarchy
3. owner-facing clarity without leaking low-level Web3 complexity
4. runtime contract consistency with `gateway` and `sdk/python`

## Documentation Sync

If frontend behavior, environment variables, page IA, or setup instructions change, update together:

1. `apps/frontend/README.md`
2. `apps/frontend/AGENTS.md`
3. `docs/03_Projects/frontend/Frontend_Local_Development.md`
4. this file
5. any affected root product docs

## Stop Conditions

1. You are about to use `npm install` or `npm ci` inside `apps/frontend`.
2. You are about to run `npm run build` during an interactive session.
3. Product semantics are drifting away from root docs.
4. The page is inventing admin-only workflow or backend-owned truth.
