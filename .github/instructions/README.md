# Synapse Instruction Routing Manifest

This directory is the source of truth for task-specific repository instructions. Some agents do not automatically load `.github/instructions`, so root bridge files route them here instead of duplicating rules.

## Routing Table

| File                                   | Use when                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `agents-memory-bridge.instructions.md` | Agents-Memory startup, project facts, reusable rules, and memory-backed context.                                                          |
| `python.instructions.md`               | Python, FastAPI, backend services, repositories, migrations, tests, and local service scripts.                                            |
| `frontend.instructions.md`             | React, Next.js, TypeScript, `services/user-front`, and shared frontend implementation.                                                    |
| `finance-backend.instructions.md`      | Money movement, balances, deposits, withdrawals, refunds, settlement, idempotency, audit, reconciliation, and Decimal-safe backend work.  |
| `finance-admin.instructions.md`        | `services/gateway-admin` finance approval, withdrawal review, refund, reconciliation, and control-plane finance workflows.                |
| `admin-console.instructions.md`        | `services/admin-front` control-plane UI, list views, pagination, status surfaces, and operations UX.                                      |
| `docs-sync.instructions.md`            | Docs, instructions, behavior contracts, tests/docs sync, and documentation governance changes.                                            |
| `safety-guard.instructions.md`         | Production deploys, migrations, destructive DB operations, contract deployments, irreversible changes, and high-risk operational actions. |

## Context Loading Notes

- For quality-budget, file-size, function-length, complexity, PR-template, or CI-gate work, load `docs/reference/Engineering_Quality_Guardrails.md` in addition to the task-specific instruction file.
- For ordinary small bug fixes, do not load every reference document. Start from `llms.txt`, `docs/AGENTS.md`, this manifest, and the closest `docs/reference/Agent_Task_Map.*` domain.
- Keep long implementation guidance in reference docs and route to it from this manifest; do not copy full rulebooks into bridge entrypoints.

## Generated Standards

The `agents-memory/` subtree is managed by Agents-Memory. Re-run `amem enable . --full` or `amem standards-sync .` after profile-managed standard changes instead of hand-copying generated rules.

## Bridge Entrypoints

- Codex: `AGENTS.md`
- Cursor: `.cursor/rules/synapse-instructions.mdc`
- Claude: `CLAUDE.md`
- Gemini: `GEMINI.md`
- Copilot: `.github/copilot-instructions.md`

Bridge files must stay thin and point back to this manifest plus `docs/AGENTS.md`.
