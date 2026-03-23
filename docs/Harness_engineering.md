# Harness Engineering For Synapse

## 1. Purpose

This document translates harness engineering principles into a practical documentation and AI-collaboration plan for Synapse Network.

It has two jobs:

1. explain how this repository should evolve to become more agent-readable
2. define the most pragmatic landing order so the work can be implemented incrementally without turning docs into a second product rewrite

Status note:

1. the foundation pass described in this document has now been landed
2. this file should be read as both the original rollout rationale and the current status record for that pass

## 2. What Harness Engineering Means Here

For Synapse, harness engineering means the repository itself must become the primary operating surface for AI agents.

That implies five concrete rules:

1. `AGENTS.md` stays a map, not a handbook.
2. Canonical knowledge must live in versioned Markdown inside the repository.
3. Architecture, plans, validation, and decision boundaries must be easy to discover.
4. AI should be able to infer what to read next and how to verify its work.
5. Drift-prone knowledge should be compressed into stable entrypoints instead of duplicated across many files.

## 3. Current State Assessment

Synapse already has a strong foundation:

1. `docs/AGENTS.md` and root `AGENTS.md` already act as maps instead of giant rule dumps.
2. `.github/instructions/` already carries file-type and domain-specific coding rules.
3. `docs/README.md` already provides a high-quality human-facing document map.
4. `docs/03_Projects/` already centralizes per-project canonical guidance.
5. legacy planning material is now explicitly separated from the standardized execution-plan layout.

The original structural gaps for the foundation pass are now closed:

1. root `llms.txt` exists and points to canonical repo entrypoints.
2. `docs/ARCHITECTURE.md` provides a stable top-level system map.
3. `docs/exec-plans/` is now the canonical workspace for execution plans.
4. `docs/06_Reference/AI_Quick_Reference.md` and `docs/06_Reference/Validation_Entry_Points.md` provide compressed AI-facing operational context.

The remaining gaps are now maintenance-oriented rather than foundational:

1. some top-level indexes are still dense and can be compressed further for faster first-read navigation
2. reference-layer boundaries still need occasional cleanup as contracts evolve across `gateway`, `gateway-admin`, and `provider_service`
3. there is still no automated freshness enforcement for docs, instructions, and indexes
4. ADR and decision-log workflows are still lightweight and mostly manual

## 4. Design Goals

The next round of documentation work should optimize for four outcomes:

1. reduce first-step exploration cost for AI
2. reduce ambiguity between control plane, runtime plane, and settlement plane
3. make complex tasks resumable through standardized plans
4. make verification entrypoints explicit instead of implicit

## 5. Most Pragmatic Landing Order

The repository landed the foundation pass in this order.

### Step 1. Add `llms.txt`

Why first:

1. smallest change with immediate AI-navigation value
2. does not disturb existing docs layout
3. creates a stable machine-readable entrypoint for any future agent

Definition of done:

1. root `llms.txt` exists
2. it points to canonical docs, project entrypoints, and validation anchors

Status: completed.

### Step 2. Add `docs/ARCHITECTURE.md`

Why second:

1. Synapse has enough subsystems that AI needs a top-level mental model before reading detailed docs
2. current architecture knowledge exists, but is distributed across many files

Definition of done:

1. one top-level architecture summary exists
2. it explains system roles, dependency directions, and source-of-truth boundaries

Status: completed.

### Step 3. Standardize execution plans under `docs/exec-plans/`

Why third:

1. complex work should be resumable without relying on chat history
2. planning artifacts should become first-class repository assets

Definition of done:

1. `docs/exec-plans/` exists with `active/`, `completed/`, and `templates/`
2. a reusable template defines scope, acceptance criteria, decision log, and verification log

Status: completed.

### Step 4. Add AI quick references and validation entrypoints

Why fourth:

1. AI should not rediscover the same commands and project boundaries every time
2. finance-sensitive work benefits from explicit validation anchors

Definition of done:

1. a quick-reference page compresses core repository facts
2. a validation-entrypoint page lists the current command anchors by project and workflow

Status: completed.

### Step 5. Wire the new entrypoints into existing navigation

Why fifth:

1. new files only help if existing canonical docs lead readers to them
2. this prevents the new material from becoming another disconnected doc island

Definition of done:

1. `docs/README.md` references the new pages
2. relevant module indexes point to the new reference material

Status: completed.

## 6. What This Pass Will Not Do

The foundation pass does not try to solve everything at once.

Still not included after the current landing sequence:

1. automated doc freshness linting
2. doc-gardening bots or CI jobs
3. per-workflow deep acceptance pages for every business chain
4. broad instruction proliferation beyond the current layering model

Those are valid phase-two investments, but they should come after the repository gains better entrypoints and plan structure.

## 7. Recommended Skill Strategy

For this repository, skills should be adopted selectively.

Best-fit skill categories are:

1. `llms.txt` generation or update support
2. implementation-plan creation and update workflows
3. ADR generation for architecture or governance decisions
4. context mapping for large multi-file tasks
5. documentation writing and markdown index maintenance

Avoid adding many generic coding skills that overlap with existing local instructions. Synapse already has strong project-local constraints; the bigger opportunity is better context structure, not more generic behavior overlays.

## 8. Completion Criteria For This Initiative

This harness-engineering pass is complete when:

1. AI has a root machine-readable entrypoint
2. the repository has a single top-level architecture map
3. execution-plan storage is standardized
4. quick-reference and validation-entrypoint docs exist
5. existing canonical indexes link to those new assets

Current status:

1. this completion criteria set is satisfied as of 2026-03-24
2. follow-on work should now focus on index compression, reference-boundary hygiene, and lightweight freshness enforcement rather than more entrypoint creation