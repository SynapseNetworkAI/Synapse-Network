---
description: "Use when writing or modifying frontend, React, Next.js, TypeScript, Tailwind, Chakra UI, dashboard, component, page, layout, styling, i18n, admin-front, or services/user-front code. Covers Next 14 and React 18 baseline, reuse, visual consistency, and frontend UX rules."
applyTo:
  - "services/user-front/**/*.ts"
  - "services/user-front/**/*.tsx"
  - "services/user-front/**/*.js"
  - "services/user-front/**/*.jsx"
  - "services/user-front/**/*.css"
  - "services/admin-front/**/*.ts"
  - "services/admin-front/**/*.tsx"
  - "services/admin-front/**/*.js"
  - "services/admin-front/**/*.jsx"
  - "services/admin-front/**/*.css"
name: "Synapse Frontend Rules"
---

# Synapse Frontend Rules

## Scope

- This file carries shared frontend rules for `services/user-front` and `services/admin-front`.
- Product role boundaries, local package-manager rules, and app-specific run commands stay in each subproject's AGENTS file.

## Runtime Baseline

- Primary frontend stack is Next.js `14.2.x`, React `18`, and TypeScript `5`.
- `services/user-front` uses TailwindCSS `3.4.x` and wallet/web3 UI integrations.
- `services/admin-front` uses Next.js with Chakra UI and a more ops-heavy console surface.
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

## Interaction Patterns

- List, feed, marketplace, forum, table, and registry pages are scanning surfaces. They must not inline-expand heavy create/edit forms inside the list flow.
- For create/edit workflows on scanning surfaces, default to an existing modal or drawer component. Inline controls are only appropriate for lightweight filters, search, sorting, or single-field quick actions.
- Keep action errors scoped to the surface that produced them: modal submission errors stay in the modal, while list-loading errors stay with the list.

## App-Specific Conventions

- In `services/user-front`, keep user-facing copy and information architecture aligned with the central product docs and i18n resources.
- In `services/admin-front`, keep UX semantics aligned with `docs/admin/` and the stitch prototypes for that surface.
- Do not make the frontend invent backend truth for approvals, pagination, review states, or system status if the backend should own it.

## Types, Data, and Contracts

- Prefer TypeScript-first contracts and explicit types over loose untyped objects.
- Keep client-side API adapters thin and predictable.
- Public/exported frontend API adapters must return explicit interfaces/types, not `Record<string, unknown>` or `Promise<Record<string, unknown>>`. Raw maps are only acceptable for request bodies, patch payloads, schema fields, and private parser helpers.
- When a backend field or response shape changes, update the adapter, UI, tests, and docs together.

## Domain Status Typing

- Business lifecycle states must live in a fixed domain status directory such as `src/domain/status/`; do not scatter status unions or hardcoded values across pages, presenters, and components.
- Do not introduce a global cross-domain `Status` enum or a catch-all `BusinessStatus` type. Split statuses by domain such as approval, withdrawal, execution, risk, and provider service lifecycle.
- For TypeScript, prefer `as const` objects plus derived union types over `enum`.
- API adapters must normalize backend status strings into domain status types before the data reaches presenters or components.
- Core business presenters and components must not carry finance-sensitive or workflow-sensitive states as bare `string`.
- Do not use substring heuristics such as `includes("pending")` or `includes("approved")` for business decisions. Branch on explicit domain statuses only.
- When a backend status changes, update the matching domain type, adapter normalization, tests, and UI mappings in the same change.

## Tests and Validation

- Any meaningful presenter, utility, API adapter, or component change should update tests.
- Test observable behavior instead of implementation details.
- Use the dev server for iteration. Only run full build or CI-style checks when the subproject AGENTS or task context calls for it.

## ⚠️ Gotchas — Known Frontend Failure Patterns

**Backend truth invented in the frontend**
- Deriving approval status, withdrawal review state, or pagination totals from frontend-local logic when these must come from the backend.
- String-matching on display labels to infer state — always use the raw backend status field.

**TypeScript safety bypasses**
- Using `as any` or casting API responses to silence TypeScript. Define a typed adapter that validates the shape at the boundary.
- Optional-chaining through deeply nested API responses without a null-check guard on the first use of the result.

**React hooks traps**
- `useEffect` with an empty dependency array that reads a ref or prop that can change — causes stale-closure bugs that are hard to reproduce.
- Missing `key` prop in list renders, or using array index as `key` for reorderable lists — causes DOM reconciliation identity bugs.

**Wallet / Web3 UX errors**
- Showing a loading state indefinitely when a wallet extension is not installed — add a detection guard and a fallback message.
- Blocking all UI interaction during an on-chain op without giving the user a cancel or dismiss path.

**i18n drift**
- Adding new user-facing copy directly as a string literal instead of through the i18n resource file — breaks localization silently.
