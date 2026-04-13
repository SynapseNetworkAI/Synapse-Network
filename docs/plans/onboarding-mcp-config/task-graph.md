---
created_at: 2026-04-07
updated_at: 2026-04-07
doc_status: active
---

# Task Graph

## Work Items

1. 基础设施或模板改动
2. 核心代码改动
3. 测试改动
4. 文档改动
5. 收尾清理

## Dependencies

- 哪些任务必须先完成？
- 哪些任务可以并行？

## Exit Criteria

- 任务完成时必须满足哪些条件？

## Onboarding Task Steps
```json
[
  {
    "group": "Core",
    "priority": "required",
    "key": "profile_consistency",
    "status": "FAIL",
    "detail": "missing required file: tests",
    "action": "Repair missing or drifted profile-managed files before continuing onboarding.",
    "command": "amem profile-check .",
    "verify_with": "amem profile-check .",
    "done_when": "`amem doctor .` shows `[OK] profile_consistency`.",
    "safe_to_auto_execute": false,
    "approval_required": true,
    "approval_reason": "this step diagnoses drift but manual repair choices still require a human decision",
    "next_command": "amem doctor ."
  }
]
```
