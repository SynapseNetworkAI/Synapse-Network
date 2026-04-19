# BUG-ADMIN-PROVIDER-SERVICES-DOGFOOD

**Status:** Fixed
**Area:** gateway-admin / admin-front / provider services
**Date:** 2026-04-19

## Reproduction

Run `npm run e2e:admin-front` against local gateway, gateway-admin, and admin-front. The browser dogfood opened `/provider-services`, but the API consistency step failed and sidebar navigation could not find a Provider Services menu link.

## Root Cause

There were two independent issues:

1. `HttpProviderServicesAdapter` forwarded empty filter values as `query=&status=&runtimeStatus=`. The gateway route rejects empty `query` because the parameter has `min_length=1`, so a default admin-front request could return a gateway validation error instead of an empty-filter list.
2. The default menu tree contained `provider-services`, but the published-menu migration allowlist did not. Existing local/staging menu snapshots therefore never received the page in visible navigation, leaving `/provider-services` as a reachable but undiscoverable route.

## Fix

1. Gateway-admin provider services adapter now drops `None` and empty string query parameters before proxying to gateway.
2. `provider-services` is included in `DEFAULT_MENU_MIGRATION_ITEM_IDS`, so existing published menu snapshots are automatically backfilled the next time menu config is loaded.
3. Admin dogfood now verifies Provider Services through both browser navigation and gateway-admin API consistency.

## Verification

- `cd services/gateway-admin && .venv/bin/python -m pytest tests/test_app.py -k 'forum_support or provider_services' tests/test_forum_support_service.py tests/test_forum_support_repository.py tests/test_provider_services_adapter.py`
- `npm run e2e:admin-front`
- `npm run ci:admin-gateway`
- `npm run ci:admin-front`

## Residual Risk

Provider Services still depends on the gateway internal token configuration being aligned across gateway and gateway-admin. The dogfood runbook documents the required local/staging environment variables.
