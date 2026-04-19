# BUG-ADMIN-SIDEBAR-PARENT-NAVIGATION

**Status:** Fixed
**Area:** admin-front / navigation
**Date:** 2026-04-19

## Reproduction

1. Open `http://localhost:4000/dashboard/overview`.
2. Click the sidebar parent item labeled `控制台`.
3. Observe that the page reloads or navigates instead of expanding or collapsing the menu tree.

## Expected Behavior

Sidebar parent nodes with children should behave as tree controls. Clicking `控制台` should expand or collapse its children and keep the current URL on `/dashboard/overview`.

Leaf page nodes such as `概览` should remain normal navigable links.

## Actual Behavior

When a persisted or backend-provided menu snapshot included a stale `path` for a parent node, `NavTreeNode` rendered that parent as a Next `Link`. The click therefore navigated to the parent route instead of toggling the tree.

## Root Cause

The component decided navigability with `Boolean(item.path)` only. That made the UI depend on every upstream menu snapshot perfectly omitting paths from parent nodes. A stale parent `path` was enough to override the intended tree behavior.

## Fix

`NavTreeNode` now only renders a `Link` when the item has a path and no children. Any node with children is always rendered as an expandable control, including stale snapshots that still carry a parent `path`.

The expandable parent control also supports keyboard activation through `Enter` and `Space`, and exposes `aria-expanded` for accessibility.

## Verification

```bash
cd services/admin-front && yarn test src/components/nav-tree-node.test.ts src/lib/navigation.test.ts
node --check scripts/ui/dogfood_admin_front.mjs
```

Executed verification:

- `cd services/admin-front && yarn test src/components/nav-tree-node.test.ts src/lib/navigation.test.ts`: 15 tests passed.
- `node --check scripts/ui/dogfood_admin_front.mjs`: passed.
- `npm run e2e:admin-front`: the new `click:sidebar-dashboard-parent-toggle` browser step passed and confirmed the URL stayed on `/dashboard/overview`.

## Residual Risk

The full admin dogfood run can still fail if local gateway and gateway-admin internal token configuration is mismatched. That is an environment setup issue, not a sidebar navigation regression. The targeted browser step now covers this menu behavior directly.
