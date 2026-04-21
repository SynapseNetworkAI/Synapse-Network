# Validation Entry Points

## 1. Purpose

This page lists the canonical validation anchors AI agents and maintainers should use before closing work.

Rule: start with the narrowest relevant check, then escalate to repo-level CI only when the change crosses project or contract boundaries.

## 2. Repository-Level Validation

From repository root:

1. `npm run ci:docs`
2. `npm run ci:finance-approval-safety`
3. `npm run ci:finance-approval-e2e-evidence`
4. `npm run ci:withdrawal-one-ticket-evidence`
5. `npm run ci:financial-security`
6. `npm run ci:architecture-quality`
7. `npm run ci:diff-coverage`
8. `npm run ci:agent-guardrails`
9. `npm run ci:frontend`
10. `npm run ci:admin-front`
11. `npm run ci:admin-gateway`
12. `npm run ci:gateway`
13. `npm run ci:provider-service`
14. `npm run ci:sdk-python`
15. `npm run ci:contracts`
16. `npm run ci:pr`
17. `npm run perf:local-production-load-rehearsal`
18. `npm run ci:local-production-load-evidence`
19. `npm run ci:monitoring-alert-rules`
20. `npm run ci:backup-restore-evidence`

Use these wrappers when final integration confidence is required.

Local hook bootstrap:

1. `bash scripts/dev/install_git_hooks.sh`

After installation, `git push` automatically runs `bash scripts/ci/pr_checks.sh`.
Emergency bypass remains `git push --no-verify`.

`ci:pr` starts with `bash scripts/ci/runtime_preflight.sh`. This probe gives
Node and each project Python virtualenv interpreter 8 seconds to print a version
before the expensive gates run. It fails fast on the first startup failure so
pre-push does not hang indefinitely. If the probe times out on macOS with
processes stuck before printing a version, treat it as a local runtime/session
issue rather than a test failure: restart the affected terminal or Codex
session, then rerun `bash scripts/ci/pr_checks.sh`. To collect every failing
runtime probe in one pass, set `CI_RUNTIME_PREFLIGHT_COLLECT_ALL=true`. Do not
make `--no-verify` the normal path; keep it for true emergency pushes only.

## 3. Project-Level Validation

### 3.1 apps/frontend

Working directory: `apps/frontend/`

1. `yarn dev` for active iteration
2. `yarn test` for local frontend test validation
3. `npm run ci:frontend` from repository root when repo-standard gating is needed

### 3.2 services/admin-front

Working directory: `services/admin-front/`

1. `yarn dev` for active iteration on `http://localhost:4000`
2. `yarn lint`
3. `yarn test`
4. `yarn build` only when the task explicitly needs final build confirmation
5. `npm run ci:admin-front` from repository root when repo-standard gating is needed; this runs lint, Vitest, and production build

### 3.3 services/gateway-admin

Working directory: `services/gateway-admin/`

1. `/Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin/.venv/bin/python -m pytest tests -q`
2. `npm run ci:admin-gateway` from repository root when repo-standard gating is needed; this runs the full gateway-admin pytest suite

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

## 4. Document Metadata Rule

Synapse 不要求每一份 Markdown 都写满验证元信息，但以下文档必须把验证锚点写进文档头部：

1. `docs/**/README.md` 中声明 `- Status: canonical` 的入口页
2. 少量高价值深层 canonical 真相页：Runtime 总体架构、身份/鉴权/风控主文档、核心工作流主链路、Manifest/Runtime Object 总表、Development/Testing/Integration 总表、Runtime API 合约与错误码总表、SQL schema 总览页
3. 其他显式承担当前 stable truth 的 canonical 文档，推荐逐步补齐同样字段

当前 canonical README 的推荐头部格式：

1. `- Status: canonical`
2. `- Code paths: ...`
3. `- Verified with: ...`
4. `- Last verified against code: YYYY-MM-DD`

规则解释：

1. `Status` 解决文档分层问题
2. `Code paths` 对应 source-of-truth 范围，告诉 AI 去哪里看真实实现
3. `Verified with` 对应最小验证命令，优先写 root `npm run ci:*` 锚点
4. `Last verified against code` 记录最近一次人工按代码核对的日期

不需要强制补齐完整验证元信息的文档：

1. `supplementary` / `legacy` / `archive` 文档
2. 已完成执行计划、历史迁移记录、归档草案
3. 不承担入口职责的深层专题页

## 5. Finish Checklist

### Finance-sensitive backend or admin work

Before finishing:

1. update docs if behavior changed
2. update tests if behavior changed
3. prefer the narrow project-local test plus the matching repo `ci:*` gate when risk is high
4. run `npm run ci:finance-approval-safety` for approval, withdraw, refund, complete, ledger, balance, gateway-admin finance, or admin-front withdrawal-review changes; this includes Semgrep, finance-only mypy, local runtime guard, and E2E model-drift checks
5. run `npm run ci:pr` before push for admin-front or gateway-admin changes so security, complexity, duplication, assertion-quality, coverage-escape, secret, and incremental diff-coverage gates all run against changed files
6. run `npm run e2e:admin-withdrawal-approval` and `npm run ci:finance-approval-e2e-evidence` before release approval when funds approval behavior or evidence-sensitive paths changed
7. run `npm run e2e:withdrawal-one-ticket-evidence` and `npm run ci:withdrawal-one-ticket-evidence` before release approval when one-ticket withdrawal, reaper, watcher, ticket signing, or claim completion semantics changed
8. run `npm run ci:diff-coverage` when changed code needs line-level coverage evidence; Python and Vitest coverage must be Cobertura XML
9. run `npm run ci:agent-guardrails` when Agent-generated backend/admin code touches finance, approval, storage, or shared state-machine logic; install `uv` once if the runner reports a missing Python guardrail tool
10. run `npm run release:evidence:gateway-fullchain:local` for a local rehearsal of the full live Gateway E2E evidence chain; run `npm run release:evidence:gateway-fullchain:staging` plus `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence` for release Go/No-Go evidence
11. run `npm run perf:local-production-load-rehearsal` and `npm run ci:local-production-load-evidence` before staging load when changing invoke, balance, deposit confirm, withdrawal, provider health, admin finance views, load-runner behavior, or wallet/signing isolation; this validates local runId isolation, temporary wallet pools, per-wallet chain serialization, bounded concurrency, drain hard cap, and no secret leakage
12. run `npm run ci:monitoring-alert-rules` when changing metrics, readiness, dashboards, alert rules, or monitoring runbooks
13. run `npm run drill:backup-restore:staging` and `npm run ci:backup-restore-evidence` before release approval when changing backup, restore, reconciliation, database bootstrap, ClickHouse analytics storage, or production recovery runbooks

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
3. update `docs/00_Governance/Documentation_Inventory.md` if root entrypoints, governance docs, or canonical owners / review dates changed
4. run `npm run ci:docs`

## 6. When To Escalate Validation

Escalate from project-local checks to repo-level checks when:

1. a task crosses more than one project
2. API contracts changed
3. settlement, approval, or audit behavior changed
4. a local change affects shared instructions or canonical docs
