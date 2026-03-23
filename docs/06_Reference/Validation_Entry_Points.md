# Validation Entry Points

## 1. Purpose

This page lists the current validation anchors that AI agents and maintainers should use before closing work.

Prefer the narrowest validation that still covers the change.

## 2. Repository-Level Validation

From repository root:

1. `npm run ci:frontend`
2. `npm run ci:admin-front`
3. `npm run ci:admin-gateway`
4. `npm run ci:gateway`
5. `npm run ci:provider-service`
6. `npm run ci:sdk-python`
7. `npm run ci:contracts`
8. `npm run ci:pr`

Use repository-level CI wrappers when the task crosses project boundaries or when final integration confidence is needed.

## 3. Project-Level Validation

### 3.1 apps/frontend

Working directory: `apps/frontend/`

1. `yarn dev` for active iteration
2. `yarn test` for local frontend test validation
3. `npm run ci:frontend` from repository root for repo-standard gate

### 3.2 admin/admin-front

Working directory: `admin/admin-front/`

1. `npm run dev` for active iteration
2. `npm run lint`
3. `npm run test`
4. `npm run build` only when the task explicitly needs final build validation
5. `npm run ci:admin-front` from repository root for repo-standard gate

### 3.3 admin/gateway-admin

Working directory: `admin/gateway-admin/`

1. `/Users/cliff/workspace/Synapse-Network/admin/gateway-admin/.venv/bin/python -m pytest tests/test_app.py -q`
2. `npm run ci:admin-gateway` from repository root for repo-standard gate

Operations anchors:

1. `sh scripts/ops/start-local.sh`
2. `sh scripts/ops/stop.sh`
3. `sh scripts/ops/restart.sh`
4. `sh scripts/ops/status.sh`

### 3.4 provider_service

Working directory: `provider_service/`

1. `./.venv/bin/python -m pytest tests -q`
2. `npm run ci:provider-service` from repository root for repo-standard gate

### 3.5 gateway

Primary repo-standard gate:

1. `npm run ci:gateway`

For gateway-specific local development details, follow the canonical project page under `docs/03_Projects/gateway/` and its linked local development guide.

### 3.6 contracts

Primary repo-standard gate:

1. `npm run ci:contracts`

### 3.7 sdk/python

Primary repo-standard gate:

1. `npm run ci:sdk-python`

## 4. Workflow-Specific Checks

### Finance-sensitive backend or admin work

Before finishing:

1. confirm docs were updated if behavior changed
2. confirm tests were updated if behavior changed
3. prefer the project-local narrow test plus the corresponding repo `ci:*` gate when risk is high

### Frontend work

Before finishing:

1. verify the local dev server path used during iteration still matches docs
2. run the relevant project-local test or lint command
3. use the root `ci:*` wrapper before closing cross-surface UI work

### Docs-only work

Before finishing:

1. ensure new files are linked from existing canonical indexes
2. ensure no stale guidance remains in AGENTS, instructions, or README files

## 5. When To Escalate Validation

Escalate from project-local checks to repo-level checks when:

1. a task crosses more than one project
2. API contracts changed
3. settlement, approval, or audit behavior changed
4. a local change affects shared instructions or canonical docs