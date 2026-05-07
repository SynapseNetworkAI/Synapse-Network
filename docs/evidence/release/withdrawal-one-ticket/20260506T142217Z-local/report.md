# Withdrawal One-Ticket Release Evidence

- Status: success
- Environment: local
- Run ID: wot-20260506142232
- Generated at: 2026-05-06T14:27:04.263Z
- Gateway: http://127.0.0.1:8000
- RPC: http://127.0.0.1:8545
- Chain ID: 31337
- SynapseCore: 0x3Aa5ebB10DC797CAC828524e59A333d0A371443c
- MockUSDC: 0x68B1D87F95878fE05B998F19b66F4baba5De1aed
- Ticket TTL: 60s
- Reaper buffer: 3s
- RPC finality margin: 3s

## Scenario Results

| Scenario | Status | Ticket Hash | Key Result |
| --- | --- | --- | --- |
| consumer-normal-claim | passed | 0x160fd8dda07558154b029607f6ea6f393fa1c879869537090659925f24cf53b0 | consumer ticket claimed and completed |
| consumer-soft-revoke-race-claim | passed | 0x5729d3f1496ea6922e2b82993b0b1aa4cb7ee2bebbdf96387be68fc1fc616f4e | consumer ticket claimed and completed |
| consumer-replay-attack | passed | 0x0b6c8041d46aa6c04fd9a1c768eb96d2520ce63af9a44b212d903989738ee85b | Replay of consumed consumer ticket reverts and Gateway remains COMPLETED |
| provider-normal-claim | passed | 0x05537a3eee3b5317a9129e51009c1fcdf97b7b5fee796e07e56c6f459887fcfb | provider ticket claimed and completed |
| provider-soft-revoke-race-claim | passed | 0x99a7b6565b7d04aa4f66409d6a920935afbde454b1909f4a5156c4fd04585ba5 | provider ticket claimed and completed |
| provider-onchain-revert-retry | passed | 0x2d79ff4090f6caf2f25b730d3f431daa7be066e3d9192b7b1d9f486c1858a881 | Low-gas claim reverts without consuming ticket; same ticket retries successfully before deadline |
| consumer-expired-reaper | passed | 0x0ed3f959ba44c88e546fc21d9e52b14f1c51505d342050c105d87896f933fb81 | consumer ticket expired and reaper released funds |
| consumer-soft-revoke-expire | passed | 0x1fff3b5fcdec1719749942407964481f0576f381bd98c022584bf4901e20a8f0 | consumer ticket expired and reaper released funds |
| provider-expired-reaper | passed | 0x27961c74d948a0c22a01c15df530ca56832674b47c1bc6646175bc8f12c52365 | provider ticket expired and reaper released funds |
| provider-soft-revoke-expire | passed | 0x80529dd4f307097d01168e286d880975bc053b0a6b3c07e5d9b47e5b45d3664e | provider ticket expired and reaper released funds |

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
| consumer-expired-reaper | rpcBlockTimestamp | >1778077422 | 1778077428 | PASS |
| consumer-soft-revoke-expire | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| consumer-soft-revoke-expire | ticketConsumed | false | false | PASS |
| consumer-soft-revoke-expire | rpcBlockTimestamp | >1778077489 | 1778077495 | PASS |
| provider-expired-reaper | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| provider-expired-reaper | ticketConsumed | false | false | PASS |
| provider-expired-reaper | rpcBlockTimestamp | >1778077556 | 1778077562 | PASS |
| provider-soft-revoke-expire | dbStatus | FAILED_EXPIRED | FAILED_EXPIRED | PASS |
| provider-soft-revoke-expire | ticketConsumed | false | false | PASS |
| provider-soft-revoke-expire | rpcBlockTimestamp | >1778077622 | 1778077628 | PASS |

## Negative Scenarios

- Consumer replay attack: second claim reverts, Gateway remains COMPLETED, no second balance delta.
- Provider low-gas revert retry: first low-gas claim fails without consuming ticket; same ticket succeeds with normal gas before deadline.

## Failures

None.

