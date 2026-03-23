# admin-front Hard Rules

Local execution mirror for `admin/admin-front/`.

Canonical rules doc:

1. `docs/agents.md`
2. `docs/03_Projects/admin-front/Admin_Front_Agent_Rules.md`

## 1. Core Engineering Rules

- Use feature-based structure. Group code by business surface such as `features/auth` or `features/orders`, not only by technical type.
- Keep components lean. UI state stays in functional components and hooks; complex orchestration and data shaping should live in typed services or presenter-style modules.
- Reuse shared UI. Prefer `/src/components` before creating new page-local primitives.
- Keep types strict. Do not use raw `any` or loose JSON blobs for internal logic.
- Prefer domain-shaped models. Use TypeScript interfaces or classes when data carries validation, derived fields, or behavior.

## 2. Quality Gate

- Add or update tests for every meaningful utility, presenter, service, or component change.
- Test behavior, not implementation details.
- After significant modifications, always run lint, test, and build before considering the task complete.

## 3. Useful Commands

| Command | Purpose | When to Run |
| --- | --- | --- |
| `npm run dev` | Start Next.js dev server with HMR. | During active coding/iteration. |
| `npm run lint` | Run ESLint/Prettier checks. | After modification. |
| `npm run test` | Execute the test suite. | After modification (Mandatory). |
| `npm run build` | Production build & Type check. | Before final submission/commit. |

### HMR Note

Always use `npm run dev` while iterating. Do not keep the dev server running while executing `npm run build` as it may lead to inconsistent states in the `.next` directory.

This file stays intentionally shorter than the canonical root document so local agent discovery remains stable without duplicating the whole rule source.

## 4. Development Workflow

### Dependency Sync

If adding packages, update the lockfile (`yarn.lock`) and restart the dev server.

### Coding Conventions

- Prefer TypeScript (`.ts`/`.tsx`) exclusively.
- Co-locate styles with the component when practical.
- Check existing utilities and components before creating new ones.

### 保持文档和前端页面一致

When working on `admin/admin-front`, consult the backend/admin document index under `docs/admin/` so page behavior, IA, approval semantics, and control-plane wording stay aligned with `gateway-admin`.

Recommended `docs/admin/` reading order:

- `docs/admin/README.md`: admin document entrypoint and scope overview.
- `docs/admin/Platform_Admin_Backoffice_Architecture.md`: source of truth for module boundaries, page responsibilities, and admin-front vs gateway-admin separation.
- `docs/admin/Admin_API_Contract_Phase1.md`: backend contract baseline for dashboard, approvals, audit, execution, users, and config APIs.
- `docs/admin/Admin_RBAC_Design.md`: admin roles, permission boundaries, and surface visibility model.
- `docs/admin/Admin_Approval_Workflow.md`: approval states, reviewer flow, and high-risk action control path.
- `docs/admin/Admin_Audit_and_Compliance.md`: audit trail semantics, operator trace requirements, and compliance expectations.
- `docs/admin/Admin_Finance_Operations_Runbook.md`: finance console responsibilities, operational actions, and exception handling flows.
- `docs/admin/Admin_Gateway_Security_Design.md`: admin security boundary, MFA, token, and privileged action guardrails.
- `docs/admin/Admin_Database_Design.md`: admin-side persistent model and read-model boundaries.
- `docs/admin/Gateway_Admin_Projection_Views_SQL_Design.md`: projection/read-model semantics that drive dashboard, finance, and operations pages.
- `docs/admin/Admin_PostgreSQL_Deployment_Design.md`: deployment and operational constraints relevant to runtime/system pages.

For any admin-front page that maps to a `gateway-admin` module, align UI copy, filters, statuses, and control flow to these documents before inventing frontend-only semantics.

### 保持实现与 `stitch` 原型一致

When implementing or refactoring any `admin/admin-front` page, treat `admin/admin-front/stitch/` as the primary visual and interaction prototype library for that surface.

Recommended prototype lookup order:

- `admin/admin-front/stitch/overview/`: console shell, dashboard density, card rhythm, signal surfaces, and global Sentinel tone.
- `admin/admin-front/stitch/admin_login/`: admin sign-in composition, security framing, CTA posture, and auth entry hierarchy.
- `admin/admin-front/stitch/mfa_setup_registration/`: MFA enrollment, QR/manual key layout, verification cadence, and secure initialization mood.
- `admin/admin-front/stitch/reset_successful/`: success-state composition, post-action confirmation rhythm, and return-entry CTA treatment.
- `admin/admin-front/stitch/synapse_sentinel/`: shared Sentinel design language and supporting visual rules.

For each matching page, review `screen.png`, `code.html`, and `DESIGN.md` in that `stitch` subfolder before implementation.

Resolution rules when references differ:

- `docs/admin/` defines product semantics, IA, permissions, workflow states, and backend-aligned wording.
- `stitch/` defines visual hierarchy, spatial composition, component silhouette, and auth/dashboard atmosphere.
- If behavior from `docs/admin/` conflicts with a prototype, keep the documented behavior and adapt the prototype visually instead of changing product semantics.

## 5. List Page Standards

所有列表页默认遵循统一的 List Page 结构，不允许每个页面单独发明一套搜索区、按钮区和分页区布局。

### 5.1 Standard Information Hierarchy

Every list page should follow this top-to-bottom order:

1. Page title and short business description.
2. Search and filter area.
3. Search action row.
4. Data table or list body.
5. Pagination area below the list.

Do not place pagination controls inside the top filter area unless the page has an exceptional workflow explicitly documented.

### 5.2 Search Area Rules

- All search conditions must be placed above the list body.
- Search conditions should be grouped inside one consistent filter container or surface card.
- Common filters such as keyword, status, owner, reviewer, date range, and type should align on a clean grid.
- Inputs should prioritize scan efficiency: same height, same radius family, consistent spacing, and predictable label placement.
- Date range fields should appear as a start field plus an end field, not as ambiguous freeform text.
- Avoid mixing inline summary text into the filter row. Filter rows are for input and action only.

### 5.3 Search Button Rules

- Every list page must provide a dedicated `搜索` button.
- The `搜索` button belongs directly below or to the right of the filter inputs, depending on available width.
- Changing filter values should not automatically trigger a request unless the page explicitly requires live search.
- Clicking `搜索` should apply all current filter conditions in one request.
- While loading, the button must show a loading state and prevent duplicate submission.
- Text inputs inside the search area should support `Enter` to submit the current search form.
- Every list page should also provide a dedicated `重置筛选` button near the search button.
- `重置筛选` should restore default filter values and return the list to the first page.

### 5.4 Pagination Rules

- Pagination controls must be placed below the table or list body, not above it.
- Every paginated list must provide at minimum:
	- `上一页`
	- `下一页`
	- `每页记录条数`
	- `总页数`
- If the backend provides total record count, also show total records near the pagination area.
- Disabled pagination buttons must have a clear disabled state and should not visually compete with the primary search action.
- Pagination information should read as operational metadata, not as a primary CTA.

Recommended pagination layout:

- Left side: `每页 10 / 20 / 50 条` selector.
- Middle: total pages and optional total records.
- Right side: `上一页` and `下一页` buttons.

Search action row recommendation:

- Left side: primary `搜索` button.
- Next to it: secondary `重置筛选` button.
- Support `Enter` submit on desktop and laptop keyboard workflows.

### 5.5 Table Content Rules

- Prefer one column for one business concept. Do not collapse unrelated business fields into a single dense cell unless space is severely constrained.
- If a field is important enough for filtering or sorting, it should usually have its own visible column.
- Avoid stacking too many secondary lines inside the first column. This reduces scan speed and breaks row rhythm.
- Secondary metadata such as tx hash, request id, internal message, or reviewer role should go into detail drawers, expandable rows, or explicitly named columns when they are core to the workflow.

### 5.6 List Surface Design Principles

All list components should feel operational, clean, and calm rather than generic admin CRUD.

- Use one clear surface for the filter zone and one clear surface for the data zone.
- Preserve strong horizontal rhythm: filters, actions, header row, data rows, pagination.
- Favor generous whitespace over cramped density in the search area.
- Keep the table header visually quiet but readable. Avoid heavy decoration.
- Use status chips only for states and decisions. Do not overuse badges for ordinary text.
- Primary action weight should belong to `搜索` or the page's core action, not to pagination.
- Keep row height stable across the table so scanning by eye remains fast.
- Empty states should appear inside the list surface, with a short explanation of how to adjust filters.
- Detail actions such as `详情` should be lightweight and visually secondary.

### 5.7 Shared Componentization Rules

To keep all future list pages consistent, list-page structure must be built from shared primitives instead of page-local wrappers.

- Use `ListFilterForm` for the search and action area.
- Use `ListFilterFields` for config-driven filter field rendering instead of repeating page-local `Grid + input/select` markup.
- Use shared field presets for recurring combinations such as `keyword`, `status`, and `date-range` before defining page-local field configs.
- Use `ListPaginationBar` for the bottom pagination area.
- Use `ListTableSurface` as the default page-level list scaffold that composes `筛选区 + 表格区 + 分页区` into one shared surface.
- Do not hand-assemble `SurfaceCard + custom filter wrapper + custom pagination wrapper` in each list page unless the page has a documented exception.
- Prefer a field config array when the page only differs by placeholders, options, and bound values.
- When a page uses common query patterns, compose the field array from shared presets first and add custom fields only for business-specific gaps.
- If a page needs extra summary text, stamps, or actions, pass them through the shared list surface instead of creating a parallel layout.
- Empty state content should also stay inside `ListTableSurface`, so users always read filters, results, and pagination as one operational unit.

### 5.8 Visual Quality Bar

For all future list pages in `admin/admin-front`, the expected quality bar is:

- Business-first layout: filters first, results second, navigation last.
- Predictable interaction: users always know where to search, where to turn pages, and where to inspect details.
- Consistent pagination: same placement and same wording across pages.
- Clean visual grouping: no floating controls that feel detached from the list they operate on.
- High scan readability on desktop first, while still collapsing cleanly on smaller screens.

If a page cannot follow this structure, document the reason in the implementation PR or design note instead of silently diverging.

## 6. System Design & Visual Identity

为了让 AI 在后续开发中稳定复刻图片中的“赛博工业风”与“数据驱动”的设计感，需要把认证页与 Dashboard 原型收敛成一套统一的系统设计语言。

### 6.1 Visual Theme: "Synapse Sentinel"

The project follows a Cyber-Industrial / High-Fidelity Data aesthetic, blending terminal-style precision with modern dashboard clarity.

#### Color Palette (Neural & High-Contrast)

| Element | Color Code | Description |
| --- | --- | --- |
| Void Black | `#05080A` | Primary background for auth and sidebars. |
| Sentinel Cyan | `#00E5FF` | Primary accent, used for "Active" states and "Execute" buttons. |
| Alert Red | `#FF3B30` | Critical warnings, "Degraded" status, or "3 Critical" alerts. |
| Nominal Green | `#00FF41` | Success states and healthy system nodes. |
| Neural Gray | `#1A1C1E` | Card backgrounds and secondary UI containers. |

#### Typography

- Monospace (Data): Use for numerical values, timestamps, and system logs, for example JetBrains Mono or Roboto Mono.
- Sans-Serif (Labels): Use for UI labels and titles, for example Inter or Geist.
- High letter-spacing (`tracking`) for titles like `PROTOCOL AUTH 2FA`.

### 6.2 Component Design Guidelines

#### Layout & Containers

- Brutalism-Lite: Use sharp corners (`0px` or `2px` border-radius). Avoid excessive rounding.
- Glassmorphism: Apply subtle background blur (`backdrop-filter: blur(10px)`) and semi-transparent overlays for modals and cards.
- Border Accents: Use "Corner Brackets" (L-shaped corners) for critical focus areas like the 2FA input box.

#### Data Visualization & Status

- Integrity Bars: Status bars like `Operations Status` should be thin, using solid color fills without gradients, ending with a text label such as `NOMINAL`.
- Activity Streams: Tables should have minimal padding, no vertical borders, and use color-coded badges for threat levels like `Critical`, `Elevated`, and `Monitoring`.
- Terminal Elements: Include decorative latency or entropy metrics, for example `NETWORK_LATENCY: 12ms`, to reinforce the system monitoring vibe.

#### Interactive Elements

- Primary Buttons: Large, blocky, and glowing. Use the `Sentinel Cyan` background with black uppercase text.
- Input Fields: Ghost-style inputs with subtle borders. In 2FA, use discrete boxes for each digit with a focus glow effect.

### 6.3 Page Patterns

#### Authentication Flow (Dark Mode Only)

- Center-aligned containers.
- Heavy use of decorative `Secure Sentinel Active` text on the right as a visual anchor.
- Abstract system status snippets, for example `HARDWARE-GRADE ENCRYPTION SUB-ROUTINES OPERATIONAL`, as background or sidebar elements.

#### Dashboard & Functional Pages (Hybrid Mode)

- Top Bar: Global search with a dark background, user profile with a square avatar.
- Stat Cards: Large, bold white numbers for primary metrics, with small colored trend indicators such as `+12.4%`.
- Diagnostic Buttons: High-contrast black buttons for system-level actions such as `RUN_SYSTEM_DIAGNOSTIC`.