# Admin Rewrite Stitch UI Blueprint

Status: active  
Owner: admin-front  
Last updated: 2026-06-03

## Source References

The rewrite uses the existing stitch prototype package as the visual source:

1. `services/admin-front/stitch/overview/`
2. `services/admin-front/stitch/admin_login/`
3. `services/admin-front/stitch/mfa_setup_registration/`
4. `services/admin-front/stitch/reset_successful/`
5. `services/admin-front/stitch/synapse_sentinel/`

The prototype language is "Monolithic Sentinel": dark command rail, quiet
light workspace, editorial typography, compact status strips, and cloud-console
utility density.

## Visual Thesis

The new admin console is a cloud control tower for Synapse operations. It should
feel closer to Google Cloud Console or AWS Console than a startup dashboard:
searchable modules, route-specific workspaces, backend-owned tables, compact
filters, and explicit action modals.

## Shell

### Left Command Rail

1. Dark `sidebar` token surface.
2. Uses backend menu tree rendered by a shared sidebar component.
3. Shows module groups, route children, and nested config sections.
4. Search filters every module path.
5. Category nodes only expand; page/panel nodes navigate.

### Top Command Bar

1. Global search input.
2. Node/admin status chip.
3. Notification inbox.
4. Audit/log shortcut.
5. Active admin identity.

### Workspace

1. No marketing hero.
2. Every route starts with a compact module header.
3. Keep the first viewport useful: status, filter, and primary list/action.
4. Put deep details into drilldown pages or centered modals.

## Component System

The rewrite should converge on these primitives:

| Primitive           | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `ModuleShell`       | route title, description, current module, actions   |
| `ModuleStatusStrip` | 2-5 key metrics or health states                    |
| `ModuleTabs`        | page-local submode control, not global navigation   |
| `ListWorkspace`     | filter/search/table/pagination standard             |
| `CrudDialog`        | create/edit/delete modal surface                    |
| `ActionDialog`      | high-risk confirmation with immutable backend facts |
| `DetailPanel`       | permanent in-page read-only context, not a drawer   |
| `EmptyState`        | no-data state with backend-safe copy                |

## Module IA

### Control Overview

Routes:

1. `/dashboard/overview`
2. `/dashboard/runtime`
3. `/system`

UI:

1. overview page has summary metrics and drilldowns only
2. runtime page only covers business queues
3. system page owns diagnostics and infra status

### Analytics

Routes stay split by topic. No route may import all analytics surfaces at once.
Each page has:

1. one metric strip
2. one chart/table region
3. one samples/distribution region

### Finance

`/finance` becomes a Finance Desk with tabs or subroutes:

1. overview
2. consumer deposits
3. provider withdrawals
4. platform fees
5. reconciliation link

`/finance/reconciliation` remains a focused investigation page.

### Approvals And Risk

1. `/approvals`: unified queue and prioritization.
2. `/withdrawal-reviews`: decision workbench with modal step-up.
3. `/review-history`: read-only ledger.
4. `/risk`: risk policy map and risk queue.

### Provider And Execution

1. provider services list and actions
2. provider LLM config tables and rollout requests
3. execution jobs, failure clusters, retry

### Identity And Access

1. users CRUD
2. role/permission CRUD
3. menu topology CRUD and publish

### Business Control

1. `/config`: lightweight entry and health
2. `/config/business-policy`: draft editor
3. `/config/runtime`: read-only runtime source
4. `/config/published`: read-only published snapshot
5. `/owner-accounts`: owner lookup table

### Support Operations

1. forum topic lifecycle list
2. response queue/history
3. human-reviewed reply editor

## Deletion And Rewrite Strategy

The historical admin-front code should be removed by module after the new
module primitive has replaced that route.

Recommended order:

1. static/read-only monitoring routes
2. analytics routes
3. audit/execution/list routes
4. config read-only routes
5. config editing and menu publish routes
6. users/RBAC CRUD
7. finance and withdrawal review high-risk actions
8. support operations

This order avoids deleting step-up and finance-sensitive logic before the new
modal/action framework is proven.

## E2E Acceptance

Each migrated route must pass:

```bash
npm run e2e:admin-console-new-ui:local
npm run ci:admin-console-new-ui-local-evidence
```

Acceptance requires:

1. local password-only login
2. backend menu tree visible
3. route final path correct
4. route expected function texts present
5. tokenized shell present
6. screenshot exists and is non-empty
7. no secret patterns in evidence
