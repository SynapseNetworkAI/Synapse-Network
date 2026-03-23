# Synapse Root Mirror

This file is the repo-root execution mirror.

Canonical workspace rules live in `docs/AGENTS.md`.

## Read Order

1. `docs/AGENTS.md`
2. `docs/Design.md` for visual and interaction work
3. `.github/instructions/python.instructions.md` for Python files
4. `.github/instructions/frontend.instructions.md` for frontend files
5. `.github/instructions/finance-backend.instructions.md` for money, settlement, idempotency, audit, and transaction-sensitive backend work
6. `.github/instructions/finance-admin.instructions.md` for `admin/gateway-admin` finance approval, withdraw-review, refund, and reconciliation control-plane work
7. `.github/instructions/admin-console.instructions.md` for `admin/admin-front` list, pagination, and control-plane UI work
8. `.github/instructions/docs-sync.instructions.md` for behavior-changing work that must update docs, tests, and instructions together
9. The target subproject's `AGENTS.md` for local commands and role boundaries

## Root-Level Expectations

- Keep changes aligned to the agent-first settlement product.
- Preserve finance-sensitive safety, docs sync, and auditability constraints from `docs/AGENTS.md`.
- Do not duplicate Python or frontend coding rules in root AGENTS anymore. Language-specific rules now live in `.github/instructions/`.
- Keep subproject AGENTS files short and local: role, commands, env, validation, and project-only exceptions.
