---
created_at: 2026-04-07
updated_at: 2026-04-07
doc_status: active
---

# Refactor hotspot: services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py::FinanceAtomicRepository.redeem_credit_voucher_atomic

这是当前任务的 planning bundle。

建议使用顺序：

1. 先写 `spec.md`
2. 再补 `plan.md`
3. 再确认 `task-graph.md`
4. 最后在 `validation.md` 里写最小验证路线

## Refactor Hotspot
- hotspot: `services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py::FinanceAtomicRepository.redeem_credit_voucher_atomic`
- hotspot token: `hotspot-af1f8f002a9e`
- current rank index: `1`
- line: `52`
- status: `WARN`
- issues: `lines=292>40, branches=21>5, nesting=4>=4, locals=36>8, missing_guiding_comment`
- bundle entry command: `amem refactor-bundle . --token hotspot-af1f8f002a9e`
- verify with: `amem doctor .`
