from typing import Dict, Any, List, Optional
from src.storage.base import BaseStorage
from src.core.config import settings
from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.domain.service_contract import (
    ServiceConstraintRecord,
    ServiceDefinitionRecord,
    ServiceForwardingRecord,
    ServiceHealthCheckRecord,
    ServiceHealthTargetRecord,
    ServiceInvokeConfigRecord,
    ServiceInvokeTargetRecord,
    ServiceMeteringRecord,
    ServiceRequestSpecRecord,
    ServiceResponseSpecRecord,
    ServiceRetryPolicyRecord,
    ServiceRuntimeHealthRecord,
)
from src.services.platform import service_health_service
from src.utils.datetime_utils import now_dt_str, to_dt_str
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
    rand4 = "".join(
        random.choice(string.ascii_uppercase + string.digits) for _ in range(4)
    )
    return f"SVC_{_seller_short(owner_wallet)}_{time36}_{rand4}"


def _build_public_invoke(
    svc: ServiceDefinitionRecord, public_gateway_url: Optional[str]
) -> Dict[str, Any]:
    gateway_url = str(public_gateway_url or "").strip()
    if not gateway_url:
        gateway_url = "/api/v1/gateway/generate"

    return {
        "method": str(svc.invoke.method or "POST").upper(),
        "targets": [
            {
                "url": gateway_url,
                "weight": 100,
                "region": None,
            }
        ],
        "timeoutMs": int(svc.invoke.timeout_ms or settings.gateway_default_timeout_ms),
        "request": svc.invoke.request.model_dump(by_alias=True),
        "response": svc.invoke.response.model_dump(by_alias=True),
    }


def _as_int(raw: Any, fallback: int) -> int:
    try:
        return int(raw)
    except Exception:
        return int(fallback)


def _require_range(name: str, value: int, lower: int, upper: int) -> int:
    if value < lower or value > upper:
        raise ValueError(f"{name} must be in [{lower}, {upper}]")
    return value


def _dict_payload(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list_payload(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _validated_invoke_payload(req_data: Dict[str, Any]) -> Dict[str, Any]:
    invoke = _dict_payload(req_data.get("invoke"))
    if not invoke:
        raise ValueError("invoke is required")
    invoke_method = str(invoke.get("method") or "POST").upper()
    if invoke_method != "POST":
        raise ValueError("invoke.method must be POST")
    request_spec = _dict_payload(invoke.get("request"))
    request_content_type = str(
        request_spec.get("contentType") or JSON_CONTENT_TYPE
    ).strip().lower()
    if request_content_type != JSON_CONTENT_TYPE:
        raise ValueError("invoke.request.contentType must be application/json")
    return invoke


def _normalized_invoke_targets(invoke: Dict[str, Any]) -> List[ServiceInvokeTargetRecord]:
    targets = _list_payload(invoke.get("targets"))
    if not targets:
        raise ValueError("invoke.targets must contain at least one target")

    normalized_targets = [
        ServiceInvokeTargetRecord(
            url=str(row.get("url") or "").strip(),
            weight=int(row.get("weight") or 100),
            region=row.get("region"),
        )
        for row in targets
        if isinstance(row, dict) and str(row.get("url") or "").strip()
    ]
    if not normalized_targets:
        raise ValueError("invoke.targets must contain valid URLs")
    return normalized_targets


def _normalized_health_check(req_data: Dict[str, Any]) -> Dict[str, Any]:
    health_check = _dict_payload(req_data.get("healthCheck"))
    if not health_check:
        raise ValueError("healthCheck is required")
    health_path = str(health_check.get("path") or "").strip()
    if not health_path:
        raise ValueError("healthCheck.path is required")
    return {**health_check, "path": health_path if health_path.startswith("/") else f"/{health_path}"}


def _bounded_constraint(
    constraints: Dict[str, Any],
    key: str,
    snake_key: str,
    fallback: int,
    lower: int,
    upper: int,
) -> int:
    return _require_range(
        f"constraints.{key}",
        _as_int(constraints.get(key) or constraints.get(snake_key) or fallback, fallback),
        lower,
        upper,
    )


def _normalized_constraints(req_data: Dict[str, Any]) -> ServiceConstraintRecord:
    constraints = _dict_payload(req_data.get("constraints"))
    return ServiceConstraintRecord(
        timeoutMs=_bounded_constraint(
            constraints,
            "timeoutMs",
            "timeout_ms",
            settings.gateway_default_timeout_ms,
            settings.gateway_min_timeout_ms,
            settings.gateway_max_timeout_ms,
        ),
        maxRequestBytes=_bounded_constraint(
            constraints,
            "maxRequestBytes",
            "max_request_bytes",
            settings.gateway_default_request_bytes,
            settings.gateway_min_request_bytes,
            settings.gateway_max_request_bytes,
        ),
        maxResponseBytes=_bounded_constraint(
            constraints,
            "maxResponseBytes",
            "max_response_bytes",
            settings.gateway_default_response_bytes,
            settings.gateway_min_response_bytes,
            settings.gateway_max_response_bytes,
        ),
        maxQps=_bounded_constraint(
            constraints,
            "maxQps",
            "max_qps",
            settings.gateway_default_service_qps,
            settings.gateway_min_service_qps,
            settings.gateway_max_service_qps,
        ),
    )


def _resolved_pricing(req_data: Dict[str, Any]) -> tuple[str, str]:
    pricing_value = req_data.get("pricing")
    pricing_amount = req_data.get("pricingAmount") or "0"
    pricing_currency = str(req_data.get("pricingCurrency") or "USDC")
    if isinstance(pricing_value, dict):
        return (
            str(pricing_value.get("amount") or "0"),
            str(pricing_value.get("currency") or "USDC"),
        )
    if pricing_value is not None:
        return str(pricing_value), pricing_currency
    return str(pricing_amount), pricing_currency


def _resolved_service_name(req_data: Dict[str, Any]) -> str:
    return str(req_data.get("serviceName") or req_data.get("service_name") or "").strip()


def _resolved_tags(req_data: Dict[str, Any]) -> List[str]:
    tags_value = req_data.get("tags")
    if isinstance(tags_value, list):
        source = tags_value
    else:
        intent_value = req_data.get("intent")
        source = intent_value if isinstance(intent_value, list) else []
    return [str(tag) for tag in source if isinstance(tag, (str, int, float))]


def _default_forwarding_payload(req_data: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "requestIdHeader": "X-Synapse-Request-Id",
        "passThroughHeaders": ["X-Trace-Id", "X-Client-Version"],
        "injectHeaders": {
            "X-Synapse-Service-Id": str(req_data.get("serviceId") or "")
        },
        "retryPolicy": ServiceRetryPolicyRecord(
            maxAttempts=2,
            backoffMs=200,
            retryOnStatus=[429, 500, 502, 503, 504],
        ).model_dump(by_alias=True),
    }


def _default_metering_payload() -> Dict[str, Any]:
    return {
        "billingUnit": "per_call",
        "billOnError": False,
        "billableStatusClasses": [2],
        "requestIdRequired": True,
        "responseSizeMetering": True,
    }


def _normalized_invoke_config(
    invoke: Dict[str, Any],
    constraints: ServiceConstraintRecord,
    targets: List[ServiceInvokeTargetRecord],
) -> ServiceInvokeConfigRecord:
    request_spec = _dict_payload(invoke.get("request"))
    response_spec = _dict_payload(invoke.get("response"))
    return ServiceInvokeConfigRecord(
        method=str(invoke.get("method") or "POST").upper(),
        targets=targets,
        timeoutMs=int(invoke.get("timeoutMs") or constraints.timeout_ms),
        request=ServiceRequestSpecRecord.model_validate(
            request_spec or {"contentType": JSON_CONTENT_TYPE, "schema": {}}
        ),
        response=ServiceResponseSpecRecord.model_validate(
            response_spec or {"contentType": JSON_CONTENT_TYPE, "schema": {}}
        ),
        headersTemplate=dict(invoke.get("headersTemplate") or {}),
        examples=list(invoke.get("examples") or []),
    )


def _service_definition_payload(
    req_data: Dict[str, Any],
    owner_wallet: str,
    service_name: str,
    tags: List[str],
    pricing_amount: str,
    pricing_currency: str,
    constraints: ServiceConstraintRecord,
    health_check: Dict[str, Any],
    invoke: Dict[str, Any],
    normalized_targets: List[ServiceInvokeTargetRecord],
) -> Dict[str, Any]:
    forwarding_payload = _dict_payload(req_data.get("forwarding"))
    metering_payload = _dict_payload(req_data.get("metering"))
    auth_payload = _dict_payload(req_data.get("auth"))
    return {
        "id": str(req_data.get("id") or "") or None,
        "serviceId": str(req_data.get("serviceId") or "").strip() or None,
        "schemaVersion": int(req_data.get("schemaVersion") or 2),
        "ownerAddress": owner_wallet,
        "serviceName": service_name,
        "summary": str(req_data.get("summary") or req_data.get("description") or "").strip(),
        "tags": tags,
        "pricingAmount": pricing_amount,
        "pricingCurrency": pricing_currency,
        "role": str(req_data.get("role") or "Provider / Seller"),
        "address": str(req_data.get("address") or owner_wallet),
        "status": str(req_data.get("status") or ("active" if req_data.get("isActive", True) else "inactive")),
        "isActive": bool(req_data.get("isActive", True)),
        "constraints": constraints,
        "auth": auth_payload,
        "healthCheck": ServiceHealthCheckRecord.model_validate(health_check),
        "forwarding": ServiceForwardingRecord.model_validate(
            forwarding_payload or _default_forwarding_payload(req_data)
        ),
        "metering": ServiceMeteringRecord.model_validate(
            metering_payload or _default_metering_payload()
        ),
        "invoke": _normalized_invoke_config(invoke, constraints, normalized_targets),
        "createdAt": to_dt_str(req_data.get("createdAt"), "") or "",
        "updatedAt": to_dt_str(req_data.get("updatedAt"), "") or "",
    }


def _normalize_service_payload(
    req_data: Dict[str, Any], owner_wallet: str
) -> ServiceDefinitionRecord:
    invoke = _validated_invoke_payload(req_data)
    normalized_targets = _normalized_invoke_targets(invoke)
    health_check = _normalized_health_check(req_data)
    constraints = _normalized_constraints(req_data)
    pricing_amount, pricing_currency = _resolved_pricing(req_data)
    service_name = _resolved_service_name(req_data)
    tags = _resolved_tags(req_data)

    return ServiceDefinitionRecord.model_validate(
        _service_definition_payload(
            req_data,
            owner_wallet,
            service_name,
            tags,
            pricing_amount,
            pricing_currency,
            constraints,
            health_check,
            invoke,
            normalized_targets,
        )
    )


def _target_health_record(payload: Dict[str, Any], target_url: str) -> ServiceHealthTargetRecord:
    row_last_checked = int(payload.get("lastCheckedAt") or 0)
    return ServiceHealthTargetRecord(
        targetUrl=target_url,
        status=str(payload.get("status") or "unknown"),
        weight=int(payload.get("weight") or 100),
        region=payload.get("region"),
        httpStatus=payload.get("httpStatus"),
        latencyMs=payload.get("latencyMs"),
        consecutiveSuccesses=int(payload.get("consecutiveSuccesses") or 0),
        consecutiveFailures=int(payload.get("consecutiveFailures") or 0),
        probeUrl=payload.get("probeUrl"),
        lastCheckedAt=row_last_checked or None,
        lastHealthyAt=payload.get("lastHealthyAt"),
        error=payload.get("error"),
    )


def _merge_health_row(
    index: Dict[str, ServiceRuntimeHealthRecord], payload: Dict[str, Any]
) -> None:
    service_id = str(payload.get("serviceId") or "").strip()
    target_url = str(payload.get("targetUrl") or "").strip()
    if not service_id or not target_url:
        return

    bucket = index.setdefault(service_id, ServiceRuntimeHealthRecord())
    next_target = _target_health_record(payload, target_url)
    bucket.targets = [
        target for target in bucket.targets if target.target_url != target_url
    ] + [next_target]
    if int(next_target.last_checked_at or 0) > int(bucket.last_checked_at or 0):
        bucket.last_checked_at = next_target.last_checked_at
    overall_status = str(payload.get("overallStatus") or "").strip()
    if overall_status:
        bucket.overall_status = overall_status


def _finalize_health_bucket(bucket: ServiceRuntimeHealthRecord) -> None:
    healthy_count = len(
        [target for target in bucket.targets if str(target.status or "").lower() == "healthy"]
    )
    total_targets = len(bucket.targets)
    bucket.healthy_targets = healthy_count
    bucket.total_targets = total_targets
    if bucket.overall_status and str(bucket.overall_status).lower() != "unknown":
        return
    if total_targets <= 0:
        bucket.overall_status = "unknown"
    elif healthy_count == total_targets:
        bucket.overall_status = "healthy"
    elif healthy_count > 0:
        bucket.overall_status = "degraded"
    else:
        bucket.overall_status = "unhealthy"


def _searchable_service_text(service: ServiceDefinitionRecord) -> str:
    return " ".join(
        [
            str(service.service_name or "").lower(),
            str(service.summary or "").lower(),
            " ".join(str(tag).lower() for tag in service.tags),
        ]
    )


def _service_matches_intent(service: ServiceDefinitionRecord, intent: str) -> bool:
    return intent.lower() in _searchable_service_text(service)


def _find_owned_service(
    rows: List[ServiceDefinitionRecord], service_record_id: str, owner_wallet: str
) -> ServiceDefinitionRecord | None:
    return next(
        (
            row
            for row in rows
            if row.service_id == service_record_id and row.owner_address == owner_wallet
        ),
        None,
    )


def _history_window_hours(hours: Optional[int], days: Optional[int]) -> tuple[int, int]:
    retention_hours = max(1, int(settings.service_health_history_retention_hours))
    if hours is not None:
        requested_hours = int(hours)
    elif days is not None:
        requested_hours = int(days) * 24
    else:
        requested_hours = retention_hours
    return retention_hours, max(1, min(requested_hours, retention_hours))


def _history_entries_by_target(
    history: List[ServiceTargetHealthHistory], service_record_id: str, cutoff_ms: int
) -> Dict[str, List[Dict[str, Any]]]:
    per_target: Dict[str, List[Dict[str, Any]]] = {}
    for row in history:
        if str(row.service_id or "") != service_record_id:
            continue
        checked_at = int(row.checked_at or 0)
        if checked_at < cutoff_ms:
            continue
        target_url = str(row.target_url or "").strip()
        if not target_url:
            continue
        per_target.setdefault(target_url, []).append(row.model_dump(by_alias=True))
    return per_target


def _serialized_history_targets(
    per_target: Dict[str, List[Dict[str, Any]]], normalized_limit: int
) -> List[Dict[str, Any]]:
    targets = []
    for target_url, entries in per_target.items():
        sorted_entries = sorted(
            entries, key=lambda item: int(item.get("checkedAt") or 0), reverse=True
        )
        latest = sorted_entries[0] if sorted_entries else None
        targets.append(
            {
                "targetUrl": target_url,
                "latestStatus": str((latest or {}).get("status") or "unknown"),
                "history": sorted_entries[:normalized_limit],
            }
        )
    targets.sort(key=lambda item: item["targetUrl"])
    return targets


def _bind_forwarding_service_id(
    service_payload: ServiceDefinitionRecord,
) -> ServiceDefinitionRecord:
    service_id = str(service_payload.service_id or "").strip()
    if not service_id:
        return service_payload
    next_forwarding = service_payload.forwarding.model_copy(
        update={
            "inject_headers": {
                **service_payload.forwarding.inject_headers,
                "X-Synapse-Service-Id": service_id,
            }
        }
    )
    return service_payload.model_copy(update={"forwarding": next_forwarding})


class RegistryService:
    def __init__(self, storage: BaseStorage):
        self.storage = storage
        self._lock = asyncio.Lock()

    def _health_index_by_service_id(self) -> Dict[str, ServiceRuntimeHealthRecord]:
        rows = self.storage.get_data_manager().system.registry.read_service_target_health_rows()
        if not isinstance(rows, list):
            return {}

        index: Dict[str, ServiceRuntimeHealthRecord] = {}
        for row in rows:
            payload = (
                row.model_dump(by_alias=True)
                if isinstance(row, ServiceTargetHealth)
                else row
            )
            if not isinstance(payload, dict):
                continue
            _merge_health_row(index, payload)

        for bucket in index.values():
            _finalize_health_bucket(bucket)
        return index

    def _load_service_registry_rows(self) -> List[ServiceDefinitionRecord]:
        raw_rows = (
            self.storage.get_data_manager().system.registry.read_service_registry_rows()
        )
        health_index = self._health_index_by_service_id()
        rows: List[ServiceDefinitionRecord] = []
        if not isinstance(raw_rows, list):
            return rows
        for row in raw_rows:
            if not isinstance(row, ServiceDefinitionRecord):
                continue
            payload = row
            service_id = str(payload.service_id or "").strip()
            health = health_index.get(service_id) if service_id else None
            if isinstance(health, ServiceRuntimeHealthRecord):
                payload = payload.model_copy(update={"runtime_health": health})
                if not payload.invoke.targets:
                    payload = payload.model_copy(
                        update={
                            "invoke": payload.invoke.model_copy(
                                update={
                                    "targets": [
                                        ServiceInvokeTargetRecord(
                                            url=target.target_url,
                                            weight=target.weight,
                                            region=target.region,
                                        )
                                        for target in health.targets
                                    ],
                                    "timeout_ms": int(
                                        payload.constraints.timeout_ms
                                        or settings.gateway_default_timeout_ms
                                    ),
                                }
                            )
                        }
                    )
            rows.append(payload)
        return rows

    def _save_service_registry_rows(self, rows: List[ServiceDefinitionRecord]) -> None:
        self.storage.get_data_manager().system.registry.write_service_registry_rows(rows)

    def _load_service_target_health_history_rows(
        self,
    ) -> List[ServiceTargetHealthHistory]:
        return list(
            self.storage.get_data_manager().system.registry.read_service_target_health_history_rows()
        )

    async def register_service(
        self, req_data: Dict[str, Any], owner_wallet: str
    ) -> Dict[str, Any]:
        """
        [网关防弹层] 注册新的 AI Service
        """
        async with self._lock:
            rows = self._load_service_registry_rows()
            new_svc = _normalize_service_payload(req_data, owner_wallet)
            if not new_svc.service_id:
                new_svc = new_svc.model_copy(
                    update={"service_id": _generate_service_id(owner_wallet)}
                )
            new_svc = _bind_forwarding_service_id(new_svc)
            created_at = now_dt_str()
            new_svc = new_svc.model_copy(
                update={
                    "id": str(new_svc.id or uuid.uuid4()),
                    "created_at": created_at,
                    "updated_at": created_at,
                }
            )
            new_svc = await service_health_service.probe_service_health(new_svc)

            rows.append(new_svc)
            self._save_service_registry_rows(rows)
            service_health_service.sync_service_target_health_table(self.storage, rows)
            return new_svc.model_dump(by_alias=True, mode="json")

    async def update_service(
        self, service_record_id: str, req_data: Dict[str, Any], owner_wallet: str
    ) -> Optional[Dict[str, Any]]:
        """
        [网关防弹层] 更新现有的 AI Service
        """
        async with self._lock:
            rows = self._load_service_registry_rows()
            for i, svc in enumerate(rows):
                if (
                    svc.service_id == service_record_id
                    and svc.owner_address == owner_wallet
                ):
                    blocked = {
                        "id",
                        "serviceId",
                        "ownerAddress",
                        "createdAt",
                        "schemaVersion",
                    }
                    safe_patch = {k: v for k, v in req_data.items() if k not in blocked}
                    updated_payload = {
                        **svc.model_dump(by_alias=True, mode="json"),
                        **safe_patch,
                    }
                    updated = _normalize_service_payload(updated_payload, owner_wallet)
                    updated = updated.model_copy(
                        update={
                            "id": svc.id,
                            "service_id": svc.service_id,
                            "created_at": svc.created_at,
                            "owner_address": owner_wallet,
                            "updated_at": now_dt_str(),
                        }
                    )
                    updated = _bind_forwarding_service_id(updated)
                    updated = await service_health_service.probe_service_health(updated)
                    rows[i] = updated
                    self._save_service_registry_rows(rows)
                    service_health_service.sync_service_target_health_table(
                        self.storage, rows
                    )
                    return updated.model_dump(by_alias=True, mode="json")
            return None

    async def delete_service(self, service_record_id: str, owner_wallet: str) -> bool:
        async with self._lock:
            rows = self._load_service_registry_rows()
            original_len = len(rows)
            rows = [
                r
                for r in rows
                if not (
                    r.service_id == service_record_id
                    and r.owner_address == owner_wallet
                )
            ]
            if len(rows) == original_len:
                return False
            self._save_service_registry_rows(rows)
            service_health_service.sync_service_target_health_table(self.storage, rows)
            service_health_service.prune_health_history(self.storage)
            return True

    async def has_owner_service(
        self, service_record_id: str, owner_wallet: str
    ) -> bool:
        await asyncio.sleep(0)
        rows = self._load_service_registry_rows()
        for svc in rows:
            if (
                svc.service_id == service_record_id
                and svc.owner_address == owner_wallet
            ):
                return True
        return False

    async def discover_services(
        self, intent: Optional[str] = None, public_gateway_url: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        await asyncio.sleep(0)
        rows = self._load_service_registry_rows()
        available_services = [
            row for row in rows if service_health_service.is_service_discoverable(row)
        ]

        if intent:
            available_services = [
                svc for svc in available_services if _service_matches_intent(svc, intent)
            ]

        # Filter out sensitive info just in case
        public_services = []
        for svc in available_services:
            public_svc = {
                "serviceId": svc.service_id,
                "serviceName": svc.service_name,
                "pricing": {
                    "amount": str(svc.pricing_amount),
                    "currency": svc.pricing_currency,
                },
                "summary": svc.summary,
                "tags": svc.tags,
                "status": service_health_service.public_discover_status(svc),
                "health": service_health_service.public_health_summary(svc),
                "invoke": _build_public_invoke(svc, public_gateway_url),
            }
            public_services.append(public_svc)

        return public_services

    async def list_owner_services(self, owner_wallet: str) -> List[Dict[str, Any]]:
        await asyncio.sleep(0)
        rows = self._load_service_registry_rows()
        owner_rows: List[Dict[str, Any]] = []
        for svc in rows:
            if svc.owner_address != owner_wallet:
                continue
            enriched = svc.model_dump(by_alias=True, mode="json")
            enriched["pricing"] = {
                "amount": str(svc.pricing_amount),
                "currency": svc.pricing_currency,
            }
            enriched["status"] = service_health_service.public_discover_status(svc)
            enriched["health"] = service_health_service.public_health_summary(svc)
            enriched["runtimeAvailable"] = service_health_service.is_service_discoverable(svc)
            owner_rows.append(enriched)
        return owner_rows

    async def health_status(
        self, intent: Optional[str] = None, include_inactive: bool = False
    ) -> List[Dict[str, Any]]:
        await asyncio.sleep(0)
        rows = self._load_service_registry_rows()
        scoped = []
        for row in rows:
            if not include_inactive and not bool(row.is_active):
                continue
            scoped.append(row)

        if intent:
            scoped = [svc for svc in scoped if _service_matches_intent(svc, intent)]

        return [
            {
                "serviceId": svc.service_id,
                "serviceName": svc.service_name,
                "isActive": bool(svc.is_active),
                "status": str(svc.status or "unknown"),
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
        await asyncio.sleep(0)
        rows = self._load_service_registry_rows()
        service_row = _find_owned_service(rows, service_record_id, owner_wallet)
        if service_row is None:
            raise ValueError("SERVICE_NOT_FOUND_OR_FORBIDDEN")

        history = self._load_service_target_health_history_rows()
        if not isinstance(history, list):
            history = []

        retention_hours, window_hours = _history_window_hours(hours, days)
        cutoff_ms = int(time.time() * 1000) - (window_hours * 60 * 60 * 1000)
        normalized_limit = max(1, min(int(limit_per_target), 2000))
        per_target = _history_entries_by_target(history, service_record_id, cutoff_ms)
        targets = _serialized_history_targets(per_target, normalized_limit)
        return {
            "serviceId": service_record_id,
            "serviceName": service_row.service_name,
            "windowHours": window_hours,
            "retentionHours": retention_hours,
            "windowDays": max(1, int(math.ceil(window_hours / 24))),
            "retentionDays": max(1, int(math.ceil(retention_hours / 24))),
            "limitPerTarget": normalized_limit,
            "targets": targets,
        }
