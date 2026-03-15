from typing import Dict, Any, List, Optional
from src.storage.base import BaseStorage
from src.core.config import settings
from src.services.platform import service_health_service
import uuid
import time
import asyncio
import random
import string
import math

JSON_CONTENT_TYPE = "application/json"


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
    timeout_ms = int(invoke.get("timeoutMs") or settings.gateway_default_timeout_ms)
    method = str(invoke.get("method") or "POST").upper()
    request_spec = invoke.get("request") if isinstance(invoke.get("request"), dict) else {"contentType": JSON_CONTENT_TYPE, "schema": {}}
    response_spec = invoke.get("response") if isinstance(invoke.get("response"), dict) else {"contentType": JSON_CONTENT_TYPE, "schema": {}}

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
    def _as_int(raw: Any, fallback: int) -> int:
        try:
            return int(raw)
        except Exception:
            return int(fallback)

    def _require_range(name: str, value: int, lower: int, upper: int) -> int:
        if value < lower or value > upper:
            raise ValueError(f"{name} must be in [{lower}, {upper}]")
        return value

    invoke = req_data.get("invoke") if isinstance(req_data.get("invoke"), dict) else {}
    if not invoke:
        raise ValueError("invoke is required")
    invoke_method = str(invoke.get("method") or "POST").upper()
    if invoke_method != "POST":
        raise ValueError("invoke.method must be POST")
    request_spec = invoke.get("request") if isinstance(invoke.get("request"), dict) else {}
    request_content_type = str(request_spec.get("contentType") or JSON_CONTENT_TYPE).strip().lower()
    if request_content_type != JSON_CONTENT_TYPE:
        raise ValueError("invoke.request.contentType must be application/json")
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
    timeout_ms = _require_range(
        "constraints.timeoutMs",
        _as_int(
            constraints.get("timeoutMs") or constraints.get("timeout_ms") or settings.gateway_default_timeout_ms,
            settings.gateway_default_timeout_ms,
        ),
        settings.gateway_min_timeout_ms,
        settings.gateway_max_timeout_ms,
    )
    max_request_bytes = _require_range(
        "constraints.maxRequestBytes",
        _as_int(
            constraints.get("maxRequestBytes") or constraints.get("max_request_bytes") or settings.gateway_default_request_bytes,
            settings.gateway_default_request_bytes,
        ),
        settings.gateway_min_request_bytes,
        settings.gateway_max_request_bytes,
    )
    max_response_bytes = _require_range(
        "constraints.maxResponseBytes",
        _as_int(
            constraints.get("maxResponseBytes") or constraints.get("max_response_bytes") or settings.gateway_default_response_bytes,
            settings.gateway_default_response_bytes,
        ),
        settings.gateway_min_response_bytes,
        settings.gateway_max_response_bytes,
    )
    max_qps = _require_range(
        "constraints.maxQps",
        _as_int(
            constraints.get("maxQps") or constraints.get("max_qps") or settings.gateway_default_service_qps,
            settings.gateway_default_service_qps,
        ),
        settings.gateway_min_service_qps,
        settings.gateway_max_service_qps,
    )
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
        "constraints": {
            "timeoutMs": timeout_ms,
            "maxResponseBytes": max_response_bytes,
            "maxRequestBytes": max_request_bytes,
            "maxQps": max_qps,
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

    def _load_service_registry_rows(self) -> List[Dict[str, Any]]:
        raw_rows = getattr(self.storage, "read_service_registry_rows")()
        return [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []

    def _save_service_registry_rows(self, rows: List[Dict[str, Any]]) -> None:
        getattr(self.storage, "write_service_registry_rows")(rows)

    def _load_service_target_health_history_rows(self) -> List[Dict[str, Any]]:
        raw_rows = getattr(self.storage, "read_service_target_health_history_rows")()
        return [row for row in raw_rows if isinstance(row, dict)] if isinstance(raw_rows, list) else []

    async def register_service(self, req_data: Dict[str, Any], owner_wallet: str) -> Dict[str, Any]:
        """
        [网关防弹层] 注册新的 AI Service
        """
        async with self._lock:
            rows = self._load_service_registry_rows()
            new_svc = _normalize_service_payload(req_data, owner_wallet)
            if not new_svc.get("serviceId"):
                new_svc["serviceId"] = _generate_service_id(owner_wallet)
            new_svc["id"] = str(new_svc.get("id") or uuid.uuid4())
            new_svc["createdAt"] = int(time.time() * 1000)
            new_svc["updatedAt"] = new_svc["createdAt"]
            new_svc = await service_health_service.probe_service_health(new_svc)
            
            rows.append(new_svc)
            self._save_service_registry_rows(rows)
            service_health_service.sync_service_target_health_table(self.storage, rows)
            return new_svc

    async def update_service(self, service_record_id: str, req_data: Dict[str, Any], owner_wallet: str) -> Optional[Dict[str, Any]]:
        """
        [网关防弹层] 更新现有的 AI Service
        """
        async with self._lock:
            rows = self._load_service_registry_rows()
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
                    updated = await service_health_service.probe_service_health(updated)
                    rows[i] = updated
                    self._save_service_registry_rows(rows)
                    service_health_service.sync_service_target_health_table(self.storage, rows)
                    return updated
            return None

    async def delete_service(self, service_record_id: str, owner_wallet: str) -> bool:
        async with self._lock:
            rows = self._load_service_registry_rows()
            original_len = len(rows)
            rows = [
                r for r in rows
                if not (r.get("serviceId") == service_record_id and r.get("ownerAddress") == owner_wallet)
            ]
            if len(rows) == original_len:
                return False
            self._save_service_registry_rows(rows)
            service_health_service.sync_service_target_health_table(self.storage, rows)
            service_health_service.prune_health_history(self.storage)
            return True

    async def has_owner_service(self, service_record_id: str, owner_wallet: str) -> bool:
        rows = self._load_service_registry_rows()
        for svc in rows:
            if svc.get("serviceId") == service_record_id and svc.get("ownerAddress") == owner_wallet:
                return True
        return False

    async def discover_services(self, intent: Optional[str] = None, public_gateway_url: Optional[str] = None) -> List[Dict[str, Any]]:
        rows = self._load_service_registry_rows()
        available_services = [row for row in rows if service_health_service.is_service_discoverable(row)]
        
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
                "status": service_health_service.public_discover_status(svc),
                "health": service_health_service.public_health_summary(svc),
                "invoke": _build_public_invoke(svc, public_gateway_url),
            }
            public_services.append(public_svc)

        return public_services

    async def list_owner_services(self, owner_wallet: str) -> List[Dict[str, Any]]:
        rows = self._load_service_registry_rows()
        return [svc for svc in rows if svc.get("ownerAddress") == owner_wallet]

    async def health_status(self, intent: Optional[str] = None, include_inactive: bool = False) -> List[Dict[str, Any]]:
        rows = self._load_service_registry_rows()
        scoped = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if not include_inactive and not bool(row.get("isActive", False)):
                continue
            scoped.append(row)

        if intent:
            intent_lower = intent.lower()
            filtered = []
            for svc in scoped:
                searchable_text = " ".join([
                    str(svc.get("serviceName", "")).lower(),
                    str(svc.get("summary", "")).lower(),
                    " ".join(str(t).lower() for t in svc.get("tags", [])),
                ])
                if intent_lower in searchable_text:
                    filtered.append(svc)
            scoped = filtered

        return [
            {
                "serviceId": svc.get("serviceId"),
                "serviceName": svc.get("serviceName"),
                "isActive": bool(svc.get("isActive", False)),
                "status": str(svc.get("status") or "unknown"),
                "health": service_health_service.public_health_summary(svc),
            }
            for svc in scoped
        ]

    async def service_health_history(
        self,
        service_record_id: str,
        owner_wallet: str,
        limit_per_target: int,
        hours: Optional[int] = None,
        days: Optional[int] = None,
    ) -> Dict[str, Any]:
        rows = self._load_service_registry_rows()
        service_row = None
        for row in rows:
            if isinstance(row, dict) and row.get("serviceId") == service_record_id and row.get("ownerAddress") == owner_wallet:
                service_row = row
                break
        if service_row is None:
            raise ValueError("SERVICE_NOT_FOUND_OR_FORBIDDEN")

        history = self._load_service_target_health_history_rows()
        if not isinstance(history, list):
            history = []

        retention_hours = max(1, int(settings.service_health_history_retention_hours))
        if hours is not None:
            requested_hours = int(hours)
        elif days is not None:
            requested_hours = int(days) * 24
        else:
            requested_hours = retention_hours
        window_hours = max(1, min(requested_hours, retention_hours))
        cutoff_ms = int(time.time() * 1000) - (window_hours * 60 * 60 * 1000)

        per_target: Dict[str, List[Dict[str, Any]]] = {}
        for row in history:
            if not isinstance(row, dict):
                continue
            if str(row.get("serviceId") or "") != service_record_id:
                continue
            checked_at = int(row.get("checkedAt") or 0)
            if checked_at < cutoff_ms:
                continue
            target_url = str(row.get("targetUrl") or "").strip()
            if not target_url:
                continue
            bucket = per_target.setdefault(target_url, [])
            bucket.append(row)

        normalized_limit = max(1, min(int(limit_per_target), 2000))
        targets = []
        for target_url, entries in per_target.items():
            sorted_entries = sorted(entries, key=lambda item: int(item.get("checkedAt") or 0), reverse=True)
            latest = sorted_entries[0] if sorted_entries else None
            targets.append(
                {
                    "targetUrl": target_url,
                    "latestStatus": str((latest or {}).get("status") or "unknown"),
                    "history": sorted_entries[:normalized_limit],
                }
            )

        targets.sort(key=lambda item: item["targetUrl"])
        return {
            "serviceId": service_record_id,
            "serviceName": service_row.get("serviceName"),
            "windowHours": window_hours,
            "retentionHours": retention_hours,
            "windowDays": max(1, int(math.ceil(window_hours / 24))),
            "retentionDays": max(1, int(math.ceil(retention_hours / 24))),
            "limitPerTarget": normalized_limit,
            "targets": targets,
        }
