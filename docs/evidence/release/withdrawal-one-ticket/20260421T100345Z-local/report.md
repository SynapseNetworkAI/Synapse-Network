# Withdrawal One-Ticket Release Evidence

- Status: success
- Environment: local
- Run ID: wot-20260421100352
- Generated at: 2026-04-21T10:08:18.322Z
- Gateway: http://127.0.0.1:8000
- RPC: http://127.0.0.1:8545
- Chain ID: 31337
- SynapseCore: 0x00CAC06Dd0BB4103f8b62D280fE9BCEE8f26fD59
- MockUSDC: 0xAD2935E147b61175D5dc3A9e7bDa93B0975A43BA
- Ticket TTL: 60s
- Reaper buffer: 3s
- RPC finality margin: 3s

## Scenario Results

| Scenario | Status | Ticket Hash | Key Result |
| --- | --- | --- | --- |
| consumer-normal-claim | passed | 0x65c25d3ffdc17e8d4ec51bcd77afe95b1b7963e51a393a128efd170e9834a88a | consumer ticket claimed and completed |
| consumer-soft-revoke-race-claim | passed | 0xf20b93e874a7c0730e36c18993d60afd6fd09d2b7e557c4d6068c92a8108dd14 | consumer ticket claimed and completed |
| consumer-replay-attack | passed | 0xa3c3cc0cd6fd918eb594539afd3d3850676669e98e2448ef7ad91d296934f9be | Replay of consumed consumer ticket reverts and Gateway remains COMPLETED |
| provider-normal-claim | passed | 0x88657cc9d67a57247143fbe50e6d5af35f417111e66d06c23a81141abe8fbcb2 | provider ticket claimed and completed |
| provider-soft-revoke-race-claim | passed | 0x941b54a381edc87bf74f520fdeaace1daaa280d1385fd3627d7a155ab9b17b3d | provider ticket claimed and completed |
| provider-onchain-revert-retry | passed | 0x790fc338f6b7a39b36ea9bb545c8388ffacfa70d8ac7f06ceeee5261db8ccaf3 | Low-gas claim reverts without consuming ticket; same ticket retries successfully before deadline |
| consumer-expired-reaper | passed | 0xd9cd41733e1973ccffa38bf928f715b237f8e6103ee595d24c344d9de3808e9c | consumer ticket expired and reaper released funds |
| consumer-soft-revoke-expire | passed | 0x5b149852b3daa4c580abde9735933c13dcd8a09fc35fc08f4ef5004f90569feb | consumer ticket expired and reaper released funds |
| provider-expired-reaper | passed | 0x60fce9deeef2abc1018a23ebfa9ee3e12c738a9c719333fd3656b5c9c84742b0 | provider ticket expired and reaper released funds |
| provider-soft-revoke-expire | passed | 0x4254c07f6e2175a6c8eda826c17b5fb9727b030af3328ff983a5ed1f5f974a35 | provider ticket expired and reaper released funds |

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
| consumer-expired-reaper | rpcBlockTimestamp | >1776765899 | 1776765905 | PASS |
| consumer-soft-revoke-expire | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| consumer-soft-revoke-expire | ticketConsumed | false | false | PASS |
| consumer-soft-revoke-expire | rpcBlockTimestamp | >1776765965 | 1776765971 | PASS |
| provider-expired-reaper | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| provider-expired-reaper | ticketConsumed | false | false | PASS |
| provider-expired-reaper | rpcBlockTimestamp | >1776766031 | 1776766037 | PASS |
| provider-soft-revoke-expire | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| provider-soft-revoke-expire | ticketConsumed | false | false | PASS |
| provider-soft-revoke-expire | rpcBlockTimestamp | >1776766096 | 1776766102 | PASS |

## Negative Scenarios

- Consumer replay attack: second claim reverts, Gateway remains COMPLETED, no second balance delta.
- Provider low-gas revert retry: first low-gas claim fails without consuming ticket; same ticket succeeds with normal gas before deadline.

## Failures

None.
