# Admin Control Console Redesign

Status: active  
Owner: admin-front  
Last updated: 2026-06-03

## Product Plan

The admin console should behave like an infrastructure control plane, closer to Google Cloud Console or AWS Console than a flat dashboard. The first screen is a workbench with navigation, search, health, and the current operating surface; individual business functions live in modules under the backend-provided sidebar tree.

### Information Architecture

1. Control Overview
   - Dashboard overview, runtime, health, analytics, and system diagnostics.
   - Purpose: answer "what needs attention now?"
2. Finance Operations
   - Finance desk, reconciliation, platform treasury readiness, deposits, withdrawals, and provider receivables.
   - Purpose: keep money movement auditable and scan-friendly.
3. Approvals And Risk
   - Approval queue, withdrawal reviews, risk controls, review history, and audit.
   - Purpose: separate review decisions from passive monitoring.
4. Provider And Execution
   - Provider services, execution jobs, provider LLM config, and operational incidents.
   - Purpose: isolate runtime/provider action surfaces.
5. Identity And Access
   - Admin users, roles, permissions, session posture, and audit-linked access state.
   - Purpose: make privileged access explicit.
6. Business Control
   - Config center, business policy, runtime config, published config, menu config, and owner accounts.
   - Purpose: collect configuration workflows under one backend-owned module tree.
7. Support Operations
   - Forum support, notification review, and external reply workflows.
   - Purpose: keep human-in-the-loop support actions out of finance and runtime pages.

The sidebar is the only navigation source for feature discovery. Menu data comes from `GET /api/admin/v1/config/menu-items/visible`, backed by `admin_config_documents.config_key='admin_menu_config'`; the browser renders what the backend returns and does not invent hidden routes or local fallback menus.

## UI Design

### Visual Thesis

Synapse Admin is a tokenized "Sentinel Console": dark left command rail, quiet high-density work surface, precise status tokens, and restrained cloud-console utility instead of decorative dashboard cards.

### Token Model

The design follows the shadcn/ui theme-token convention documented at `https://ui.shadcn.com/docs/theming#theme-tokens`, adapted to the existing Chakra stack:

1. Global CSS defines semantic tokens under `:root`: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `chart-1..5`, `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-accent`, `sidebar-border`, `sidebar-ring`, and `radius`.
2. Chakra exposes those values through `shadcn.*` tokens so components can use semantic names rather than hardcoded colors.
3. Radius is intentionally tighter than the early prototype: `--radius: 0.75rem`, with derived `sm/md/lg/xl` values for controls, panels, popovers, and sidebar rows.
4. Chart and status colors must use `chart-*`, `accent`, `destructive`, and domain status tone helpers instead of one-off page colors.

### Shell Pattern

1. Left sidebar
   - Dark `sidebar` surface.
   - Backend-provided tree nodes rendered by the shared `NavTreeNode` component.
   - Search remains in the sidebar and filters the full tree.
   - Category nodes expand only; page and panel nodes navigate.
2. Top bar
   - Sticky command/search region.
   - Notification inbox, audit/log shortcut, and active admin identity.
   - Uses `card`, `border`, `input`, `ring`, and `accent` tokens.
3. Page header
   - Short title, business description, current surface, and page actions.
   - No marketing hero, no long prose, no operational forms in the header.
4. Workspace
   - Dense full-width sections with shared `SurfaceCard`, `ListTableSurface`, and modal primitives.
   - Operation details, confirmations, and reviews open as centered modal/popup surfaces, never right drawers.

### Module Page Rules

1. Overview pages show status, queues, and drill-down links only.
2. List pages use the shared sequence: title, filter surface, action row, table/list body, pagination below.
3. Config pages stay split: `/config`, `/config/business-policy`, `/config/runtime`, `/config/published`, and `/menu-config`.
4. Finance and withdrawal review pages must keep backend-owned money/status truth visible and must not infer totals or terminal states in the browser.
5. Support pages must make generated suggestions advisory; public replies require explicit admin action.

## E2E Verification Plan

Local screenshot verification must run with Google FA disabled only in local:

```bash
ADMIN_GOOGLE_AUTHENTICATOR_LOGIN_ENABLED=false \
ADMIN_GOOGLE_AUTHENTICATOR_HIGH_RISK_ENABLED=false \
bash scripts/local/start_all_services.sh restart

npm run e2e:admin-console-new-ui:local
npm run ci:admin-console-new-ui-local-evidence
```

The E2E must prove:

1. Login uses username/password only and does not show TOTP fields when local policy disables Google FA.
2. The shell renders `data-ui-system="shadcn-token-console"`.
3. The sidebar and top bar are present on every authenticated module route.
4. Visible menu API returns backend menu items and the sidebar exposes those `data-nav-id` entries.
5. Every authenticated admin route renders a non-auth, non-loading page state.
6. Every route proves function-level text from `scripts/lib/admin_console_new_ui_contract.mjs`, not only shell presence.
7. Redirect routes such as `/dashboard` and `/dashboard/health` prove their expected final path.
8. Screenshots are captured only after DOM checkpoints and route text checkpoints pass.

Evidence should be written under:

```text
output/e2e/admin-console-new-ui-local/<timestamp>/
```

Required artifacts:

1. `report.json`
2. `report.md`
3. `api-evidence.json`
4. `dom-evidence.json`
5. `screenshot-evidence.json`
6. `trace.jsonl`
7. `screenshots/*.png`

The current local route contract covers `31` authenticated routes and captures `32` screenshots, including the password-only login page. Each screenshot metadata row records:

1. `route`
2. `expectedPath`
3. `actualPath`
4. `uiSystem=shadcn-token-console`
5. `expectedTexts`
6. `missingTexts=[]`

## Implementation Notes

The current P0 implementation keeps Chakra UI and introduces shadcn-style semantic tokens. Do not migrate the project to Tailwind or install shadcn components unless there is a separate migration plan. The priority is a professional, tokenized admin control plane that keeps existing backend contracts and E2E harnesses intact.
