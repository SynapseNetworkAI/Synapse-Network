# pyright: reportMissingImports=false

import pytest
from fastapi import HTTPException

from src.services.buyer import forwarding_billing
from src.services.buyer import forwarding_upstream
from src.services.buyer import forwarding_validation


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


@pytest.mark.asyncio
async def test_charge_blocked_when_buyer_is_frozen_and_restricted(temp_storage):
    temp_storage.save_collection(
        "balance_ledger",
        {
            "buyers": {"0xbuyer": 50.0},
            "buyersFrozen": {"0xbuyer": 5.0},
            "buyersLocked": {},
            "sellers": {"0xseller": 0.0},
            "sellersFrozen": {},
            "sellersLocked": {},
            "platform": {"feeAccrued": 0.0},
        },
    )
    temp_storage.save_collection(
        "auth_sessions",
        {
            "0xbuyer": {"status": "restricted", "registered_at": 1, "last_login": 1},
        },
    )

    with pytest.raises(HTTPException) as exc:
        await forwarding_billing.charge_and_mark_usage(
            temp_storage,
            "0xbuyer",
            "0xseller",
            1.0,
            0.1,
            0.9,
            "cred-1",
        )

    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "BUYER_RESTRICTED_RISK_BLOCK"


@pytest.mark.asyncio
async def test_charge_blocked_when_seller_is_frozen_and_restricted(temp_storage):
    temp_storage.save_collection(
        "balance_ledger",
        {
            "buyers": {"0xbuyer": 50.0},
            "buyersFrozen": {},
            "buyersLocked": {},
            "sellers": {"0xseller": 0.0},
            "sellersFrozen": {"0xseller": 2.0},
            "sellersLocked": {},
            "platform": {"feeAccrued": 0.0},
        },
    )
    temp_storage.save_collection(
        "auth_sessions",
        {
            "0xseller": {"status": "restricted", "registered_at": 1, "last_login": 1},
        },
    )

    with pytest.raises(HTTPException) as exc:
        await forwarding_billing.charge_and_mark_usage(
            temp_storage,
            "0xbuyer",
            "0xseller",
            1.0,
            0.1,
            0.9,
            "cred-2",
        )

    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "SELLER_RESTRICTED_RISK_BLOCK"
