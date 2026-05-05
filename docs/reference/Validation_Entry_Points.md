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
3. `npm run ci:docs`
4. `npm run ci:finance-approval-safety`
5. `npm run ci:finance-approval-e2e-evidence`
6. `npm run ci:withdrawal-one-ticket-evidence`
7. `npm run ci:withdrawal-idempotency-concurrency-evidence`
8. `npm run ci:financial-security`
9. `npm run ci:architecture-quality`
10. `npm run ci:quality-budget`
11. `npm run ci:format-check`
12. `npm run ci:diff-coverage`
13. `npm run ci:agent-guardrails`
14. `npm run ci:frontend`
15. `npm run ci:admin-front`
16. `npm run ci:admin-gateway`
17. `npm run ci:gateway`
18. `npm run ci:provider-service`
19. `npm run ci:sdk-python`
20. `npm run ci:contracts`
21. `npm run ci:pr`
22. `npm run perf:local-production-load-rehearsal`
23. `npm run ci:local-production-load-evidence`
24. `npm run ci:monitoring-alert-rules`
25. `npm run e2e:lark-alerts`
26. `npm run ci:lark-alert-e2e-evidence`
27. `npm run e2e:in-app-notifications`
28. `npm run ci:in-app-notifications-evidence`
29. `npm run e2e:user-front-deposit-balance`
30. `npm run ci:user-front-deposit-balance-evidence`
31. `npm run e2e:user-front-payments-gateway-truth:local`
32. `npm run ci:user-front-payments-gateway-truth-local-evidence`
33. `npm run e2e:deposit-indexer-recovery:local`
34. `npm run ci:deposit-indexer-recovery-local-evidence`
35. `npm run e2e:invocation-billing-migration:local`
36. `npm run ci:invocation-billing-migration-local-evidence`
37. `npm run e2e:admin-regression`
38. `npm run ci:admin-regression-evidence`
39. `npm run ci:backup-restore-evidence`
40. `npm run deploy:contracts:arbitrum-sepolia:dry-run`
41. `npm run ci:contract-deployment-evidence`
42. `npm run ci:migration-seed-guard`

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

`ci:pr` defaults to dynamic scope. `bash scripts/ci/pr_checks.sh` resolves changed
files with `scripts/ci/resolve_pr_ci_scope.mjs`, prints the selected commands,
and then runs only the relevant gates. It fails closed into full CI for CI
workflow changes, root dependency/lockfile changes, deploy-script changes,
guardrail script changes, unknown paths, or merge-base resolution failures.
Root `package.json` script-only changes are mapped narrowly when they are
ordinary evidence/E2E wrappers. Each selected gate prints `DONE` with a duration
and the run ends with a gate duration summary. Use `SYNAPSE_CI_SCOPE=full bash
scripts/ci/pr_checks.sh` when you need the old full aggregate gate explicitly.

`npm run ci:github-actions-runtime` is the canonical GitHub Actions JavaScript
runtime guard. It requires every workflow to force Node 24 with
`FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, forbids the deprecated Node 20 opt-out
`ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION`, and blocks downgrades below the repo
baseline for `actions/checkout`, `actions/setup-node`, `actions/setup-python`,
`actions/cache`, and `actions/upload-artifact`. `npm run ci:docs` runs this guard
as part of lightweight documentation and workflow governance.

`ci:pr` starts selected runs with `bash scripts/ci/runtime_preflight.sh`. This probe gives
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

### 3.1a services/user-front

Working directory: `services/user-front/`

1. `yarn dev` for active iteration on `http://localhost:3000`
2. `npm run ci:user-front-i18n` from repository root for static user-facing copy drift detection
3. `npm run ci:user-front-user-errors` from repository root to block raw backend/RPC/wallet error messages from high-risk user-facing toasts
4. `npm run ci:user-front-error-dom` from repository root for focused DOM regression on localized, user-readable error toasts for Credits withdraw, Provider withdraw, provider services and health, service deploy, paid invoke, spend cap, and credential actions
5. `npm run ci:user-front-i18n-dom` from repository root for focused `en`/`zh` DOM regression on Credits, Withdraw, Credentials, QuickStart, Paid Invoke, RolePathCards, and Feedback surfaces
6. `cd services/user-front && yarn test` for the full Vitest suite
7. `USER_FRONT_BASE_URL=http://localhost:3000 npm run ci:user-front-error-browser` from repository root after starting user-front to verify product toasts replace raw RPC/API errors
8. `USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_i18n.mjs` from repository root after starting user-front to verify real route DOM language switching and capture screenshots
9. `USER_FRONT_BASE_URL=http://localhost:3000 node scripts/ui/verify_user_front_pages.mjs` from repository root for general browser route/navigation verification
10. `USER_FRONT_BASE_URL=http://127.0.0.1:3000 npm run e2e:user-front-copyable-identifiers` and `npm run ci:user-front-copyable-identifiers-evidence` when changing copyable IDs, hashes, addresses, invocation privacy, or provider identifier tables. This local DOM/clipboard gate proves short display values copy the full canonical value and ordinary user pages do not expose `agent:agent:*`, counterparty, or provider wallet internals.
11. `USER_FRONT_BASE_URL=http://127.0.0.1:3000 npm run e2e:user-front-payments-gateway-truth:local` and `npm run ci:user-front-payments-gateway-truth-local-evidence` when changing Billing/Payments history, deposit intent display, consumer withdrawal rows, refund rows, or frontend money-history aggregation. This local DOM/API/SQL gate proves Payments rows come from Gateway DB/API, use `limit=100` per source, render the sorted top 50 records, and do not reintroduce frontend `DepositInfo` / `WithdrawInfo` chain-log ledger rows.
12. `npm run ci:frontend` from repository root when repo-standard frontend gating is needed

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

### 3.4 services/gateway-admin

Working directory: `services/gateway-admin/`

1. `/Users/cliff/workspace/agent/Synapse-Network/services/gateway-admin/.venv/bin/python -m pytest tests -q`
2. `npm run ci:admin-gateway` from repository root when repo-standard gating is needed; this runs the full gateway-admin pytest suite

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
4. run `npm run ci:finance-approval-safety` for approval, withdraw, refund, complete, ledger, balance, gateway-admin finance, or admin-front withdrawal-review changes; this includes Semgrep, finance-only mypy, local runtime guard, and E2E model-drift checks
5. run `npm run ci:pr` before push for admin-front or gateway-admin changes so security, complexity, duplication, assertion-quality, coverage-escape, secret, and incremental diff-coverage gates all run against changed files
6. run `npm run e2e:admin-withdrawal-approval` and `npm run ci:finance-approval-e2e-evidence` before release approval when funds approval behavior or evidence-sensitive paths changed
7. run `npm run e2e:admin-withdrawal-review:local` and `npm run ci:admin-withdrawal-review-local-evidence` when changing Admin-front withdrawal review, Gateway-admin decision auth, CSRF/session handling, OTP step-up, or 401/403 error handling. This evidence must prove `synapse_admin_session`, `X-CSRF-Token`, `X-Admin-OTP-Code`, `approval:decide`, review screenshots, DB state, duplicate-decision rejection, and chain replay protection.
8. run `npm run e2e:manual-review-expiry:local` and `npm run ci:manual-review-expiry-local-evidence` when changing manual-review expiry, consumer/provider withdrawal reapers, `WITHDRAWAL_MANUAL_REVIEW_EXPIRY_SEC`, expiry notification copy, or pending review queue filters. The local gate uses a 3-second expiry with `ALLOW_SHORT_WITHDRAWAL_REVIEW_EXPIRY_FOR_TESTS=1`; production default remains 24h.
9. run `npm run e2e:withdrawal-one-ticket-evidence` and `npm run ci:withdrawal-one-ticket-evidence` before release approval when one-ticket withdrawal, reaper, watcher, ticket signing, or claim completion semantics changed
10. run `npm run e2e:withdrawal-idempotency-concurrency` and `npm run ci:withdrawal-idempotency-concurrency-evidence` when changing withdrawal creation, idempotency keys, manual-review decisions, complete callbacks, ticket replay protection, or balance bucket transitions under concurrency
11. run `npm run e2e:user-front-deposit-balance` and `npm run ci:user-front-deposit-balance-evidence` when changing user-front Billing/Credits deposit display, `useFundsData`, deposit intent sync, balance refresh, or deposit status semantics. The evidence must prove Gateway `PENDING_CONFIRMATION` renders as `Pending`, Gateway `CONFIRMED` renders as `Completed`, SQL balance buckets move pending -> available exactly once, and replay does not double-credit the account.
12. run `npm run e2e:user-front-copyable-identifiers` and `npm run ci:user-front-copyable-identifiers-evidence` when changing visible copy controls for transaction IDs, invocation IDs, service IDs, agent IDs, wallet addresses, tx hashes, withdrawal IDs, nonce/ticket fields, or privacy-sensitive invocation/provider tables. This is a local DOM/clipboard evidence gate, not a DB/ledger money-path gate.
13. run `npm run e2e:user-front-payments-gateway-truth:local` and `npm run ci:user-front-payments-gateway-truth-local-evidence` when changing Billing/Payments history aggregation, deposit/withdraw/refund API adapters, or frontend money-history data sources. The evidence must prove Payments rows come from Gateway DB/API, each source uses `limit=100`, DOM renders the sorted top 50 rows, pending intents survive refresh, and frontend chain-log scans are not reintroduced.
14. run `npm run e2e:deposit-indexer-recovery:local` and `npm run ci:deposit-indexer-recovery-local-evidence` when changing deposit indexer startup, backfill, replay protection, local Gateway indexer env, or pending-deposit reliability. The evidence must prove indexer-down UI stays pending, restart auto-confirms valid deposits, backfill recovers missed intents, invalid events do not credit, and replay does not double-credit.
15. run `npm run ci:diff-coverage` when changed code needs line-level coverage evidence; Python and Vitest coverage must be Cobertura XML
16. run `npm run ci:agent-guardrails` when Agent-generated backend/admin code touches finance, approval, storage, or shared state-machine logic; install `uv` once if the runner reports a missing Python guardrail tool
17. run `npm run release:evidence:gateway-fullchain:local` for a local rehearsal of the full live Gateway E2E evidence chain; run `GATEWAY_RELEASE_E2E_PROFILE=mvp-postgres npm run release:evidence:gateway-fullchain:staging` plus `GATEWAY_RELEASE_E2E_REQUIRED_ENV=staging npm run ci:gateway-release-e2e-evidence` for MVP Cloud Run + Cloud SQL staging release evidence. The bundle must include a non-empty `trace.jsonl` with a matching `report.json.traceDigest`
18. run `npm run perf:local-production-load-rehearsal` and `npm run ci:local-production-load-evidence` before staging load when changing invoke, balance, deposit confirm, withdrawal, provider health, admin finance views, load-runner behavior, or wallet/signing isolation; this validates local runId isolation, temporary wallet pools, per-wallet chain serialization, bounded concurrency, drain hard cap, and no secret leakage
19. run `npm run ci:monitoring-alert-rules` when changing metrics, readiness, dashboards, Alertmanager routes, Lark Relay behavior, alert rules, or monitoring runbooks
20. run `npm run e2e:gcp-alerts:local` and `npm run ci:gcp-alerts-local-evidence` before deploying GCP Monitoring receiver/drill changes; then run `npm run e2e:gcp-alerts:staging` and `npm run ci:gcp-alerts-staging-evidence` after staging deploy. Set `GCP_ALERTS_REQUIRE_MONITORING_DELIVERY=true` once per release candidate to prove GCP policy callback delivery
21. run `npm run e2e:lark-alerts` and `npm run ci:lark-alert-e2e-evidence` before release approval when changing Lark webhook routing, Relay delivery, Alertmanager-to-Lark contracts, or production alert notification behavior
22. run `npm run e2e:staging-smoke` and `npm run ci:staging-smoke-evidence` after staging Cloud Run, DNS, CORS, RPC, contract-address, or docs-front endpoint changes; this is the first-pass live staging gate before full-chain evidence
23. run `npm run e2e:staging-full-regression` and `npm run ci:staging-full-regression-evidence` after a staging app deploy when you need the broad release gate. It starts from `https://staging.synapse-network.ai/dashboard/overview`, reuses canonical registered Provider services only, verifies DOM/API/Cloud SQL/chain checkpoints before screenshots, and fails if service registration count changes.
24. run `npm run e2e:staging-ui-dogfood` after staging User-front/Admin-front/Docs-front deploys to capture screenshots and browser-origin API/CORS failures
25. run `npm run e2e:staging-core-dogfood` and `npm run ci:staging-core-dogfood-evidence` for the first-phase staging money-path gate; it mutates Arbitrum Sepolia and Cloud SQL staging, requires `STAGING_CORE_DOGFOOD_CONFIRM=I_UNDERSTAND_THIS_MUTATES_STAGING`, and must stay out of PR CI
26. run `npm run e2e:gmail-notifications:staging` and `npm run ci:gmail-notifications-staging-evidence` when validating live staging Gmail SMTP/outbox delivery; the runner requires `GMAIL_STAGING_E2E_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_EMAIL`
27. run `npm run e2e:transaction-notifications:local` and `npm run ci:transaction-notifications-local-evidence` before deploying transaction notification changes; optionally run `npm run e2e:transaction-notifications:local-real` and `npm run ci:transaction-notifications-local-real-evidence` when you need to prove real local Gmail SMTP + Lark delivery before staging. `local-real` requires `TRANSACTION_NOTIFICATIONS_LOCAL_REAL_CONFIRM=I_UNDERSTAND_THIS_SENDS_REAL_LOCAL_EMAIL_AND_LARK` and private Gmail/Lark values from shell env or `services/gateway/.env.local.private`. After staging deploy run `npm run e2e:transaction-notifications:staging` and `npm run ci:transaction-notifications-staging-evidence`. The staging runner sends real staging Gmail and Lark cards and requires `TRANSACTION_NOTIFICATIONS_STAGING_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_EMAIL_AND_LARK`
28. run `npm run e2e:support-case-dogfood:local` and `npm run ci:support-case-dogfood-local-evidence` before deploying support intake, forum-support, support Lark, or support reply notification changes. After staging deploy run `npm run e2e:support-case-dogfood:staging` and `npm run ci:support-case-dogfood-staging-evidence`; the staging runner creates staging-only support cases, sends support Lark cards, verifies Admin-front `/forum-support` screenshots, and requires `SUPPORT_CASE_DOGFOOD_STAGING_CONFIRM=I_UNDERSTAND_THIS_SENDS_STAGING_SUPPORT_ALERTS`
29. run `npm run e2e:email-binding:local-real` and `npm run ci:email-binding-local-evidence` when changing email binding, change-email, remove-email, verification-code, or account settings screenshot evidence. The checker rejects screenshots without `screenshot-evidence.json`, expected DOM text/selector checkpoints, DB checkpoints, and `forbiddenTextAbsent=true`; AuthMask/Connect Wallet screenshots are invalid evidence.
30. run `npm run e2e:llm-deepseek:local` and `npm run ci:llm-deepseek-local-evidence` before deploying LLM token-metered billing changes; local evidence defaults to a local OpenAI-compatible fake LLM happy path plus fake timeout, missing-usage, and slow-success fixtures proving no final usage means no charge. Set `LLM_E2E_USE_REGISTERED_DEEPSEEK=1` only when local Provider has a real DeepSeek API key. After staging deploy run `npm run e2e:llm-deepseek:staging` and `npm run ci:llm-deepseek-staging-evidence`. The staging runner calls live DeepSeek Chat through Gateway, mutates staging balance, requires `LLM_DEEPSEEK_E2E_CONFIRM=I_UNDERSTAND_THIS_CALLS_LIVE_LLM_AND_CHARGES_STAGING`, and validates usage, charge, hold release, and provider/platform split exactly.
31. run `npm run ci:quality-budget` when changing production code, tests, E2E scripts, or CI guardrails; new production source files must stay under 500 effective lines, test-like files under 800 effective lines, and new disable comments must include a reason.
32. run `npm run ci:format-check` when changing TypeScript, JavaScript, JSON, YAML, or Markdown; this is a read-only Prettier check and must not be closed by committing unreviewed formatter churn.
33. run `npm run ci:e2e-env-isolation` whenever changing E2E, perf, drill, or root npm script environment boundaries; local E2E must never read Google Secret Manager, dual-mode scripts must not load `.env.staging`, and staging Secret Manager reads must go through the shared wrapper.
34. run `npm run drill:backup-restore:staging` and `npm run ci:backup-restore-evidence` before release approval when changing backup, restore, reconciliation, database bootstrap, ClickHouse analytics storage, or production recovery runbooks
35. run `cd services/gateway && python -m pytest tests/unit/test_notifications_outbox_unit.py` when changing Gmail email notifications; email sending must remain async outbox-driven and must not block Gateway request paths
36. run `cd services/gateway && python -m pytest tests/unit/test_notifications_outbox_unit.py tests/unit/test_in_app_notifications_router_unit.py` and `cd services/user-front && yarn test src/components/NotificationCenter.test.tsx` when changing in-app notifications; inbox writes must remain best-effort and must not block funds state machines
37. run `npm run ci:migration-seed-guard` when changing DB migrations, bootstrap SQL, Cloud Run migration jobs, or any `scripts/e2e/*seed*.mjs` / dogfood seed path; production seed execution must remain impossible
38. run `npm run e2e:in-app-notifications` and `npm run ci:in-app-notifications-evidence` when closing in-app notification front-to-service E2E; it must produce screenshots, prove local Docker table readiness, and keep payload metadata-only
39. run `npm run e2e:admin-login-lockout:dogfood` when closing admin login lockout UX, API, audit, or config behavior; it must create a disposable local admin, trigger the five-failure lockout through Admin-front, capture screenshots/video, assert DB audit state, write `bugfix-log.md`, and delete the test account
40. run `terraform -chdir=infra/terraform/gcp-staging fmt -check` and `terraform -chdir=infra/terraform/gcp-staging validate` when changing Google Cloud staging infrastructure; `terraform validate` requires `terraform init` first
41. run `npm run deploy:contracts:arbitrum-sepolia:dry-run` before Arbitrum Sepolia staging deployment, then `npm run deploy:contracts:arbitrum-sepolia` and `npm run ci:contract-deployment-evidence` to close staging contract evidence; this requires live Arbitrum Sepolia RPC and funded staging deployer/consumer/provider wallets
42. follow `docs/ops/19_E2E_Regression_Runbook.md` when doing full local or staging regression. Provider registration, consumer login, deposit, invoke, consumer withdrawal, provider withdrawal/admin review, notifications, analytics, and contract release checks must include the documented read-only SQL evidence. Staging SQL must use an approved read-only DSN or Cloud SQL Auth Proxy connection and must never repair state during regression.
    Ordinary invoke, billing, UI, and withdrawal E2E must reuse the Synapse-Network-Provider catalog. Default paid settlement uses `svc_synapse_mock_cost_1usdc`, free smoke uses `svc_synapse_echo`, and Gateway local/staging E2E must not POST service registrations; service-registration behavior is covered by backend unit/router/service tests.
43. run `npm run e2e:admin-regression` and `npm run ci:admin-regression-evidence` when closing Admin-wide regression, Admin Analytics Postgres source changes, admin notification evidence, withdrawal review orchestration, platform treasury Safe draft evidence, or screenshot/SQL evidence contracts. The evidence must include `expected_state.json`, `sql_evidence.json`, `screenshot_evidence.json`, final-state DOM checkpoints, and Postgres-only Analytics source proof.

Withdrawal evidence coverage is intentionally split:

1. `npm run e2e:withdrawal-risk-policy` proves Dust, T+N maturity, aggregate FIFO, 24h sliding-window risk classification, and normal Consumer/Provider withdrawals through final `COMPLETED`.
2. `npm run e2e:withdrawal-idempotency-concurrency` proves create, manual-review decision, complete, ticket replay, and balance-bucket invariants under concurrency.
3. `npm run e2e:withdrawal-review-dogfood:local` and `npm run e2e:admin-withdrawal-approval` prove manual-review UI/API/DB, approve/reject operations, screenshots, and admin evidence. Their evidence gates require the matching E2E to run first; missing local evidence directories are not a docs-only failure by themselves.

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
