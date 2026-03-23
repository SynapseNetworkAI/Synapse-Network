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

## Review Checklist

Before finishing a behavior-changing task, verify:

1. code reflects the intended behavior
2. tests assert the new behavior
3. docs describe the new behavior
4. AGENTS or instruction files still match the actual workflow and ownership boundary