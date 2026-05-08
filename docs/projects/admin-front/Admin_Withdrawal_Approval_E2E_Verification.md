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

Consumer withdrawal/refund manual review exists in Gateway internal APIs and the
focused withdrawal-review dogfood gate treats `/withdrawal-reviews`
as the unified manual review surface for both `provider_withdrawal` and
`consumer_refund` items. The older provider approval E2E remains the canonical
provider approve baseline; the focused gate adds provider reject plus consumer
approve/reject coverage and verifies the consumer reject no-funds-blackhole
invariant.

The queue must also surface `reviewExpiresAt` / 审批过期时间. This value is
backend-owned and equals `created_at + WITHDRAWAL_MANUAL_REVIEW_EXPIRY_SEC`.
Rows that have passed that timestamp must not remain in the active
`/withdrawal-reviews` queue, even if the expiry worker has not yet persisted
`FAILED_EXPIRED`.

## Scenario

The E2E flow creates real Provider receivable through a paid Gateway invocation, then withdraws `2.000000 USDC` through manual review.

1. Authenticate consumer, provider, and admin wallets/sessions.
2. Register one local Provider service and wait until it is discoverable.
3. Deposit local MockUSDC into `SynapseCore` for the consumer and confirm it in Gateway.
4. Invoke the Provider service once through Gateway to create Provider receivable.
5. Create a Provider withdrawal intent with `WITHDRAWAL_AUTO_SINGLE_LIMIT_USDC=1.000000`, forcing `PENDING_MANUAL_REVIEW`.
6. Use admin-front `/withdrawal-reviews` to approve and issue a signed ticket.
7. Execute `SynapseCore.withdraw(amount, fee, ticketId, deadline, signature)` with the Provider wallet.
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

Focused local withdrawal-review dogfood:

```bash
npm run e2e:withdrawal-review-dogfood:local
npm run ci:withdrawal-review-dogfood-local-evidence
```

The focused gate first runs the provider approve baseline above, then continues
with:

1. Consumer manual withdrawal reject: status becomes `REJECTED` and frozen funds
   return to available funds.
2. Consumer manual withdrawal approve: Gateway issues an EIP-712 ticket, the
   consumer claims on-chain, and replay is rejected.
3. Provider manual withdrawal reject: provider frozen funds return to available
   receivable and the reviewed item cannot be approved afterward.

The gate writes `report.json`, `report.md`, `trace.jsonl`, `bugfix-log.md`,
`api-evidence.json`, `db-evidence.json`, `chain-evidence.json`, and screenshots
under `output/dogfood/withdrawal-review/<timestamp>/`.

Important environment variables:

1. `GATEWAY_BASE_URL`, default `http://127.0.0.1:8000`
2. `ADMIN_GATEWAY_URL`, default `http://127.0.0.1:8300`
3. `ADMIN_FRONT_URL`, default `http://localhost:3200`
4. `RPC_URL`, default `http://127.0.0.1:8545`
5. `POSTGRES_DSN` or `GATEWAY_POSTGRES_DSN`
6. `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_OTP_CODE`, `ADMIN_TOTP_SECRET`

Default local private keys and default admin password are refused against non-local URLs.

## Expected vs Actual Checks

The reconciliation report must include these comparisons:

| Stage           | Expected                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| Request created | `synapse_vault_withdrawals.status = PENDING_MANUAL_REVIEW`                                |
| Request created | Provider available receivable decreases and frozen balance increases by withdrawal amount |
| Approval        | Gateway and DB status become `APPROVED_AUTO`                                              |
| Approval        | Ticket contains amount, fee, ticketId, ticketHash, deadline, signature                    |
| Chain claim     | Provider MockUSDC balance increases by ticket amount                                      |
| Chain claim     | SynapseCore MockUSDC balance decreases by ticket amount                                   |
| Completion      | Gateway/DB status becomes `COMPLETED` and txHash is persisted                             |
| Completion      | Provider pending and frozen balances return to `0.000000` for the completed withdrawal    |
| UI              | `/withdrawal-reviews`, `/review-history`, and `/finance/reconciliation` screenshots exist |
| UI              | `/withdrawal-reviews` shows 审批过期时间 / `Review Expires At` for each pending row        |

The focused withdrawal-review dogfood additionally requires:

| Scenario          | Expected                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Consumer reject   | `consumer_refund` status is `REJECTED`; available/frozen balance tuple returns to the pre-request values.                                 |
| Consumer approve  | ticket is present; on-chain claim succeeds; ticket replay fails; DB status becomes `COMPLETED`.                                           |
| Provider reject   | `provider_withdrawal` status is `REJECTED`; available/frozen balance tuple returns to the pre-request values.                             |
| Unified review UI | `/withdrawal-reviews` screenshots show both `Consumer withdrawal` and `Provider withdrawal` item kinds when those items are under review. |
| Queue expiry      | Once a manual-review row passes `reviewExpiresAt`, it disappears from `/withdrawal-reviews`; backend later persists `FAILED_EXPIRED` and releases funds. |

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

Focused withdrawal-review evidence writes:

1. `output/dogfood/withdrawal-review/<timestamp>/report.md`
2. `output/dogfood/withdrawal-review/<timestamp>/report.json`
3. `output/dogfood/withdrawal-review/<timestamp>/trace.jsonl`
4. `output/dogfood/withdrawal-review/<timestamp>/bugfix-log.md`
5. `output/dogfood/withdrawal-review/<timestamp>/api-evidence.json`
6. `output/dogfood/withdrawal-review/<timestamp>/db-evidence.json`
7. `output/dogfood/withdrawal-review/<timestamp>/chain-evidence.json`
8. `output/dogfood/withdrawal-review/<timestamp>/screenshots/*.png`

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
6. For consumer or reject-path changes, rerun
   `npm run e2e:withdrawal-review-dogfood:local` and
   `npm run ci:withdrawal-review-dogfood-local-evidence`.
