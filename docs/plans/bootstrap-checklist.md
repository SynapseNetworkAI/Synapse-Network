# Bootstrap Checklist

- Project: `synapse-network`
- Root: `/Users/cliff/workspace/agent/Synapse-Network`
- Overall: `PARTIAL`

## Checklist
- [ ] Core - Core status=ATTENTION (ok=6, warn=0, fail=1, info=0)
- [x] Planning - Planning status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [x] Integration - Integration status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [ ] Optional - Optional status=WATCH (ok=2, warn=5, fail=0, info=0)
- [ ] Final verification - re-run `amem doctor .` and confirm no remaining WARN / FAIL steps

## Action Sequence
1. Core (required): Re-run `amem profile-check .` and repair the missing profile-managed files.
2. Optional (recommended): Refactor flagged functions before adding more behavior, and add a short guiding comment when complex logic must remain in place.

## Onboarding Runbook
### Step 1: Core / profile_consistency
- Priority: `required`
- Trigger: missing required file: tests
- Action: Repair missing or drifted profile-managed files before continuing onboarding.
- Command: `amem profile-check .`
- Verify with: `amem profile-check .`
- Next command: `amem doctor .`
- Safe To Auto Execute: `False`
- Approval Required: `True`
- Approval Reason: this step diagnoses drift but manual repair choices still require a human decision
- Done when: `amem doctor .` shows `[OK] profile_consistency`.

## Group Health
### Core
- Summary: Core status=ATTENTION (ok=6, warn=0, fail=1, info=0)
- [OK] `registry` registered as 'synapse-network'
- [OK] `active` active=true
- [OK] `root` /Users/cliff/workspace/agent/Synapse-Network
- [OK] `python3.12` /opt/homebrew/bin/python3.12
- [OK] `mcp_package` mcp import OK
- [OK] `profile_manifest` applied profile 'python-service'
- [FAIL] `profile_consistency` missing required file: tests

### Planning
- Summary: Planning status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [OK] `planning_root` present: /Users/cliff/workspace/agent/Synapse-Network/docs/plans
- [OK] `planning_bundle` 2 planning bundle(s) passed plan-check

### Integration
- Summary: Integration status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [OK] `bridge_instruction` /Users/cliff/workspace/agent/Synapse-Network/.github/instructions/agents-memory-bridge.instructions.md
- [OK] `mcp_config` agents-memory server configured -> /Users/cliff/workspace/agent/Synapse-Network/.vscode/mcp.json

### Optional
- Summary: Optional status=WATCH (ok=2, warn=5, fail=0, info=0)
- [OK] `copilot_activation` Agents-Memory activation block present -> /Users/cliff/workspace/agent/Synapse-Network/.github/copilot-instructions.md
- [OK] `agents_read_order` AGENTS.md references current bridge and 8 managed standard(s)
- [WARN] `refactor_watch` services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py::FinanceAtomicRepository.redeem_credit_voucher_atomic high complexity (lines=292>40, branches=21>5, nesting=4>=4, locals=36>8, missing_guiding_comment)
- [WARN] `refactor_watch` services/gateway/src/services/owner/finance_consumer_withdraw_mixin.py::FinanceConsumerWithdrawMixin.create_consumer_withdraw_intent high complexity (lines=203>40, branches=15>5, nesting=4>=4, locals=31>8)
- [WARN] `refactor_watch` services/gateway/examples/v2_daily_limit_regression.py::submit_and_wait_deposit_confirmation high complexity (lines=50>40, branches=6>5, locals=11>8, nesting=3, missing_guiding_comment)
- [WARN] `refactor_watch` services/gateway/src/storage/postgres/repositories/idempotency_repository.py::IdempotencyRepository.read_idempotency_rows high complexity (lines=59>40, nesting=4>=4, locals=14>8, branches=4, missing_guiding_comment)
- [WARN] `refactor_watch` services/gateway/src/storage/postgres/repositories/balance_repository.py::BalanceRepository.read_balance_ledger high complexity (lines=61>40, nesting=4>=4, locals=14>8, branches=5, missing_guiding_comment)
