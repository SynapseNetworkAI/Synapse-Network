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
- bootstrap ready: `yes`
- bootstrap complete: `yes`
- next group: `Refactor`
- next key: `refactor_bundle`
- next command: `python3 scripts/memory.py refactor-bundle . --token hotspot-af1f8f002a9e`
- verify with: `amem doctor .`
- done when: `amem doctor .` no longer reports `services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py::FinanceAtomicRepository.redeem_credit_voucher_atomic` as the top refactor hotspot.
