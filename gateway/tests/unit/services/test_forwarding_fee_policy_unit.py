# pyright: reportMissingImports=false

import asyncio
import pytest
from fastapi import HTTPException

from src.services.buyer import forwarding_service
from src.services.platform import credential_service


def test_pricing_breakdown_uses_global_setting(monkeypatch, temp_storage):
    monkeypatch.setattr(forwarding_service.settings, "platform_fee_rate", 0.10)
    monkeypatch.setattr(forwarding_service.settings, "gateway_routing_tax", 0.0001)

    fee_rate, protocol_fee, routing_tax, platform_fee_total, seller_net, total_charge = forwarding_service._pricing_breakdown(
        temp_storage,
        "0xabc",
        1.0,
    )

    assert abs(fee_rate - 0.10) < 1e-9
    assert abs(protocol_fee - 0.10) < 1e-9
    assert abs(routing_tax - 0.0001) < 1e-9
    assert abs(platform_fee_total - 0.1001) < 1e-9
    assert abs(seller_net - 0.90) < 1e-9
    assert abs(total_charge - 1.0001) < 1e-9


def test_pricing_breakdown_owner_override_takes_priority(monkeypatch, temp_storage):
    monkeypatch.setattr(forwarding_service.settings, "platform_fee_rate", 0.10)
    monkeypatch.setattr(forwarding_service.settings, "gateway_routing_tax", 0.0001)
    temp_storage.save_collection(
        "platform_fee_policy",
        {
            "defaultRate": 0.08,
            "ownerRates": {
                "0xd856907d7e35a8f9bd225859a59e58577147a092": 0.03,
            },
        },
    )

    fee_rate, protocol_fee, routing_tax, platform_fee_total, seller_net, total_charge = forwarding_service._pricing_breakdown(
        temp_storage,
        "0xD856907D7E35A8F9BD225859A59E58577147A092",
        2.0,
    )

    assert abs(fee_rate - 0.03) < 1e-9
    assert abs(protocol_fee - 0.06) < 1e-9
    assert abs(routing_tax - 0.0001) < 1e-9
    assert abs(platform_fee_total - 0.0601) < 1e-9
    assert abs(seller_net - 1.94) < 1e-9
    assert abs(total_charge - 2.0001) < 1e-9


def test_pricing_breakdown_falls_back_to_runtime_default_rate(monkeypatch, temp_storage):
    monkeypatch.setattr(forwarding_service.settings, "platform_fee_rate", 0.15)
    monkeypatch.setattr(forwarding_service.settings, "gateway_routing_tax", 0.0001)
    temp_storage.save_collection(
        "platform_fee_policy",
        {
            "ownerRates": {},
        },
    )

    fee_rate, protocol_fee, routing_tax, platform_fee_total, seller_net, total_charge = forwarding_service._pricing_breakdown(
        temp_storage,
        "0xabc",
        2.0,
    )

    assert abs(fee_rate - 0.15) < 1e-9
    assert abs(protocol_fee - 0.30) < 1e-9
    assert abs(routing_tax - 0.0001) < 1e-9
    assert abs(platform_fee_total - 0.3001) < 1e-9
    assert abs(seller_net - 1.70) < 1e-9
    assert abs(total_charge - 2.0001) < 1e-9


def test_pricing_breakdown_invalid_rate_is_clamped(monkeypatch, temp_storage):
    monkeypatch.setattr(forwarding_service.settings, "platform_fee_rate", 0.10)
    monkeypatch.setattr(forwarding_service.settings, "gateway_routing_tax", 0.0001)
    temp_storage.save_collection(
        "platform_fee_policy",
        {
            "defaultRate": 1.8,
            "ownerRates": {
                "0xabc": -0.2,
            },
        },
    )

    fee_rate, protocol_fee, routing_tax, platform_fee_total, seller_net, total_charge = forwarding_service._pricing_breakdown(
        temp_storage,
        "0xabc",
        1.0,
    )

    assert abs(fee_rate - 0.0) < 1e-9
    assert abs(protocol_fee - 0.0) < 1e-9
    assert abs(routing_tax - 0.0001) < 1e-9
    assert abs(platform_fee_total - 0.0001) < 1e-9
    assert abs(seller_net - 1.0) < 1e-9
    assert abs(total_charge - 1.0001) < 1e-9


def test_build_buyer_receipt_exposes_only_buyer_cost_fields():
    receipt = forwarding_service._build_buyer_receipt(
        request_id="req-1",
        service_id="svc-1",
        unit_price=1.0,
        total_charge=1.0001,
        buyer_balance_after=9.9999,
    )

    assert receipt == {
        "requestId": "req-1",
        "serviceId": "svc-1",
        "totalCharge": 1.0001,
        "buyerBalanceAfter": 9.9999,
        "serviceUnitPrice": 1.0,
    }


def test_build_buyer_success_response_does_not_leak_settlement_fields():
    receipt = forwarding_service._build_buyer_receipt(
        request_id="req-2",
        service_id="svc-2",
        unit_price=2.0,
        total_charge=2.0001,
        buyer_balance_after=7.9999,
    )
    response = forwarding_service._build_buyer_success_response(receipt, {"hello": "world"})

    assert response["statusCode"] == 200
    assert response["ok"] is True
    payload = response["payload"]
    assert payload["status"] == "success"
    assert payload["code"] == "DELIVERED"
    assert abs(float(payload["receipt"]["totalCharge"]) - 2.0001) < 1e-9
    assert payload["data"]["result"] == {"hello": "world"}

    assert "billing" not in payload
    assert "feeRate" not in payload["receipt"]
    assert "platformFee" not in payload["receipt"]
    assert "platformFeeTotal" not in payload["receipt"]
    assert "sellerNet" not in payload["receipt"]


def test_validate_prompt_rejects_blank():
    with pytest.raises(HTTPException) as exc:
        forwarding_service._validate_prompt("   ")
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "PROMPT_REQUIRED"


def test_validate_prompt_rejects_too_long():
    with pytest.raises(HTTPException) as exc:
        forwarding_service._validate_prompt("a" * 8001)
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "PROMPT_TOO_LONG"


def test_validate_service_id_rejects_invalid_characters():
    with pytest.raises(HTTPException) as exc:
        forwarding_service._validate_service_id(None, "svc bad")
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "SERVICE_ID_INVALID_FORMAT"


def test_validate_credential_token_rejects_invalid_format():
    with pytest.raises(HTTPException) as exc:
        forwarding_service._validate_credential_token("bad-token")
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "CREDENTIAL_FORMAT_INVALID"


def test_resolve_request_id_uses_client_value_when_valid():
    request_id = forwarding_service._resolve_request_id("buyer-req-001")
    assert request_id == "buyer-req-001"


def test_resolve_request_id_rejects_invalid_format():
    with pytest.raises(HTTPException) as exc:
        forwarding_service._resolve_request_id("invalid request id")
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "INVALID_REQUEST_ID"


def test_effective_service_constraints_clamps_to_platform_caps(monkeypatch):
    monkeypatch.setattr(forwarding_service.settings, "gateway_min_timeout_ms", 300)
    monkeypatch.setattr(forwarding_service.settings, "gateway_max_timeout_ms", 15000)
    monkeypatch.setattr(forwarding_service.settings, "gateway_min_request_bytes", 256)
    monkeypatch.setattr(forwarding_service.settings, "gateway_max_request_bytes", 262144)
    monkeypatch.setattr(forwarding_service.settings, "gateway_min_response_bytes", 256)
    monkeypatch.setattr(forwarding_service.settings, "gateway_max_response_bytes", 1048576)
    monkeypatch.setattr(forwarding_service.settings, "gateway_min_service_qps", 1)
    monkeypatch.setattr(forwarding_service.settings, "gateway_max_service_qps", 200)

    result = forwarding_service._effective_service_constraints(
        {
            "constraints": {
                "timeoutMs": 999999,
                "maxRequestBytes": 1,
                "maxResponseBytes": 99999999,
                "maxQps": 0,
            }
        }
    )

    assert result["timeoutMs"] == 15000
    assert result["maxRequestBytes"] == 256
    assert result["maxResponseBytes"] == 1048576
    assert result["maxQps"] == 1


@pytest.mark.asyncio
async def test_call_upstream_rejects_oversized_request_before_network(monkeypatch):
    service = {
        "constraints": {
            "timeoutMs": 3000,
            "maxRequestBytes": 32,
            "maxResponseBytes": 2048,
            "maxQps": 5,
        },
        "invoke": {
            "method": "POST",
            "targets": [{"url": "http://127.0.0.1:8100/mock", "weight": 100}],
        },
    }

    with pytest.raises(HTTPException) as exc:
        await forwarding_service._call_upstream(service, "x" * 4000, "req-oversized")

    assert exc.value.status_code == 413
    assert exc.value.detail["code"] == "REQUEST_PAYLOAD_TOO_LARGE"


@pytest.mark.asyncio
async def test_service_qps_limit_enforced_in_memory(monkeypatch):
    forwarding_service._memory_window_counters.clear()

    async def _redis_none():
        await asyncio.sleep(0)
        return None

    monkeypatch.setattr(forwarding_service, "_get_redis_client", _redis_none)
    monkeypatch.setattr(credential_service, "now_ts", lambda: 100)

    await forwarding_service._check_service_qps_limit("svc-demo", 1)
    with pytest.raises(HTTPException) as exc:
        await forwarding_service._check_service_qps_limit("svc-demo", 1)

    assert exc.value.status_code == 429
    assert exc.value.detail["code"] == "SERVICE_QPS_EXCEEDED"


def test_select_weighted_target_url_uses_registered_weights(monkeypatch):
    captured: dict[str, object] = {}

    def _fake_choices(population, weights=None, k=1):
        captured["population"] = population
        captured["weights"] = weights
        captured["k"] = k
        return [population[1]]

    monkeypatch.setattr(forwarding_service.random, "choices", _fake_choices)
    invoke = {
        "targets": [
            {"url": "http://127.0.0.1:8100/a", "weight": 100, "region": "ap-sg-1"},
            {"url": "http://127.0.0.1:8101/a", "weight": 80, "region": "ap-sg-2"},
        ]
    }

    selected = forwarding_service._select_weighted_target_url(invoke)

    assert selected == "http://127.0.0.1:8101/a"
    assert captured["weights"] == [100, 80]
    assert captured["k"] == 1


def test_select_weighted_target_url_rejects_non_positive_weight():
    invoke = {
        "targets": [
            {"url": "http://127.0.0.1:8100/a", "weight": 0},
        ]
    }

    with pytest.raises(HTTPException) as exc:
        forwarding_service._select_weighted_target_url(invoke)

    assert exc.value.status_code == 500
    assert exc.value.detail["code"] == "INVALID_INVOKE_CONFIG"


def test_validate_invoke_request_contract_missing_required_fields():
    service = {
        "serviceId": "SVC_TEST_REQUIRED",
        "invoke": {
            "method": "POST",
            "request": {
                "contentType": "application/json",
                "schema": {
                    "type": "object",
                    "required": ["text", "topic"],
                },
            },
        },
    }

    with pytest.raises(HTTPException) as exc:
        forwarding_service._validate_invoke_request_contract(service, {"text": "hello"})

    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "REQUEST_REQUIRED_FIELDS_MISSING"
    assert exc.value.detail["serviceId"] == "SVC_TEST_REQUIRED"
    assert exc.value.detail["missingFields"] == ["topic"]


def test_validate_invoke_request_contract_rejects_non_json_content_type():
    service = {
        "serviceId": "SVC_TEST_CONTENT_TYPE",
        "invoke": {
            "method": "POST",
            "request": {
                "contentType": "application/x-www-form-urlencoded",
                "schema": {"type": "object", "required": ["text"]},
            },
        },
    }

    with pytest.raises(HTTPException) as exc:
        forwarding_service._validate_invoke_request_contract(service, {"text": "hello"})

    assert exc.value.status_code == 500
    assert exc.value.detail["code"] == "INVALID_INVOKE_CONFIG"
