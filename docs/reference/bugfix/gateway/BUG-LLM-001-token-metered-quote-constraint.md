# BUG-LLM-001: Token-metered LLM quote rejected by legacy DB constraint

## Status

Fixed locally. Staging requires the updated Gateway migration/schema contract to be deployed before running the live DeepSeek E2E gate.

## Scenario

`svc_deepseek_chat` was registered as an LLM service with `priceModel=token_metered`. The Gateway discovered the service correctly and entered the LLM billing path, but invocation failed while inserting a quote row.

## Expected

The Gateway should allow `synapse_service_quotes.price_model='token_metered'`, create the quote, reserve the LLM hold, call the provider, parse final usage, capture the actual charge, and release the unused hold.

## Actual

Postgres rejected the quote insert with:

```text
synapse_service_quotes_price_model_check
```

The old live/local constraint only accepted legacy non-LLM price models, so the API returned `500`.

## Fix

- Updated Gateway bootstrap and migration SQL to explicitly drop/recreate `synapse_service_manifests_price_model_check` and `synapse_service_quotes_price_model_check` with `token_metered`.
- Added schema contract checks so future drift fails at startup/release gate instead of during a paid invocation.
- Added unit coverage for legacy manifest/quote price model constraints.
- Re-ran local DeepSeek E2E and evidence checker successfully.

## Validation

```bash
npm run e2e:llm-deepseek:local
npm run ci:llm-deepseek-local-evidence
cd services/gateway && .venv/bin/python -m pytest tests/unit/test_forwarding_runtime_service_unit.py -k "llm" -q
cd services/gateway && .venv/bin/python -m pytest tests/unit/storage/test_postgres_impl_unit.py tests/unit/test_service_registration_unit.py tests/unit/storage/test_postgres_repositories_unit.py -q
npm run ci:docs
git diff --check
```

