# Performance Evidence

- Status: canonical
- Code paths: `docs/evidence/performance/`, `scripts/perf/`, `scripts/chaos/`, `scripts/drills/`
- Verified with: `npm run ci:docs`, `npm run ci:performance-reliability`
- Last verified against code: 2026-04-21

This directory stores reviewed performance, reliability, chaos, rollback, and recovery evidence that is safe to commit.

Do not commit raw secrets, tokens, private keys, cookies, wallet mnemonics, or full production logs. Redact sensitive values before attaching evidence.

Use `TEMPLATE.md` for every staging or production-like run.

## Local MVP Load Rehearsal Evidence

`npm run perf:local-production-load-rehearsal` writes local-only evidence to:

```bash
docs/evidence/performance/<timestamp>-local-production-load-rehearsal/
```

Validate the latest bundle with:

```bash
npm run ci:local-production-load-evidence
```

This bundle is intentionally stricter about local safety than about laptop
throughput. It must prove:

1. a unique `REHEARSAL_RUN_ID`
2. temporary consumer/provider wallet pools
3. per-wallet serialized chain writes
4. `chainNonceCollisionCount === 0`
5. no secret, private key, raw signature, JWT, admin token, or cookie leakage
6. no unexpected Gateway 5xx
7. graceful drain completes before the hard cap
8. `0.000000` unexplained financial delta for the run

Do not treat this as staging capacity evidence. Staging must use dedicated
approved test wallets, production-like infra, and its own load report.
The local command's default lane concurrency is deliberately conservative:
`invoke=1`, `balance=4`, `deposit-confirm=2`, `withdrawal=1`,
`provider-health=1`, and `admin-finance=2`. Increase those only for local
diagnostics; staging owns real capacity evidence.
Expected local backpressure, for example an invoke lane `503 SERVICE_BUSY`,
is recorded in status counts but does not fail the evidence if that lane
declares the status acceptable. Raw `500` responses always fail.
