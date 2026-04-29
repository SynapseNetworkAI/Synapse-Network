# Staging Load Suite Evidence

- Run id: `20260427T091633Z`
- Commit: `7ef9e0b7`
- Started UTC: `2026-04-27T09:16:37Z`
- Environment: `staging`

This suite runs staging light-load scenarios only. It does not run chaos,
failover, rollback, restore, signer procedures, or destructive money-write
concurrency unless SYNAPSE_PERF_ENABLE_MONEY_WRITE_LOAD=1 is explicitly set.
