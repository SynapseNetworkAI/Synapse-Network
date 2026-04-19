---
created_at: 2026-04-19
updated_at: 2026-04-19
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
- expected outcome: `services/gateway/src/services/owner/downstream_concurrency.py::_record_outcome` is no longer the first hotspot, or its issue list is smaller.

## Hotspot Snapshot
```json
{
  "identifier": "services/gateway/src/services/owner/downstream_concurrency.py::_record_outcome",
  "rank_token": "hotspot-6df970994e40",
  "relative_path": "services/gateway/src/services/owner/downstream_concurrency.py",
  "function_name": "_record_outcome",
  "qualified_name": "_record_outcome",
  "line": 344,
  "status": "WARN",
  "effective_lines": 95,
  "branches": 13,
  "nesting": 5,
  "local_vars": 13,
  "has_guiding_comment": false,
  "issues": [
    "lines=95>40",
    "branches=13>5",
    "nesting=5>=4",
    "locals=13>8",
    "missing_guiding_comment"
  ],
  "score": 41
}
```
