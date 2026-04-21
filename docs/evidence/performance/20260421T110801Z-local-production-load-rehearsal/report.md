# Local MVP Production Load Rehearsal Evidence

- Status: success
- Run ID: lplr-2026-04-21T110809791Z-6f49cbcb
- Environment: local
- Generated at: 2026-04-21T11:10:33.044Z
- Gateway: http://127.0.0.1:8000
- Gateway-admin: http://127.0.0.1:8300
- RPC: http://127.0.0.1:8545
- Chain ID: 31337
- SynapseCore: 0xa195ACcEB1945163160CD5703Ed43E4f78176a54
- MockUSDC: 0xc0c5618f0F3Fa66b496F2940f373DC366d765BAe

## Local Boundary

This is local MVP rehearsal evidence. It validates state-machine safety, wallet isolation, bounded concurrency, graceful drain, and no unexpected 5xx. It is not staging or production capacity evidence.

## Wallet Isolation

- Consumer wallets: 4
- Provider wallets: 4
- Chain nonce collisions: 0
- Private keys, mnemonics, raw signatures, JWTs, and admin tokens are not written to evidence.

## Lane Results

| Lane | Type | Requests | Successes | Failures | p50 ms | p95 ms | p99 ms | Unexpected 5xx |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| withdrawal | task | 2 | 2 | 0 | 3996.918 | 3996.918 | 3996.918 | 0 |
| deposit-confirm | task | 4 | 4 | 0 | 691.509 | 781.188 | 781.188 | 0 |
| balance | loop | 199 | 199 | 0 | 1799.665 | 3231.643 | 4857.622 | 0 |
| invoke | loop | 71 | 71 | 0 | 1281.302 | 2362.139 | 2440.39 | 0 |
| provider-health | loop | 77 | 77 | 0 | 1053.579 | 1894.665 | 2627.502 | 0 |
| admin-finance | loop | 1306 | 1306 | 0 | 78.501 | 132.316 | 147.553 | 0 |

## Reconciliation

- Vault before: 100.0 USDC
- Vault after: 98.9 USDC
- Unexplained delta: 0.000000 USDC
- Drain hard cap exceeded: false
- Abandoned in-flight: 0

## Failures

None.

## Warnings

None.

