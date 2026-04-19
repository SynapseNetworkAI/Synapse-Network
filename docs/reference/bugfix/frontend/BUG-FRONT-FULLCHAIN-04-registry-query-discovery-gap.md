---
Status: fixed
Area: user-front marketplace registry
Detected: 2026-04-19
Verification: output/playwright/user-front-verification/2026-04-19T013454624Z/report.md
---

# BUG-FRONT-FULLCHAIN-04: Registry Query Did Not Reach Gateway Discovery

## Reproduction

1. Run the local fullchain seed:
   ```bash
   npm run e2e:user-front-fullchain:seed
   ```
2. Query the agent-facing registry for the seeded run:
   ```bash
   curl "http://localhost:3000/marketplace/registry.json?q=<runId>&page=1&pageSize=10"
   ```
3. Observe that the response returned `total=0` even though `GET /api/v1/services/discover?intent=<runId>` returned the three newly registered services.

## Expected

`/marketplace/registry.json?q=<runId>` should return the three callable services seeded by the fullchain scenario.

## Actual

The route called `discoverServices()` without passing the query to gateway discovery, then filtered only the gateway default result set locally. When the seeded services were not in that default result set, local filtering returned an empty registry page.

## Root Cause

The route treated `q` as a local-only filter. That is not sufficient for an agent-facing registry because gateway discovery is the source of truth for searchable runtime services and may not return every callable service in the default unfiltered response.

## Fix

`services/user-front/src/app/marketplace/registry.json/route.ts` now passes `q` or `tag` into `discoverServices()` before applying the route-level available-only filter and pagination.

## Verification

```bash
node --check scripts/ui/verify_user_front_pages.mjs
npm run e2e:user-front-fullchain:verify
```

Passing report:

```text
output/playwright/user-front-verification/2026-04-19T013454624Z/report.md
```

The report shows `PASS api:marketplace-registry-json - 3 services returned, total=3`.

## Residual Risk

This verifies local/staging-style discovery behavior. Production still needs normal registry load tests and gateway discovery SLO monitoring before launch.
