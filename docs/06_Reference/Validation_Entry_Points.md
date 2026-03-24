# Validation Entry Points

## 1. Purpose

This page lists the canonical validation anchors AI agents and maintainers should use before closing work.

Rule: start with the narrowest relevant check, then escalate to repo-level CI only when the change crosses project or contract boundaries.

## 2. Repository-Level Validation

From repository root:

1. `npm run ci:docs`
2. `npm run ci:frontend`
3. `npm run ci:admin-front`
4. `npm run ci:admin-gateway`
5. `npm run ci:gateway`
6. `npm run ci:provider-service`
7. `npm run ci:sdk-python`
8. `npm run ci:contracts`
9. `npm run ci:pr`

Use these wrappers when final integration confidence is required.

## 3. Project-Level Validation

### 3.1 apps/frontend

Working directory: `apps/frontend/`

1. `yarn dev` for active iteration
2. `yarn test` for local frontend test validation
3. `npm run ci:frontend` from repository root when repo-standard gating is needed

### 3.2 admin/admin-front

Working directory: `admin/admin-front/`

1. `npm run dev` for active iteration
2. `npm run lint`
3. `npm run test`
4. `npm run build` only when the task explicitly needs final build confirmation
5. `npm run ci:admin-front` from repository root when repo-standard gating is needed

### 3.3 admin/gateway-admin

Working directory: `admin/gateway-admin/`

1. `/Users/cliff/workspace/Synapse-Network/admin/gateway-admin/.venv/bin/python -m pytest tests/test_app.py -q`
2. `npm run ci:admin-gateway` from repository root when repo-standard gating is needed

Runtime ops anchors:

1. `sh scripts/ops/start-local.sh`
2. `sh scripts/ops/stop.sh`
3. `sh scripts/ops/restart.sh`
4. `sh scripts/ops/status.sh`

### 3.4 provider_service

Working directory: `provider_service/`

1. `./.venv/bin/python -m pytest tests -q`
2. `npm run ci:provider-service` from repository root when repo-standard gating is needed

### 3.5 gateway

Canonical gate:

1. `npm run ci:gateway`

For local gateway workflows, follow the canonical project page under `docs/03_Projects/gateway/` and its linked development guide.

### 3.6 contracts

Canonical gate:

1. `npm run ci:contracts`

### 3.7 sdk/python

Canonical gate:

1. `npm run ci:sdk-python`

## 4. Finish Checklist

### Finance-sensitive backend or admin work

Before finishing:

1. update docs if behavior changed
2. update tests if behavior changed
3. prefer the narrow project-local test plus the matching repo `ci:*` gate when risk is high

### Frontend work

Before finishing:

1. verify the local dev server path used during iteration still matches docs
2. run the relevant project-local test or lint command
3. use the root `ci:*` wrapper before closing cross-surface UI work

### Docs-only work

Before finishing:

1. ensure new files are linked from existing canonical indexes
2. ensure no stale guidance remains in AGENTS, instructions, or README files
3. run `npm run ci:docs`

### Docs governance or structure work

Before finishing:

1. update `docs/README.md` and `llms.txt` if entrypoints moved
2. update `docs/00_Governance/Documentation_Constraints.md` if hard boundaries changed
3. run `npm run ci:docs`

## 5. When To Escalate Validation

Escalate from project-local checks to repo-level checks when:

1. a task crosses more than one project
2. API contracts changed
3. settlement, approval, or audit behavior changed
4. a local change affects shared instructions or canonical docs