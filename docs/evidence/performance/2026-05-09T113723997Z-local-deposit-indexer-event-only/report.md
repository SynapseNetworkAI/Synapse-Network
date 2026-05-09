# Deposit Indexer Event-Only Local Evidence

- Status: success
- Run ID: event-only-2026-05-09T113723997Z
- Trace digest: 5c85f9f65e273d00f08b80a4dbc0911ad68a807958dbf7718137201500fb1ec2
- Primary deposit tx: 0xaf5568fd0d1304b5cc8147929c57e4473e49704a43ffd9a3e598d5a7111dd82a

## Reduction Summary

- Before: 202 req/tick, 23561280 CU/month
- After: 3 req/tick, 388800 CU/month
- RPC reduction: -98.52%
- CU reduction: -98.35%
- Reduction factor: 60.6x

## Checks

- PASS preflight:local
- PASS event-only:uses-getLogs - getLogs=2 getBlockByNumber=0
- PASS chunking:evidence-present - plannedChunks=2 getLogsCalls=2
- PASS finality-buffer:evidence-present - lastScannedBlock=2202 confirmedHead=2202
- PASS deposit:single-business-row - [REDACTED_HEX]
- PASS deposit:event-key-dedup - processedKeys=25
- PASS payments:db-dom-consistent - 0xaf5568fd...d82a
