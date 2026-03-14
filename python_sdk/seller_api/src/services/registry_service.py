from typing import Dict, Any, List, Optional
from src.storage.base import BaseStorage
import uuid
import time
import asyncio
import random
import string


def _seller_short(owner_wallet: str) -> str:
    compact = "".join(ch for ch in owner_wallet.lower() if ch in string.hexdigits)
    return (compact[-2:] if len(compact) >= 2 else "SA").upper()


def _generate_service_id(owner_wallet: str) -> str:
    # Example: SVC_SA_0Z8K2F_7Q3N
    time36 = format(int(time.time() * 1000), "x")[-6:].upper()
    rand4 = "".join(random.choice(string.ascii_uppercase + string.digits) for _ in range(4))
    return f"SVC_{_seller_short(owner_wallet)}_{time36}_{rand4}"


def _build_public_invoke(svc: Dict[str, Any], public_gateway_url: Optional[str]) -> Dict[str, Any]:
    invoke = svc.get("invoke") if isinstance(svc.get("invoke"), dict) else {}
    timeout_ms = int(invoke.get("timeoutMs") or 3000)
    method = str(invoke.get("method") or "POST").upper()
    request_spec = invoke.get("request") if isinstance(invoke.get("request"), dict) else {"contentType": "application/json", "schema": {}}
    response_spec = invoke.get("response") if isinstance(invoke.get("response"), dict) else {"contentType": "application/json", "schema": {}}

    gateway_url = str(public_gateway_url or "").strip()
    if not gateway_url:
        gateway_url = "/api/v1/gateway/generate"

    return {
        "method": method,
        "targets": [
            {
                "url": gateway_url,
                "weight": 100,
                "region": None,
            }
        ],
        "timeoutMs": timeout_ms,
        "request": request_spec,
        "response": response_spec,
    }


def _normalize_service_payload(req_data: Dict[str, Any], owner_wallet: str) -> Dict[str, Any]:
    invoke = req_data.get("invoke") if isinstance(req_data.get("invoke"), dict) else {}
    if not invoke:
        raise ValueError("invoke is required")
    targets = invoke.get("targets") if isinstance(invoke.get("targets"), list) else []
    if not targets:
        raise ValueError("invoke.targets must contain at least one target")
    normalized_targets = []
    for row in targets:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        if not url:
            continue
        normalized_targets.append({
            "url": url,
            "weight": int(row.get("weight") or 100),
            "region": row.get("region"),
        })
    if not normalized_targets:
        raise ValueError("invoke.targets must contain valid URLs")
    health_check = req_data.get("healthCheck") if isinstance(req_data.get("healthCheck"), dict) else {}
    if not health_check:
        raise ValueError("healthCheck is required")
    health_path = str(health_check.get("path") or "").strip()
    if not health_path:
        raise ValueError("healthCheck.path is required")
    if not health_path.startswith("/"):
        health_path = f"/{health_path}"
    constraints = req_data.get("constraints") if isinstance(req_data.get("constraints"), dict) else {}
    pricing_value = req_data.get("pricing")
    pricing_amount = "0"
    pricing_currency = "USDC"
    if isinstance(pricing_value, dict):
        pricing_amount = str(pricing_value.get("amount") or "0")
        pricing_currency = str(pricing_value.get("currency") or "USDC")
    elif pricing_value is not None:
        pricing_amount = str(pricing_value)
    endpoint = str(normalized_targets[0].get("url") or "").strip()
    service_name = str(req_data.get("serviceName") or req_data.get("service_name") or "").strip()
    tags = req_data.get("tags") if isinstance(req_data.get("tags"), list) else req_data.get("intent") if isinstance(req_data.get("intent"), list) else []

    normalized = {
        **req_data,
        "schemaVersion": 2,
        "ownerAddress": owner_wallet,
        "name": service_name,
        "serviceName": service_name,
        "summary": str(req_data.get("summary") or req_data.get("description") or "").strip(),
        "tags": tags,
        "pricing": pricing_amount,
        "pricingCurrency": pricing_currency,
        "endpoint": endpoint,
        "role": str(req_data.get("role") or "Provider / Seller"),
        "address": str(req_data.get("address") or owner_wallet),
        "status": str(req_data.get("status") or ("active" if req_data.get("isActive", True) else "inactive")),
        "isActive": bool(req_data.get("isActive", True)),
        "healthCheck": {
            **health_check,
            "path": health_path,
        },
        "constraints": req_data.get("constraints") if isinstance(req_data.get("constraints"), dict) else {
            "timeoutMs": int(constraints.get("timeoutMs") or constraints.get("timeout_ms") or 3000),
            "maxResponseBytes": int(constraints.get("maxResponseBytes") or constraints.get("max_response_bytes") or 2048),
            "maxRequestBytes": int(constraints.get("maxRequestBytes") or constraints.get("max_request_bytes") or 4096),
            "maxQps": int(constraints.get("maxQps") or constraints.get("max_qps") or 50),
        },
        "forwarding": req_data.get("forwarding") if isinstance(req_data.get("forwarding"), dict) else {
            "requestIdHeader": "X-Synapse-Request-Id",
            "passThroughHeaders": ["X-Trace-Id", "X-Client-Version"],
            "injectHeaders": {"X-Synapse-Service-Id": str(req_data.get("serviceId") or "")},
            "retryPolicy": {
                "maxAttempts": 2,
                "backoffMs": 200,
                "retryOnStatus": [429, 500, 502, 503, 504],
            },
        },
        "metering": req_data.get("metering") if isinstance(req_data.get("metering"), dict) else {
            "billingUnit": "per_call",
            "billOnError": False,
            "billableStatusClasses": [2],
            "requestIdRequired": True,
            "responseSizeMetering": True,
        },
        "invoke": {
            **invoke,
            "url": endpoint,
            "targets": normalized_targets,
        },
    }
    return normalized

class RegistryService:
    def __init__(self, storage: BaseStorage):
        self.storage = storage
        self._lock = asyncio.Lock()

    async def register_service(self, req_data: Dict[str, Any], owner_wallet: str) -> Dict[str, Any]:
        """
        [网关防弹层] 注册新的 AI Service
        """
        async with self._lock:
            rows = self.storage.get_collection('service_registry') or []
            new_svc = _normalize_service_payload(req_data, owner_wallet)
            if not new_svc.get("serviceId"):
                new_svc["serviceId"] = _generate_service_id(owner_wallet)
            new_svc["id"] = str(new_svc.get("id") or uuid.uuid4())
            new_svc["createdAt"] = int(time.time() * 1000)
            new_svc["updatedAt"] = new_svc["createdAt"]
            
            rows.append(new_svc)
            self.storage.save_collection('service_registry', rows)
            return new_svc

    async def update_service(self, service_record_id: str, req_data: Dict[str, Any], owner_wallet: str) -> Optional[Dict[str, Any]]:
        """
        [网关防弹层] 更新现有的 AI Service
        """
        async with self._lock:
            rows = self.storage.get_collection('service_registry') or []
            for i, svc in enumerate(rows):
                if svc.get("serviceId") == service_record_id and svc.get("ownerAddress") == owner_wallet:
                    blocked = {"id", "serviceId", "ownerAddress", "createdAt", "schemaVersion"}
                    safe_patch = {k: v for k, v in req_data.items() if k not in blocked}
                    updated = {**svc, **safe_patch}
                    updated = _normalize_service_payload(updated, owner_wallet)
                    updated["id"] = svc.get("id")
                    updated["serviceId"] = svc.get("serviceId")
                    updated["createdAt"] = svc.get("createdAt")
                    updated["ownerAddress"] = owner_wallet
                    updated["updatedAt"] = int(time.time() * 1000)
                    rows[i] = updated
                    self.storage.save_collection('service_registry', rows)
                    return updated
            return None

    async def delete_service(self, service_record_id: str, owner_wallet: str) -> bool:
        async with self._lock:
            rows = self.storage.get_collection('service_registry') or []
            original_len = len(rows)
            rows = [
                r for r in rows
                if not (r.get("serviceId") == service_record_id and r.get("ownerAddress") == owner_wallet)
            ]
            if len(rows) == original_len:
                return False
            self.storage.save_collection('service_registry', rows)
            return True

    async def has_owner_service(self, service_record_id: str, owner_wallet: str) -> bool:
        rows = self.storage.get_collection('service_registry') or []
        for svc in rows:
            if svc.get("serviceId") == service_record_id and svc.get("ownerAddress") == owner_wallet:
                return True
        return False

    async def discover_services(self, intent: Optional[str] = None, public_gateway_url: Optional[str] = None) -> List[Dict[str, Any]]:
        rows = self.storage.get_collection('service_registry') or []
        available_services = [row for row in rows if row.get("isActive") is True]
        
        if intent:
            intent_lower = intent.lower()
            matched_services = []
            for svc in available_services:
                searchable_text = " ".join([
                    str(svc.get("serviceName", "")).lower(),
                    str(svc.get("summary", "")).lower(),
                    " ".join(str(t).lower() for t in svc.get("tags", []))
                ])
                if intent_lower in searchable_text:
                    matched_services.append(svc)
            available_services = matched_services

        # Filter out sensitive info just in case
        public_services = []
        for svc in available_services:
            public_svc = {
                "serviceId": svc.get("serviceId"),
                "serviceName": svc.get("serviceName"),
                "pricing": svc.get("pricing"),
                "summary": svc.get("summary"),
                "tags": svc.get("tags"),
                "invoke": _build_public_invoke(svc, public_gateway_url),
            }
            public_services.append(public_svc)

        return public_services

    async def list_owner_services(self, owner_wallet: str) -> List[Dict[str, Any]]:
        rows = self.storage.get_collection("service_registry") or []
        return [svc for svc in rows if svc.get("ownerAddress") == owner_wallet]
