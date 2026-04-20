# Admin Withdrawal Approval E2E Verification

- Status: canonical
- Code paths: `scripts/e2e/admin_withdrawal_approval_seed.mjs`, `scripts/ui/dogfood_admin_withdrawal_approval.mjs`, `scripts/e2e/admin_withdrawal_approval_reconcile.mjs`
- Verified with: `npm run e2e:admin-withdrawal-approval`
- Last verified against code: 2026-04-20

## Purpose

This verification proves the Provider withdrawal approval path is wired end-to-end:

`Gateway withdrawal intent -> gateway-admin review API -> admin-front manual approval -> Gateway signed ticket -> SynapseCore.withdraw -> Gateway completion -> DB/API/UI/chain reconciliation`.

Screenshots are visual evidence. Pass/fail is based on browser clicks, Gateway API responses, Postgres rows, and on-chain USDC balance deltas.

## Current Approval Surfaces

The admin control plane currently exposes these approval-related surfaces:

1. `/withdrawal-reviews`: Provider withdrawal manual review workbench. This is the primary wired finance approval path.
2. `/approvals`: Unified approval queue. It includes local admin approvals and projected Provider withdrawal reviews with `PWR-*` approval IDs.
3. `/review-history`: Provider withdrawal review history from gateway-admin audit records.
4. `/execution`: Execution jobs and retries for control-plane operations.
5. `/finance` and `/finance/reconciliation`: Finance observability and reconciliation pages used to validate approval impact.

Consumer withdrawal/refund manual review exists in Gateway internal APIs, but it does not yet have a dedicated admin-front workbench equivalent to `/withdrawal-reviews`.

## Scenario

The E2E flow creates real Provider receivable through a paid Gateway invocation, then withdraws `2.000000 USDC` through manual review.

1. Authenticate consumer, provider, and admin wallets/sessions.
2. Register one local Provider service and wait until it is discoverable.
3. Deposit local MockUSDC into `SynapseCore` for the consumer and confirm it in Gateway.
4. Invoke the Provider service once through Gateway to create Provider receivable.
5. Create a Provider withdrawal intent with `WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC=1.000000`, forcing `PENDING_MANUAL_REVIEW`.
6. Use admin-front `/withdrawal-reviews` to approve and issue a signed ticket.
7. Execute `SynapseCore.withdraw(amount, fee, nonce, deadline, signature)` with the Provider wallet.
8. Call Gateway complete endpoint with the tx hash.
9. Reconcile expected vs actual data across Postgres, Gateway API, gateway-admin API, admin-front screenshots, and chain balances.

Local Hardhat `MockUSDC` uses 18 decimals. Reports therefore compare chain atomic values using the ticket amount returned by Gateway, not a hardcoded six-decimal assumption.

## Commands

Start services with the manual-review threshold enabled:

```bash
WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC=1.000000 sh scripts/local/restart_gateway.sh
sh scripts/local/restart_gateway_admin.sh
cd services/admin-front && yarn dev
```

Run the full flow:

```bash
npm run e2e:admin-withdrawal-approval
```

Run individual steps:

```bash
npm run e2e:admin-withdrawal-approval:seed
npm run e2e:admin-withdrawal-approval:dogfood
npm run e2e:admin-withdrawal-approval:reconcile
```

Important environment variables:

1. `GATEWAY_BASE_URL`, default `http://127.0.0.1:8000`
2. `ADMIN_GATEWAY_URL`, default `http://127.0.0.1:8300`
3. `ADMIN_FRONT_URL`, default `http://localhost:4000`
4. `RPC_URL`, default `http://127.0.0.1:8545`
5. `POSTGRES_DSN` or `GATEWAY_POSTGRES_DSN`
6. `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_OTP_CODE`, `ADMIN_TOTP_SECRET`

Default local private keys and default admin password are refused against non-local URLs.

## Expected vs Actual Checks

The reconciliation report must include these comparisons:

| Stage | Expected |
| --- | --- |
| Request created | `synapse_vault_withdrawals.status = PENDING_MANUAL_REVIEW` |
| Request created | Provider available receivable decreases and frozen balance increases by withdrawal amount |
| Approval | Gateway and DB status become `APPROVED_AUTO` |
| Approval | Ticket contains amount, fee, nonce, deadline, signature |
| Chain claim | Provider MockUSDC balance increases by ticket amount |
| Chain claim | SynapseCore MockUSDC balance decreases by ticket amount |
| Completion | Gateway/DB status becomes `COMPLETED` and txHash is persisted |
| Completion | Provider pending and frozen balances return to `0.000000` for the completed withdrawal |
| UI | `/withdrawal-reviews`, `/review-history`, and `/finance/reconciliation` screenshots exist |

## Security Regression Checks

The suite treats any failure here as a P0 finance bug:

1. Same `X-Idempotency-Key` returns the same withdrawal ID.
2. A second active same-amount withdrawal returns the existing withdrawal, not a new frozen amount.
3. A second active different-amount withdrawal is rejected.
4. Invalid internal Gateway token returns `INTERNAL_TOKEN_INVALID` or an auth failure and does not mutate balances.
5. Duplicate admin approval is rejected.
6. Approve then reject is rejected.
7. Tampered ticket amount is rejected by the contract.
8. Valid ticket replay is rejected by the contract.
9. Duplicate complete with the same tx hash is rejected.
10. DB amount, ticket amount, chain transfer, and UI display remain consistent.

## Outputs

The suite writes:

1. `tmp/admin-withdrawal-approval/fixture.json`
2. `output/dogfood/admin-withdrawal-approval/<timestamp>/report.md`
3. `output/dogfood/admin-withdrawal-approval/<timestamp>/report.json`
4. `output/dogfood/admin-withdrawal-approval/<timestamp>/reconciliation-report.md`
5. `output/dogfood/admin-withdrawal-approval/<timestamp>/reconciliation-report.json`
6. `output/dogfood/admin-withdrawal-approval/<timestamp>/screenshots/*.png`

Do not commit `tmp/` or `output/` evidence unless a release evidence bundle explicitly asks for it.

## Pass Criteria

The flow passes only when:

1. Seed exits successfully and creates a `PENDING_MANUAL_REVIEW` Provider withdrawal.
2. Browser dogfood report has `status=success`, no failed steps, and no console/API 500 errors.
3. Reconciliation report has `status=success`.
4. Provider receives the exact ticket amount on-chain.
5. SynapseCore/vault loses the exact ticket amount on-chain.
6. Gateway DB status is `COMPLETED`.
7. Review history contains the reviewed withdrawal.
8. All security regression checks pass.

## Failure Handling

If any step fails:

1. Record a bugfix under `docs/reference/bugfix/gateway/`, `docs/reference/bugfix/gateway-admin/`, or `docs/reference/bugfix/admin-front/`.
2. Include reproduction, root cause, fix, verification command, and residual risk.
3. Fix the issue.
4. Rerun the narrow failed command.
5. Rerun `npm run e2e:admin-withdrawal-approval` before marking the approval path verified.
