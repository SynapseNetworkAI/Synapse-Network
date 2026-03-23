# Harness Engineering For Synapse

## 1. Purpose

This document translates harness engineering principles into a practical documentation and AI-collaboration plan for Synapse Network.

It has two jobs:

1. explain how this repository should evolve to become more agent-readable
2. define the most pragmatic landing order so the work can be implemented incrementally without turning docs into a second product rewrite

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
5. the repository already had versioned planning material, but it was still split between legacy `docs/plan/` and the new standardized execution-plan layout.

The main gaps are now structural rather than conceptual:

1. no repository-level AI entrypoint like `llms.txt`
2. no single top-level architecture summary for the whole system
3. no standardized execution-plan workspace for active and completed work
4. no AI-oriented quick reference for commands, ownership boundaries, and validation entrypoints

## 4. Design Goals

The next round of documentation work should optimize for four outcomes:

1. reduce first-step exploration cost for AI
2. reduce ambiguity between control plane, runtime plane, and settlement plane
3. make complex tasks resumable through standardized plans
4. make verification entrypoints explicit instead of implicit

## 5. Most Pragmatic Landing Order

The repository should land the next changes in this order.

### Step 1. Add `llms.txt`

Why first:

1. smallest change with immediate AI-navigation value
2. does not disturb existing docs layout
3. creates a stable machine-readable entrypoint for any future agent

Definition of done:

1. root `llms.txt` exists
2. it points to canonical docs, project entrypoints, and validation anchors

### Step 2. Add `docs/ARCHITECTURE.md`

Why second:

1. Synapse has enough subsystems that AI needs a top-level mental model before reading detailed docs
2. current architecture knowledge exists, but is distributed across many files

Definition of done:

1. one top-level architecture summary exists
2. it explains system roles, dependency directions, and source-of-truth boundaries

### Step 3. Standardize execution plans under `docs/exec-plans/`

Why third:

1. complex work should be resumable without relying on chat history
2. planning artifacts should become first-class repository assets

Definition of done:

1. `docs/exec-plans/` exists with `active/`, `completed/`, and `templates/`
2. a reusable template defines scope, acceptance criteria, decision log, and verification log

### Step 4. Add AI quick references and validation entrypoints

Why fourth:

1. AI should not rediscover the same commands and project boundaries every time
2. finance-sensitive work benefits from explicit validation anchors

Definition of done:

1. a quick-reference page compresses core repository facts
2. a validation-entrypoint page lists the current command anchors by project and workflow

### Step 5. Wire the new entrypoints into existing navigation

Why fifth:

1. new files only help if existing canonical docs lead readers to them
2. this prevents the new material from becoming another disconnected doc island

Definition of done:

1. `docs/README.md` references the new pages
2. relevant module indexes point to the new reference material

## 6. What This Pass Will Not Do

This pass does not try to solve everything at once.

Not included in the current landing sequence:

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