# Claude Instruction Bridge

Claude should treat this file as a thin repository bridge, not as a second source of business rules.

## Startup Order

1. Read `AGENTS.md`.
2. Read `llms.txt` for the compressed repository map.
3. Read `docs/AGENTS.md` for canonical workspace rules.
4. Read `.github/instructions/README.md` to choose the task-specific instruction files.
5. Read the target subproject `AGENTS.md` when the task touches a service or app.

## Instruction Routing

- Python, FastAPI, backend, repositories, or tests: `.github/instructions/python.instructions.md`
- React, Next.js, user-front, or shared frontend work: `.github/instructions/frontend.instructions.md`
- Money, ledger, balances, deposits, withdrawals, refunds, settlement, idempotency, audit, or reconciliation: `.github/instructions/finance-backend.instructions.md`
- Gateway-admin finance approvals, withdrawal reviews, refunds, or reconciliation: `.github/instructions/finance-admin.instructions.md`
- Admin-front control-plane UI: `.github/instructions/admin-console.instructions.md`
- Docs, instructions, behavior contracts, tests/docs sync: `.github/instructions/docs-sync.instructions.md`
- Production, migrations, destructive operations, contract deploys, or irreversible actions: `.github/instructions/safety-guard.instructions.md`

Do not copy rules out of `.github/instructions`; route to them so the instruction source of truth stays singular.
