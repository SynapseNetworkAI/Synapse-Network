# pyright: reportMissingImports=false

import pytest
import time

from src.services.registry_service import RegistryService, _normalize_service_payload
from src.services import service_health_service


async def _healthy_probe_stub(service, client=None):
    now_ms = int(time.time() * 1000)
    next_service = dict(service)
    targets = ((service.get("invoke") or {}).get("targets") or [])
    target_map = {}
    for target in targets:
        if not isinstance(target, dict):
            continue
        url = str(target.get("url") or "").strip()
        if not url:
            continue
        target_map[url] = {
            "status": "healthy",
            "lastCheckedAt": now_ms,
            "lastHealthyAt": now_ms,
            "consecutiveSuccesses": 3,
            "consecutiveFailures": 0,
        }
    next_service["serviceHealth"] = {
        "overallStatus": "healthy",
        "healthyTargets": len(target_map),
        "totalTargets": len(target_map),
        "lastCheckedAt": now_ms,
        "targets": target_map,
    }
    return next_service


@pytest.mark.asyncio
async def test_register_service_normalizes_cluster_and_health_path(temp_json_storage):
    original_probe = service_health_service.probe_service_health
    service_health_service.probe_service_health = _healthy_probe_stub
    service = RegistryService(temp_json_storage)

    payload = {
        "serviceName": "Quote Service",
        "pricing": {"currency": "USDC", "amount": "0.01"},
        "healthCheck": {"path": "healthz", "method": "GET"},
        "invoke": {
            "method": "POST",
            "targets": [
                {"url": "http://10.0.0.1:8100/infer", "weight": 100, "region": "sg-1"},
                {"url": "http://10.0.0.2:8100/infer", "weight": 80, "region": "sg-2"},
            ],
            "request": {"contentType": "application/json", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
    }

    try:
        result = await service.register_service(payload, "0xabc")
    finally:
        service_health_service.probe_service_health = original_probe

    assert result["endpoint"] == "http://10.0.0.1:8100/infer"
    assert result["healthCheck"]["path"] == "/healthz"
    assert result["invoke"]["url"] == "http://10.0.0.1:8100/infer"
    assert len(result["invoke"]["targets"]) == 2


@pytest.mark.asyncio
async def test_discover_services_exposes_platform_gateway_not_seller_target(temp_json_storage):
    original_probe = service_health_service.probe_service_health
    service_health_service.probe_service_health = _healthy_probe_stub
    service = RegistryService(temp_json_storage)

    payload = {
        "serviceName": "获取名人名言 Top3",
        "pricing": {"currency": "USDC", "amount": "1"},
        "summary": "输入主题或关键词，返回相关的前三名名人名言。",
        "tags": ["quote", "inspiration", "chinese", "famous"],
        "healthCheck": {"path": "/health", "method": "GET"},
        "invoke": {
            "method": "POST",
            "targets": [
                {"url": "http://127.0.0.1:8100/api/v1/quotes/famous/top3", "weight": 100, "region": None}
            ],
            "timeoutMs": 3000,
            "request": {
                "contentType": "application/json",
                "schema": {"type": "object", "required": ["text"]},
            },
            "response": {"contentType": "application/json", "schema": {}},
        },
    }
    try:
        await service.register_service(payload, "0xabc")
    finally:
        service_health_service.probe_service_health = original_probe

    rows = await service.discover_services(
        intent="名人名言",
        public_gateway_url="http://127.0.0.1:8000/api/v1/gateway/generate",
    )

    assert len(rows) == 1
    invoke = rows[0]["invoke"]
    assert invoke["targets"] == [
        {"url": "http://127.0.0.1:8000/api/v1/gateway/generate", "weight": 100, "region": None}
    ]
    assert "8100/api/v1/quotes/famous/top3" not in invoke["targets"][0]["url"]
    assert rows[0]["status"] == "healthy"
    assert rows[0]["health"]["healthyTargets"] == 1


@pytest.mark.asyncio
async def test_discover_services_filters_out_unhealthy_service(temp_json_storage):
    original_probe = service_health_service.probe_service_health

    async def _unhealthy_probe_stub(service, client=None):
        now_ms = int(time.time() * 1000)
        next_service = dict(service)
        targets = ((service.get("invoke") or {}).get("targets") or [])
        target_map = {
            str(target.get("url")): {
                "status": "unhealthy",
                "lastCheckedAt": now_ms,
                "lastHealthyAt": None,
                "consecutiveSuccesses": 0,
                "consecutiveFailures": 3,
            }
            for target in targets
            if isinstance(target, dict) and str(target.get("url") or "").strip()
        }
        next_service["serviceHealth"] = {
            "overallStatus": "unhealthy",
            "healthyTargets": 0,
            "totalTargets": len(target_map),
            "lastCheckedAt": now_ms,
            "targets": target_map,
        }
        return next_service

    service_health_service.probe_service_health = _unhealthy_probe_stub
    service = RegistryService(temp_json_storage)
    payload = {
        "serviceName": "Unhealthy Quote",
        "pricing": {"currency": "USDC", "amount": "0.01"},
        "summary": "probe should fail",
        "tags": ["quote"],
        "healthCheck": {"path": "/health", "method": "GET"},
        "invoke": {
            "method": "POST",
            "targets": [{"url": "http://127.0.0.1:8100/api/v1/quotes/famous", "weight": 100}],
            "timeoutMs": 3000,
            "request": {"contentType": "application/json", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
    }

    try:
        await service.register_service(payload, "0xabc")
    finally:
        service_health_service.probe_service_health = original_probe

    rows = await service.discover_services(intent="quote", public_gateway_url="http://127.0.0.1:8000/api/v1/gateway/generate")
    assert rows == []


@pytest.mark.asyncio
async def test_service_health_history_returns_latest_n_per_target(temp_json_storage):
    original_probe = service_health_service.probe_service_health
    service_health_service.probe_service_health = _healthy_probe_stub
    service = RegistryService(temp_json_storage)

    payload = {
        "serviceName": "History Service",
        "pricing": {"currency": "USDC", "amount": "0.01"},
        "summary": "history query",
        "tags": ["history"],
        "healthCheck": {"path": "/health", "method": "GET"},
        "invoke": {
            "method": "POST",
            "targets": [
                {"url": "http://127.0.0.1:8100/api/v1/run", "weight": 100},
                {"url": "http://127.0.0.1:8101/api/v1/run", "weight": 80},
            ],
            "timeoutMs": 3000,
            "request": {"contentType": "application/json", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
    }

    try:
        created = await service.register_service(payload, "0xabc")
    finally:
        service_health_service.probe_service_health = original_probe

    service_id = str(created["serviceId"])
    now_ms = int(time.time() * 1000)
    temp_json_storage.save_collection(
        "service_target_health_history",
        [
            {"serviceId": service_id, "targetUrl": "http://127.0.0.1:8100/api/v1/run", "status": "healthy", "checkedAt": now_ms - 2000},
            {"serviceId": service_id, "targetUrl": "http://127.0.0.1:8100/api/v1/run", "status": "degraded", "checkedAt": now_ms - 1000},
            {"serviceId": service_id, "targetUrl": "http://127.0.0.1:8101/api/v1/run", "status": "healthy", "checkedAt": now_ms - 1500},
            {"serviceId": "other", "targetUrl": "http://other", "status": "healthy", "checkedAt": now_ms - 500},
        ],
    )

    history = await service.service_health_history(
        service_record_id=service_id,
        owner_wallet="0xabc",
        limit_per_target=1,
        days=7,
    )

    assert history["serviceId"] == service_id
    assert len(history["targets"]) == 2
    first_target = next(item for item in history["targets"] if item["targetUrl"] == "http://127.0.0.1:8100/api/v1/run")
    assert len(first_target["history"]) == 1
    assert first_target["history"][0]["checkedAt"] == now_ms - 1000


def test_normalize_service_payload_requires_invoke_targets():
    payload = {
        "serviceName": "Invalid",
        "pricing": {"currency": "USDC", "amount": "0.01"},
        "healthCheck": {"path": "/health", "method": "GET"},
        "invoke": {
            "method": "POST",
            "targets": [],
            "request": {"contentType": "application/json", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
    }

    with pytest.raises(ValueError) as exc:
        _normalize_service_payload(payload, "0xabc")

    assert "invoke.targets" in str(exc.value)


def test_normalize_service_payload_requires_health_path():
    payload = {
        "serviceName": "Invalid",
        "pricing": {"currency": "USDC", "amount": "0.01"},
        "healthCheck": {"path": "", "method": "GET"},
        "invoke": {
            "method": "POST",
            "targets": [{"url": "http://10.0.0.1:8100/infer", "weight": 100}],
            "request": {"contentType": "application/json", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
    }

    with pytest.raises(ValueError) as exc:
        _normalize_service_payload(payload, "0xabc")

    assert "healthCheck.path" in str(exc.value)


def test_normalize_service_payload_rejects_over_limit_constraints(monkeypatch):
    monkeypatch.setattr("src.services.registry_service.settings.gateway_max_timeout_ms", 15000)
    monkeypatch.setattr("src.services.registry_service.settings.gateway_min_timeout_ms", 300)
    monkeypatch.setattr("src.services.registry_service.settings.gateway_min_request_bytes", 256)
    monkeypatch.setattr("src.services.registry_service.settings.gateway_max_request_bytes", 262144)
    monkeypatch.setattr("src.services.registry_service.settings.gateway_min_response_bytes", 256)
    monkeypatch.setattr("src.services.registry_service.settings.gateway_max_response_bytes", 1048576)
    monkeypatch.setattr("src.services.registry_service.settings.gateway_min_service_qps", 1)
    monkeypatch.setattr("src.services.registry_service.settings.gateway_max_service_qps", 200)

    payload = {
        "serviceName": "Invalid Limits",
        "pricing": {"currency": "USDC", "amount": "0.01"},
        "healthCheck": {"path": "/health", "method": "GET"},
        "constraints": {
            "timeoutMs": 60000,
            "maxRequestBytes": 4096,
            "maxResponseBytes": 4096,
            "maxQps": 50,
        },
        "invoke": {
            "method": "POST",
            "targets": [{"url": "http://10.0.0.1:8100/infer", "weight": 100}],
            "request": {"contentType": "application/json", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
    }

    with pytest.raises(ValueError) as exc:
        _normalize_service_payload(payload, "0xabc")

    assert "constraints.timeoutMs" in str(exc.value)


def test_normalize_service_payload_rejects_non_post_method():
    payload = {
        "serviceName": "Invalid Method",
        "pricing": {"currency": "USDC", "amount": "0.01"},
        "healthCheck": {"path": "/health", "method": "GET"},
        "invoke": {
            "method": "GET",
            "targets": [{"url": "http://10.0.0.1:8100/infer", "weight": 100}],
            "request": {"contentType": "application/json", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
    }

    with pytest.raises(ValueError) as exc:
        _normalize_service_payload(payload, "0xabc")

    assert "invoke.method" in str(exc.value)


def test_normalize_service_payload_rejects_non_json_content_type():
    payload = {
        "serviceName": "Invalid ContentType",
        "pricing": {"currency": "USDC", "amount": "0.01"},
        "healthCheck": {"path": "/health", "method": "GET"},
        "invoke": {
            "method": "POST",
            "targets": [{"url": "http://10.0.0.1:8100/infer", "weight": 100}],
            "request": {"contentType": "application/x-www-form-urlencoded", "schema": {}},
            "response": {"contentType": "application/json", "schema": {}},
        },
    }

    with pytest.raises(ValueError) as exc:
        _normalize_service_payload(payload, "0xabc")

    assert "invoke.request.contentType" in str(exc.value)
