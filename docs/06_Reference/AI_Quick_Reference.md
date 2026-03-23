# AI Quick Reference

## 1. Product Fact

Synapse is an agent-first settlement layer. The highest-priority product outcome is: `Agent completed first paid invocation autonomously.`

## 2. Fast Start

1. `docs/AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. target project page under `docs/03_Projects/`
4. `docs/06_Reference/Validation_Entry_Points.md` when verification matters

## 3. Main Boundaries

1. `gateway/`: runtime protocol, budget, billing, receipts, audit, provider routing
2. `contracts/`: chain-side vault and settlement primitives
3. `apps/frontend/`: owner and developer facing product console
4. `admin/gateway-admin/`: admin control-plane backend
5. `admin/admin-front/`: admin control-plane frontend
6. `provider_service/`: provider runtime sample service
7. `sdk/python/`: client integration layer for discover, quote, invoke, and receipts

## 4. Truth Map

1. product doctrine and rule hierarchy: `docs/AGENTS.md`
2. system architecture map: `docs/ARCHITECTURE.md`
3. runtime architecture and protocol: `docs/agent/01_Agent_Runtime_Product_Architecture.md`, `docs/agent/02_Discovery_Quote_Invoke_API_Design.md`
4. workflows: `docs/03_Core_Workflows/README.md`
5. database and settlement model: `docs/04_Database_Design/README.md`
6. API and error contracts: `docs/06_Reference/05_Runtime_API_Contract.md`, `docs/06_Reference/06_Runtime_Error_Code_Catalog.md`, `docs/06_Reference/`
7. per-project boundaries: `docs/03_Projects/README.md`

## 5. Finance Warning

If the task touches money movement, balances, billing, settlement, withdrawals, refunds, approvals, reconciliation, or audit:

1. prefer correctness and traceability over convenience
2. read `.github/instructions/finance-backend.instructions.md`
3. read `.github/instructions/finance-admin.instructions.md` if the task is in `gateway-admin`
4. update docs and tests in the same change when behavior changes

## 6. UI Warning

Frontend code must not invent authoritative status or finance semantics.

1. `apps/frontend/` reflects owner-facing runtime views
2. `admin/admin-front/` reflects admin control-plane views
3. backend-owned truth must stay in `gateway` or `gateway-admin`

## 7. Planning Rule

If the task is multi-step, cross-project, or risky, create an execution plan under `docs/exec-plans/` rather than leaving the work only in chat history.

Legacy `docs/plan/` is archive-only and does not replace `docs/exec-plans/`.

## 8. Validation Rule

Before finishing, check `docs/06_Reference/Validation_Entry_Points.md` and run the narrowest relevant validation for the touched project.