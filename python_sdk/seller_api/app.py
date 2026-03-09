import asyncio
import time
from typing import Annotated, Any, Dict, Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .auth import create_auth_challenge, enforce_owner, require_auth, validate_wallet, verify_auth_signature
from .common import normalize_service_id, normalize_wallet, pending_response
from .credentials import (
    consume_credential_call,
    enforce_generate_rate_limits,
    enforce_rate_limit,
    find_active_credential_or_unauthorized,
    hash_credential_token,
    issue_agent_credential_token,
    list_owned_services,
    resolve_credential_ttl,
    resolve_max_calls,
    resolve_rpm,
    validate_service_for_credential,
)
from .models import (
    AgentCreateRequest,
    AgentCredentialIssueRequest,
    AgentCredentialQuotaUpdateRequest,
    AuthVerifyRequest,
    InferenceRequest,
    ServiceCreateRequest,
    ServiceUpdateRequest,
)
from .payment import verify_payment
from .persistence import (
    append_audit_log,
    list_audit_logs as list_audit_logs_from_store,
    load_agent_credentials,
    load_agent_registry,
    load_service_registry,
    save_agent_credentials,
    save_agent_registry,
    save_service_registry,
)
from .settings import (
    AGENT_RATE_LIMIT_PER_MIN,
    AUTH_RESPONSES,
    ERROR_RESPONSES,
    INVALID_ADDRESS_MESSAGE,
    OWNER_RATE_LIMIT_PER_MIN,
    REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE,
    SERVICE_REGISTRY_RESPONSES,
)
from .state import lock

app = FastAPI(title="A2A Agent Provider API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def generate_service_id(existing_ids: set[str]) -> str:
    for _ in range(8):
        candidate = f"SVC_{uuid4().hex[:12].upper()}"
        if candidate not in existing_ids:
            return candidate
    return f"SVC_{uuid4().hex.upper()}"


def normalize_invoke(method: str, url: str, timeout_ms: int) -> tuple[str, str, int]:
    normalized_method = method.strip().upper()
    if normalized_method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
        raise HTTPException(status_code=400, detail={"code": "INVALID_METHOD", "message": "invoke.method is invalid"})

    normalized_url = url.strip()
    if not normalized_url.startswith("http://") and not normalized_url.startswith("https://"):
        raise HTTPException(status_code=400, detail={"code": "INVALID_ENDPOINT", "message": "invoke.url must start with http:// or https://"})

    if timeout_ms <= 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_TIMEOUT", "message": "invoke.timeoutMs must be positive"})

    return normalized_method, normalized_url, timeout_ms


@app.get("/api/v1/auth/challenge", responses=AUTH_RESPONSES)
async def auth_challenge(address: str):
    return create_auth_challenge(address)


@app.post("/api/v1/auth/verify", responses=AUTH_RESPONSES)
async def auth_verify(payload: AuthVerifyRequest):
    return verify_auth_signature(payload.address, payload.nonce, payload.signature)


@app.post("/api/v2/services", responses=SERVICE_REGISTRY_RESPONSES)
async def create_service(payload: ServiceCreateRequest, subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)

    owner_address = subject_wallet
    service_address = validate_wallet(payload.address, "INVALID_SERVICE_ADDRESS", INVALID_ADDRESS_MESSAGE)

    service_name = payload.serviceName.strip()
    if not service_name:
        raise HTTPException(status_code=400, detail={"code": "INVALID_SERVICE_NAME", "message": "serviceName is required"})

    try:
        pricing_value = float(payload.pricing)
        if pricing_value <= 0:
            raise ValueError("pricing must be positive")
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "INVALID_PRICING", "message": "pricing must be a positive number"})

    invoke_method, invoke_url, timeout_ms = normalize_invoke(
        payload.invoke.method,
        payload.invoke.url,
        int(payload.invoke.timeoutMs),
    )

    tags = [str(tag).strip() for tag in (payload.tags or []) if str(tag).strip()]
    auth_payload = payload.auth.model_dump(exclude_none=True) if payload.auth else None
    invoke_payload = payload.invoke.model_dump()
    invoke_payload["method"] = invoke_method
    invoke_payload["url"] = invoke_url
    invoke_payload["timeoutMs"] = timeout_ms

    now = int(time.time())

    with lock:
        rows = load_service_registry()
        existing_ids = {normalize_service_id(str(row.get("serviceId", ""))) for row in rows if row.get("serviceId")}
        service_id = generate_service_id(existing_ids)
        record_id = str(uuid4())

        record = {
            "id": record_id,
            "agentId": payload.agentId,
            "name": service_name,
            "serviceName": service_name,
            "role": payload.role.strip(),
            "ownerAddress": owner_address,
            "address": service_address,
            "serviceId": service_id,
            "pricing": str(payload.pricing),
            "endpoint": invoke_url,
            "isActive": bool(payload.isActive),
            "summary": payload.summary.strip() if payload.summary else None,
            "tags": tags,
            "auth": auth_payload,
            "invoke": invoke_payload,
            "updatedAt": now,
            "createdAt": now,
        }

        rows.append(record)

        save_service_registry(rows)

    append_audit_log(
        "SERVICE_CREATE",
        subject_wallet,
        {
            "serviceRecordId": record_id,
            "serviceId": service_id,
            "agentId": payload.agentId,
            "endpoint": invoke_url,
            "pricing": str(payload.pricing),
            "isActive": bool(payload.isActive),
        },
    )

    return {
        "status": "success",
        "code": "SERVICE_CREATED",
        "service": record,
        "count": len(rows),
    }


@app.get("/api/v2/services/discover", responses=SERVICE_REGISTRY_RESPONSES)
async def discover_services(
    intent: Annotated[Optional[str], Query(description="Search keyword for service discovery")] = None,
):
    """
    Public endpoint for Buyer AI Agents to discover available services.
    Returns only active services. Strips out sensitive backend info like auth if needed (for now, returns public fields).
    """
    rows = load_service_registry()
    
    # Filter only active services
    available_services = [row for row in rows if row.get("isActive") is True]
    
    if intent:
        intent_lower = intent.lower()
        # Basic intent matching: check if intent is in serviceName, summary, description, or tags
        matched_services = []
        for svc in available_services:
            searchable_text = " ".join([
                str(svc.get("serviceName", "")).lower(),
                str(svc.get("summary", "")).lower(),
                " ".join(str(t).lower() for t in svc.get("tags", [])),
            ])
            if intent_lower in searchable_text:
                matched_services.append(svc)
        available_services = matched_services

    # Clean up sensitive data before returning to buyer (e.g., internal auth headers)
    public_services = []
    for svc in available_services:
        public_svc = {
            "serviceId": svc.get("serviceId"),
            "serviceName": svc.get("serviceName"),
            "pricing": svc.get("pricing"),
            "summary": svc.get("summary"),
            "tags": svc.get("tags"),
            "invoke": {
                # Only expose what the buyer needs to send the request to the gateway
                "method": svc.get("invoke", {}).get("method"),
                "request": svc.get("invoke", {}).get("request", {}),
                "response": svc.get("invoke", {}).get("response", {}),
            }
        }
        public_services.append(public_svc)

    return {
        "status": "success", 
        "services": public_services, 
        "count": len(public_services)
    }


@app.get("/api/v2/services", responses=SERVICE_REGISTRY_RESPONSES)
async def list_services(
    subject_wallet: Annotated[str, Depends(require_auth)],
    owner_address: Annotated[Optional[str], Query(alias="ownerAddress")] = None,
):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    rows = load_service_registry()
    target = subject_wallet
    if owner_address:
        requested = validate_wallet(owner_address, "INVALID_OWNER_ADDRESS", "ownerAddress is invalid")
        enforce_owner(requested, subject_wallet)
        target = requested
    rows = [row for row in rows if normalize_wallet(str(row.get("ownerAddress", ""))) == target]
    return {"status": "success", "services": rows, "count": len(rows)}


@app.put("/api/v2/services/{service_record_id}", responses=SERVICE_REGISTRY_RESPONSES)
async def update_service(service_record_id: str, payload: ServiceUpdateRequest, subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)

    service_name = payload.serviceName.strip()
    if not service_name:
        raise HTTPException(status_code=400, detail={"code": "INVALID_SERVICE_NAME", "message": "serviceName is required"})

    try:
        pricing_value = float(payload.pricing)
        if pricing_value <= 0:
            raise ValueError("pricing must be positive")
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "INVALID_PRICING", "message": "pricing must be a positive number"})

    invoke_method, invoke_url, timeout_ms = normalize_invoke(
        payload.invoke.method,
        payload.invoke.url,
        int(payload.invoke.timeoutMs),
    )
    tags = [str(tag).strip() for tag in (payload.tags or []) if str(tag).strip()]
    auth_payload = payload.auth.model_dump(exclude_none=True) if payload.auth else None
    invoke_payload = payload.invoke.model_dump()
    invoke_payload["method"] = invoke_method
    invoke_payload["url"] = invoke_url
    invoke_payload["timeoutMs"] = timeout_ms

    with lock:
        rows = load_service_registry()
        existing_index = next((idx for idx, row in enumerate(rows) if row.get("id") == service_record_id), -1)
        if existing_index < 0:
            raise HTTPException(status_code=404, detail={"code": "SERVICE_NOT_FOUND", "message": "Service does not exist"})
        enforce_owner(str(rows[existing_index].get("ownerAddress", "")), subject_wallet)

        before = dict(rows[existing_index])
        rows[existing_index] = {
            **rows[existing_index],
            "name": service_name,
            "serviceName": service_name,
            "pricing": str(payload.pricing),
            "endpoint": invoke_url,
            "isActive": bool(payload.isActive),
            "summary": payload.summary.strip() if payload.summary else None,
            "tags": tags,
            "auth": auth_payload,
            "invoke": invoke_payload,
            "updatedAt": int(time.time()),
        }
        save_service_registry(rows)

    changed_fields = []
    if before.get("endpoint") != invoke_url:
        changed_fields.append("endpoint")
    if before.get("pricing") != str(payload.pricing):
        changed_fields.append("pricing")
    if before.get("isActive") != bool(payload.isActive):
        changed_fields.append("isActive")
    if before.get("name") != service_name:
        changed_fields.append("serviceName")
    if before.get("invoke") != invoke_payload:
        changed_fields.append("invoke")

    append_audit_log(
        "SERVICE_UPDATE",
        subject_wallet,
        {
            "serviceRecordId": service_record_id,
            "serviceId": rows[existing_index].get("serviceId"),
            "agentId": rows[existing_index].get("agentId"),
            "changedFields": changed_fields,
            "before": {
                "endpoint": before.get("endpoint"),
                "pricing": before.get("pricing"),
                "isActive": before.get("isActive"),
            },
            "after": {
                "endpoint": invoke_url,
                "pricing": str(payload.pricing),
                "isActive": bool(payload.isActive),
            },
        },
    )

    return {
        "status": "success",
        "code": "SERVICE_UPDATED",
        "service": rows[existing_index],
        "count": len(rows),
    }


@app.delete("/api/v2/services/{service_record_id}", responses=SERVICE_REGISTRY_RESPONSES)
async def delete_service(service_record_id: str, subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    with lock:
        rows = load_service_registry()
        existing_index = next((idx for idx, row in enumerate(rows) if row.get("id") == service_record_id), -1)
        if existing_index < 0:
            raise HTTPException(status_code=404, detail={"code": "SERVICE_NOT_FOUND", "message": "Service does not exist"})

        existing = rows[existing_index]
        enforce_owner(str(existing.get("ownerAddress", "")), subject_wallet)
        removed = rows.pop(existing_index)
        save_service_registry(rows)

    append_audit_log(
        "SERVICE_DELETE",
        subject_wallet,
        {
            "serviceRecordId": removed.get("id"),
            "serviceId": removed.get("serviceId"),
            "agentId": removed.get("agentId"),
            "endpoint": removed.get("endpoint"),
        },
    )

    return {
        "status": "success",
        "code": "SERVICE_DELETED",
        "service": removed,
        "count": len(rows),
    }

@app.post("/api/v2/agents", responses=SERVICE_REGISTRY_RESPONSES)
async def create_agent(
    payload: AgentCreateRequest,
    subject_wallet: Annotated[str, Depends(require_auth)]
):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    
    with lock:
        rows = load_agent_registry()
        
        # Ensure owner is consistent
        enforce_owner(payload.ownerAddress, subject_wallet)
        
        # Check if agent already exists for this owner
        for row in rows:
            if row.get("address", "").lower() == payload.address.lower() and \
               row.get("ownerAddress", "").lower() == payload.ownerAddress.lower():
                raise HTTPException(status_code=400, detail={"code": "AGENT_ALREADY_EXISTS", "message": "This agent address is already registered to this owner."})

        record_id = payload.id or str(uuid4())
        record = {
            "id": record_id,
            "name": payload.name,
            "ownerAddress": payload.ownerAddress,
            "address": payload.address,
            "role": payload.role,
            "createdAt": payload.createdAt
        }
        
        rows.append(record)
        save_agent_registry(rows)
        
    append_audit_log(
        "agent_registered",
        subject_wallet,
        {"recordId": record_id, "role": payload.role, "target": payload.address}
    )
    
    return {
        "status": "success",
        "code": "AGENT_CREATED",
        "agent": record,
        "count": len(rows),
    }

@app.get("/api/v2/agents", responses=SERVICE_REGISTRY_RESPONSES)
async def list_agents(
    subject_wallet: Annotated[str, Depends(require_auth)],
    owner_address: Annotated[Optional[str], Query(alias="ownerAddress")] = None,
):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    rows = load_agent_registry()
    
    target = subject_wallet
    if owner_address:
        requested = validate_wallet(owner_address, "INVALID_OWNER_ADDRESS", "ownerAddress is invalid")
        enforce_owner(requested, subject_wallet)
        target = requested
        
    filtered_rows = [row for row in rows if str(row.get("ownerAddress")).lower() == target.lower()]
    
    return {
        "status": "success",
        "code": "AGENTS_FETCHED",
        "data": filtered_rows,
        "count": len(filtered_rows)
    }

@app.post("/api/v1/agent-credentials/issue", responses=SERVICE_REGISTRY_RESPONSES)
async def issue_agent_credential(payload: AgentCredentialIssueRequest, subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)

    ttl = resolve_credential_ttl(payload.expiresInSec)
    now = int(time.time())
    expires_at = now + ttl

    max_calls = resolve_max_calls(payload.maxCalls)
    rpm = resolve_rpm(payload.rpm)

    plain_token = issue_agent_credential_token()
    token_hash = hash_credential_token(plain_token)
    owner_wallet = normalize_wallet(subject_wallet)
    shared_agent_id = "OWNER_SHARED"

    credential_id = ""
    record: Dict[str, Any] = {}

    with lock:
        rows = load_agent_credentials()
        existing_index = next(
            (
                idx
                for idx, row in enumerate(rows)
                if normalize_wallet(str(row.get("ownerAddress", ""))) == owner_wallet
                and str(row.get("status", "")) == "active"
            ),
            -1,
        )

        if existing_index >= 0:
            existing = rows[existing_index]
            existing["tokenHash"] = token_hash
            existing["tokenPrefix"] = plain_token[:10]
            existing["agentId"] = shared_agent_id
            existing["serviceId"] = None
            existing["serviceRecordId"] = None
            existing["maxCalls"] = max_calls
            existing["callsUsed"] = 0
            existing["rpm"] = rpm
            existing["expiresAt"] = expires_at
            existing["updatedAt"] = now
            existing["revokedAt"] = None
            existing["status"] = "active"
            rows[existing_index] = existing
            record = existing
            credential_id = str(existing.get("id"))
        else:
            credential_id = str(uuid4())
            record = {
                "id": credential_id,
                "ownerAddress": owner_wallet,
                "agentId": shared_agent_id,
                "serviceId": None,
                "serviceRecordId": None,
                "tokenHash": token_hash,
                "tokenPrefix": plain_token[:10],
                "status": "active",
                "maxCalls": max_calls,
                "callsUsed": 0,
                "rpm": rpm,
                "createdAt": now,
                "updatedAt": now,
                "expiresAt": expires_at,
                "revokedAt": None,
            }
            rows.append(record)

        save_agent_credentials(rows)

    append_audit_log(
        "AGENT_CREDENTIAL_ISSUED",
        subject_wallet,
        {
            "credentialId": credential_id,
            "agentId": record.get("agentId"),
            "serviceId": record.get("serviceId"),
            "maxCalls": max_calls,
            "rpm": rpm,
            "expiresAt": expires_at,
        },
    )

    return {
        "status": "success",
        "credential": {
            "id": credential_id,
            "token": plain_token,
            "ownerAddress": record.get("ownerAddress"),
            "agentId": record.get("agentId"),
            "serviceId": record.get("serviceId"),
            "maxCalls": record.get("maxCalls"),
            "callsUsed": record.get("callsUsed"),
            "rpm": record.get("rpm"),
            "expiresAt": record.get("expiresAt"),
            "status": record.get("status"),
        },
    }


@app.get("/api/v1/agent-credentials", responses=SERVICE_REGISTRY_RESPONSES)
async def list_agent_credentials(subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    owner = normalize_wallet(subject_wallet)
    rows = load_agent_credentials()
    visible = [
        {
            "id": row.get("id"),
            "ownerAddress": row.get("ownerAddress"),
            "agentId": row.get("agentId"),
            "serviceId": row.get("serviceId"),
            "tokenPrefix": row.get("tokenPrefix"),
            "status": row.get("status"),
            "maxCalls": row.get("maxCalls"),
            "callsUsed": row.get("callsUsed"),
            "rpm": row.get("rpm"),
            "expiresAt": row.get("expiresAt"),
            "createdAt": row.get("createdAt"),
            "updatedAt": row.get("updatedAt"),
            "revokedAt": row.get("revokedAt"),
        }
        for row in rows
        if normalize_wallet(str(row.get("ownerAddress", ""))) == owner
    ]
    visible.sort(key=lambda row: int(row.get("createdAt", 0)), reverse=True)
    return {"status": "success", "credentials": visible, "count": len(visible)}


@app.post("/api/v1/agent-credentials/{credential_id}/revoke", responses=SERVICE_REGISTRY_RESPONSES)
async def revoke_agent_credential(credential_id: str, subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    owner = normalize_wallet(subject_wallet)
    now = int(time.time())

    with lock:
        rows = load_agent_credentials()
        index = next((i for i, row in enumerate(rows) if row.get("id") == credential_id), -1)
        if index < 0:
            raise HTTPException(status_code=404, detail={"code": "CREDENTIAL_NOT_FOUND", "message": "Credential not found"})

        found = rows[index]
        if normalize_wallet(str(found.get("ownerAddress", ""))) != owner:
            raise HTTPException(
                status_code=403,
                detail={"code": "FORBIDDEN", "message": "Credential does not belong to current wallet"},
            )

        found["status"] = "revoked"
        found["updatedAt"] = now
        found["revokedAt"] = now
        rows[index] = found
        save_agent_credentials(rows)

    append_audit_log(
        "AGENT_CREDENTIAL_REVOKED",
        subject_wallet,
        {
            "credentialId": credential_id,
            "agentId": found.get("agentId"),
            "serviceId": found.get("serviceId"),
        },
    )

    return {"status": "success", "credential": found}


@app.patch("/api/v1/agent-credentials/{credential_id}/quota", responses=SERVICE_REGISTRY_RESPONSES)
async def update_agent_credential_quota(
    credential_id: str,
    payload: AgentCredentialQuotaUpdateRequest,
    subject_wallet: Annotated[str, Depends(require_auth)],
):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    owner = normalize_wallet(subject_wallet)
    now = int(time.time())

    with lock:
        rows = load_agent_credentials()
        index = next((i for i, row in enumerate(rows) if row.get("id") == credential_id), -1)
        if index < 0:
            raise HTTPException(status_code=404, detail={"code": "CREDENTIAL_NOT_FOUND", "message": "Credential not found"})

        found = rows[index]
        if normalize_wallet(str(found.get("ownerAddress", ""))) != owner:
            raise HTTPException(
                status_code=403,
                detail={"code": "FORBIDDEN", "message": "Credential does not belong to current wallet"},
            )

        before = {
            "maxCalls": found.get("maxCalls"),
            "rpm": found.get("rpm"),
            "expiresAt": found.get("expiresAt"),
        }

        if payload.maxCalls is not None:
            if payload.maxCalls <= 0:
                raise HTTPException(status_code=400, detail={"code": "INVALID_MAX_CALLS", "message": "maxCalls must be positive"})
            found["maxCalls"] = payload.maxCalls
        if payload.rpm is not None:
            if payload.rpm <= 0:
                raise HTTPException(status_code=400, detail={"code": "INVALID_RPM", "message": "rpm must be positive"})
            found["rpm"] = payload.rpm
        if payload.expiresAt is not None:
            if payload.expiresAt <= now:
                raise HTTPException(status_code=400, detail={"code": "INVALID_EXPIRES_AT", "message": "expiresAt must be in future"})
            found["expiresAt"] = payload.expiresAt

        found["updatedAt"] = now
        rows[index] = found
        save_agent_credentials(rows)

    append_audit_log(
        "AGENT_CREDENTIAL_QUOTA_UPDATED",
        subject_wallet,
        {
            "credentialId": credential_id,
            "agentId": found.get("agentId"),
            "serviceId": found.get("serviceId"),
            "before": before,
            "after": {
                "maxCalls": found.get("maxCalls"),
                "rpm": found.get("rpm"),
                "expiresAt": found.get("expiresAt"),
            },
        },
    )

    return {"status": "success", "credential": found}


@app.get("/api/v1/audit-logs", responses=SERVICE_REGISTRY_RESPONSES)
async def list_audit_logs(
    subject_wallet: Annotated[str, Depends(require_auth)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    logs = list_audit_logs_from_store(subject_wallet, limit)
    return {"status": "success", "logs": logs, "count": len(logs)}


@app.post("/api/v1/generate", responses=ERROR_RESPONSES)
async def generate_response(
    request: InferenceRequest,
    x_tx_hash: Annotated[str, Header(alias="X-Tx-Hash")],
    x_service_id: Annotated[Optional[str], Header(alias="X-Service-Id")] = None,
    x_agent_credential: Annotated[Optional[str], Header(alias="X-Agent-Credential")] = None,
):
    service_id = x_service_id or request.service_id
    if not service_id:
        raise HTTPException(status_code=422, detail={"code": "SERVICE_ID_REQUIRED", "message": "serviceId is required"})
    if x_service_id and request.service_id and x_service_id != request.service_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "SERVICE_ID_MISMATCH", "message": "Header and body serviceId mismatch"},
        )

    active_credential = None
    if x_agent_credential:
        active_credential = find_active_credential_or_unauthorized(x_agent_credential)
        raw_service_id = active_credential.get("serviceId")
        cred_service_id = normalize_service_id(str(raw_service_id)) if raw_service_id else ""
        if cred_service_id and cred_service_id != service_id:
            raise HTTPException(
                status_code=403,
                detail={"code": "AGENT_CREDENTIAL_SERVICE_MISMATCH", "message": "Credential serviceId mismatch"},
            )

        owner_wallet = normalize_wallet(str(active_credential.get("ownerAddress", "")))
        agent_id = str(active_credential.get("agentId") or "OWNER_SHARED")
        rpm_limit = int(active_credential.get("rpm") or AGENT_RATE_LIMIT_PER_MIN)
        enforce_generate_rate_limits(owner_wallet, agent_id, service_id, rpm_limit)
    elif REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE:
        raise HTTPException(
            status_code=401,
            detail={"code": "AGENT_CREDENTIAL_REQUIRED", "message": "X-Agent-Credential is required"},
        )

    verification = verify_payment(x_tx_hash, service_id)
    if verification["status"] == "pending":
        return pending_response(x_tx_hash)

    if active_credential:
        consume_credential_call(str(active_credential.get("id")))

    await asyncio.sleep(1)
    return {
        "status": "success",
        "code": "DELIVERED",
        "payment": verification,
        "data": {
            "result": f"Agent Response to '{request.prompt}'.",
            "provider_signature": "0x123",
        },
    }
