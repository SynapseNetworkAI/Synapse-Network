---
description: "Use when changing API contracts, request or response fields, status semantics, errors, tests, docs, readmes, AGENTS files, or project instructions. Covers docs-code-test sync, contract updates, and avoiding stale guidance."
name: "Synapse Docs Sync Rules"
---

# Synapse Docs Sync Rules

## Scope

- This file applies when a task changes observable behavior, contracts, validation rules, status semantics, or developer workflow guidance.
- It is task-oriented rather than language-specific.

## Sync Principle

- Observable behavior changes require matching updates to docs, tests, and any affected instruction files.
- Do not leave docs, AGENTS files, or instructions describing behavior that no longer exists.

## When to Update Docs

Update docs in the same change when you modify any of the following:

- API request or response fields
- status values or state-machine semantics
- auth or permission behavior
- setup, runtime, bootstrap, or validation commands
- project structure or instruction-loading conventions
- user-facing or operator-facing workflow semantics

## When to Update Tests

- Backend contract and behavior changes must update tests in the same change.
- Frontend adapter or UI behavior changes must update relevant tests when the observable behavior shifts.
- Do not keep outdated passing tests that encode the wrong behavior.

## Instruction and AGENTS Hygiene

- If a rule is cross-project and language- or framework-specific, prefer `.github/instructions/*.instructions.md`.
- If a rule is project-local, keep it in the project's `AGENTS.md`.
- If a rule is system-wide doctrine or governance, keep it in `docs/AGENTS.md`.
- Remove duplicated or stale rules instead of letting multiple files drift apart.

## Sync Pipeline

For any behavior-changing task, execute these steps **in order**. Do not proceed to the next step until the current step is confirmed.

### Step 1 — Identify impact surface
Before writing code, list every contract that changes:
- API fields added, removed, or renamed
- Status or enum values that shift
- Auth / permission rules that change
- Env vars, config keys, or CLI commands that change
- Developer workflow or bootstrap commands that change

Present the list and confirm it is complete before writing any code.

### Step 2 — Implement code + tests
Write the code change. Update or add tests that assert the new behavior.

**Gate: do not proceed to Step 3 until tests pass.**

### Step 3 — Update docs
For every item identified in Step 1, update the matching doc or reference:
- API docs: update field tables, request/response examples, curl snippets
- Status semantics: update state-machine docs
- Env / config: update `.env.example` and relevant runbook sections
- Bootstrap / workflow: update AGENTS, README, or runbook as appropriate

**Gate: do not proceed to Step 4 until every Step 1 item has a matching doc update.**

### Step 4 — Instruction and AGENTS hygiene
Verify that no instruction or AGENTS file now describes behavior that no longer exists:
- Does any `.github/instructions/*.instructions.md` reference a removed field or pattern?
- Does any subproject `AGENTS.md` describe a workflow step that changed?
- Are there duplicate or conflicting rules across files that this change makes worse?

Fix any stale instruction content found.

### Step 5 — Final review
Run through the full sync checklist:

1. Code reflects the intended behavior ✓
2. Tests assert the new behavior ✓
3. Docs describe the new behavior ✓
4. AGENTS and instruction files match the actual workflow ✓
5. No orphaned curl examples, stale field names, or dead links in changed docs ✓

## ⚠️ Gotchas — Known Docs Sync Failure Patterns

**Env var drift**
- Adding a new required env var to code without adding it to `.env.example` and the local-development doc. The next developer silently gets a startup crash.

**Stale curl examples**
- Renaming a request field in the schema but leaving old field names in the API doc curl examples — these break consumer onboarding.

**AGENTS file lag**
- Changing a service's startup command or test command without updating that service's `AGENTS.md`. The next agent session runs the wrong command.

**Silent instruction drift**
- Refactoring a workflow (e.g., switching from file-backed to Postgres-backed storage) without updating the matching instruction file that recommends the old approach.

**Test without doc, doc without test**
- Updating docs to describe new behavior before the tests actually pass — creates misleading docs that diverge from reality if the tests later fail or get reverted.