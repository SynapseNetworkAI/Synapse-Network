# Financial Concurrency And Idempotency Matrix

- Status: canonical
- Code paths: `services/gateway/src/`, `services/gateway/tests/unit/`, `scripts/e2e/`, `scripts/ci/`, `docs/reference/`, `docs/ops/`
- Verified with: `npm run ci:docs`
- Last verified against code: 2026-05-06

This matrix is the compact source of truth for money-path replay, race, and
terminal-state expectations.

## Matrix

| Flow                    | Create / register                                 | Review / approve                  | Complete / confirm                                      | Replay / duplicate rule                                                               | Primary gate                                                                                                                  |
| ----------------------- | ------------------------------------------------- | --------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Deposit                 | durable intent by idempotency key                 | n/a                               | confirm or backfill moves `pending -> available` once   | same `txHash` and same event key must never double-credit                             | `e2e:deposit-indexer-recovery:local`                                                                                          |
| Consumer withdrawal     | one active row per owner; reserve once            | approve/reject race resolves once | claim + `/complete` consumes pending once               | same key same payload stable; mismatched payload `409`; consumed ticket cannot replay | `e2e:withdrawal-idempotency-concurrency`, `e2e:consumer-withdraw-claim-fullchain:local`, `e2e:withdrawal-one-ticket-evidence` |
| Provider withdrawal     | one active row per provider; receivable lock once | approve/reject race resolves once | claim + complete consumes pending once                  | same key same payload stable; consumed ticket cannot replay                           | `e2e:withdrawal-idempotency-concurrency`, `e2e:withdrawal-one-ticket-evidence`, `e2e:provider-withdraw-mature:local`          |
| Refund                  | one intent per idempotency key                    | manual review path explicit       | complete or fail releases/consumes once                 | duplicate same callback is idempotent; conflicting callback rejected                  | `test_money_safety_races_unit.py`                                                                                             |
| LLM settlement          | one invocation per idempotency key                | n/a                               | hold reserve once, capture once, release remainder once | retry or timeout cannot duplicate charge/provider credit/platform fee                 | `e2e:llm-deepseek:local`                                                                                                      |
| Platform fee withdrawal | owner-controlled request only                     | n/a                               | withdraw only accrued fee                               | `amount > platformFeePool` must revert                                                | `e2e:consumer-withdraw-claim-fullchain:local`                                                                                 |

## Invariants

Every money path must satisfy all of these:

1. no duplicate balance delta
2. no duplicate ledger entry for the same business mutation
3. no terminal status rollback
4. no cross-owner/provider/platform fund leakage
5. no unexplained reconciliation drift
6. no success path that depends on client-side chain-log inference

## Unified Local Gate

Run this when changing any money-affecting path:

```bash
npm run e2e:money-safety-concurrency:local
npm run ci:money-safety-concurrency-local-evidence
```

That gate aggregates the narrow evidence suites and fails if any attack ends as
`bug`, any ledger/vault invariant breaks, or any required scenario is missing.
