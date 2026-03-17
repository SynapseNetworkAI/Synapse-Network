# Phase 1 of Refactoring Complete

1. Reorganized into standard `src/` modular layout:
   - `src/core`: `config` holding loaded ENV vars.
   - `src/api/schemas`: Shared pydantic response/request models.
   - `src/storage`: Abstract base storage with PostgreSQL implementation mapped via DI.
   - `src/api`: Top level routing logic split into chunks (`auth`, `services`, `registry`).
   - `src/app.py`: Clean initialized FastAPI router.

2. Next Steps:
   - Migrate endpoints from `app.py` -> `src/api/routers/*`.
   - Migrate web3 payment dependencies to `src/services/payment.py`.
   - Replace old `persistence.py` file writes with injected instances in routes using `Depends(get_storage)`.

## Service and Storage Separation (Current Baseline)

`src/services` now keeps domain business logic only, while persistence access is centralized under `src/storage` repository adapters.

- `src/storage/finance_repository.py`: finance collections (`deposit_intents`, `refund_intents`, `provider_withdrawal_intents`, `balance_ledger`, `router_config`, `usage_log`, idempotency keys, audit append).
- `src/storage/registry_repository.py`: service registry and health tables (`service_registry`, `service_target_health`, `service_target_health_history`).
- `src/storage/credential_repository.py`: credential/secrets collections and audit query capability probing.

This repository layer keeps FastAPI services focused on invariants (owner scope, idempotency, and settlement rules) and makes persistence behavior testable in isolation.

## Service Runtime Model Baseline

Service registration, discovery, forwarding, and health probing now use `src/domain/service_contract.py` as the only internal runtime model.

- `ServiceDefinitionRecord` is the canonical object passed between repository, seller service, buyer forwarding, and platform health modules.
- `dict` payloads are only allowed at request/response boundaries or database JSON serialization boundaries.
- Legacy `ServiceRegistryRow` remains only for compatibility surfaces that have not yet been removed, and should not be reintroduced into service orchestration paths.
- `ServiceRegistryRepository`, `RegistryService`, and `service_health_service` now exchange typed `ServiceDefinitionRecord`, `ServiceTargetHealth`, and `ServiceTargetHealthHistory` objects internally; `dict` fallback paths have been removed from these runtime flows.

## Finance Deposit and Withdrawal Model Baseline

Deposit and withdrawal orchestration now treats `src/domain/ledger.py` plus `src/domain/execution.py` as the canonical internal model boundary.

- `DepositIntentRow` and `WithdrawalIntentRow` live in `ledger.py` and are the only typed rows passed between gateway state storage and finance services.
- `DepositIntentRegisterCommand`, `DepositIntentConfirmCommand`, `WithdrawalAtomicRequestCommand`, `PreparedWithdrawTicket`, `WithdrawalDecision`, `CompleteWithdrawTxCommand`, and `ReserveSellerWithdrawCommand` live in `execution.py` and are the only typed execution commands/results used by atomic repositories and deposit/withdraw flows.
- `finance.py` remains a compatibility export surface for unchanged callers, but new internal finance code should import deposit/withdraw runtime objects from `ledger.py` and `execution.py` directly.
- Gateway state repository no longer accepts raw `dict` deposit rows; JSON payloads remain only at runtime-state serialization boundaries.

## Buyer Quote and Invoke Runtime Baseline

The buyer forwarding pipeline now treats `src/domain/execution.py` plus `src/domain/service_contract.py` as the canonical internal model boundary for paid service execution.

- `generate_response_v2()` builds and carries a typed `ServiceQuoteRecord` and `InvocationRecord` through validation, charging, upstream forwarding, usage logging, and audit logging.
- `forwarding_upstream.call_upstream()` now accepts typed `InvocationRecord` plus `ServiceDefinitionRecord` and returns a typed `InvocationResultRecord` instead of raw `dict` transport.
- Buyer receipt remains a response-boundary JSON object, but now includes `quoteId` and `invocationId` derived from the typed execution records for end-to-end traceability.
- `ExecutionRepository` is now the persistence boundary for runtime execution state, storing typed quote records in `synapse_service_quotes` and typed invocation records in `synapse_invocations`.
- Legacy `POST /api/v1/gateway/generate` and the agent-facing `POST /api/v1/agent/quotes`, `POST /api/v1/agent/invocations`, and `GET /api/v1/agent/invocations/{invocation_id}` now share the same typed quote/invocation execution pipeline instead of drifting into separate dict-based implementations.

## Agent Discovery Runtime Baseline

Agent-facing discovery now uses canonical runtime objects from `src/domain/service_contract.py` instead of assembling ad hoc public dict payloads in the service layer.

- `RegistryService.search_agent_discovery()` returns typed `PublicServiceDiscoveryRecord` results with a typed `QuoteRequestDraftRecord` under `quoteTemplate`.
- Discovery, quote, and invocation now share `QuoteInputPreviewRecord` and `RuntimePayloadRecord` wrappers, so the handoff between phases no longer depends on raw `dict` contracts inside the runtime.
- Legacy `GET /api/v1/services/discover` is still supported, but it now serializes from the same typed discovery record used by the new `POST /api/v1/agent/discovery/search` path.
