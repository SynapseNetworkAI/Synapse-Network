# Withdrawal One-Ticket Release Evidence

- Status: success
- Environment: local
- Run ID: wot-20260509104656
- Generated at: 2026-05-09T10:51:29.260Z
- Gateway: http://127.0.0.1:8000
- RPC: http://127.0.0.1:8545
- Chain ID: 31337
- SynapseCore: 0x8f119cd256a0FfFeed643E830ADCD9767a1d517F
- MockUSDC: 0x4f42528B7bF8Da96516bECb22c1c6f53a8Ac7312
- Ticket TTL: 60s
- Reaper buffer: 3s
- RPC finality margin: 3s

## Scenario Results

| Scenario | Status | Ticket Hash | Key Result |
| --- | --- | --- | --- |
| consumer-normal-claim | passed | 0x5b93b5640ed11c90eca42ea7c7e4dbd208c9cb9073418f21fbe991cb3046496e | consumer ticket claimed and completed |
| consumer-soft-revoke-race-claim | passed | 0x6025e66b08d905cec6e190648590bf074bf9faa8db42462a7ceffe3827143890 | consumer ticket claimed and completed |
| consumer-replay-attack | passed | 0x09873028d395d9fe9028989196bb4cf91a8c34534b07d2750049a683b4181ff5 | Replay of consumed consumer ticket reverts and Gateway remains COMPLETED |
| provider-normal-claim | passed | 0x27eda602995ad838a42298a6868c41ae3a8bc23556b2b4d67491bc9fd868371c | provider ticket claimed and completed |
| provider-soft-revoke-race-claim | passed | 0xf38625a7d595e3f4eac6ea4cc81cd43761be565a9d8ab3f8431196426a70fed8 | provider ticket claimed and completed |
| provider-onchain-revert-retry | passed | 0xffb6828c738cce9add234bb2e4beef4d4f95b5d555d51bdf845c3edc76971855 | Low-gas claim reverts without consuming ticket; same ticket retries successfully before deadline |
| consumer-expired-reaper | passed | 0x8b5e4760b16b56a517b3e22007e177a62ce1c75a697f73c33c8d3d05b502a7ae | consumer ticket expired and reaper released funds |
| consumer-soft-revoke-expire | passed | 0x753d631ea578930b1d6e706275c9ac25004aa82eee391969d14dde52d71fa3fa | consumer ticket expired and reaper released funds |
| provider-expired-reaper | passed | 0xf674034f49f45d4e55368a60b78626288ef3e9e5b8cbe624c3fafbf24b026866 | provider ticket expired and reaper released funds |
| provider-soft-revoke-expire | passed | 0x5146c33848ef42f6ef6a6ed0d5c8e2cc8d79508b2a9c372c2ff4c6b006e1930d | provider ticket expired and reaper released funds |

## Expected vs Actual

| Scenario | Metric | Expected | Actual | Pass |
| --- | --- | --- | --- | --- |
| consumer-normal-claim | dbStatus | COMPLETED | COMPLETED | PASS |
| consumer-normal-claim | receiptStatus | 1 | 1 | PASS |
| consumer-normal-claim | ticketConsumed | true | true | PASS |
| consumer-soft-revoke-race-claim | dbStatus | COMPLETED | COMPLETED | PASS |
| consumer-soft-revoke-race-claim | receiptStatus | 1 | 1 | PASS |
| consumer-soft-revoke-race-claim | ticketConsumed | true | true | PASS |
| consumer-replay-attack | replayReverted | true | true | PASS |
| consumer-replay-attack | gatewayStatusAfterReplay | COMPLETED | COMPLETED | PASS |
| consumer-replay-attack | noSecondWalletDelta | 0 | 0 | PASS |
| consumer-replay-attack | ticketConsumed | true | true | PASS |
| provider-normal-claim | dbStatus | COMPLETED | COMPLETED | PASS |
| provider-normal-claim | receiptStatus | 1 | 1 | PASS |
| provider-normal-claim | ticketConsumed | true | true | PASS |
| provider-soft-revoke-race-claim | dbStatus | COMPLETED | COMPLETED | PASS |
| provider-soft-revoke-race-claim | receiptStatus | 1 | 1 | PASS |
| provider-soft-revoke-race-claim | ticketConsumed | true | true | PASS |
| provider-onchain-revert-retry | lowGasReverted | true | true | PASS |
| provider-onchain-revert-retry | consumedAfterLowGas | false | false | PASS |
| provider-onchain-revert-retry | gatewayNotFailedAfterLowGas | not FAILED/FAILED_EXPIRED | APPROVED_AUTO | PASS |
| provider-onchain-revert-retry | retryReceiptStatus | 1 | 1 | PASS |
| provider-onchain-revert-retry | finalGatewayStatus | COMPLETED | COMPLETED | PASS |
| consumer-expired-reaper | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| consumer-expired-reaper | ticketConsumed | false | false | PASS |
| consumer-expired-reaper | rpcBlockTimestamp | >1778323687 | 1778323693 | PASS |
| consumer-soft-revoke-expire | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| consumer-soft-revoke-expire | ticketConsumed | false | false | PASS |
| consumer-soft-revoke-expire | rpcBlockTimestamp | >1778323755 | 1778323761 | PASS |
| provider-expired-reaper | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| provider-expired-reaper | ticketConsumed | false | false | PASS |
| provider-expired-reaper | rpcBlockTimestamp | >1778323822 | 1778323828 | PASS |
| provider-soft-revoke-expire | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| provider-soft-revoke-expire | ticketConsumed | false | false | PASS |
| provider-soft-revoke-expire | rpcBlockTimestamp | >1778323887 | 1778323893 | PASS |

## Negative Scenarios

- Consumer replay attack: second claim reverts, Gateway remains COMPLETED, no second balance delta.
- Provider low-gas revert retry: first low-gas claim fails without consuming ticket; same ticket succeeds with normal gas before deadline.

## Failures

None.

## Evidence Layers

- `trace.jsonl`
- `db-evidence.json`
- `dom-evidence.json`
- `screenshot-evidence.json`

- Trace digest: c0ba7c1f9dd8e2248239ac136cf494e82ecaf300c0d67b45be464bb8ca21d779

## Evidence Layers

- `trace.jsonl`
- `db-evidence.json`
- `dom-evidence.json`
- `screenshot-evidence.json`

- Trace digest: c0ba7c1f9dd8e2248239ac136cf494e82ecaf300c0d67b45be464bb8ca21d779

## Evidence Layers

- `trace.jsonl`
- `db-evidence.json`
- `dom-evidence.json`
- `screenshot-evidence.json`

- Trace digest: c0ba7c1f9dd8e2248239ac136cf494e82ecaf300c0d67b45be464bb8ca21d779
