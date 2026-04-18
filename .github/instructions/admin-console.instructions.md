---
description: "Use when writing or modifying admin console, admin-front table, list page, filters, pagination, approval status, audit status, review state, admin dashboard, or stitch-aligned control-plane UX. Covers admin-front list semantics, backend-owned status truth, and operational UI patterns."
applyTo:
  - "services/admin-front/**/*.ts"
  - "services/admin-front/**/*.tsx"
  - "services/admin-front/**/*.js"
  - "services/admin-front/**/*.jsx"
  - "services/admin-front/**/*.css"
name: "Synapse Admin Console Rules"
---

# Synapse Admin Console Rules

## Scope

- This file is specific to `services/admin-front` control-plane work.
- It refines the general frontend rules with admin-console-specific list, status, and operational UX constraints.

## Source of Truth

- Backend-owned semantics come first.
- Do not invent approval, audit, execution, or pagination truth in the frontend when `gateway-admin` should define it.
- Keep wording, filters, and control flow aligned with `docs/admin/` and matching stitch prototypes.

## List Page Structure

Every standard admin list page should follow this order:

1. page title and short business description
2. search and filter area
3. search action row
4. data table or list body
5. pagination area below the list

Do not place pagination controls above the list body unless the workflow explicitly requires it.

## Filters and Search

- Group filters inside one clear filter surface.
- Keep filter controls aligned on a predictable grid.
- Search should submit deterministically with the main action button and with Enter on input-based forms.
- Reset actions should restore default filters and return the list to the first page.

## Pagination

- Pagination belongs below the table.
- Treat pagination as operational metadata, not as the primary call to action.
- Do not infer total pages or total records from the current slice.
- If the UI needs canonical pagination truth, require explicit backend metadata.

## Status and Table Semantics

- Status chips are for real states, risks, and decisions, not decorative labeling.
- Prefer one column per business concept when scan speed matters.
- Keep rows visually stable and easy to scan on desktop.
- Secondary metadata should move to detail drawers or secondary surfaces rather than overloading the first column.
- Approval, audit, execution, withdrawal-review, and other control-plane status chips must map from canonical domain status enums or unions defined from the backend contract; do not hardcode chip colors directly in page tables.

## Shared Primitive Bias

- Prefer shared list primitives and existing surfaces before inventing per-page wrappers.
- Reuse shared filter forms, pagination bars, and table surfaces when possible.
- If a page must diverge, the reason should be traceable to a documented workflow need.

## Visual Tone

- Admin UI should feel operational, calm, and high-signal.
- Favor clear hierarchy and dense usefulness over decorative dashboard noise.
- Keep stitch alignment for auth, control-plane, and operations surfaces where those prototypes exist.

## ⚠️ Gotchas — Known Admin Console Failure Patterns

**Pagination total invention**
- Computing `totalPages = Math.ceil(items.length / pageSize)` from the current page slice — this is always wrong. Total must come from the backend `total` field in the response envelope.
- Showing "page X of Y" when Y is inferred from the current slice — causes flickering and overcounting when the user is not on the first page.

**Status chip overload**
- Adding a new status variant directly as a hardcoded color string in the component table, detached from the backend enum. Define variant mappings from the canonical backend status list.
- Using status chips for non-state labels (e.g., feature flags, type categories) — chips are for lifecycle states only.

**Filter reset bug**
- A reset handler that clears form values but does not reset the page to 1, leaving the user on an empty page with stale pagination state.

**Backend-owned wording drift**
- Renaming a backend status or approval type in the UI display label without verifying the backend contract — the display map must stay synchronized with the backend enum definition.
