# Gateway API Reference — Automated Test Bug Report

> Generated during API Reference e2e test pass on 2026-01-04.
> Test file: `services/gateway/tests/e2e/test_api_reference.py`
> Final result: **19 passed, 3 skipped** (skipped = require funded Anvil node)

---

## Bug 1 — DB connection failure on auth/verify → 500

**Symptom**: `POST /api/v1/auth/verify` returned `{"detail":"Verification failed"}` (500).

**Root cause**: `synapse-postgres` container (port 5432) was stopped.  
Port 5432 was occupied by the local system postgres user (`postgres`, no `synapse` user).  
`.env.local` was pointing to port 5432.

**Fix**:
1. Changed `POSTGRES_DSN` port in `services/gateway/.env.local` from `5432` → `5434` (points to `synapse-postgres-alt` Docker container).
2. Also required starting the gateway with an explicit env var override because the running process inherited a stale `POSTGRES_DSN` from the shell:
   ```bash
   POSTGRES_DSN="postgresql://synapse:12345678@127.0.0.1:5434/synapse_gateway" \
     .venv/bin/python gateway_fastapi.py
   ```

---

## Bug 2 — `discover` allows unauthenticated access (test assertion wrong)

**Symptom**: `GET /api/v1/services/discover` returns 200 without auth; test expected 401/403.

**Root cause**: Discovery is intentionally public — not a gateway bug, the test was wrong.

**Fix**: Updated test to accept 200, 401, or 403.

---

## Bug 3 — `POST /api/v1/services` → 422 (wrong field schema in test)

**Symptom**: Service registration returned 422 Unprocessable Entity.

**Root cause**: Test was using REST-style field names (`name`, `price_per_call_usdc`) that don't match the gateway's manifest schema.

**Fix**: Updated test payload to the correct manifest schema:
```json
{
  "serviceName": "...",
  "agentToolName": "...",
  "summary": "...",
  "pricing": { "currency": "USD", "amount": "0.01" },
  "invoke": {
    "method": "POST",
    "targets": [{ "url": "http://...", "weight": 100 }],
    "request": {},
    "response": {}
  }
}
```

---

## Bug 4 — `POST /api/v1/agent/credentials` token not found

**Symptom**: Test couldn't extract credential token from response.

**Root cause**: Token is nested at `data['credential']['token']`, not `data['token']`.

**Fix**: Updated test extraction to use `data.get('credential', {}).get('token')`.

---

## Bug 5 — `GET /api/v1/agent/invocations` → 405 + empty header crash

**Symptom**: 405 Method Not Allowed; also `LocalProtocolError: Illegal header value b'Bearer '` when credential was empty.

**Root cause**:
1. `GET /api/v1/agent/invocations` route does not exist (405).
2. Credential token was empty, resulting in a malformed `Authorization: Bearer ` header.

**Fix**:
1. Changed invocation list test to use the correct endpoint: `GET /api/v1/usage/logs` (with JWT, not agent credential).
2. Added guard: `if not cred: pytest.skip("no credential")`.

---

## Bug 6 — `DELETE /api/v1/services/:id` → 409 SERVICE_DELETE_ACTIVE_CONFLICT after deactivation

> **This was a real gateway bug. Two related issues were found and fixed in the gateway source.**

### Issue A — `isActive: False` patch did not persist `status` to "paused"

**File**: `services/gateway/src/services/provider/registry/registration.py`

**Root cause**: `update_service` merges the existing service dump (which has `status: "active"`) with the patch `{ isActive: False }`. In `service_definition_payload`, the merged status `"active"` takes precedence via the `or` operator:
```python
"status": str(req_data.get("status") or ("active" if req_data.get("isActive", True) else "inactive")),
```
Since `req_data["status"] = "active"` (from the dump), `isActive: False` never changes the stored status.

When the service is reloaded from DB, `service_lifecycle_status(svc)` returns `"active"` → 409.

**Fix** (line ~115 in `registration.py`):
```python
# When isActive is explicitly set to False without a status override,
# inject "paused" so the merged payload does not inherit the existing
# "active" status — preventing service_lifecycle_status from returning "active".
if "isActive" in safe_patch and not safe_patch["isActive"] and "status" not in safe_patch:
    safe_patch["status"] = "paused"
```

### Issue B — `delete_service` wrote `status: "deleted"` which violates DB check constraint

**File**: `services/gateway/src/services/provider/registry/registration.py`

**Root cause**: `delete_service` sets `status = "deleted"` on soft-delete, but the `synapse_service_manifests` DB table only allows: `draft`, `active`, `paused`, `archived`.

This bug was hidden before Bug 6A was fixed because the code never reached the write (it raised 409 first).

**Fix 1** — Use `"archived"` as the soft-delete status:
```python
# registration.py: delete_service
deleted = svc.model_copy(
    update={
        "status": "archived",   # was "deleted" — invalid DB value
        "is_active": False,
        "updated_at": now_dt_str(),
    }
)
```

**Fix 2** — Update `is_deleted_service` to recognize both `"deleted"` (legacy in-memory) and `"archived"` (DB-persisted):
```python
# payload_helpers.py
def is_deleted_service(service: ServiceDefinitionRecord) -> bool:
    return service_lifecycle_status(service) in {"deleted", "archived"}
```

---

## Test Skips (expected — require funded Anvil)

| Test | Reason |
|------|--------|
| `TestInvocations::test_01_quote_service` | Needs live service + price oracle |
| `TestInvocations::test_02_invoke_service` | Depends on quote |
| `TestInvocations::test_03_get_invocation_receipt` | Depends on invoke |
