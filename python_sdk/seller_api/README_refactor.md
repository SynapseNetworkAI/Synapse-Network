# Phase 1 of Refactoring Complete

1. Reorganized into standard `src/` modular layout:
   - `src/core`: `config` holding loaded ENV vars.
   - `src/models`: Shared pydantic response/request models.
   - `src/storage`: Abstract base storage vs `json_impl` mapped via DI.
   - `src/api`: Top level routing logic split into chunks (`auth`, `services`, `registry`).
   - `src/app.py`: Clean initialized FastAPI router.

2. Next Steps:
   - Migrate endpoints from `app.py` -> `src/api/routers/*`.
   - Migrate web3 payment dependencies to `src/services/payment.py`.
   - Replace old `persistence.py` json writes with injected instances in routes using `Depends(get_storage)`.
