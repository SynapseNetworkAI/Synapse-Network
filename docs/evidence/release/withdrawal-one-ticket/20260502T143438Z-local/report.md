# Withdrawal One-Ticket Release Evidence

- Status: success
- Environment: local
- Run ID: wot-20260502143447
- Generated at: 2026-05-02T14:39:13.254Z
- Gateway: http://127.0.0.1:8000
- RPC: http://127.0.0.1:8545
- Chain ID: 31337
- SynapseCore: 0x3155755b79aA083bd953911C92705B7aA82a18F9
- MockUSDC: 0x3347B4d90ebe72BeFb30444C9966B2B990aE9FcB
- Ticket TTL: 60s
- Reaper buffer: 3s
- RPC finality margin: 3s

## Scenario Results

| Scenario | Status | Ticket Hash | Key Result |
| --- | --- | --- | --- |
| consumer-normal-claim | passed | 0xdd03da5213471c85552678bf77af4fa7f47211d831b555e11a9ac7c0cb8a259f | consumer ticket claimed and completed |
| consumer-soft-revoke-race-claim | passed | 0xb3d388c6f7d529fa73504f0d9a0f029c2289c117f64643369dc536e6eebba903 | consumer ticket claimed and completed |
| consumer-replay-attack | passed | 0xb1be5d3edfa5d079f80c49ece43a31d4922ad6be8a698f72dd14c4a9786e296b | Replay of consumed consumer ticket reverts and Gateway remains COMPLETED |
| provider-normal-claim | passed | 0xd64c97e05a8a0485971d5244ae61671c34d9b4a38db3ddf17899ad9c7615f5d5 | provider ticket claimed and completed |
| provider-soft-revoke-race-claim | passed | 0x2dee8c60fedfd2f77aafee2226fc690d6833e49bb0e10920c3ea5473b02c97b5 | provider ticket claimed and completed |
| provider-onchain-revert-retry | passed | 0x1bdec31e7733e0ea72bf6c5c0b8850117d6fe0fe8cbce56ee0a592dfa8dfb633 | Low-gas claim reverts without consuming ticket; same ticket retries successfully before deadline |
| consumer-expired-reaper | passed | 0xffa5bc1c7a92ac6a257fda9bc007348f859db399ed24f2880b1cb4d3f7031582 | consumer ticket expired and reaper released funds |
| consumer-soft-revoke-expire | passed | 0x83ebd39bfc11958b5d0b5a029d65bb24f581a23274c2201e59b75b932690049f | consumer ticket expired and reaper released funds |
| provider-expired-reaper | passed | 0x71016557fbd64ea02965fcb7516e89c07cedee58ec201487f0e8b1257dbf5cb4 | provider ticket expired and reaper released funds |
| provider-soft-revoke-expire | passed | 0x2dc45f57c90b77d76462b48b5109e2e817fe2f0787b17f38fc9208fcb593ebc6 | provider ticket expired and reaper released funds |

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
| consumer-expired-reaper | rpcBlockTimestamp | >1777732554 | 1777732560 | PASS |
| consumer-soft-revoke-expire | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| consumer-soft-revoke-expire | ticketConsumed | false | false | PASS |
| consumer-soft-revoke-expire | rpcBlockTimestamp | >1777732620 | 1777732626 | PASS |
| provider-expired-reaper | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| provider-expired-reaper | ticketConsumed | false | false | PASS |
| provider-expired-reaper | rpcBlockTimestamp | >1777732686 | 1777732692 | PASS |
| provider-soft-revoke-expire | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| provider-soft-revoke-expire | ticketConsumed | false | false | PASS |
| provider-soft-revoke-expire | rpcBlockTimestamp | >1777732751 | 1777732757 | PASS |

## Negative Scenarios

- Consumer replay attack: second claim reverts, Gateway remains COMPLETED, no second balance delta.
- Provider low-gas revert retry: first low-gas claim fails without consuming ticket; same ticket succeeds with normal gas before deadline.

## Failures

None.
