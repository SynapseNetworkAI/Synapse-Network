import asyncio
import httpx
from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential
import time
import secrets
from contextlib import asynccontextmanager
from typing import Annotated, Any, Dict, List, Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from .log_config import logger

global_http_client = httpx.AsyncClient(
    timeout=10.0,
    limits=httpx.Limits(max_keepalive_connections=50, max_connections=100)
)

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
    ParseCurlRequest,
)
from .payment import verify_payment
from .persistence import (
    enforce_wallet_role,
    load_wallet_roles,
    append_audit_log,
    list_audit_logs as list_audit_logs_from_store,
    load_agent_credentials,
    load_agent_registry,
    load_balance_ledger,
    load_deposit_intents,
    load_refund_intents,
    load_router_config,
    load_service_registry,
    load_usage_logs,
    save_agent_credentials,
    save_agent_registry,
    save_balance_ledger,
    save_deposit_intents,
    save_refund_intents,
    save_router_config,
    save_service_registry,
    save_usage_logs,
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
from .v2_indexer import run_v2_deposit_indexer


@asynccontextmanager
async def lifespan(_: FastAPI):
    stop_event = asyncio.Event()
    indexer_task = asyncio.create_task(run_v2_deposit_indexer(stop_event))
    try:
        yield
    finally:
        stop_event.set()
        try:
            await asyncio.wait_for(indexer_task, timeout=5)
        except Exception:
            if not indexer_task.done():
                indexer_task.cancel()


app = FastAPI(title="A2A Agent Provider API", lifespan=lifespan)

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or str(uuid4())
        request.state.request_id = request_id
        
        req_logger = logger.bind(request_id=request_id)
        start_time = time.time()
        
        req_logger.info(f"==> Incoming Request: {request.method} {request.url.path}")
        
        response = await call_next(request)
        
        process_time_ms = round((time.time() - start_time) * 1000, 2)
        req_logger.info(f"<== Request completed: {response.status_code} in {process_time_ms}ms")
        
        response.headers["X-Request-Id"] = request_id
        return response

app.add_middleware(RequestLoggingMiddleware)

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


def parse_service_price_usdc(service_row: Dict[str, Any]) -> float:
    try:
        price = float(service_row.get("pricing", "0"))
    except Exception:
        raise HTTPException(status_code=500, detail={"code": "INVALID_SERVICE_PRICE", "message": "service pricing is invalid"})
    if price <= 0:
        raise HTTPException(status_code=500, detail={"code": "INVALID_SERVICE_PRICE", "message": "service pricing must be positive"})
    return price


def find_active_service(service_id: str) -> Dict[str, Any]:
    normalized = normalize_service_id(service_id)
    rows = load_service_registry()
    target = next((row for row in rows if str(row.get("serviceId", "")) == normalized), None)
    if not target:
        raise HTTPException(status_code=404, detail={"code": "SERVICE_NOT_FOUND", "message": "Service not found"})
    if target.get("isActive") is False:
        raise HTTPException(status_code=403, detail={"code": "SERVICE_INACTIVE", "message": "Service is inactive"})
    return target


def list_usage_logs_for_wallet(wallet: str, limit: int) -> List[Dict[str, Any]]:
    owner = normalize_wallet(wallet)
    rows = load_usage_logs()
    visible = [
        row
        for row in rows
        if normalize_wallet(str(row.get("buyer", ""))) == owner or normalize_wallet(str(row.get("seller", ""))) == owner
    ]
    visible.sort(key=lambda row: int(row.get("created_at", 0)), reverse=True)
    return visible[:limit]


def resolve_active_credential_for_generate(
    x_agent_credential: Optional[str],
    service_id: str,
) -> Optional[Dict[str, Any]]:
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
        return active_credential

    if REQUIRE_AGENT_CREDENTIAL_FOR_GENERATE:
        raise HTTPException(
            status_code=401,
            detail={"code": "AGENT_CREDENTIAL_REQUIRED", "message": "X-Agent-Credential is required"},
        )

    return None


@app.get("/api/v1/auth/challenge", responses=AUTH_RESPONSES)
async def auth_challenge(address: str):
    return create_auth_challenge(address)


@app.post("/api/v1/auth/verify", responses=AUTH_RESPONSES)
async def auth_verify(payload: AuthVerifyRequest):
    return verify_auth_signature(payload.address, payload.nonce, payload.signature)


@app.post("/api/v2/services", responses=SERVICE_REGISTRY_RESPONSES)
async def create_service(payload: ServiceCreateRequest, subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_wallet_role(subject_wallet, "PROVIDER")
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

        secret_key = f"sk_live_synapse_{secrets.token_hex(16)}"
        record = {
            "id": record_id,
            "secretKey": secret_key,
            "maskedKey": mask_key(secret_key),
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



from pydantic import BaseModel
class BindRoleRequest(BaseModel):
    role: str

@app.post("/api/v1/wallet/role/{address}/bind")
async def bind_wallet_role(address: str, payload: BindRoleRequest):
    try:
        from .common import normalize_wallet
        enforce_wallet_role(normalize_wallet(address), payload.role)
        return {"success": True, "role": payload.role}
    except Exception as e:
        raise HTTPException(status_code=403, detail=str(e))

@app.get("/api/v1/wallet/role/{address}")
async def get_wallet_role(address: str):
    from .common import normalize_wallet
    roles = load_wallet_roles()
    role = roles.get(normalize_wallet(address))
    return {"role": role}

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
    safe_rows = []
    for row in rows:
        if normalize_wallet(str(row.get("ownerAddress", ""))) == target:
            r = dict(row)
            if "secretKey" in r:
                r.pop("secretKey", None)
            safe_rows.append(r)
    return {"status": "success", "services": safe_rows, "count": len(safe_rows)}


@app.put("/api/v2/services/{service_record_id}", responses=SERVICE_REGISTRY_RESPONSES)
async def update_service(service_record_id: str, payload: ServiceUpdateRequest,
    ParseCurlRequest, subject_wallet: Annotated[str, Depends(require_auth)]):
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
        current_secret = rows[existing_index].get("secretKey", f"sk_live_synapse_{secrets.token_hex(16)}")
        rows[existing_index] = {
            **rows[existing_index],
            "secretKey": current_secret,
            "maskedKey": mask_key(current_secret),
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
    enforce_wallet_role(subject_wallet, "CONSUMER")
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
    enforce_wallet_role(subject_wallet, "CONSUMER")
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


@app.get("/api/v2/balance", responses=SERVICE_REGISTRY_RESPONSES)
async def get_v2_balance(subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    wallet = normalize_wallet(subject_wallet)
    ledger = load_balance_ledger()
    buyers = ledger.get("buyers", {})
    sellers = ledger.get("sellers", {})
    platform = ledger.get("platform", {})
    daily_spend = ledger.get("dailySpend", {}) if isinstance(ledger, dict) else {}
    wallet_daily_spend = daily_spend.get(wallet, {}) if isinstance(daily_spend, dict) else {}
    today_key = str(int(time.time()) // 86400)
    spent_today = float(wallet_daily_spend.get(today_key, 0.0)) if isinstance(wallet_daily_spend, dict) else 0.0

    router_config = load_router_config()
    owners = router_config.get("owners", {}) if isinstance(router_config, dict) else {}
    owner_row = owners.get(wallet, {}) if isinstance(owners, dict) else {}
    daily_limit_usdc = float(owner_row.get("dailyLimitUsdc", 0.0)) if isinstance(owner_row, dict) else 0.0

    return {
        "status": "success",
        "balance": {
            "buyerBalance": float(buyers.get(wallet, 0.0)),
            "sellerReceivable": float(sellers.get(wallet, 0.0)),
            "platformFeeAccrued": float(platform.get("feeAccrued", 0.0)),
            "dailySpendUsed": spent_today,
            "dailyLimitUsdc": daily_limit_usdc,
        },
    }


@app.post("/api/v2/refund", responses=SERVICE_REGISTRY_RESPONSES)
async def request_refund_v2(subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    wallet = normalize_wallet(subject_wallet)
    now = int(time.time())
    
    with lock:
        ledger = load_balance_ledger()
        buyers = ledger.get("buyers", {})
        
        current_balance = float(buyers.get(wallet, 0.0))
        if current_balance <= 0:
            raise HTTPException(status_code=400, detail={"code": "INSUFFICIENT_BALANCE", "message": "No balance to refund"})
        
        # 4.2 Credential Invalidation
        credentials = load_agent_credentials()
        for idx, cred in enumerate(credentials):
            if normalize_wallet(cred.get("ownerAddress", "")) == wallet and cred.get("status") == "active":
                credentials[idx]["status"] = "revoked"
        save_agent_credentials(credentials)

        # Update balance
        buyers[wallet] = 0.0
        
        # 4.3 Refund Intent State Machine - Phase 1 (PENDING)
        intents = load_refund_intents()
        mock_nonce = len(intents) 
        signature = "0xmock_eip712_signature"
        intents.append({
            "buyer_address": wallet,
            "amount": current_balance,
            "nonce": mock_nonce,
            "signature": signature,
            "status": "PENDING",
            "created_at": now
        })
        
        save_refund_intents(intents)
        save_balance_ledger(ledger)
    
    return {
        "status": "success",
        "message": f"Successfully settled {current_balance} USDC",
        "signature": signature,
        "amountRefunded": current_balance
    }


@app.get("/api/v2/router/config", responses=SERVICE_REGISTRY_RESPONSES)
async def get_router_config_v2(subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    wallet = normalize_wallet(subject_wallet)
    payload = load_router_config()
    owners = payload.get("owners", {}) if isinstance(payload, dict) else {}
    owner_row = owners.get(wallet, {}) if isinstance(owners, dict) else {}

    return {
        "status": "success",
        "config": {
            "dailyLimitUsdc": float(owner_row.get("dailyLimitUsdc", 0.0)),
            "updatedAt": int(owner_row.get("updatedAt", 0)) if owner_row else None,
        },
    }


@app.post("/api/v2/router/config", responses=SERVICE_REGISTRY_RESPONSES)
async def set_router_config_v2(
    payload: Dict[str, Any],
    subject_wallet: Annotated[str, Depends(require_auth)],
):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    wallet = normalize_wallet(subject_wallet)

    try:
        daily_limit_usdc = float(payload.get("dailyLimitUsdc", 0))
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "INVALID_DAILY_LIMIT", "message": "dailyLimitUsdc must be a number"})

    if daily_limit_usdc < 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_DAILY_LIMIT", "message": "dailyLimitUsdc must be >= 0"})

    now = int(time.time())
    with lock:
        config = load_router_config()
        owners = config.setdefault("owners", {})
        owners[wallet] = {
            "dailyLimitUsdc": round(daily_limit_usdc, 6),
            "updatedAt": now,
        }
        save_router_config(config)

    append_audit_log(
        "V2_ROUTER_DAILY_LIMIT_SET",
        wallet,
        {"dailyLimitUsdc": round(daily_limit_usdc, 6)},
    )

    return {
        "status": "success",
        "config": {
            "dailyLimitUsdc": round(daily_limit_usdc, 6),
            "updatedAt": now,
        },
    }


@app.post("/api/v2/balance/deposit/intent", responses=SERVICE_REGISTRY_RESPONSES)
async def deposit_intent_v2(
    payload: Dict[str, Any],
    subject_wallet: Annotated[str, Depends(require_auth)],
):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)

    tx_hash = str(payload.get("txHash") or "").strip().lower()
    if not tx_hash.startswith("0x") or len(tx_hash) != 66:
        raise HTTPException(status_code=400, detail={"code": "INVALID_TX_HASH", "message": "txHash is required and must be a valid hash"})

    try:
        amount_usdc = float(payload.get("amountUsdc", 0))
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be a number"})

    if amount_usdc <= 0:
        raise HTTPException(status_code=400, detail={"code": "INVALID_AMOUNT", "message": "amountUsdc must be positive"})

    wallet = normalize_wallet(subject_wallet)
    with lock:
        intents = load_deposit_intents()
        existing = next(
            (
                row
                for row in intents
                if normalize_wallet(str(row.get("ownerAddress", ""))) == wallet and str(row.get("txHash", "")).lower() == tx_hash
            ),
            None,
        )

        if existing:
            status = str(existing.get("status") or "pending")
            return {
                "status": "success",
                "code": "DEPOSIT_INTENT_EXISTS",
                "deposit": {
                    "txHash": tx_hash,
                    "state": status,
                    "requestedAmountUsdc": float(existing.get("amountUsdc") or amount_usdc),
                    "creditedAmountUsdc": float(existing.get("creditedAmountUsdc") or 0.0),
                },
            }

        now = int(time.time())
        intents.append(
            {
                "id": str(uuid4()),
                "ownerAddress": wallet,
                "txHash": tx_hash,
                "amountUsdc": round(amount_usdc, 6),
                "status": "pending",
                "createdAt": now,
                "updatedAt": now,
            }
        )
        save_deposit_intents(intents)

    append_audit_log(
        "V2_DEPOSIT_INTENT",
        subject_wallet,
        {"txHash": tx_hash, "amountUsdc": amount_usdc, "state": "pending"},
    )

    return {
        "status": "success",
        "code": "DEPOSIT_PENDING_CONFIRMATION",
        "deposit": {
            "txHash": tx_hash,
            "state": "pending",
            "requestedAmountUsdc": round(amount_usdc, 6),
            "creditedAmountUsdc": 0.0,
        },
    }


@app.get("/api/v2/balance/deposit/intents", responses=SERVICE_REGISTRY_RESPONSES)
async def list_deposit_intents_v2(
    subject_wallet: Annotated[str, Depends(require_auth)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    wallet = normalize_wallet(subject_wallet)
    rows = load_deposit_intents()
    visible = [row for row in rows if normalize_wallet(str(row.get("ownerAddress", ""))) == wallet]
    visible.sort(key=lambda row: int(row.get("createdAt", 0)), reverse=True)
    visible = visible[:limit]
    return {"status": "success", "count": len(visible), "intents": visible}


@app.get("/api/v2/usage/logs", responses=SERVICE_REGISTRY_RESPONSES)
async def list_v2_usage_logs(
    subject_wallet: Annotated[str, Depends(require_auth)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    logs = list_usage_logs_for_wallet(subject_wallet, limit)
    return {"status": "success", "logs": logs, "count": len(logs)}


@app.post("/api/v2/generate", responses=ERROR_RESPONSES)
async def generate_response_v2(
    fastapi_req: Request,
    request: InferenceRequest,
    x_service_id: Annotated[Optional[str], Header(alias="X-Service-Id")] = None,
    x_agent_credential: Annotated[Optional[str], Header(alias="X-Agent-Credential")] = None,
):
    request_id = fastapi_req.state.request_id
    req_logger = logger.bind(request_id=request_id)
    
    start_time = time.time()
    req_logger.bind(action="request_enter").info(
        "Generate v2 request started",
        payload=request.dict()
    )
    
    service_id = x_service_id or request.service_id
    if not service_id:
        raise HTTPException(status_code=422, detail={"code": "SERVICE_ID_REQUIRED", "message": "serviceId is required"})

    if x_service_id and request.service_id and x_service_id != request.service_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "SERVICE_ID_MISMATCH", "message": "Header and body serviceId mismatch"},
        )

    active_credential = resolve_active_credential_for_generate(x_agent_credential, service_id)
    if not active_credential:
        raise HTTPException(
            status_code=401,
            detail={"code": "AGENT_CREDENTIAL_REQUIRED", "message": "X-Agent-Credential is required for /api/v2/generate"},
        )

    service = find_active_service(service_id)
    unit_price = parse_service_price_usdc(service)
    fee_rate = 0.1
    platform_fee = round(unit_price * fee_rate, 6)
    seller_net = round(unit_price - platform_fee, 6)

    buyer_wallet = normalize_wallet(str(active_credential.get("ownerAddress", "")))
    seller_wallet = normalize_wallet(str(service.get("address") or service.get("ownerAddress") or ""))
    now = int(time.time())
    today_key = str(now // 86400)

    with lock:
        router_config = load_router_config()
        owners = router_config.get("owners", {}) if isinstance(router_config, dict) else {}
        owner_row = owners.get(buyer_wallet, {}) if isinstance(owners, dict) else {}
        daily_limit_usdc = float(owner_row.get("dailyLimitUsdc", 0.0)) if isinstance(owner_row, dict) else 0.0

        ledger = load_balance_ledger()
        buyers = ledger.setdefault("buyers", {})
        sellers = ledger.setdefault("sellers", {})
        platform = ledger.setdefault("platform", {"feeAccrued": 0.0})
        daily_spend = ledger.setdefault("dailySpend", {})
        wallet_daily_spend = daily_spend.setdefault(buyer_wallet, {})
        if not isinstance(wallet_daily_spend, dict):
            wallet_daily_spend = {}
            daily_spend[buyer_wallet] = wallet_daily_spend

        spent_today = float(wallet_daily_spend.get(today_key, 0.0))
        if daily_limit_usdc > 0 and (spent_today + unit_price) > daily_limit_usdc + 1e-9:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "DAILY_LIMIT_EXCEEDED",
                    "message": "daily spending limit exceeded, please adjust platform daily limit or retry tomorrow",
                    "dailyLimitUsdc": round(daily_limit_usdc, 6),
                    "dailySpendUsed": round(spent_today, 6),
                    "attemptedCharge": round(unit_price, 6),
                },
            )

        buyer_balance = float(buyers.get(buyer_wallet, 0.0))
        if buyer_balance < unit_price:
            raise HTTPException(
                status_code=402,
                detail={"code": "INSUFFICIENT_BALANCE", "message": "buyer balance is insufficient, please deposit first"},
            )

        buyer_after = round(buyer_balance - unit_price, 6)
        buyers[buyer_wallet] = buyer_after
        wallet_daily_spend[today_key] = round(spent_today + unit_price, 6)
        sellers[seller_wallet] = round(float(sellers.get(seller_wallet, 0.0)) + seller_net, 6)
        platform["feeAccrued"] = round(float(platform.get("feeAccrued", 0.0)) + platform_fee, 6)

        save_balance_ledger(ledger)

        usage_rows = load_usage_logs()
        usage_rows.append(
            {
                "request_id": request_id,
                "buyer": buyer_wallet,
                "seller": seller_wallet,
                "service_id": service_id,
                "status": "succeeded",
                "unit_price": unit_price,
                "platform_fee": platform_fee,
                "seller_net": seller_net,
                "tx_hash": None,
                "block_number": None,
                "created_at": now,
            }
        )
        save_usage_logs(usage_rows)

    if active_credential:
        consume_credential_call(str(active_credential.get("id")))

    append_audit_log(
        "V2_USAGE_CHARGED",
        buyer_wallet,
        {
            "requestId": request_id,
            "serviceId": service_id,
            "unitPrice": unit_price,
            "platformFee": platform_fee,
            "sellerNet": seller_net,
            "buyerBalanceAfter": buyer_after,
            "dailyLimitUsdc": round(daily_limit_usdc, 6),
            "dailySpendUsed": round(float(wallet_daily_spend.get(today_key, 0.0)), 6),
        },
    )

    await asyncio.sleep(0.1)

    # ------------------ 反向代理/网关转发 ------------------
    # 调用实际的 Provider Service
    provider_url = "http://127.0.0.1:8100/api/v1/quotes/famous"
    actual_result = f"Agent Response to '{request.prompt}'."
    provider_signature = "0x123"
    
    try:
        req_logger.info(f"Forwarding to provider service: {provider_url}")
        
        # 使用 Tenacity 进行重试和熔断机制，最多重试 3 次，指数退避
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=1, max=4),
            reraise=True
        ):
            with attempt:
                # 使用全局连接池 global_http_client 以提高性能
                resp = await global_http_client.post(
                    provider_url,
                    json={"text": request.prompt},
                    headers={"X-Request-Id": request_id}
                )
                resp.raise_for_status()
                provider_json = resp.json()
                
                # 解析 provider_service 的返回提取内容
                if "quote" in provider_json:
                    actual_result = provider_json["quote"]
                elif "quotes" in provider_json:
                    actual_result = "\n".join(provider_json["quotes"])
                else:
                    actual_result = str(provider_json)
                    
                if "model" in provider_json:
                    actual_result = f"[{provider_json['model']}] " + actual_result
                    
    except Exception as e:
        req_logger.error(f"Upstream provider failed after retries: {e}")
        
        # --- ROLLBACK LOGIC (TCC Cancel) ---
        with lock:
            ledger = load_balance_ledger()
            buyers = ledger.setdefault("buyers", {})
            sellers = ledger.setdefault("sellers", {})
            platform = ledger.setdefault("platform", {"feeAccrued": 0.0})
            daily_spend = ledger.setdefault("dailySpend", {})
            wallet_daily_spend = daily_spend.setdefault(buyer_wallet, {})
            
            # Revert balances
            buyers[buyer_wallet] = round(float(buyers.get(buyer_wallet, 0.0)) + unit_price, 6)
            sellers[seller_wallet] = round(float(sellers.get(seller_wallet, 0.0)) - seller_net, 6)
            platform["feeAccrued"] = round(float(platform.get("feeAccrued", 0.0)) - platform_fee, 6)
            wallet_daily_spend[today_key] = round(float(wallet_daily_spend.get(today_key, 0.0)) - unit_price, 6)
            
            save_balance_ledger(ledger)
            
            # Update usage log to 'failed'
            usage_rows = load_usage_logs()
            for row in reversed(usage_rows):
                if row.get("request_id") == request_id:
                    row["status"] = "failed_upstream"
                    row["error_msg"] = str(e)
                    break
            save_usage_logs(usage_rows)
            
        if active_credential:
            refund_credential_call(str(active_credential.get("id")))
            
        append_audit_log(
            "V2_USAGE_REFUNDED",
            buyer_wallet,
            {
                "requestId": request_id, 
                "serviceId": service_id, 
                "refundedAmount": unit_price, 
                "reason": "upstream_error"
            }
        )
            
        raise HTTPException(
            status_code=502,
            detail={"code": "UPSTREAM_ERROR", "message": f"Upstream provider failed: {str(e)}"}
        )
    # ---------------------------------------------------------

    response_data = {
        "status": "success",
        "code": "DELIVERED",
        "billing": {
            "requestId": request_id,
            "serviceId": service_id,
            "unitPrice": unit_price,
            "platformFee": platform_fee,
            "sellerNet": seller_net,
            "buyerBalanceAfter": buyer_after,
            "dailyLimitUsdc": round(daily_limit_usdc, 6),
            "dailySpendUsed": round(float(wallet_daily_spend.get(today_key, 0.0)), 6),
        },
        "data": {
            "result": actual_result,
            "provider_signature": provider_signature,
        },
    }

    process_time_ms = round((time.time() - start_time) * 1000, 2)
    req_logger.bind(action="request_exit", process_time_ms=process_time_ms).info(
        "Generate v2 request completed",
        response=response_data
    )
    return response_data


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
            "result": actual_result,
            "provider_signature": provider_signature,
        },
    }


@app.get("/api/v2/refunds")
async def get_refunds_history(wallet_address: str = Depends(require_auth)):
    try:
        intents = load_refund_intents()
        user_intents = [
            i for i in intents 
            if i.get("buyer_address", "").lower() == wallet_address.lower()
        ]
        user_intents.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        mapped_data = []
        for i in user_intents:
            tx_hash_val = i.get("tx_hash")
            if tx_hash_val and not str(tx_hash_val).strip(): tx_hash_val = None
            mapped_data.append({
                "id": i.get("intent_id"),
                "timestamp": i.get("timestamp"),
                "amount": i.get("amount", 0.0),
                "type": i.get("type", "refund"),
                "status": i.get("status", "PENDING"),
                "txHash": tx_hash_val
            })
        return {"status": "success", "data": mapped_data}
    except Exception as e:
        logger.error(f"Error fetching refunds: {e}")
        raise HTTPException(status_code=500, detail="Internal error")


import json
import os
import httpx

@app.post("/api/v2/services/parse-curl")
async def parse_curl_endpoint(req: ParseCurlRequest):
    """
    Use a large model (DeepSeek/OpenAI) to parse a cURL command 
    and return the ServiceManifest components.
    """
    curl_str = req.curlCommand
    manifest = req.currentManifest or {}
    model_name = req.model

    prompt = f"""
    You are an expert API integration engineer.
    Base on the following cURL command, extract the API schema and configuration.
    
    Return ONLY a valid raw JSON object strictly adhering to this structure:
    {{
      "service_name": "A short descriptive name extracted from the endpoint (e.g., Image Generation API)",
      "agent_tool_name": "a_snake_case_tool_name_regex_safe",
      "description": "Clear 1-2 sentence description for an AI agent on when and why to use this tool.",
      "endpoint": "The full HTTP URL",
      "input_schema": {{ "type": "object", "properties": {{}}, "required": [] }},
      "output_schema": {{ "type": "object", "properties": {{}} }},
      "intent": ["tag1", "tag2"]
    }}
    
    cURL command:
    {curl_str}
    
    If there is JSON data in the -d or --data body, infer the input_schema properties and types.
    For output_schema, infer what a typical response would look like based on the endpoint name and intent.
    Do NOT include markdown formatting like ```json. Return only the raw JSON.
    """

    api_key = os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")
    base_url = "https://api.deepseek.com/v1" if "deepseek" in model_name.lower() else "https://api.openai.com/v1"
    
    if api_key:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "deepseek-chat" if "deepseek" in model_name else "gpt-4-turbo",
                        "messages": [
                            {"role": "system", "content": "You are a JSON-only schema generator. Output only valid raw JSON."},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0.1
                    }
                )
                if resp.status_code == 200:
                    content = resp.json()["choices"][0]["message"]["content"]
                    content = content.replace('```json', '').replace('```', '').strip()
                    parsed = json.loads(content)
                    return {"status": "success", "data": parsed}
                else:
                    logger.error(f"LLM API error: {resp.text}")
        except Exception as e:
            logger.error(f"LLM Exception: {e}")

    # Fallback heuristic if API fails or no key
    import re
    endpoint = ""
    url_match = re.search(r'https?://[^\s\"\']+', curl_str)
    if url_match:
        endpoint = url_match.group(0)

    inferred_inputs = {}
    req_fields = []
    
    try:
        start_idx = curl_str.find('{')
        end_idx = curl_str.rfind('}')
        if start_idx != -1 and end_idx > start_idx:
            json_body_str = curl_str[start_idx:end_idx+1]
            json_body_str = json_body_str.replace('\\"', '"')
            body_dict = json.loads(json_body_str)
            for k, v in body_dict.items():
                inferred_inputs[k] = {"type": type(v).__name__ if v is not None else "string", "description": f"Inferred parameter {k}"}
                req_fields.append(k)
    except:
        pass

    fallback_data = {
        "service_name": "API Service" if not url_match else f"Extracted ({endpoint.split('/')[-1] if '/' in endpoint else endpoint})",
        "agent_tool_name": "invoke_api_call",
        "description": "Extracted parameter schema.",
        "endpoint": endpoint,
        "input_schema": {
            "type": "object",
            "properties": inferred_inputs if inferred_inputs else {"query": {"type": "string"}},
            "required": req_fields if req_fields else ["query"]
        },
        "output_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string"},
                "data": {"type": "object"}
            }
        },
        "intent": ["ai-service"]
    }

    return {"status": "success", "data": fallback_data, "fallback": True}

@app.post("/api/v2/services/{service_record_id}/rotate-key")
async def rotate_key(service_record_id: str, subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    with lock:
        rows = load_service_registry()
        existing_index = next((idx for idx, row in enumerate(rows) if row.get("id") == service_record_id), -1)
        if existing_index < 0:
            raise HTTPException(status_code=404, detail={"code": "SERVICE_NOT_FOUND", "message": "Service does not exist"})
        
        enforce_owner(str(rows[existing_index].get("ownerAddress", "")), subject_wallet)
        
        new_secret = f"sk_live_synapse_{secrets.token_hex(16)}"
        rows[existing_index]["secretKey"] = new_secret
        rows[existing_index]["maskedKey"] = mask_key(new_secret)
        rows[existing_index]["updatedAt"] = int(time.time())
        save_service_registry(rows)
        
        return {
            "status": "success",
            "message": "Key rotated successfully",
            "secretKey": new_secret,
            "maskedKey": rows[existing_index]["maskedKey"]
        }


@app.post("/api/v2/services/{service_record_id}/ping")
async def test_ping(service_record_id: str, subject_wallet: Annotated[str, Depends(require_auth)]):
    enforce_rate_limit("owner", subject_wallet, OWNER_RATE_LIMIT_PER_MIN)
    # Just a mock response for now, to represent connection testing
    return {
        "status": "success",
        "message": "Connection OK"
    }

