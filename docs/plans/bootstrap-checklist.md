# Bootstrap Checklist

- Project: `synapse-network`
- Root: `/Users/cliff/workspace/agent/Synapse-Network`
- Overall: `PARTIAL`

## Checklist
- [x] Core - Core status=HEALTHY (ok=7, warn=0, fail=0, info=0)
- [x] Planning - Planning status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [ ] Integration - Integration status=WATCH (ok=1, warn=1, fail=0, info=0)
- [ ] Optional - Optional status=WATCH (ok=2, warn=6, fail=0, info=0)
- [ ] Final verification - re-run `amem doctor .` and confirm no remaining WARN / FAIL steps

## Action Sequence
1. Integration (required): Run `amem mcp-setup .` to repair or create the MCP server configuration.
2. Optional (recommended): Refactor flagged functions before adding more behavior, and add a short guiding comment when complex logic must remain in place.

## Onboarding Runbook
### Step 1: Integration / mcp_config
- Priority: `required`
- Trigger: agents-memory exists but args do not include /Users/cliff/workspace/agent/Agents-Memory/scripts/mcp_server.py
- Action: Create or repair the MCP configuration so IDE agents can call Agents-Memory tools.
- Command: `amem mcp-setup .`
- Verify with: `amem doctor .`
- Next command: `amem doctor .`
- Safe To Auto Execute: `True`
- Approval Required: `False`
- Approval Reason: writes only local IDE MCP config under .vscode for the current project
- Done when: `amem doctor .` shows `[OK] mcp_config`.

## Group Health
### Core
- Summary: Core status=HEALTHY (ok=7, warn=0, fail=0, info=0)
- [OK] `registry` registered as 'synapse-network'
- [OK] `active` active=true
- [OK] `root` /Users/cliff/workspace/agent/Synapse-Network
- [OK] `python3.12` /opt/homebrew/bin/python3.12
- [OK] `mcp_package` mcp import OK
- [OK] `profile_manifest` applied profile 'python-service'
- [OK] `profile_consistency` profile 'python-service' consistency OK

### Planning
- Summary: Planning status=HEALTHY (ok=2, warn=0, fail=0, info=0)
- [OK] `planning_root` present: /Users/cliff/workspace/agent/Synapse-Network/docs/plans
- [OK] `planning_bundle` 1 planning bundle(s) passed plan-check

### Integration
- Summary: Integration status=WATCH (ok=1, warn=1, fail=0, info=0)
- [OK] `bridge_instruction` /Users/cliff/workspace/agent/Synapse-Network/.github/instructions/agents-memory-bridge.instructions.md
- [WARN] `mcp_config` agents-memory exists but args do not include /Users/cliff/workspace/agent/Agents-Memory/scripts/mcp_server.py

### Optional
- Summary: Optional status=WATCH (ok=2, warn=6, fail=0, info=0)
- [OK] `copilot_activation` Agents-Memory activation block present -> /Users/cliff/workspace/agent/Synapse-Network/.github/copilot-instructions.md
- [OK] `agents_read_order` AGENTS.md references current bridge and 8 managed standard(s)
- [WARN] `refactor_watch` unable to inspect services/gateway/examples/synapse_client_quickstart.py: unterminated string literal (detected at line 38) (<unknown>, line 38)
- [WARN] `refactor_watch` services/gateway/src/storage/postgres/repositories/finance_atomic_repository.py::FinanceAtomicRepository.redeem_credit_voucher_atomic high complexity (lines=292>40, branches=21>5, nesting=4>=4, locals=36>8, missing_guiding_comment)
- [WARN] `refactor_watch` services/gateway/src/storage/postgres/repositories/idempotency_repository.py::IdempotencyRepository.read_idempotency_rows high complexity (lines=59>40, nesting=4>=4, locals=14>8, branches=4, missing_guiding_comment)
- [WARN] `refactor_watch` services/gateway/src/storage/postgres/repositories/balance_repository.py::BalanceRepository.read_balance_ledger high complexity (lines=61>40, nesting=4>=4, locals=14>8, branches=5, missing_guiding_comment)
- [WARN] `refactor_watch` services/gateway/src/services/platform/tasks/deposit_indexer/backfill.py::run_backfill_scan_once high complexity (lines=116>40, branches=8>5, locals=22>8, nesting=3, missing_guiding_comment)
- [WARN] `refactor_watch` services/gateway/src/services/platform/finance_service.py::PlatformFinanceService.redeem_credit_voucher high complexity (lines=111>40, branches=8>5, locals=16>8, nesting=3, missing_guiding_comment)
