# Synapse Architecture

## 1. Purpose

This document is the top-level architecture map for Synapse Network.

It is intentionally shorter than the detailed architecture and workflow documents. Its job is to give humans and AI agents a stable system model before they drill into subsystem-specific docs.

## 2. System Summary

Synapse is an agent-first settlement layer that lets an owner fund an agent, let that agent discover services, invoke them through a gateway, and settle the paid call with auditability.

The architecture is organized around four planes:

1. owner control plane
2. agent runtime plane
3. risk and settlement plane
4. admin control plane

## 3. Core Components

### 3.1 contracts

- Code: `contracts/`
- Role: on-chain vault, deposit, and withdrawal settlement boundary
- Source of truth for: asset custody and chain-settlement primitives
- Not responsible for: high-frequency routing, budget checks, or runtime throttling

### 3.2 gateway

- Code: `gateway/`
- Role: main runtime and settlement control point
- Handles: discovery, quote, invoke, credential checks, budget enforcement, billing, receipts, ledger and audit emission, provider routing
- Source of truth for: runtime execution state, chain-offloaded settlement logic, and audit-linked receipts

### 3.3 apps/frontend

- Code: `apps/frontend/`
- Role: owner and developer facing product console
- Handles: onboarding, funding assistance, runtime observability, and human-facing support UX for agent operations
- Must not invent backend truth for balances, policy, or service status

### 3.4 provider_service

- Code: `provider_service/`
- Role: provider runtime sample service
- Handles: provider-side API behavior and sample integration path for `gateway -> provider runtime`
- Must not absorb platform settlement or admin responsibilities

### 3.5 admin/gateway-admin

- Code: `admin/gateway-admin/`
- Role: admin control-plane backend
- Handles: admin auth, RBAC, approvals, audit logging, execution orchestration, and controlled access to stable gateway projections
- Must not become a second runtime gateway

### 3.6 admin/admin-front

- Code: `admin/admin-front/`
- Role: admin control-plane frontend
- Handles: finance review, audit views, approval workflows, operational dashboards, and privileged control-plane UX
- Must follow backend-owned status and workflow truth

### 3.7 sdk/python

- Code: `sdk/python/`
- Role: client integration layer for discover, quote, invoke, and receipt flows
- Handles: programmatic access to runtime APIs, not settlement truth or admin logic

## 4. Planes And Dependency Direction

### 4.1 Owner Control Plane

Primary systems:

1. `apps/frontend`
2. `gateway`
3. `contracts`

Typical path:

`Owner -> frontend -> gateway -> contracts`

### 4.2 Agent Runtime Plane

Primary systems:

1. `sdk/python`
2. agent clients
3. `gateway`
4. `provider_service` or third-party providers

Typical path:

`Agent -> discover -> quote -> invoke -> gateway -> provider runtime`

### 4.3 Risk And Settlement Plane

Primary systems:

1. `gateway`
2. ledger and audit data model
3. `contracts`

Typical path:

`Runtime event -> budget/risk enforcement -> ledger/audit -> vault settlement boundary`

### 4.4 Admin Control Plane

Primary systems:

1. `admin/admin-front`
2. `admin/gateway-admin`
3. stable gateway projections and controlled adapters

Typical path:

`Admin user -> admin-front -> gateway-admin -> projections / controlled actions`

## 5. Source-Of-Truth Rules

1. Chain custody truth belongs to `contracts`.
2. Runtime execution and settlement-control truth belongs to `gateway`.
3. Admin approval, finance review, and operational governance truth belongs to `gateway-admin`.
4. UI layers are presentation and workflow surfaces, not authoritative sources for domain semantics.
5. Canonical docs live in root `docs/`, not in scattered project-local files.

## 6. High-Risk Boundaries

The following boundaries must stay explicit:

1. Agent-facing API objects vs platform-internal settlement objects
2. Runtime gateway vs admin gateway
3. provider earnings vs owner consumer balances
4. projection/read models vs mutable source-of-truth records
5. chain custody vs chain-offloaded execution control

## 7. Critical Workflows

The canonical workflow set is:

1. owner deposit and idempotent funding
2. service discovery and gateway call path
3. billing, settlement, and audit
4. provider registration and agreement
5. provider withdrawal and risk gates

Read: `docs/03_Core_Workflows/README.md`

## 8. Canonical Reading Order For Architecture Work

1. `docs/AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/agent/01_Agent_Runtime_Product_Architecture.md`
4. `docs/02_System_Architecture/README.md`
5. `docs/03_Core_Workflows/README.md`
6. `docs/04_Database_Design/README.md`
7. the target project page under `docs/03_Projects/`

## 9. Validation Principle

Architecture work is not complete when the prose looks correct. It is complete when the related plan, code, tests, and docs point to the same boundaries.

For validation commands and workflow anchors, read `docs/06_Reference/Validation_Entry_Points.md`.