# Synapse Root Mirror

This file is the repo-root execution mirror.

Canonical workspace rules live in `docs/AGENTS.md`.

## Read Order

1. `docs/AGENTS.md`
2. `llms.txt` for the shortest machine-readable repository map
3. `docs/ARCHITECTURE.md` for cross-project system structure
4. `docs/Design.md` for visual and interaction work
5. `.github/instructions/python.instructions.md` for Python files
6. `.github/instructions/frontend.instructions.md` for frontend files
7. `.github/instructions/finance-backend.instructions.md` for money, settlement, idempotency, audit, and transaction-sensitive backend work
8. `.github/instructions/finance-admin.instructions.md` for `admin/gateway-admin` finance approval, withdraw-review, refund, and reconciliation control-plane work
9. `.github/instructions/admin-console.instructions.md` for `admin/admin-front` list, pagination, and control-plane UI work
10. `.github/instructions/docs-sync.instructions.md` for behavior-changing work that must update docs, tests, and instructions together
11. The target subproject's `AGENTS.md` for local commands and role boundaries

## Root-Level Expectations

- Keep changes aligned to the agent-first settlement product.
- Preserve finance-sensitive safety, docs sync, and auditability constraints from `docs/AGENTS.md`.
- Do not duplicate Python or frontend coding rules in root AGENTS anymore. Language-specific rules now live in `.github/instructions/`.
- Keep subproject AGENTS files short and local: role, commands, env, validation, and project-only exceptions.
