# Admin Rewrite Function Inventory

Status: active  
Owner: admin-front  
Last updated: 2026-06-03

## Purpose

This document is the product inventory for rewriting `services/admin-front`.
It records the current admin console functions before historical page code is
removed. The rewrite must preserve backend-owned truth while replacing the old
page implementations with one modular console system.

## Current Product Surface

| Module                 | Routes                                                                                                                                                                                                                                                         | Primary job                                                                                                | Backend truth                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Authentication         | `/login`, `/login/mfa-enroll`, `/login/reset-success`                                                                                                                                                                                                          | password login, MFA enrollment, reset success                                                              | auth policy, session, CSRF                                                     |
| Control Overview       | `/dashboard`, `/dashboard/overview`, `/dashboard/runtime`, `/dashboard/health`, `/system`                                                                                                                                                                      | operator landing, business runtime, system health                                                          | dashboard projections, diagnostics, system status                              |
| Analytics              | `/dashboard/analytics`, `/dashboard/analytics/consumer-funnel`, `/dashboard/analytics/invocation-revenue`, `/dashboard/analytics/provider-revenue`, `/dashboard/analytics/money-flow`, `/dashboard/analytics/risk-health`, `/dashboard/analytics/data-quality` | growth, revenue, funnel, risk, and data-quality drilldowns                                                 | analytics aggregation APIs                                                     |
| Finance                | `/finance`, `/finance/reconciliation`                                                                                                                                                                                                                          | capital pulse, consumer deposits, provider withdrawals, reconciliation investigation, Safe draft readiness | finance overview, reconciliation detail, deposits, withdrawals, treasury draft |
| Approvals And Risk     | `/approvals`, `/withdrawal-reviews`, `/review-history`, `/risk`                                                                                                                                                                                                | approval queue, provider withdrawal decisions, review history, risk queue                                  | approval, withdraw review, audit status, risk projections                      |
| Provider And Execution | `/provider-services`, `/provider-llm-config`, `/execution`                                                                                                                                                                                                     | provider registry, LLM provider/model rollout control, execution retry                                     | provider services, LLM config, execution jobs                                  |
| Identity And Access    | `/users`, `/role-permissions`, `/menu-config`                                                                                                                                                                                                                  | admin users, roles, permissions, backend menu topology                                                     | admin users, role catalog, permission catalog, menu config document            |
| Business Control       | `/config`, `/config/business-policy`, `/config/runtime`, `/config/published`, `/owner-accounts`                                                                                                                                                                | business policy draft/publish, runtime source, published snapshot, owner account lookup                    | config documents, runtime source, owner account list                           |
| Support Operations     | `/forum-support`                                                                                                                                                                                                                                               | topic lifecycle, human-reviewed replies, response history                                                  | forum response tasks, topic timeline                                           |
| Audit And Compliance   | `/audit`                                                                                                                                                                                                                                                       | immutable operator trail, error clusters                                                                   | audit action list                                                              |

## Required Workflows

### CRUD Workflows

1. Admin users: list, create, edit, disable/delete.
2. Roles: list, create, edit, delete, permission assignment.
3. Menu config: list/tree, create item, edit item, delete item, publish.
4. Business policy: edit draft, save draft, publish with step-up.
5. Forum topics: close, reopen, pin, unpin, send reviewed reply.
6. Provider services: force probe, pause, resume, suspend, delete.
7. Provider LLM rollout: request staging smoke or prod enablement.

CRUD interactions must use centered modals or route-specific pages. Do not use
right drawers or expand-in-table operation panels.

### List Workflows

1. Approvals, withdrawals, review history, audit, execution jobs.
2. Owner accounts, consumer deposits, provider withdrawals.
3. Provider services, provider LLM vendors/models/pricing.
4. Forum topics and response tasks.

All list pages must follow one structure:

1. module header
2. compact status summary
3. filter/search surface
4. table/list
5. pagination below the list

Pagination and totals must come from backend metadata when the API provides it.
The browser must not infer total pages from the current slice.

### Monitoring Workflows

1. Dashboard overview: only first-response signals and drilldown links.
2. Runtime: business bottleneck lanes, not system infra detail.
3. System: component snapshot and diagnostic actions.
4. Analytics: one topic per page; no giant all-in-one analytics surface.
5. Finance overview: capital pulse and action queues split into tabs/pages.

## Rewrite Requirements

1. The sidebar is the only feature-discovery surface.
2. Menu items are grouped by module and backed by `GET /api/admin/v1/config/menu-items/visible`.
3. Page implementations must be replaceable module views rather than one-off dashboard mosaics.
4. Shared page primitives must cover:
   - module overview
   - list workspace
   - CRUD modal
   - read-only detail
   - action confirmation
   - status and metric strip
5. Historical page code can be deleted only after the new module view preserves the route contract and E2E proof for that route.
6. Finance and approval actions must keep existing step-up, audit, and backend-owned status semantics.

## Route Contract

The active E2E route contract lives in:

```text
scripts/lib/admin_console_new_ui_contract.mjs
```

It is the executable source of truth for rewrite coverage. A route is not
considered migrated until it has:

1. expected final path
2. expected function text
3. tokenized shell proof
4. screenshot evidence
5. no missing text in `dom-evidence.json`

The active module catalog lives in:

```text
services/admin-front/src/features/admin-rewrite/module-catalog.ts
```

Every authenticated route in the screenshot contract must have exactly one
catalog entry with module, mode, title, description, and at least three section
labels. `module-catalog.test.ts` enforces this so newly added admin pages cannot
sit outside the rewritten information architecture.

## Deletion Policy

Deleting historical admin-front code is allowed only in migration batches:

1. replace route implementation with the new module system
2. remove unused old feature/component files for that route
3. run route-level E2E screenshots
4. run admin-front tests/lint/build
5. update this inventory if module ownership changes

Do not delete shared API adapters, domain status types, CSRF/session code, or
step-up helpers unless the rewrite provides equivalent typed replacements.
