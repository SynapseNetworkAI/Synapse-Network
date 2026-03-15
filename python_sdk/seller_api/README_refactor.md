# Phase 1 of Refactoring Complete

1. Reorganized into standard `src/` modular layout:
   - `src/core`: `config` holding loaded ENV vars.
   - `src/models`: Shared pydantic response/request models.
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
