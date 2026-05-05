---
id: bug-admin-rbac-sidebar-panel-links
title: Admin RBAC sidebar panel links were visible but not clickable
status: fixed
created_at: 2026-05-05
updated_at: 2026-05-05
owner: admin-front
---

# BUG-ADMIN-RBAC-SIDEBAR-PANEL-LINKS

- Surface: Admin-front sidebar, RBAC navigation
- Verified with: `cd services/admin-front && yarn test src/components/nav-tree-node.test.ts src/lib/navigation.test.ts`, `cd services/gateway-admin && .venv/bin/python -m pytest tests/test_app.py -k "menu_config"`, `npm run e2e:admin-front:dogfood`
- Last verified against code: 2026-05-05

## Symptom

The `角色权限` sidebar group rendered `权限矩阵`, `模块边界`, and
`Reviewer 分工` as visible child rows, but those rows could not navigate
anywhere. The parent `角色权限` row was also treated as expand-only because it
had children, even though it is a real page at `/role-permissions`.

## Root Cause

The Gateway-admin default menu modeled the three RBAC child rows as `panel`
nodes with `href=null`. Admin-front also treated any node with children as
non-navigable, so a `page` node with child panels lost its page link.
Local and long-lived environments could also keep an older
`admin_config_documents` snapshot, so changing only the default tree did not
repair already-published panel rows.

## Fix

The backend menu now publishes panel hrefs as `/role-permissions` hash anchors:

1. `/role-permissions#permissions-matrix`
2. `/role-permissions#module-boundaries`
3. `/role-permissions#reviewer-split`

Admin-front now allows `panel` nodes with hrefs to become links, and the sidebar
separates row navigation from the expand/collapse button. The role-permissions
page exposes matching DOM sections with stable ids. Admin-front also expands
the active page node itself, so `/role-permissions` reveals its hash panel
children without a separate manual toggle. Gateway-admin patches the three
seeded RBAC panel hrefs when it loads an older menu config snapshot.

## Evidence

The admin-front dogfood runner validates URL, hash, visible DOM text, and
screenshots:

1. `click-sidebar-role-permissions-parent-page.png`
2. `click-sidebar-role-permissions-permissions-matrix.png`
3. `click-sidebar-role-permissions-module-boundaries.png`
4. `click-sidebar-role-permissions-reviewer-split.png`
