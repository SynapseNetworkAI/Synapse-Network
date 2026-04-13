---
created_at: 2026-04-07
updated_at: 2026-04-07
doc_status: active
---

# Integration onboarding: mcp_config

这是当前任务的 planning bundle。

建议使用顺序：

1. 先写 `spec.md`
2. 再补 `plan.md`
3. 再确认 `task-graph.md`
4. 最后在 `validation.md` 里写最小验证路线

## Onboarding State
- state file: `.agents-memory/onboarding-state.json`
- bootstrap ready: `no`
- bootstrap complete: `no`
- next group: `Core`
- next key: `profile_consistency`
- next command: `amem profile-check .`
- verify with: `amem profile-check .`
- done when: `amem doctor .` shows `[OK] profile_consistency`.
