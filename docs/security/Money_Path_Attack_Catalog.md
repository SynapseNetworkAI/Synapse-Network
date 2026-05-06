# Money Path Attack Catalog

- Status: canonical
- Code paths: `services/gateway/src/`, `services/gateway/tests/unit/`, `scripts/e2e/`, `scripts/ci/`, `docs/ops/`, `docs/reference/`
- Verified with: `npm run ci:docs`
- Last verified against code: 2026-05-06

This document is the attacker-facing catalog for Synapse money paths. It is the
bridge between narrow finance suites and the unified local gate:

```bash
npm run e2e:money-safety-concurrency:local
npm run ci:money-safety-concurrency-local-evidence
```

## Security Goal

No attacker, retry storm, replay, race, stale callback, or operator mistake may:

1. credit the same deposit twice
2. settle the same withdrawal twice
3. release the same refund funds twice
4. capture the same invoke hold twice
5. let platform fee withdrawal consume customer principal or provider payable
6. roll a terminal money state backward into a mutable state

## Attack Catalog

| Attack                               | Target flow                               | Expected defense                                                                          | Evidence source                                                                |
| ------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Duplicate request double-spend       | consumer/provider withdraw create         | one active row, one balance reservation, same-key stable replay, mismatched payload `409` | `e2e:withdrawal-idempotency-concurrency`                                       |
| Deposit tx replay                    | deposit intent + confirm                  | same `txHash` never double-credits available balance                                      | `e2e:deposit-indexer-recovery:local`                                           |
| Watcher/indexer restart replay       | deposit backfill                          | restart/backfill can recover but not duplicate confirm                                    | `e2e:deposit-indexer-recovery:local`                                           |
| Ticket replay                        | consumer/provider claim                   | second on-chain claim reverts, Gateway remains terminal once                              | `e2e:withdrawal-one-ticket-evidence`, `e2e:withdrawal-idempotency-concurrency` |
| Approve/reject race                  | manual-review withdrawals                 | only one legal terminal branch survives                                                   | `e2e:withdrawal-idempotency-concurrency`                                       |
| Expiry/approve race                  | withdrawal expiry processors              | approval and expiry cannot both release/settle funds                                      | `e2e:withdrawal-risk-policy`, expiry unit tests                                |
| Stale callback replay                | refund / withdraw complete/fail callbacks | same callback is idempotent; conflicting callback is rejected                             | `test_money_safety_races_unit.py`                                              |
| Cross-account completion             | refund / withdraw complete APIs           | wrong owner/provider cannot complete another party's row                                  | existing auth + finance unit/E2E coverage                                      |
| Hold capture duplication             | LLM token-metered invoke                  | hold reserve once, capture once, release exact remainder                                  | `e2e:llm-deepseek:local`                                                       |
| Missing usage / timeout charge abuse | token-metered invoke                      | no final usage means no charge and no provider/platform credit                            | `e2e:llm-deepseek:local`                                                       |
| Fee over-withdraw                    | platform fee withdrawal                   | contract revert when `amount > platformFeePool`                                           | `e2e:consumer-withdraw-claim-fullchain:local`                                  |
| Principal theft via platform path    | platform fee withdrawal                   | only accrued fee leaves vault; customer principal stays isolated                          | `e2e:consumer-withdraw-claim-fullchain:local`                                  |
| Chain domain / signer tamper         | ticket claim                              | invalid signer, chainId, deadline, or ticket fields fail closed                           | contract tests + one-ticket evidence                                           |
| Low-gas revert retry abuse           | provider withdrawal                       | failed low-gas receipt does not consume ticket; retry completes once                      | `e2e:withdrawal-one-ticket-evidence`                                           |

## Required Evidence Contract

Every attack row in `attack-evidence.json` must include:

- `attackName`
- `targetFlow`
- `precondition`
- `exploitAttempt`
- `expectedDefense`
- `evidenceSource`
- `finalResult`

Allowed `finalResult` values:

- `blocked`
- `idempotent-noop`
- `terminal-safe`
- `bug`

Anything outside the first three is a release blocker.

## Release Rule

For finance-sensitive changes, passing a single UI or API happy path is not
enough. The change is not safe until:

1. the narrow lane for that money path passes
2. the unified money-safety concurrency gate passes
3. the evidence shows no duplicate ledger, no duplicate balance movement, and
   no unexplained vault drift
