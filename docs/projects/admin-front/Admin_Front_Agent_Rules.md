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
