# Synapse Canonical Rules

This file is the canonical workspace-level rule source for Synapse Network.

## 1. North Star

- Synapse is the settlement layer for AI agents.
- Product decisions must optimize for `Agent completed first paid invocation autonomously.`
- Human UX is support infrastructure for owner authorization, funding, budgeting, and observability. The runtime first-class user is still the agent.

## 2. Architecture Invariants

1. Smart contracts stay dumb. Keep high-frequency budget and routing logic off-chain.
2. Gateway is the fast centralized control point for routing, charging, balance checks, and risk enforcement.
3. Runtime identity is agent-first, not API-key-bucket-first.
4. USDC is the single settlement currency.
5. Agent-facing discover, quote, and invoke surfaces expose services, not provider settlement internals.

## 3. Security and Finance Baseline

- Default deny for privileged surfaces.
- Bind sensitive ownership and actor identity to server-side trust, not raw client input.
- Treat money movement and settlement paths as transaction-sensitive and audit-sensitive.
- Preserve idempotency, consistency, append-only auditability, and minimal error disclosure.
- Prefer correctness and traceability over convenience whenever finance and speed conflict.

## 4. Instruction Layering

The workspace should now be split into three layers instead of putting every rule into one AGENTS file.

AI-readable repository entrypoints now also include:

- root `llms.txt` for the shortest machine-readable repo map
- `docs/ARCHITECTURE.md` for the top-level system model
- `docs/00_Governance/exec-plans/` for persistent multi-step execution plans

### 4.1 Canonical Workspace Layer

- `docs/AGENTS.md`
- Purpose: product doctrine, architecture invariants, security baseline, docs-sync policy, and instruction layout.

### 4.2 File-Type Instruction Layer

- `.github/instructions/python.instructions.md`
- `.github/instructions/frontend.instructions.md`
- `.github/instructions/finance-backend.instructions.md`
- `.github/instructions/finance-admin.instructions.md`
- `.github/instructions/admin-console.instructions.md`
- `.github/instructions/docs-sync.instructions.md`
- `.github/instructions/safety-guard.instructions.md`
- Purpose: language and framework rules that should auto-attach by file type.
- These files should carry coding style, layering, framework conventions, version baselines, and test expectations.

Recommended split:

- `python.instructions.md`: general Python and FastAPI coding rules
- `frontend.instructions.md`: shared React and Next frontend rules
- `finance-backend.instructions.md`: transaction-sensitive money and ledger rules
- `finance-admin.instructions.md`: `gateway-admin` finance review, approval, withdraw-review, refund, and reconciliation control-plane rules
- `admin-console.instructions.md`: admin-front list, pagination, state, and ops UI rules
- `docs-sync.instructions.md`: behavior-change sync rules for code, tests, docs, and instructions
- `safety-guard.instructions.md`: pre-flight safety checklist and blocked-patterns gate for production deployments, migrations, destructive DB ops, and irreversible operations\n\n### 4.3 Subproject Local Layer

- `services/user-front/AGENTS.md`
- `services/admin-front/AGENTS.md`
- `services/gateway-admin/AGENTS.md`
- `provider_service/AGENTS.md`
- Purpose: local role boundaries, package-manager rules, runtime commands, validation entrypoints, and project-specific exceptions.

## 5. What Belongs Where

### Put in `.instructions.md`

- Python version baseline and backend layering rules.
- FastAPI, repository, Pydantic, transaction, test, and docs-sync coding norms.
- React, Next.js, TypeScript, component reuse, visual consistency, and frontend testing norms.
- Cross-project language conventions that repeat across multiple codebases.

### Keep in `docs/AGENTS.md`

- Business vision and product doctrine.
- Security and finance guardrails.
- System-wide architectural constraints.
- Documentation governance and rule-source hierarchy.

### Keep in subproject `AGENTS.md`

- What this project is and is not responsible for.
- Local interpreter, package manager, and run commands.
- Project-specific product docs that must be read before edits.
- Local stop conditions and exceptions that do not apply workspace-wide.

## 6. Execution Workflow

Before implementation:

1. Read `docs/AGENTS.md`.
2. For cross-project or repo-structure tasks, read `docs/ARCHITECTURE.md` and root `llms.txt`.
3. If the task touches `docs/` structure or canonical entrypoints, read `docs/00_Governance/Documentation_Constraints.md`.
4. If the task touches visual or UX work, read `docs/Design.md`.
5. Rely on `.github/instructions/*.instructions.md` for language-specific coding rules.
6. Read the target subproject `AGENTS.md` for local commands, runtime boundaries, and validation flow.
7. If the task is finance-sensitive, admin-console-heavy, or behavior-changing across docs/tests/contracts, expect the finer-grained instructions to apply too.

## 7. Docs-Code-Test Sync

- Any observable behavior change must update the matching docs.
- Backend behavior changes must update tests in the same change.
- Frontend information architecture, wording, and API expectations must stay aligned with the canonical docs.
- Do not leave stale rules duplicated across root and subproject AGENTS files.
- If a task changes `docs/` structure, indexes, or governance rules, it must pass `npm run ci:docs` before closing.

## 8. Design Rule for Future Customization

If a rule is repeating across multiple Python services or multiple frontend apps, move it into `.github/instructions/` instead of copying it into every AGENTS file.

If a rule only matters to one service's role, environment, or runtime workflow, keep it in that service's `AGENTS.md`.
