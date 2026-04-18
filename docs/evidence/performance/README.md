# Performance Evidence

- Status: canonical
- Code paths: `docs/evidence/performance/`, `scripts/perf/`, `scripts/chaos/`, `scripts/drills/`
- Verified with: `npm run ci:docs`, `npm run ci:performance-reliability`
- Last verified against code: 2026-04-18

This directory stores reviewed performance, reliability, chaos, rollback, and recovery evidence that is safe to commit.

Do not commit raw secrets, tokens, private keys, cookies, wallet mnemonics, or full production logs. Redact sensitive values before attaching evidence.

Use `TEMPLATE.md` for every staging or production-like run.

