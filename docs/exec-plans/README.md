# Execution Plans

- Status: canonical
- Code paths: `docs/exec-plans/`, `tools/scripts/validate_docs.js`
- Last verified against code: 2026-03-25

This directory stores multi-step execution plans that should survive beyond a single chat session.

## Purpose

Execution plans are first-class repository artifacts for work that is too large, risky, or cross-cutting to leave only in conversation history.

Use them when a task:

1. spans multiple projects or architecture layers
2. changes contracts, workflows, or finance-sensitive behavior
3. requires staged rollout or rollback thinking
4. needs an explicit decision log or validation log

## Structure

1. `templates/`
   reusable templates for new plans
2. `active/`
   plans currently being executed
3. `completed/`
   finished plans retained for repository memory

## Required Sections

Every execution plan should include:

1. background
2. goal
3. non-goals
4. scope and affected systems
5. prerequisite docs to read
6. implementation steps
7. acceptance criteria
8. risk and rollback notes
9. decision log
10. validation log

## Usage Rules

1. Start from `templates/Exec_Plan_Template.md`.
2. Put in-progress work under `active/`.
3. Move the file to `completed/` after acceptance criteria and validation are satisfied.
4. Keep the plan factual. It is an execution artifact, not a brainstorming dump.