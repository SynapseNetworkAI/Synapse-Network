# pyright: reportMissingImports=false

import pytest
from fastapi import HTTPException

from src.services import forwarding_billing
from src.services import forwarding_upstream
from src.services import forwarding_validation


def test_validation_contract_reports_missing_required_fields_with_service_context():
    service = {
        "serviceId": "SVC_TEST_SPLIT",
        "invoke": {
            "method": "POST",
            "request": {
                "contentType": "application/json",
                "schema": {
                    "required": ["text", "topic"],
                },
            },
        },
    }

    with pytest.raises(HTTPException) as exc:
        forwarding_validation.validate_invoke_request_contract(service, {"text": "hello"})

    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "REQUEST_REQUIRED_FIELDS_MISSING"
    assert exc.value.detail["serviceId"] == "SVC_TEST_SPLIT"
    assert exc.value.detail["missingFields"] == ["topic"]


def test_upstream_target_normalization_rejects_non_integer_weight():
    invoke = {
        "targets": [
            {"url": "http://127.0.0.1:8100/mock", "weight": "bad"},
        ]
    }

    with pytest.raises(HTTPException) as exc:
        forwarding_upstream.normalized_weighted_targets(invoke)

    assert exc.value.status_code == 500
    assert exc.value.detail["code"] == "INVALID_INVOKE_CONFIG"


def test_upstream_target_selection_rejects_when_no_healthy_targets():
    invoke = {
        "targets": [
            {"url": "http://127.0.0.1:8100/mock", "weight": 100},
        ]
    }

    with pytest.raises(HTTPException) as exc:
        forwarding_upstream.select_weighted_target_url(
            invoke,
            allowed_target_urls={"http://127.0.0.1:8101/mock"},
        )

    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "SERVICE_UNAVAILABLE"


def test_billing_receipt_keeps_public_fields_only():
    receipt = forwarding_billing.build_buyer_receipt(
        request_id="req-split-1",
        service_id="svc-split-1",
        unit_price=1.0,
        total_charge=1.0001,
        buyer_balance_after=8.9999,
    )

    assert receipt == {
        "requestId": "req-split-1",
        "serviceId": "svc-split-1",
        "totalCharge": 1.0001,
        "buyerBalanceAfter": 8.9999,
        "serviceUnitPrice": 1.0,
    }
