# Validation Entry Points

## 1. Purpose

This page lists the canonical validation anchors AI agents and maintainers should use before closing work.

Rule: start with the narrowest relevant check, then escalate to repo-level CI only when the change crosses project or contract boundaries.

Canonical local service ports live in `docs/reference/Service_Port_Map.md`.

Canonical local and staging regression coverage lives in
`docs/ops/19_E2E_Regression_Runbook.md`. API/UI E2E evidence is not complete
for money-path work until the read-only SQL evidence layer proves the matching
Postgres rows, balance buckets, ledger entries, audit events, outboxes, and
contract config state.

## 2. Repository-Level Validation

From repository root:

1. `npm run ci:agent-lessons`
2. `npm run ci:github-actions-runtime`
3. `npm run ci:created-at-indexes`
4. `npm run ci:state-idempotency-safety`
5. `npm run ci:docs`
6. `npm run ci:finance-approval-safety`
7. `npm run ci:finance-approval-e2e-evidence`
8. `npm run ci:withdrawal-one-ticket-evidence`
9. `npm run ci:withdrawal-idempotency-concurrency-evidence`
10. `npm run ci:withdrawal-idempotency-admin-dom-evidence`
11. `npm run ci:financial-security`
12. `npm run ci:architecture-quality`
13. `npm run ci:quality-budget`
14. `npm run ci:format-check`
15. `npm run ci:diff-coverage`
16. `npm run ci:agent-guardrails`
17. `npm run ci:frontend`
18. `npm run ci:admin-front`
19. `npm run ci:admin-gateway`
20. `npm run ci:gateway`
21. `npm run ci:provider-service`
22. `npm run ci:sdk-python`
23. `npm run ci:contracts`
24. `npm run ci:pr`
25. `npm run perf:local-production-load-rehearsal`
26. `npm run ci:local-production-load-evidence`
27. `npm run ci:monitoring-alert-rules`
28. `npm run e2e:lark-alerts`
29. `npm run ci:lark-alert-e2e-evidence`
30. `npm run e2e:in-app-notifications`
31. `npm run ci:in-app-notifications-evidence`
32. `npm run e2e:admin-inbox-provider-services`
33. `npm run ci:admin-inbox-provider-services-evidence`
34. `npm run e2e:user-front-deposit-balance`
35. `npm run ci:user-front-deposit-balance-evidence`
36. `npm run e2e:user-front-payments-gateway-truth:local`
37. `npm run ci:user-front-payments-gateway-truth-local-evidence`
38. `npm run e2e:deposit-indexer-recovery:local`
39. `npm run ci:deposit-indexer-recovery-local-evidence`
40. `npm run e2e:deposit-indexer-event-only:local`
41. `npm run ci:deposit-indexer-event-only-local-evidence`
42. `npm run e2e:invocation-billing-migration:local`
43. `npm run ci:invocation-billing-migration-local-evidence`
44. `npm run e2e:admin-dashboard-projection-readmodel:local`
45. `npm run ci:admin-dashboard-projection-readmodel-local-evidence`
46. `npm run e2e:admin-regression`
47. `npm run ci:admin-regression-evidence`
48. `npm run e2e:admin-pagination-sorting`
49. `npm run ci:admin-pagination-sorting-evidence`
50. `npm run e2e:withdrawal-reviews-cleanup:local`
51. `npm run ci:withdrawal-reviews-cleanup-local-evidence`
52. `npm run ci:backup-restore-evidence`
53. `npm run deploy:contracts:arbitrum-sepolia:dry-run`
54. `npm run ci:contract-deployment-evidence`
55. `npm run e2e:consumer-withdraw-claim-fullchain:local`
56. `npm run ci:consumer-withdraw-claim-fullchain-local-evidence`
57. `npm run e2e:consumer-withdraw-approval-expiry:local`
58. `npm run ci:consumer-withdraw-approval-expiry-local-evidence`
59. `npm run ci:migration-seed-guard`

Use these wrappers when final integration confidence is required.

Local pending-deposit diagnosis:

1. `npm run dev:diagnose:pending-deposits` prints local read-only pending deposit intents and `consumer_pending` buckets.
2. `npm run dev:diagnose:pending-deposits -- <wallet>` narrows the report to one wallet.
3. This diagnostic is evidence only. Do not force-credit pending deposits unless current-chain `SynapseCore` deposit events, ledger entries, and audit evidence match the txHash.

Infrastructure preflight:

1. `bash scripts/deploy/gcp_preflight.sh <gcp-project-id>` before the first Google Cloud staging Terraform apply
2. `bash scripts/deploy/migrate_db.sh local|staging|prod` for explicit schema/reference migration; prod requires `SYNAPSE_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PROD`
3. `npm run ci:staging-schema-guard -- --project fabled-archive-494108-k5 --port 15543` after starting Cloud SQL Auth Proxy on `15543`; verifies staging Gateway/Admin databases have required tables, migrator ownership, runtime grants, and consistent DSN/password secrets.
4. `npm run ci:staging-drift-guard` verifies staging Cloud SQL keeps the V1 Auth Proxy security posture: public IPv4 is retained, authorized networks are empty, connector enforcement is `REQUIRED`, IAM database authentication is on, backups/PITR are enabled, and password policy is enabled.

Local hook bootstrap:

1. `bash scripts/dev/install_git_hooks.sh`

After installation, `git push` automatically runs `bash scripts/ci/pr_checks.sh`.
That PR gate starts with `npm run ci:agent-lessons`, which requires
`docs/reference/agent-lessons/<branch-slug>.md` for non-merge work unless the
branch has no local changes. Use `No new lessons.` for a clean push review, or
add a structured `Lesson:` block when the session exposed a reusable failure
pattern.
Emergency bypass remains `git push --no-verify`.

`npm run ci:pr` is the default local PR preflight. `bash scripts/ci/pr_checks.sh`
resolves changed files with `scripts/ci/resolve_pr_ci_scope.mjs`, prints the
selected commands, and then runs only the relevant gates. The baseline lane is
split into `baseline-static`, `baseline-quality`, and `baseline-policy` so
GitHub-hosted PR runs can fail faster and finish with lower wall-clock time
without dropping guardrails. CI and ops files such as `scripts/ci/*`,
`scripts/ops/*`, `.github/workflows/*`, billing-review automation, and hygiene
utilities are mapped explicitly so they no longer fall back to `full` just
because the resolver does not recognize them. Root `package-lock.json` now maps
to baseline plus root toolchain checks instead of dragging every app shard into
a pseudo-full run, while deploy-script changes, semgrep changes, unknown paths,
and merge-base resolution failures still fail closed into full CI. Root
`package.json` script-only changes are mapped narrowly when they are ordinary
evidence/E2E wrappers. Each selected gate prints `DONE` with a duration and the
run ends with a gate duration summary. Use `SYNAPSE_CI_SCOPE=full bash
scripts/ci/pr_checks.sh` when you need the old full aggregate gate explicitly.

For workflow, YAML, or scope-rule changes, run `npm run ci:pr` locally first,
then use [`act`](https://github.com/nektos/act) for workflow smoke only.
`act` is useful for validating job wiring, conditions, and step order, but it is
not a GitHub-hosted runner equivalence proof. For ordinary app or backend code
changes, `act` is optional; the default expectation is a clean local
`npm run ci:pr` plus the narrow focused gates for the touched surface.

`npm run ci:github-actions-runtime` is the canonical GitHub Actions JavaScript
runtime guard. It requires every workflow to force Node 24 with
`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, forbids the deprecated Node 20 opt-out
`ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION`, and blocks downgrades below the repo
baseline for `actions/checkout`, `actions/setup-node`, `actions/setup-python`,
`actions/cache`, and `actions/upload-artifact`. `npm run ci:docs` runs this guard
as part of lightweight documentation and workflow governance.

`npm run ci:created-at-indexes` is the canonical schema guard for Admin
pagination defaults. Gateway runtime schema and Gateway-Admin schema tables that
define `created_at` must also define a same-table index that includes
`created_at`; this keeps default `created_at DESC` list pages from drifting into
sequential scans. `npm run ci:docs` runs this guard as part of lightweight schema
governance.

`npm run ci:state-idempotency-safety` is the canonical guard for money and
state-machine idempotency. It checks that withdrawal complete uses a locked
business order row, expected-status CAS, txHash dedupe, and same-transaction
pending-bucket consumption; deposit confirm replay must not replay audit/outbox;
and changed runtime code must not full-delete high-risk funds tables. Run it for
any deposit, withdrawal, refund, approval, execution retry, audit, outbox, or
state-transition change. `npm run ci:finance-approval-safety` includes this
guard.

`npm run e2e:admin-pagination-sorting` is the local Admin pagination evidence
gate for default `createdAt DESC` semantics. It seeds deterministic local rows
for withdrawal reviews, provider services, forum response tasks, and forum
topics, then verifies API order, DOM first-screen order, screenshot metadata,
SQL query order, and the created-at index guard. Run
`npm run ci:admin-pagination-sorting-evidence` after the E2E to validate the
fresh evidence bundle.

`ci:pr` starts selected runs with `bash scripts/ci/runtime_preflight.sh`. This probe gives
Node and each project Python virtualenv interpreter 8 seconds to print a version
before the expensive gates run. It fails fast on the first startup failure so
pre-push does not hang indefinitely. If the probe times out on macOS with
processes stuck before printing a version, treat it as a local runtime/session
issue rather than a test failure: restart the affected terminal or Codex
session, then rerun `bash scripts/ci/pr_checks.sh`. To collect every failing
runtime probe in one pass, set `CI_RUNTIME_PREFLIGHT_COLLECT_ALL=true`. Do not
make `--no-verify` the normal path; keep it for true emergency pushes only.

Repository hygiene utility:

1. `DRY_RUN=1 MIN_AGE_DAYS=7 MAX_AGE_DAYS=14 bash scripts/git/cleanup_old_branches.sh` previews candidate local/remote branches whose latest `committerdate` is at least 7 days old but less than 14 days old. The script automatically excludes `main`, the current branch, open PR heads, and branches currently attached to a Git worktree.
2. `MIN_AGE_DAYS=7 MAX_AGE_DAYS=14 bash scripts/git/cleanup_old_branches.sh` performs the real cleanup by deleting matching remote branches through `gh api` and matching local branches through `git branch -D`, then prunes remote refs and prunable worktrees.

GCP billing review utility:

1. `bash scripts/ops/gcp_billing_review.sh` is the canonical weekly GCP cost-review entrypoint. It requires `gh`, `gcloud`, `bq`, `jq`, and `node`, resolves the current GCP project from `gcloud`, prefers a Cloud Billing Export table in BigQuery, and writes a fresh evidence bundle under `docs/evidence/cost/<timestamp>-gcp-billing-review/`.
2. If no billing export dataset/table is discoverable for the current project, the review fails closed with `BLOCKED missing_billing_export`, writes a blocked `report.json` / `report.md`, and does not open a PR.
3. Only explicit repo-local optimization patches may create a PR. Pure console-only or architecture/SLA-sensitive recommendations stay in the report bundle and must not open an empty PR.

## 3. Project-Level Validation

### 3.1 apps/frontend

Working directory: `apps/frontend/`

1. `yarn dev` for active iteration
2. `yarn test` for local frontend test validation
3. `npm run ci:frontend` from repository root when repo-standard gating is needed

### 3.1a services/user-front

Working directory: `services/user-front/`

1. `yarn dev` for active iteration on `http://localhost:3000`
2. `npm run ci:user-front-i18n` from repository root for static user-facing copy drift detection
3. `npm run ci:user-front-user-errors` from repository root to block raw backend/RPC/wallet error messages from high-risk user-facing toasts
4. `npm run ci:user-front-error-dom` from repository root for focused DOM regression on localized, user-readable error toasts for Credits withdraw, Provider withdraw, provider services and health, service deploy, paid invoke, spend cap, and credential actions
5. `npm run ci:user-front-i18n-dom` from repository root for focused `en`/`zh` DOM regression on Credits, Withdraw, Credentials, QuickStart, Paid Invoke, RolePathCards, and Feedback surfaces
6. `npm run ci:provider-withdraw-mature-dom` from repository root for focused DOM regression on Provider withdrawable receivable, receivable balance, T+7 notice, below-minimum disabled CTA, MAX-filled amount, and empty-submit prevention
7. `cd services/user-front && yarn test` for the full Vitest suite
8. `USER_FRONT_BASE_URL=http://localhost:3000 npm run ci:user-front-error-browser` from repository root after starting user-front to verify product toasts replace raw RPC/API errors and capture EN/ZH screenshots under `output/playwright/user-front-error-toasts/`
9. `USER_FRONT_BASE_URL=http://localhost:3000 npm run ci:provider-withdraw-mature-browser` from repository root after starting user-front to verify Provider withdraw mature receivable DOM state and screenshots under `output/playwright/provider-withdraw-mature/`
10. `USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_i18n.mjs` from repository root after starting user-front to verify real route DOM language switching and capture screenshots
11. `USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_pages.mjs` from repository root for general browser route/navigation verification
12. `USER_FRONT_BASE_URL=http://127.0.0.1:3000 npm run e2e:user-front-copyable-identifiers` and `npm run ci:user-front-copyable-identifiers-evidence` when changing copyable IDs, hashes, addresses, invocation privacy, or provider identifier tables. This local DOM/clipboard gate proves short display values copy the full canonical value and ordinary user pages do not expose `agent:agent:*`, counterparty, or provider wallet internals.
13. `USER_FRONT_BASE_URL=http://127.0.0.1:3000 npm run e2e:user-front-payments-gateway-truth:local` and `npm run ci:user-front-payments-gateway-truth-local-evidence` when changing Billing/Payments history, deposit intent display, consumer withdrawal rows, refund rows, or frontend money-history aggregation. This local DOM/API/SQL gate proves Payments rows come from Gateway DB/API, use `limit=100` per source, render the sorted top 50 records, and do not reintroduce frontend `DepositInfo` / `WithdrawInfo` chain-log ledger rows.
14. `npm run ci:frontend` from repository root when repo-standard frontend gating is needed. The gate is scope-aware: if the PR scope contains no `services/user-front/*` files and no contract/chain integration files, the shard exits before Yarn install; otherwise it runs targeted `next lint --file` and `vitest related` against changed files, keeps TypeScript `--noEmit`, and reserves `yarn build` for non-test user-front source/config changes or contract integration smoke.

### 3.2 services/docs-front

Working directory: `services/docs-front/`

1. `yarn dev` for active iteration on `http://localhost:3100`
2. `yarn generate:openapi` after endpoint data changes
3. `yarn lint`
4. `yarn build` for MDX, OpenAPI, type, and static route validation
5. `DOCS_BASE_URL=http://localhost:3100 node scripts/ui/verify_docs_pages.mjs` from repository root after starting the docs dev server
6. `npm run ci:docs-pages` from repository root when repo-standard docs-page gating is needed
7. `npm run e2e:staging-smoke` and `npm run ci:staging-smoke-evidence` after deploying docs-front to staging; the smoke runner checks `https://docs-staging.synapse-network.ai`, `llms.txt`, `llms-full.txt`, `sitemap.xml`, `openapi.json`, `/sdks`, and `/api-reference`
8. `npm run e2e:staging-ui-dogfood` after staging docs-front UI changes to capture docs screenshots and browser console/network failures

`services/docs-front/public/openapi.json` and
`services/docs-front/src/data/api-reference.json` are tracked generated
artifacts. Commit them with the API reference change, or restore them before
switching branches when no API reference change is intended.

### 3.2.1 Codex Token Optimization Guidance

When changing high-frequency Codex usage policy, memory guidance, task routing,
or handoff conventions:

1. Update `docs/reference/Codex_Token_Optimization.md`.
2. Update `llms.txt`, `docs/reference/AI_Instruction_Entrypoints.md`, and
   `docs/reference/Agent_Task_Map.*` only when entrypoints or routing change.
3. Run `npm run ci:docs`.
4. Run `node -e "JSON.parse(require('fs').readFileSync('docs/reference/Agent_Task_Map.json', 'utf8'))"`.

### 3.3 services/admin-front

Working directory: `services/admin-front/`

1. `yarn dev` for active iteration on `http://localhost:3200`
2. `yarn lint`
3. `yarn test`
4. `yarn build` only when the task explicitly needs final build confirmation
5. `npm run ci:admin-front` from repository root when repo-standard gating is needed; this runs lint, Vitest, and production build
6. `cd services/admin-front && yarn test src/components/admin-notification-inbox.test.tsx src/services/admin-api-route-coverage.test.ts` when changing Admin Inbox, admin notification API clients, unread badges, read/archive actions, or provider-service notification rendering
7. `npm run e2e:admin-inbox-provider-services && npm run ci:admin-inbox-provider-services-evidence` when closing local Admin Inbox provider-service notification behavior; this must produce screenshots and SQL evidence for unread, read, archive, and dedupe state

### 3.4 services/gateway-admin

Working directory: `services/gateway-admin/`

1. `/Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin/.venv/bin/python -m pytest tests -q`
2. `npm run ci:admin-gateway` from repository root when repo-standard gating is needed; this runs the full gateway-admin pytest suite
3. `cd services/gateway-admin && .venv/bin/python -m pytest tests/test_app.py tests/test_admin_notifications.py -q` when changing admin notification repositories, Admin Inbox API scoping, or Provider Services notification triggers

Runtime ops anchors:

1. `sh scripts/ops/start-local.sh`
2. `sh scripts/ops/stop.sh`
3. `sh scripts/ops/restart.sh`
4. `sh scripts/ops/status.sh`

### 3.5 provider_service

Working directory: `provider_service/`

1. `./.venv/bin/python -m pytest tests -q`
2. `npm run ci:provider-service` from repository root when repo-standard gating is needed

### 3.6 gateway

Canonical gate:

1. `npm run ci:gateway`
2. `cd services/gateway && python -m pytest tests/unit/test_notifications_outbox_unit.py` when changing Gmail email notification outbox, sender, worker, templates, or delivery-log behavior
3. `cd services/gateway && python -m pytest tests/unit/test_notifications_outbox_unit.py tests/unit/test_in_app_notifications_router_unit.py` when changing in-app notification inbox storage, API behavior, cleanup, or after-commit notification intents
4. `cd services/user-front && yarn test src/components/NotificationCenter.test.tsx` when changing User-front notification polling, badge, dropdown, read/archive behavior, or notification API client
5. `npm run e2e:in-app-notifications && npm run ci:in-app-notifications-evidence` when validating local front-to-service in-app notification behavior with screenshots

For local gateway workflows, follow the canonical project page under `docs/03_Projects/gateway/` and its linked development guide.

### 3.7 contracts

Canonical gate:

1. `npm run ci:contracts`
2. `npm run deploy:contracts:arbitrum-sepolia:dry-run` before staging deployment
3. `npm run deploy:contracts:arbitrum-sepolia` to deploy Arbitrum Sepolia staging contracts
4. `npm run ci:contract-deployment-evidence` after staging deployment to verify manifest, bytecode, Arbiscan verification, wallet gas, and MockUSDC pre-mint evidence

### 3.8 sdk/python

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
4. run `npm run ci:state-idempotency-safety` for any funds or state-machine transition change; business idempotency must be keyed by order/tx/job identifiers, not wallet/owner upserts
5. run `npm run ci:finance-approval-safety` for approval, withdraw, refund, complete, ledger, balance, gateway-admin finance, or admin-front withdrawal-review changes; this includes Semgrep, finance-only mypy, local runtime guard, E2E model-drift checks, and the state idempotency safety guard
6. run `npm run ci:pr` before push for admin-front or gateway-admin changes so security, complexity, duplication, assertion-quality, coverage-escape, secret, and incremental diff-coverage gates all run against changed files
7. run `npm run dev:provider:onboard`, then `npm run e2e:admin-withdrawal-approval` and `npm run ci:finance-approval-e2e-evidence` before release approval when funds approval behavior or evidence-sensitive paths changed. The approval seed must use the Synapse-Network-Provider catalog service from `GATEWAY_E2E_SERVICE_ID` and must not register `awa_provider_withdraw_*`.
8. run `npm run e2e:admin-withdrawal-review:local` and `npm run ci:admin-withdrawal-review-local-evidence` when changing Admin-front withdrawal review, Gateway-admin decision auth, CSRF/session handling, OTP step-up, or 401/403 error handling. This evidence must prove `synapse_admin_session`, `X-CSRF-Token`, `X-Admin-OTP-Code`, `approval:decide`, review screenshots, DB state, duplicate-decision rejection, and chain replay protection.
9. run `npm run e2e:manual-review-expiry:local` and `npm run ci:manual-review-expiry-local-evidence` when changing manual-review expiry, consumer/provider withdrawal reapers, `WITHDRAWAL_MANUAL_REVIEW_EXPIRY_SEC`, expiry notification copy, or pending review queue filters. The local gate uses a 3-second expiry with `ALLOW_SHORT_WITHDRAWAL_REVIEW_EXPIRY_FOR_TESTS=1`; production default remains 24h.
10. run `npm run e2e:consumer-withdraw-approval-expiry:local` and `npm run ci:consumer-withdraw-approval-expiry-local-evidence` when changing consumer withdraw claim-ready UX, `FAILED_EXPIRED` release semantics for approved tickets, `WITHDRAW_TICKET_EXPIRY_BUFFER_SEC`, `WITHDRAW_RPC_FINALITY_MARGIN_SEC`, withdraw-page polling, or the copy that explains expired approvals returning to withdrawable balance.
11. run `npm run e2e:withdrawal-reviews-cleanup:local` and `npm run ci:withdrawal-reviews-cleanup-local-evidence` when changing admin withdrawal-review queue cleanup behavior, local E2E seed lifecycle, manual-review expiry release semantics for `PENDING_MANUAL_REVIEW`, or the local-only rule that only known E2E-marked withdrawal reviews may be batch-expired.
12. run `npm run e2e:withdrawal-one-ticket-evidence` and `npm run ci:withdrawal-one-ticket-evidence` before release approval when one-ticket withdrawal, reaper, watcher, ticket signing, or claim completion semantics changed. The local runner onboards the Synapse-Network-Provider catalog first and must not create `wot_provider_*` services. Fresh evidence is only valid when the bundle contains `trace.jsonl`, `db-evidence.json`, `dom-evidence.json`, `screenshot-evidence.json`, payments history screenshot proof, consumer completed/expired screenshot proof, provider completed/expired screenshot proof, and DB snapshots that show replay dedup plus `SIGNED -> COMPLETED` and `FAILED_EXPIRED` terminal states.
13. run `npm run e2e:withdrawal-idempotency-concurrency` and `npm run ci:withdrawal-idempotency-concurrency-evidence` when changing withdrawal creation, idempotency keys, manual-review decisions, complete callbacks, ticket replay protection, or balance bucket transitions under concurrency. If the same change also touches Admin withdrawal approval UI or evidence, also run `npm run e2e:admin-withdrawal-approval` and `npm run ci:withdrawal-idempotency-admin-dom-evidence` so SQL/chain idempotency evidence and Admin modal DOM evidence are checked together.
14. run `npm run e2e:user-front-deposit-balance` and `npm run ci:user-front-deposit-balance-evidence` when changing user-front Billing/Credits deposit display, `useFundsData`, deposit intent sync, balance refresh, deposit request review UX, or deposit status semantics. The evidence must prove Gateway `PENDING_CONFIRMATION` renders as `Pending`, Gateway `CONFIRMED` renders as `Completed`, SQL balance buckets move pending -> available exactly once, replay does not double-credit the account, and the deposit review screenshots show amount, wallet source, Synapse Vault target, Gateway confirmation copy, and allowance-first preapproved behavior.
15. run `USER_FRONT_BASE_URL=http://localhost:3000 npm run ci:user-front-deposit-request-browser` when changing Credits deposit input validation, wallet network switching, allowance/preapproval checks, Permit/Approve fallback, 4001 rejection handling, or EN/ZH deposit transaction request copy. Hardware-wallet Permit timeout copy is covered by the focused `useVaultDeposit` DOM test. This Playwright mock-wallet gate saves screenshots and a report under `output/playwright/user-front-deposit-request/<timestamp>/` and must not show raw wallet/RPC errors.
16. run `npm run e2e:user-front-copyable-identifiers` and `npm run ci:user-front-copyable-identifiers-evidence` when changing visible copy controls for transaction IDs, invocation IDs, service IDs, agent IDs, wallet addresses, tx hashes, withdrawal IDs, nonce/ticket fields, or privacy-sensitive invocation/provider tables. This is a local DOM/clipboard evidence gate, not a DB/ledger money-path gate.
17. run `npm run e2e:user-front-payments-gateway-truth:local` and `npm run ci:user-front-payments-gateway-truth-local-evidence` when changing Billing/Payments history aggregation, deposit/withdraw/refund API adapters, or frontend money-history data sources. The evidence must prove Payments rows come from Gateway DB/API, each source uses `limit=100`, DOM renders the sorted top 50 rows, pending intents survive refresh, and frontend chain-log scans are not reintroduced.
18. run `npm run e2e:deposit-indexer-recovery:local` and `npm run ci:deposit-indexer-recovery-local-evidence` when changing deposit indexer startup, backfill, replay protection, local Gateway indexer env, or pending-deposit reliability. The evidence must prove indexer-down UI stays pending, restart auto-confirms valid deposits, backfill recovers missed intents, invalid events do not credit, and replay does not double-credit.
19. run `npm run e2e:deposit-indexer-event-only:local` and `npm run ci:deposit-indexer-event-only-local-evidence` when changing deposit event scanning, `DepositInfo` decoding, `eth_getLogs` chunking, finality-buffer rules, processed deposit event key dedup, or the local zero-user RPC/CU baseline used for cost reporting. The evidence must prove the worker tick uses `eth_getLogs` without default block scans, chunking emits at least two `getLogs` ranges for a >2000-block catch-up, `lastScannedBlock` stays behind `confirmedHead`, Payments history still renders the Gateway-backed deposit row exactly once, and `rpc-cu-comparison.json` preserves the approved before/after baseline.
20. run `npm run e2e:admin-dashboard-projection-readmodel:local` and `npm run ci:admin-dashboard-projection-readmodel-local-evidence` when changing Gateway-admin dashboard projection repositories, Admin-front dashboard/finance/runtime read-model rendering, or projection view SQL. The local gate proves Admin API, explicit Postgres projection column queries, DOM values, and screenshots agree without `row_to_json` or dashboard projection `SELECT *`.
21. run `npm run ci:diff-coverage` when changed code needs line-level coverage evidence; Python and Vitest coverage must be Cobertura XML
22. run `npm run ci:agent-guardrails` when Agent-generated backend/admin code touches finance, approval, storage, or shared state-machine logic; install `uv` once if the runner reports a missing Python guardrail tool
23. run `npm run release:evidence:gateway-fullchain:local` for a local rehearsal of the full live Gateway E2E evidence chain; run `GATEWAY_RELEASE_E2E_PROFILE=mvp-postgres npm run release:evidence:gateway-fullchain:staging` plus `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence` for MVP Cloud Run + Cloud SQL staging release evidence. The bundle must include a non-empty `trace.jsonl` with a matching `report.json.traceDigest`
24. run `npm run perf:local-production-load-rehearsal` and `npm run ci:local-production-load-evidence` before staging load when changing invoke, balance, deposit confirm, withdrawal, provider health, admin finance views, load-runner behavior, or wallet/signing isolation; this validates local runId isolation, temporary wallet pools, per-wallet chain serialization, bounded concurrency, drain hard cap, and no secret leakage
25. run `npm run ci:monitoring-alert-rules` when changing metrics, readiness, dashboards, Alertmanager routes, Lark Relay behavior, alert rules, or monitoring runbooks
26. run `npm run e2e:gcp-alerts:local` and `npm run ci:gcp-alerts-local-evidence` before deploying GCP Monitoring receiver/drill changes; then run `npm run e2e:gcp-alerts:staging` and `npm run ci:gcp-alerts-staging-evidence` after staging deploy. Set `GCP_ALERTS_REQUIRE_MONITORING_DELIVERY=true` once per release candidate to prove GCP policy callback delivery
27. run `npm run e2e:lark-alerts` and `npm run ci:lark-alert-e2e-evidence` before release approval when changing Lark webhook routing, Relay delivery, Alertmanager-to-Lark contracts, or production alert notification behavior
28. run `npm run e2e:staging-smoke` and `npm run ci:staging-smoke-evidence` after staging Cloud Run, DNS, CORS, RPC, contract-address, or docs-front endpoint changes; this is the first-pass live staging gate before full-chain evidence
29. run `npm run e2e:staging-full-regression` and `npm run ci:staging-full-regression-evidence` after a staging app deploy when you need the broad release gate. It starts from `https://staging.synapse-network.ai/dashboard/overview`, reuses canonical registered Provider services only, verifies DOM/API/Cloud SQL/chain checkpoints before screenshots, and fails if service registration count changes.
30. run `npm run e2e:staging-ui-dogfood` after staging User-front/Admin-front/Docs-front deploys to capture screenshots and browser-origin API/CORS failures
31. run `npm run e2e:staging-core-dogfood` and `npm run ci:staging-core-dogfood-evidence` for the first-phase staging money-path gate; it mutates Arbitrum Sepolia and Cloud SQL staging, requires `STAGING_CORE_DOGFOOD_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING`, and must stay out of PR CI
32. run `npm run e2e:gmail-notifications:staging` and `npm run ci:gmail-notifications-staging-evidence` when validating live staging Gmail SMTP/outbox delivery; the runner requires `GMAIL_STAGING_E2E_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_EMAIL`
33. run `npm run e2e:transaction-notifications:local` and `npm run ci:transaction-notifications-local-evidence` before deploying transaction notification changes; optionally run `npm run e2e:transaction-notifications:local-real` and `npm run ci:transaction-notifications-local-real-evidence` when you need to prove real local Gmail SMTP + Lark delivery before staging. `local-real` requires `TRANSACTION_NOTIFICATIONS_LOCAL_REAL_CONFIRM=I_UNDERSTAND_THIS_SENDS_REAL_LOCAL_EMAIL_AND_LARK` and private Gmail/Lark values from shell env or `services/gateway/.env.local.private`. After staging deploy run `npm run e2e:transaction-notifications:staging` and `npm run ci:transaction-notifications-staging-evidence`. The staging runner sends real staging Gmail and Lark cards and requires `TRANSACTION_NOTIFICATIONS_STAGING_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_EMAIL_AND_LARK`
34. run `npm run e2e:support-case-dogfood:local` and `npm run ci:support-case-dogfood-local-evidence` before deploying support intake, forum-support, support Lark, or support reply notification changes. After staging deploy run `npm run e2e:support-case-dogfood:staging` and `npm run ci:support-case-dogfood-staging-evidence`; the staging runner creates staging-only support cases, sends support Lark cards, verifies Admin-front `/forum-support` screenshots, and requires `SUPPORT_CASE_DOGFOOD_STAGING_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_SUPPORT_ALERTS`
35. run `npm run e2e:email-binding:local-real` and `npm run ci:email-binding-local-evidence` when changing email binding, change-email, remove-email, verification-code, or account settings screenshot evidence. The checker rejects screenshots without `screenshot-evidence.json`, expected DOM text/selector checkpoints, DB checkpoints, and `forbiddenTextAbsent=true`; AuthMask/Connect Wallet screenshots are invalid evidence.
36. run `npm run e2e:llm-deepseek:local` and `npm run ci:llm-deepseek-local-evidence` before deploying LLM token-metered billing changes; local evidence defaults to a local OpenAI-compatible fake LLM happy path plus fake timeout, missing-usage, and slow-success fixtures proving no final usage means no charge. Set `LLM_E2E_USE_REGISTERED_DEEPSEEK=1` only when local Provider has a real DeepSeek API key. After staging deploy run `npm run e2e:llm-deepseek:staging` and `npm run ci:llm-deepseek-staging-evidence`. The staging runner calls live DeepSeek Chat through Gateway, mutates staging balance, requires `LLM_DEEPSEEK_E2E_CONFIRM=I_UNDERSTAND_THIS_CALLS_LIVE_LLM_AND_CHARGES_STAGING`, and validates usage, charge, hold release, and provider/platform split exactly.
37. run `npm run ci:quality-budget` when changing production code, tests, E2E scripts, or CI guardrails; new production source files must stay under 500 effective lines, test-like files under 800 effective lines, and new disable comments must include a reason.
38. run `npm run ci:format-check` when changing TypeScript, JavaScript, JSON, YAML, or Markdown; this is a read-only Prettier check and must not be closed by committing unreviewed formatter churn.
39. run `npm run ci:e2e-env-isolation` whenever changing E2E, perf, drill, or root npm script environment boundaries; local E2E must never read Google Secret Manager, dual-mode scripts must not load `.env.staging`, staging Secret Manager reads must go through the shared wrapper, and ordinary local/staging E2E must not POST `/api/v1/services`.
40. run `npm run drill:backup-restore:staging` and `npm run ci:backup-restore-evidence` before release approval when changing backup, restore, reconciliation, database bootstrap, ClickHouse analytics storage, or production recovery runbooks
41. run `cd services/gateway && python -m pytest tests/unit/test_notifications_outbox_unit.py` when changing Gmail email notifications; email sending must remain async outbox-driven and must not block Gateway request paths
42. run `cd services/gateway && python -m pytest tests/unit/test_notifications_outbox_unit.py tests/unit/test_in_app_notifications_router_unit.py` and `cd services/user-front && yarn test src/components/NotificationCenter.test.tsx` when changing in-app notifications; inbox writes must remain best-effort and must not block funds state machines
43. run `npm run ci:migration-seed-guard` when changing DB migrations, bootstrap SQL, Cloud Run migration jobs, or any `scripts/e2e/*seed*.mjs` / dogfood seed path; production seed execution must remain impossible
44. run `npm run e2e:in-app-notifications` and `npm run ci:in-app-notifications-evidence` when closing in-app notification front-to-service E2E; it must produce screenshots, prove local Docker table readiness, and keep payload metadata-only
45. run `npm run e2e:admin-login-lockout:dogfood` when closing admin login lockout UX, API, audit, or config behavior; it must create a disposable local admin, trigger the five-failure lockout through Admin-front, capture screenshots/video, assert DB audit state, write `bugfix-log.md`, and delete the test account
46. run `terraform -chdir=infra/terraform/gcp-staging fmt -check` and `terraform -chdir=infra/terraform/gcp-staging validate` when changing Google Cloud staging infrastructure; `terraform validate` requires `terraform init` first
47. run `npm run deploy:contracts:arbitrum-sepolia:dry-run` before Arbitrum Sepolia staging deployment, then `npm run deploy:contracts:arbitrum-sepolia` and `npm run ci:contract-deployment-evidence` to close staging contract evidence; this requires live Arbitrum Sepolia RPC and funded staging deployer/consumer/provider wallets
48. follow `docs/ops/19_E2E_Regression_Runbook.md` when doing full local or staging regression. Provider registration, consumer login, deposit, invoke, consumer withdrawal, provider withdrawal/admin review, notifications, analytics, and contract release checks must include the documented read-only SQL evidence. Staging SQL must use an approved read-only DSN or Cloud SQL Auth Proxy connection and must never repair state during regression.
    Ordinary invoke, billing, UI, withdrawal, admin approval, and one-ticket E2E must reuse the Synapse-Network-Provider catalog. Default paid settlement uses `svc_synapse_mock_cost_1usdc`, free smoke uses `svc_synapse_echo`, and Gateway local/staging E2E must not POST service registrations; service-registration behavior is covered by backend unit/router/service tests.
49. run `npm run e2e:admin-regression` and `npm run ci:admin-regression-evidence` when closing Admin-wide regression, Admin Analytics Postgres source changes, admin notification evidence, withdrawal review orchestration, platform treasury Safe draft evidence, or screenshot/SQL evidence contracts. The evidence must include `expected_state.json`, `sql_evidence.json`, `screenshot_evidence.json`, final-state DOM checkpoints, and Postgres-only Analytics source proof.

Withdrawal evidence coverage is intentionally split:

1. `npm run e2e:withdrawal-risk-policy` proves Dust, T+N maturity, aggregate FIFO, 24h sliding-window risk classification, and normal Consumer/Provider withdrawals through final `COMPLETED`. This runner explicitly enables consumer/provider maturity enforcement because local Gateway defaults it off for fast development withdrawals.
2. `npm run e2e:withdrawal-idempotency-concurrency` proves create, manual-review decision, complete, ticket replay, and balance-bucket invariants under concurrency.
3. `npm run e2e:withdrawal-review-dogfood:local` and `npm run e2e:admin-withdrawal-approval` prove manual-review UI/API/DB, approve/reject operations, screenshots, button terminal states, centered modal DOM, and admin evidence. Their evidence gates require the matching E2E to run first; missing local evidence directories are not a docs-only failure by themselves.
4. `npm run ci:withdrawal-idempotency-admin-dom-evidence` is the combined evidence gate for withdrawal idempotency and Admin DOM approval proof. It requires fresh SQL/chain evidence from the idempotency suite plus Admin approval screenshots whose metadata proves `[role="dialog"][aria-modal="true"]`, zero drawer DOM, disabled terminal buttons, final DB `COMPLETED`, `txHash`, `ticketHash`, and zero locked balances.
5. `npm run e2e:provider-withdraw-mature:local` proves Provider withdraw summary, UI-facing receivable buckets, T+7 mature formula, latest withdrawal rows, and audit rows match read-only SQL evidence. Restart local Gateway with `PROVIDER_WITHDRAW_MATURITY_ENFORCEMENT_ENABLED=true` for this focused maturity gate. Staging requires `SYNAPSE_E2E_ENV=staging PROVIDER_WITHDRAW_MATURE_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING npm run e2e:provider-withdraw-mature:staging` plus a read-only staging DSN/Auth Proxy.
6. `npm run e2e:withdrawal-reviews-cleanup:local` proves the local admin queue can batch-expire only E2E-marked `PENDING_MANUAL_REVIEW` withdrawals, release frozen funds through the real expiry path, preserve audit rows, and leave non-E2E pending reviews untouched. This lane is local-only and must never be repurposed as a staging/prod repair path.

### Screenshot Evidence Guardrail

Dogfood screenshots are only valid when they are paired with machine-readable checkpoints. Each screenshot-producing runner must record expected visible text or selectors, forbidden blocker text absence, a DOM checkpoint, and the relevant API/DB checkpoint. Screenshots blocked by `Connect Wallet`, AuthMask, loading skeletons, error dialogs, or unrelated modals are rejected even if the backend step passed. Release evidence checkers must fail closed instead of accepting bare PNG paths.

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
