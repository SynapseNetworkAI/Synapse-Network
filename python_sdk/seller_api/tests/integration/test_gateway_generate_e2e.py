# pyright: reportMissingImports=false

import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from urllib.parse import urlparse

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "seller_api"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src import app as app_module  # noqa: E402
from src.core import config as cfg  # noqa: E402
from src.services import forwarding_service, credential_service  # noqa: E402


async def _noop_indexer(stop_event, storage):
    await asyncio.sleep(0)
    _ = (stop_event, storage)
    return None


def _auth_headers(token: str, address: str):
    return {
        "Authorization": f"Bearer {token}",
        "X-User-Address": address,
        "Content-Type": "application/json",
    }


def _issue_session(client: TestClient):
    _ = client
    return "0x" + "1" * 40, "stub-owner-token"


def _register_service_and_credential(client: TestClient, owner: str, token: str, seller_wallet: str):
    reg_res = client.post(
        "/api/v1/services",
        headers=_auth_headers(token, owner),
        json={
            "serviceName": "Gateway E2E Test Service",
            "pricing": {"currency": "USDC", "amount": "1.0"},
            "summary": "e2e gateway charge test",
            "tags": ["e2e", "billing"],
            "isActive": True,
            "status": "active",
            "address": seller_wallet,
            "healthCheck": {"path": "/health", "method": "GET"},
            "invoke": {
                "method": "POST",
                "targets": [
                    {"url": "http://127.0.0.1:8100/api/v1/quotes/famous", "weight": 100, "region": "local"}
                ],
                "request": {"contentType": "application/json", "schema": {}},
                "response": {"contentType": "application/json", "schema": {}},
            },
        },
    )
    assert reg_res.status_code == 200
    service_id = reg_res.json()["serviceId"]

    cred_res = client.post(
        "/api/v1/credentials/buyer/issue",
        headers=_auth_headers(token, owner),
        json={"name": "e2e-test-key", "rpm": 5000, "maxCalls": 10000},
    )
    assert cred_res.status_code == 200
    credential = cred_res.json()["credential"]
    return service_id, credential["token"]


def _set_buyer_balance(storage, buyer_wallet: str, seller_wallet: str, amount: float):
    ledger = storage.get_collection("balance_ledger") or {}
    if not isinstance(ledger, dict):
        ledger = {}
    buyers = ledger.setdefault("buyers", {})
    sellers = ledger.setdefault("sellers", {})
    platform = ledger.setdefault("platform", {"feeAccrued": 0.0})

    buyers[buyer_wallet] = float(amount)
    sellers.setdefault(seller_wallet, 0.0)
    platform.setdefault("feeAccrued", 0.0)
    ledger["updatedAt"] = 1
    storage.save_collection("balance_ledger", ledger)


def _mock_upstream(monkeypatch):
    async def _fake_upstream(service, prompt, request_id):
        await asyncio.sleep(0)
        _ = (service, prompt, request_id)
        return "mock-response"

    monkeypatch.setattr(forwarding_service, "_call_upstream", _fake_upstream)


def _mock_owner_auth(monkeypatch):
    monkeypatch.setattr(
        credential_service,
        "require_owner_wallet",
        lambda authorization=None, x_user_address=None: str(x_user_address or "0x" + "1" * 40),
    )


def _assert_balance(storage, buyer_wallet: str, seller_wallet: str, buyer_expected: float, seller_expected: float, fee_expected: float):
    ledger = storage.get_collection("balance_ledger") or {}
    buyers = ledger.get("buyers", {}) if isinstance(ledger, dict) else {}
    sellers = ledger.get("sellers", {}) if isinstance(ledger, dict) else {}
    platform = ledger.get("platform", {}) if isinstance(ledger, dict) else {}

    assert abs(float(buyers.get(buyer_wallet, 0.0)) - buyer_expected) < 1e-9
    assert abs(float(sellers.get(seller_wallet, 0.0)) - seller_expected) < 1e-9
    assert abs(float(platform.get("feeAccrued", 0.0)) - fee_expected) < 1e-9


def test_e2e_gateway_charge_by_service_id(monkeypatch):
    _mock_upstream(monkeypatch)
    _mock_owner_auth(monkeypatch)

    with TemporaryDirectory() as tmp:
        old_data_dir = cfg.settings.data_dir
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_fee_rate = cfg.settings.platform_fee_rate
        old_routing_tax = cfg.settings.gateway_routing_tax
        old_indexer = app_module.run_v2_deposit_indexer
        cfg.settings.data_dir = tmp
        cfg.settings.runtime_storage_dir = tmp
        cfg.settings.platform_fee_rate = 0.10
        cfg.settings.gateway_routing_tax = 0.0001
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                buyer_wallet, buyer_token = _issue_session(client)
                seller_wallet = "0x" + "2" * 40
                service_id, credential_token = _register_service_and_credential(client, buyer_wallet, buyer_token, seller_wallet)

                _set_buyer_balance(app.state.storage, buyer_wallet, seller_wallet, 3.0)

                resp = client.post(
                    "/api/v1/gateway/generate",
                    headers={"X-Credential": credential_token},
                    json={"prompt": "hello", "serviceId": service_id},
                )
                assert resp.status_code == 200
                body = resp.json()
                assert body.get("statusCode") == 200
                assert body.get("ok") is True
                payload = body.get("payload", {})
                receipt = payload.get("receipt", {})
                assert payload.get("status") == "success"
                assert payload.get("code") == "DELIVERED"
                assert abs(float(receipt.get("totalCharge", 0.0)) - 1.0001) < 1e-9
                assert abs(float(receipt.get("buyerBalanceAfter", 0.0)) - 1.9999) < 1e-9
                assert abs(float(receipt.get("serviceUnitPrice", 0.0)) - 1.0) < 1e-9
                assert "billing" not in payload
                assert "feeRate" not in receipt
                assert "platformFee" not in receipt
                assert "platformFeeTotal" not in receipt
                assert "sellerNet" not in receipt

                _assert_balance(app.state.storage, buyer_wallet, seller_wallet, 1.9999, 0.9, 0.1001)
        finally:
            cfg.settings.data_dir = old_data_dir
            cfg.settings.runtime_storage_dir = old_runtime_dir
            cfg.settings.platform_fee_rate = old_fee_rate
            cfg.settings.gateway_routing_tax = old_routing_tax
            app_module.run_v2_deposit_indexer = old_indexer


def test_e2e_discover_returns_platform_url_and_gateway_charges(monkeypatch):
    _mock_upstream(monkeypatch)
    _mock_owner_auth(monkeypatch)

    with TemporaryDirectory() as tmp:
        old_data_dir = cfg.settings.data_dir
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_fee_rate = cfg.settings.platform_fee_rate
        old_routing_tax = cfg.settings.gateway_routing_tax
        old_indexer = app_module.run_v2_deposit_indexer
        cfg.settings.data_dir = tmp
        cfg.settings.runtime_storage_dir = tmp
        cfg.settings.platform_fee_rate = 0.10
        cfg.settings.gateway_routing_tax = 0.0001
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                buyer_wallet, buyer_token = _issue_session(client)
                seller_wallet = "0x" + "5" * 40
                service_id, credential_token = _register_service_and_credential(client, buyer_wallet, buyer_token, seller_wallet)

                _set_buyer_balance(app.state.storage, buyer_wallet, seller_wallet, 3.0)

                discover = client.get("/api/v1/services/discover")
                assert discover.status_code == 200
                body = discover.json()
                assert body.get("status") == "success"
                assert body.get("count") == 1

                service = body["services"][0]
                assert service.get("serviceId") == service_id
                target_url = service["invoke"]["targets"][0]["url"]
                assert target_url == "http://testserver/api/v1/gateway/generate"
                assert "8100/api/v1/quotes/famous" not in target_url

                parsed = urlparse(target_url)
                gateway_path = parsed.path

                resp = client.post(
                    gateway_path,
                    headers={"X-Credential": credential_token},
                    json={"prompt": "hello", "serviceId": service_id},
                )
                assert resp.status_code == 200
                _assert_balance(app.state.storage, buyer_wallet, seller_wallet, 1.9999, 0.9, 0.1001)
        finally:
            cfg.settings.data_dir = old_data_dir
            cfg.settings.runtime_storage_dir = old_runtime_dir
            cfg.settings.platform_fee_rate = old_fee_rate
            cfg.settings.gateway_routing_tax = old_routing_tax
            app_module.run_v2_deposit_indexer = old_indexer


def test_e2e_gateway_concurrency_no_overspend(monkeypatch):
    _mock_upstream(monkeypatch)
    _mock_owner_auth(monkeypatch)

    with TemporaryDirectory() as tmp:
        old_data_dir = cfg.settings.data_dir
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_fee_rate = cfg.settings.platform_fee_rate
        old_routing_tax = cfg.settings.gateway_routing_tax
        old_indexer = app_module.run_v2_deposit_indexer
        cfg.settings.data_dir = tmp
        cfg.settings.runtime_storage_dir = tmp
        cfg.settings.platform_fee_rate = 0.10
        cfg.settings.gateway_routing_tax = 0.0001
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                buyer_wallet, buyer_token = _issue_session(client)
                seller_wallet = "0x" + "3" * 40
                service_id, credential_token = _register_service_and_credential(client, buyer_wallet, buyer_token, seller_wallet)

                # Balance supports exactly 20 successful calls at 1.0001 each.
                _set_buyer_balance(app.state.storage, buyer_wallet, seller_wallet, 20.002)

                def _call_once(i: int):
                    return client.post(
                        "/api/v1/gateway/generate",
                        headers={"X-Credential": credential_token},
                        json={"prompt": f"hello-{i}", "serviceId": service_id},
                    )

                total_calls = 80
                with ThreadPoolExecutor(max_workers=20) as executor:
                    responses = list(executor.map(_call_once, range(total_calls)))

                success = sum(1 for r in responses if r.status_code == 200)
                insufficient = sum(
                    1
                    for r in responses
                    if r.status_code == 402 and isinstance(r.json().get("detail"), dict) and r.json()["detail"].get("code") == "INSUFFICIENT_BALANCE"
                )

                assert success == 20
                assert insufficient == total_calls - success

                _assert_balance(app.state.storage, buyer_wallet, seller_wallet, 0.0, 18.0, 2.002)
        finally:
            cfg.settings.data_dir = old_data_dir
            cfg.settings.runtime_storage_dir = old_runtime_dir
            cfg.settings.platform_fee_rate = old_fee_rate
            cfg.settings.gateway_routing_tax = old_routing_tax
            app_module.run_v2_deposit_indexer = old_indexer


def test_e2e_balance_exhausted_does_not_inactivate_credential(monkeypatch):
    _mock_upstream(monkeypatch)
    _mock_owner_auth(monkeypatch)

    with TemporaryDirectory() as tmp:
        old_data_dir = cfg.settings.data_dir
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_fee_rate = cfg.settings.platform_fee_rate
        old_routing_tax = cfg.settings.gateway_routing_tax
        old_indexer = app_module.run_v2_deposit_indexer
        cfg.settings.data_dir = tmp
        cfg.settings.runtime_storage_dir = tmp
        cfg.settings.platform_fee_rate = 0.10
        cfg.settings.gateway_routing_tax = 0.0001
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                buyer_wallet, buyer_token = _issue_session(client)
                seller_wallet = "0x" + "4" * 40
                service_id, credential_token = _register_service_and_credential(client, buyer_wallet, buyer_token, seller_wallet)

                _set_buyer_balance(app.state.storage, buyer_wallet, seller_wallet, 1.0001)

                first = client.post(
                    "/api/v1/gateway/generate",
                    headers={"X-Credential": credential_token},
                    json={"prompt": "first", "serviceId": service_id},
                )
                assert first.status_code == 200

                second = client.post(
                    "/api/v1/gateway/generate",
                    headers={"X-Credential": credential_token},
                    json={"prompt": "second", "serviceId": service_id},
                )
                assert second.status_code == 402
                assert second.json()["detail"]["code"] == "INSUFFICIENT_BALANCE"

                # Credential remains active; only balance was exhausted.
                listed = client.get("/api/v1/credentials/buyer/list", headers=_auth_headers(buyer_token, buyer_wallet))
                assert listed.status_code == 200
                rows = listed.json().get("credentials", [])
                target = next((row for row in rows if row.get("tokenPrefix") == credential_token[:10]), None)
                assert target is not None
                assert target.get("status") == "active"

                # Top up and verify the same credential works again.
                _set_buyer_balance(app.state.storage, buyer_wallet, seller_wallet, 1.0001)
                third = client.post(
                    "/api/v1/gateway/generate",
                    headers={"X-Credential": credential_token},
                    json={"prompt": "third", "serviceId": service_id},
                )
                assert third.status_code == 200
        finally:
            cfg.settings.data_dir = old_data_dir
            cfg.settings.runtime_storage_dir = old_runtime_dir
            cfg.settings.platform_fee_rate = old_fee_rate
            cfg.settings.gateway_routing_tax = old_routing_tax
            app_module.run_v2_deposit_indexer = old_indexer
