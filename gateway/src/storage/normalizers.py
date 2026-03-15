from typing import Any, Dict

from src.core.config import settings


def normalize_service_row(row: Any) -> Any:
    if not isinstance(row, dict):
        return row

    service_name = str(row.get("serviceName") or row.get("name") or "").strip()
    invoke = row.get("invoke") if isinstance(row.get("invoke"), dict) else {}
    targets = invoke.get("targets") if isinstance(invoke.get("targets"), list) else []

    normalized_targets = []
    for item in targets:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        normalized_targets.append(
            {
                "url": url,
                "weight": int(item.get("weight") or 100),
                "region": item.get("region"),
            }
        )

    endpoint = (
        str(normalized_targets[0].get("url") or "").strip()
        if normalized_targets
        else ""
    )
    health_check = (
        row.get("healthCheck") if isinstance(row.get("healthCheck"), dict) else {}
    )
    path = str(health_check.get("path") or "/health").strip() or "/health"
    if not path.startswith("/"):
        path = f"/{path}"

    normalized: Dict[str, Any] = {
        **row,
        "schemaVersion": int(row.get("schemaVersion") or 2),
        "name": service_name,
        "serviceName": service_name,
        "endpoint": endpoint,
        "status": row.get("status")
        or ("active" if row.get("isActive", True) else "inactive"),
        "constraints": row.get("constraints")
        if isinstance(row.get("constraints"), dict)
        else {
            "timeoutMs": settings.gateway_default_timeout_ms,
            "maxResponseBytes": settings.gateway_default_response_bytes,
            "maxRequestBytes": settings.gateway_default_request_bytes,
            "maxQps": settings.gateway_default_service_qps,
        },
        "healthCheck": {
            **health_check,
            "path": path,
            "method": "GET",
            "intervalSec": 30,
            "timeoutMs": settings.gateway_default_timeout_ms,
            "successCodes": [200],
            "healthyThreshold": 2,
            "unhealthyThreshold": 3,
        },
        "invoke": {
            **invoke,
            "url": endpoint,
            "targets": normalized_targets,
        },
    }
    return normalized
