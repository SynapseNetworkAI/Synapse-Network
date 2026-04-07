---
created_at: 2026-04-07
updated_at: 2026-04-07
doc_status: active
---

# Validation Route

## Required Checks

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile $(find agents_memory scripts -name '*.py' -print)
python3 scripts/memory.py docs-check .
```

## Task-Specific Checks

- 写下本任务额外需要跑的命令

## Review Notes

- docs diff:
- code diff:
- test diff:

## Refactor Verification
- primary verification command: `amem doctor .`
- expected outcome: `services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py::FinanceAtomicRepository.redeem_credit_voucher_atomic` is no longer the first hotspot, or its issue list is smaller.

## Hotspot Snapshot
```json
{
  "identifier": "services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py::FinanceAtomicRepository.redeem_credit_voucher_atomic",
  "rank_token": "hotspot-af1f8f002a9e",
  "relative_path": "services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py",
  "function_name": "redeem_credit_voucher_atomic",
  "qualified_name": "FinanceAtomicRepository.redeem_credit_voucher_atomic",
  "line": 52,
  "status": "WARN",
  "effective_lines": 292,
  "branches": 21,
  "nesting": 4,
  "local_vars": 36,
  "has_guiding_comment": false,
  "issues": [
    "lines=292>40",
    "branches=21>5",
    "nesting=4>=4",
    "locals=36>8",
    "missing_guiding_comment"
  ],
  "score": 41
}
```
