# pyright: reportMissingImports=false

import pytest

from src.services.registry_service import RegistryService, _normalize_service_payload


@pytest.mark.asyncio
async def test_register_service_normalizes_cluster_and_health_path(temp_json_storage):
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

    result = await service.register_service(payload, "0xabc")

    assert result["endpoint"] == "http://10.0.0.1:8100/infer"
    assert result["healthCheck"]["path"] == "/healthz"
    assert result["invoke"]["url"] == "http://10.0.0.1:8100/infer"
    assert len(result["invoke"]["targets"]) == 2


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
