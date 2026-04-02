# Dashboard Navigation Loading Strategy

- Status: active
- Scope:
  - [DashboardSidebar.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard/DashboardSidebar.tsx)
  - [DashboardNavigationFeedback.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard/DashboardNavigationFeedback.tsx)
  - [DashboardPageLoadingState.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/loading/DashboardPageLoadingState.tsx)
  - [useOwnerData.ts](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/hooks/useOwnerData.ts)

## 1. Goal

Sidebar navigation must feel immediate.

The UX target is:

1. click a left-nav route
2. main panel responds immediately
3. route shell switches without waiting for page data
4. page data hydrates behind a visible loading state

The user should never feel that the sidebar click was ignored or blocked.

## 2. Root cause

Most dashboard routes currently export client components directly from `app/**/page.tsx`.

That means:

1. Next `loading.tsx` only helps for route-segment suspense
2. page data still loads later inside `useEffect`
3. without an app-level transition layer, the old page can remain visible too long
4. users interpret that delay as click lag or UI freeze

## 3. Stable solution

### 3.1 Immediate route feedback

Sidebar links must not rely on default `Link` behavior alone for perceived responsiveness.

Required pattern:

1. intercept normal left-click
2. set route-transition state immediately
3. schedule `router.push()` in a transition on the next frame
4. keep modifier-click and middle-click behavior untouched

Implementation anchor:

- [DashboardSidebar.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard/DashboardSidebar.tsx)

### 3.2 Shared main-panel transition overlay

Dashboard and Provider layouts must render a shared main-content overlay while route transition is pending.

This overlay exists to:

1. acknowledge the click instantly
2. avoid staring at stale content
3. buy enough time for route code and page shell to render

Implementation anchors:

1. [dashboard/layout.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/app/dashboard/layout.tsx)
2. [provider/layout.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/app/provider/layout.tsx)
3. [DashboardNavigationFeedback.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard/DashboardNavigationFeedback.tsx)

### 3.3 Page-level data skeletons

After route shell swap, the page itself must render a loading state while client-side data is bootstrapping.

Do not wait for API data before showing the page container.

For pages with stable chrome and predictable first-screen structure, prefer shell-first rendering with local section skeletons over a full-page blocking loader.

Required pattern for client-data pages:

1. hooks expose `isBootstrapping` or equivalent first-load state
2. page renders either `DashboardPageLoadingState` or local section skeletons during initial hydration
3. page title, frame, and primary actions should appear before secondary data settles
4. refresh actions use lighter local refresh states instead of full route-blocking loaders

Current first adopters:

1. [DashboardOverviewPage.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard-workspace/DashboardOverviewPage.tsx)
2. [OwnerCreditsPage.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard-workspace/OwnerCreditsPage.tsx)

### 3.4 Route-specific code splitting

Heavy dashboard routes must not ship guide-only or table-heavy code in the first navigation payload when that code is not needed for the active mode.

Required pattern:

1. workspace mode must not eagerly import guide-mode panels
2. route shell owns the heading and immediate page frame
3. heavier secondary content can mount through dynamic import with visible skeletons

Current adopters:

1. [DashboardAgentsPage.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard-workspace/DashboardAgentsPage.tsx)
2. [DashboardInvocationsPage.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard-workspace/DashboardInvocationsPage.tsx)
3. [DashboardInvocationsContent.tsx](/home/alex/Documents/cliff/Synapse-Network/apps/frontend/src/components/dashboard-workspace/DashboardInvocationsContent.tsx)

## 4. Performance rules

1. keep idle prefetch for major sidebar routes
2. add hover/focus prefetch for explicit nav intent
3. do not block navigation on non-critical data fetches
4. auth-gated routes may delay `router.push`, but they must still show immediate UI intent once auth succeeds
5. `loading.tsx` stays as a route fallback, but it is not the primary UX mechanism for client-data pages
6. do not eagerly load guide-only components on workspace routes

## 5. Rollout rule

Any dashboard or provider page that still fetches critical first-screen data inside `useEffect` must migrate to this contract:

1. expose page bootstrap state from the data hook
2. render shared page skeleton on first load
3. avoid flashing placeholder zeros or empty-state lies before real data returns

## 6. Validation

Minimum validation after navigation UX changes:

```bash
cd apps/frontend && npx vitest run src/components/dashboard/DashboardSidebar.test.tsx
cd apps/frontend && npx vitest run src/components/dashboard-workspace/OwnerCreditsPage.test.tsx
```