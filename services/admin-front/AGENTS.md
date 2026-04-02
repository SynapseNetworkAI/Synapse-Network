# admin-front Hard Rules

Local execution mirror for `services/admin-front/`.

## Canonical Sources

1. `docs/AGENTS.md`
2. `.github/instructions/frontend.instructions.md`
3. `.github/instructions/admin-console.instructions.md`
4. `docs/03_Projects/admin-front/Admin_Front_Agent_Rules.md`

## Local Commands

| Command | Purpose | When to Run |
| --- | --- | --- |
| `npm run dev` | Start Next.js dev server with HMR. | During active coding and iteration. |
| `npm run lint` | Run lint checks. | After meaningful modifications. |
| `npm run test` | Execute the test suite. | After meaningful modifications. |
| `npm run build` | Production build and type check. | Only when the task explicitly needs final build validation. |

Always use `npm run dev` while iterating. Do not keep the dev server running while executing `npm run build`.

## Product and Docs Alignment

### 保持文档和前端页面一致

When working on `services/admin-front`, consult the backend/admin document index under `docs/admin/` so page behavior, IA, approval semantics, and control-plane wording stay aligned with `gateway-admin`.

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

When implementing or refactoring any `services/admin-front` page, treat `services/admin-front/stitch/` as the primary visual and interaction prototype library for that surface.

Recommended prototype lookup order:

- `services/admin-front/stitch/overview/`: console shell, dashboard density, card rhythm, signal surfaces, and global Sentinel tone.
- `services/admin-front/stitch/admin_login/`: admin sign-in composition, security framing, CTA posture, and auth entry hierarchy.
- `services/admin-front/stitch/mfa_setup_registration/`: MFA enrollment, QR/manual key layout, verification cadence, and secure initialization mood.
- `services/admin-front/stitch/reset_successful/`: success-state composition, post-action confirmation rhythm, and return-entry CTA treatment.
- `services/admin-front/stitch/synapse_sentinel/`: shared Sentinel design language and supporting visual rules.

For each matching page, review `screen.png`, `code.html`, and `DESIGN.md` in that `stitch` subfolder before implementation.

Resolution rules when references differ:

- `docs/admin/` defines product semantics, IA, permissions, workflow states, and backend-aligned wording.
- `stitch/` defines visual hierarchy, spatial composition, component silhouette, and auth/dashboard atmosphere.
- If behavior from `docs/admin/` conflicts with a prototype, keep the documented behavior and adapt the prototype visually instead of changing product semantics.

## Admin Console Detail Rules

- Use `.github/instructions/admin-console.instructions.md` for list-page layout, filter behavior, pagination semantics, and control-plane status presentation.
- Keep this AGENTS file focused on local docs, commands, and project-only visual references.

## System Design & Visual Identity

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