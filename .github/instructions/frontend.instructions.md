---
description: "Use when writing or modifying frontend, React, Next.js, TypeScript, Tailwind, Chakra UI, dashboard, component, page, layout, styling, i18n, admin-front, or apps/frontend code. Covers Next 14 and React 18 baseline, reuse, visual consistency, and frontend UX rules."
applyTo:
  - "apps/frontend/**/*.ts"
  - "apps/frontend/**/*.tsx"
  - "apps/frontend/**/*.js"
  - "apps/frontend/**/*.jsx"
  - "apps/frontend/**/*.css"
  - "admin/admin-front/**/*.ts"
  - "admin/admin-front/**/*.tsx"
  - "admin/admin-front/**/*.js"
  - "admin/admin-front/**/*.jsx"
  - "admin/admin-front/**/*.css"
name: "Synapse Frontend Rules"
---

# Synapse Frontend Rules

## Scope

- This file carries shared frontend rules for `apps/frontend` and `admin/admin-front`.
- Product role boundaries, local package-manager rules, and app-specific run commands stay in each subproject's AGENTS file.

## Runtime Baseline

- Primary frontend stack is Next.js `14.2.x`, React `18`, and TypeScript `5`.
- `apps/frontend` uses TailwindCSS `3.4.x` and wallet/web3 UI integrations.
- `admin/admin-front` uses Next.js with Chakra UI and a more ops-heavy console surface.
- Respect the existing stack in each app. Do not add a new UI framework or state library without a strong reason.

## Product and UX Direction

- Frontend exists to reinforce infrastructure credibility, not to imitate a generic SaaS dashboard.
- Optimize for the agent economy story: hide unnecessary Web3 friction, keep routing clear, and make payment/runtime state easy to scan.
- Keep error messages human-readable. Do not surface raw backend or wallet-extension internals directly.

## Reuse and Structure

- Reuse shared components before creating page-local UI primitives.
- Extract repeated business logic into hooks, presenter modules, or typed helpers instead of duplicating page logic.
- Prefer feature-oriented structure for non-trivial surfaces.
- Keep components lean. Heavy orchestration, normalization, and derived-state shaping should live outside view components.

## Styling and Visual System

- Follow `docs/Design.md` as the shared design baseline.
- Avoid hardcoding brand colors repeatedly; prefer theme tokens, shared constants, or existing semantic classes.
- Preserve strong visual hierarchy and calm density. Avoid decorative motion or random gradients that weaken trust.
- Motion should explain state change or focus, not exist as ornament.

## App-Specific Conventions

- In `apps/frontend`, keep user-facing copy and information architecture aligned with the central product docs and i18n resources.
- In `admin/admin-front`, keep UX semantics aligned with `docs/admin/` and the stitch prototypes for that surface.
- Do not make the frontend invent backend truth for approvals, pagination, review states, or system status if the backend should own it.

## Types, Data, and Contracts

- Prefer TypeScript-first contracts and explicit types over loose untyped objects.
- Keep client-side API adapters thin and predictable.
- When a backend field or response shape changes, update the adapter, UI, tests, and docs together.

## Tests and Validation

- Any meaningful presenter, utility, API adapter, or component change should update tests.
- Test observable behavior instead of implementation details.
- Use the dev server for iteration. Only run full build or CI-style checks when the subproject AGENTS or task context calls for it.