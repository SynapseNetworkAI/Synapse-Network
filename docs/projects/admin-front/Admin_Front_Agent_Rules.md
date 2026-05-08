# Admin Front Agent Rules

## Role

1. `admin/admin-front/` is the platform administrator frontend.
2. It renders the control-plane UX for operations, finance, risk, approvals, audit, and system surfaces.
3. It must stay aligned with `gateway-admin` semantics, not invent browser-only truth.

## Core Engineering Rules

1. Use feature-based structure.
2. Keep components lean.
3. Reuse shared UI before creating page-local primitives.
4. Keep types strict.
5. Prefer domain-shaped models when data carries validation, derived fields, or behavior.

## Quality Gate

1. Add or update tests for every meaningful utility, presenter, service, or component change.
2. Test behavior, not implementation details.
3. After significant modifications, run lint and test.
4. Avoid running production build while the dev server is active.
5. Use Yarn for all `admin-front` local commands; do not regenerate `package-lock.json`.

Useful commands:

```bash
cd /Users/cliff/workspace/agent/Synapse-Network/services/admin-front
yarn dev
yarn lint
yarn test
yarn build
```

## Documentation Alignment

When working on `admin/admin-front`, consult `docs/admin/` first so page behavior, IA, approval semantics, and control-plane wording stay aligned with `gateway-admin`.

Recommended reading order:

1. `docs/admin/README.md`
2. `docs/admin/Platform_Admin_Backoffice_Architecture.md`
3. `docs/admin/Admin_API_Contract_Phase1.md`
4. `docs/admin/Admin_RBAC_Design.md`
5. `docs/admin/Admin_Approval_Workflow.md`
6. `docs/admin/Admin_Audit_and_Compliance.md`
7. `docs/admin/Admin_Finance_Operations_Runbook.md`
8. `docs/admin/Admin_Gateway_Security_Design.md`
9. `docs/admin/Admin_Database_Design.md`
10. `docs/admin/Gateway_Admin_Projection_Views_SQL_Design.md`
11. `docs/admin/Admin_PostgreSQL_Deployment_Design.md`

## Prototype Alignment

Treat `admin/admin-front/stitch/` as the primary visual and interaction prototype library.

Priority lookup:

1. `stitch/overview/`
2. `stitch/admin_login/`
3. `stitch/mfa_setup_registration/`
4. `stitch/reset_successful/`
5. `stitch/synapse_sentinel/`

Resolution rule:

1. `docs/admin/` defines product semantics.
2. `stitch/` defines visual hierarchy and interaction atmosphere.
3. If they conflict, keep documented behavior and adapt the prototype visually.

## List Page Standards

All list pages should follow a stable business-first structure:

1. page title and description
2. search and filter area
3. search action row
4. table or list body
5. pagination below the list

Use shared primitives for filters, table surfaces, and pagination. Do not rebuild page-local list scaffolding unless there is a documented exception.

## Operation Surface Rules

1. Create, edit, detail, review, finance confirmation, feedback, and logout actions must open a centered modal or popup.
2. Do not introduce right-side drawers, slide-out panels, or sidebar expansion for clicked admin operations.
3. The sidebar is navigation only. A permanent in-page two-column reading context is allowed only when it is not opened as an overlay.
4. Modal screenshots must be backed by DOM assertions for `role="dialog"` and `aria-modal="true"`; screenshot existence alone is not enough.

## Support And Community Ops Rules

Support-oriented control-plane pages, including `/forum-support`, must keep automation advisory and human action explicit:

1. Agent or Growing suggestions may prefill drafts, classifications, priorities, and internal links.
2. Public replies must always require an administrator to review, edit, and click send.
3. Do not auto-send public replies, financial commitments, production incident commitments, refund promises, or root-cause claims from generated text.
4. Historical support tasks must be read-only by default to avoid duplicate public responses.
5. Queue/list clicks should switch the workbench context in place; use navigation only when opening an external source of truth.
6. Candidate, Requirement, and Workflow links are references for product follow-up, not implicit approvals or executions.
7. Topic lifecycle actions (`close`, `reopen`, `pin`, `unpin`, `hide`) must be explicit admin actions backed by `gateway-admin` APIs and audit/timeline events.
8. Closing a forum topic means "public but no more replies"; do not hide or delete content as a side effect of closing.
9. Forum operations lists must use backend pagination and backend status filters. The browser must not derive "all topics" truth from the response queue.

## Finance Approval UI Rules

Withdrawal review pages are financial control surfaces. The browser may initiate a reviewed action, but it must not invent approval truth.

1. `/withdrawal-reviews` must treat Gateway/Gateway-admin as the source of truth for withdrawal status, ticket, amount, reviewer, and tx hash.
2. Approve/reject buttons must expose clear phases: waiting for MFA, submitting, and submitted terminal state. Both buttons must stay disabled after a successful decision while the modal keeps the current withdrawal snapshot visible.
3. Step-up authentication must use a safe TOTP window in dogfood scripts; do not generate a code in the final seconds of a TOTP period.
4. Any UI change that affects withdrawal approval, review history, finance reconciliation, or approval queue behavior must preserve screenshot + DB/API/chain evidence through `npm run e2e:admin-withdrawal-approval`.
5. UI smoke does not prove funds safety. Release evidence must include provider USDC delta, vault USDC delta, DB status/txHash, and provider pending/frozen bucket checks.

## Visual Identity

Admin front follows the Synapse Sentinel cyber-industrial design language:

1. strong contrast
2. data-dense but calm layouts
3. focused signal colors
4. infrastructure-grade visual credibility

## Documentation Sync

If admin-front behavior, IA, setup, or control-plane wording changes, update together:

1. `admin/admin-front/README.md`
2. `admin/admin-front/AGENTS.md`
3. `docs/03_Projects/admin-front/Admin_Front_Local_Development.md`
4. this file
5. any affected `docs/admin/` canonical docs

## Stop Conditions

1. Frontend is inventing backend truth that should come from `gateway-admin`.
2. UI copy diverges from documented admin semantics.
3. List pages diverge from shared structure without a documented reason.
4. Product semantics are changed to match a prototype instead of the backend-aligned docs.
