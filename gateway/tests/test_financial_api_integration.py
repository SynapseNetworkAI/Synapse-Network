# pyright: reportMissingImports=false

from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import asyncio
from copy import deepcopy

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "gateway"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src import app as app_module  # noqa: E402
from src.api.routers import balance as balance_router  # noqa: E402
from src.core import config as cfg  # noqa: E402
from src.services.platform import v2_indexer as v2_indexer_service  # noqa: E402
from conftest import InMemoryStorage  # noqa: E402


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


def _use_inmemory_storage(monkeypatch):
    monkeypatch.setattr(app_module, "create_storage", lambda _settings: InMemoryStorage())


def _seed_buyer_balance(app, owner: str, amount: float) -> None:
    storage = app.state.storage
    ledger = storage.get_collection("balance_ledger") or {}
    if not isinstance(ledger, dict):
        ledger = {}
    buyers = ledger.get("buyers") if isinstance(ledger.get("buyers"), dict) else {}
    buyers_locked = ledger.get("buyersLocked") if isinstance(ledger.get("buyersLocked"), dict) else {}
    buyers[str(owner).lower()] = round(float(amount), 6)
    ledger["buyers"] = buyers
    ledger["buyersLocked"] = buyers_locked
    storage.save_collection("balance_ledger", ledger)


def _seed_refundable_usage(app, owner: str, origin_request_id: str, total_charge: float) -> None:
    storage = app.state.storage
    rows = storage.get_collection("usage_log")
    usage_rows = [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []
    usage_rows.append(
        {
            "id": f"usage-{origin_request_id}",
            "buyer": str(owner).lower(),
            "seller": "0xseller",
            "status": "succeeded",
            "totalCharge": round(float(total_charge), 6),
            "originRequestId": origin_request_id,
            "timestamp": 1700000000,
        }
    )
    storage.save_collection("usage_log", usage_rows)


def _issue_session(client: TestClient):
    acct = Account.create()
    address = acct.address.lower()

    challenge_res = client.get(f"/api/v1/auth/challenge?address={address}")
    assert challenge_res.status_code == 200
    challenge = challenge_res.json()["challenge"]

    signable = encode_defunct(text=challenge)
    signature = Account.sign_message(signable, acct.key).signature.hex()

    verify_res = client.post(
        "/api/v1/auth/verify",
        json={
            "wallet_address": address,
            "signature": signature,
            "message": challenge,
        },
    )
    assert verify_res.status_code == 200
    token = verify_res.json()["access_token"]
    return address, token


def test_financial_api_auth_and_idempotency_flow(monkeypatch):
    _use_inmemory_storage(monkeypatch)
    with TemporaryDirectory() as tmp:
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_indexer = app_module.run_v2_deposit_indexer
        cfg.settings.runtime_storage_dir = tmp
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                owner, token = _issue_session(client)
                _seed_buyer_balance(app, owner, 200)
                _seed_refundable_usage(app, owner, "req-api-idem-1", 50)

                # refund minimum amount must be >= 10
                bad = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token, owner), "X-Idempotency-Key": "k_refund_min_123456"},
                    json={"amountUsdc": 9.9, "reason": "too-small", "originRequestId": "req-api-idem-1"},
                )
                assert bad.status_code in (400, 422)

                ok = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token, owner), "X-Idempotency-Key": "k_refund_ok_123456"},
                    json={"amountUsdc": 10, "reason": "ok", "originRequestId": "req-api-idem-1"},
                )
                assert ok.status_code == 200
                first = ok.json()

                replay = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token, owner), "X-Idempotency-Key": "k_refund_ok_123456"},
                    json={"amountUsdc": 10, "reason": "ok", "originRequestId": "req-api-idem-1"},
                )
                assert replay.status_code == 200
                second = replay.json()
                assert first["refundId"] == second["refundId"]

                mismatch = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token, owner), "X-Idempotency-Key": "k_refund_ok_123456"},
                    json={"amountUsdc": 11, "reason": "mismatch", "originRequestId": "req-api-idem-1"},
                )
                assert mismatch.status_code == 409
        finally:
            cfg.settings.runtime_storage_dir = old_runtime_dir
            app_module.run_v2_deposit_indexer = old_indexer


def test_owner_isolation_and_router_limit_range(monkeypatch):
    _use_inmemory_storage(monkeypatch)
    with TemporaryDirectory() as tmp:
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_indexer = app_module.run_v2_deposit_indexer
        cfg.settings.runtime_storage_dir = tmp
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                owner1, token1 = _issue_session(client)
                owner2, token2 = _issue_session(client)
                _seed_buyer_balance(app, owner1, 200)
                _seed_buyer_balance(app, owner2, 200)
                _seed_refundable_usage(app, owner1, "req-owner1-api", 50)
                _seed_refundable_usage(app, owner2, "req-owner2-api", 50)

                # Create refund for owner1
                create_refund = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token1, owner1), "X-Idempotency-Key": "k_owner1_refund_12345"},
                    json={"amountUsdc": 20, "reason": "owner1", "originRequestId": "req-owner1-api"},
                )
                assert create_refund.status_code == 200

                # owner2 should not see owner1 refunds
                list_owner2 = client.get("/api/v1/refunds", headers=_auth_headers(token2, owner2))
                assert list_owner2.status_code == 200
                assert list_owner2.json().get("refunds") == []

                # Router limit range check [0, 10000]
                invalid_router = client.post(
                    "/api/v1/router/config",
                    headers=_auth_headers(token1, owner1),
                    json={"dailyLimitUsdc": 20000},
                )
                assert invalid_router.status_code in (400, 422)

                valid_router = client.post(
                    "/api/v1/router/config",
                    headers=_auth_headers(token1, owner1),
                    json={"dailyLimitUsdc": 10000},
                )
                assert valid_router.status_code == 200
        finally:
            cfg.settings.runtime_storage_dir = old_runtime_dir
            app_module.run_v2_deposit_indexer = old_indexer


def test_auth_logout_marks_session_inactive(monkeypatch):
    _use_inmemory_storage(monkeypatch)
    with TemporaryDirectory() as tmp:
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_indexer = app_module.run_v2_deposit_indexer
        cfg.settings.runtime_storage_dir = tmp
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                owner, token = _issue_session(client)

                response = client.post("/api/v1/auth/logout", headers=_auth_headers(token, owner))
                assert response.status_code == 200
                assert response.json().get("success") is True

                sessions = app.state.storage.get_collection("auth_sessions")
                assert isinstance(sessions, dict)
                assert sessions.get(owner, {}).get("status") == "inactive"
        finally:
            cfg.settings.runtime_storage_dir = old_runtime_dir
            app_module.run_v2_deposit_indexer = old_indexer


def test_admin_deposit_replay_api(monkeypatch):
    _use_inmemory_storage(monkeypatch)
    with TemporaryDirectory() as tmp:
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_indexer = app_module.run_v2_deposit_indexer
        old_admin_wallets = set(cfg.settings.platform_fee_admin_wallets)
        cfg.settings.runtime_storage_dir = tmp
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                owner, token = _issue_session(client)
                cfg.settings.platform_fee_admin_wallets = {owner}

                def _fake_replay(storage, tx_hash, requested_by):
                    _ = storage
                    return {
                        "txHash": tx_hash,
                        "events": 1,
                        "intentsCreated": 1,
                        "credited": 1,
                        "failed": 0,
                        "pending": 0,
                        "requestedBy": requested_by,
                    }

                monkeypatch.setattr(balance_router, "replay_deposit_tx", _fake_replay)

                response = client.post(
                    "/api/v1/admin/deposits/replay",
                    headers=_auth_headers(token, owner),
                    json={"txHash": "0x" + "1" * 64},
                )
                assert response.status_code == 200
                payload = response.json()
                assert payload.get("status") == "success"
                assert payload.get("requestedBy") == owner
                assert payload.get("replay", {}).get("credited") == 1
        finally:
            cfg.settings.platform_fee_admin_wallets = old_admin_wallets
            cfg.settings.runtime_storage_dir = old_runtime_dir
            app_module.run_v2_deposit_indexer = old_indexer


def test_admin_refund_complete_api(monkeypatch):
    _use_inmemory_storage(monkeypatch)
    with TemporaryDirectory() as tmp:
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_indexer = app_module.run_v2_deposit_indexer
        old_admin_wallets = set(cfg.settings.platform_fee_admin_wallets)
        cfg.settings.runtime_storage_dir = tmp
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                owner, token = _issue_session(client)
                cfg.settings.platform_fee_admin_wallets = {owner}

                async def _fake_complete_refund(self, owner_wallet, refund_id, tx_hash, request_meta=None):
                    await asyncio.sleep(0)
                    _ = self
                    assert owner_wallet == "0xbuyerrefund"
                    assert refund_id == "ref_123"
                    assert request_meta is not None
                    assert request_meta.get("review", {}).get("requestedBy") == owner
                    return {"refundId": refund_id, "status": "COMPLETED", "txHash": tx_hash}

                monkeypatch.setattr(balance_router.BalanceService, "complete_refund_intent", _fake_complete_refund)

                response = client.post(
                    "/api/v1/admin/refunds/ref_123/complete",
                    headers=_auth_headers(token, owner),
                    json={
                        "ownerAddress": "0xbuyerrefund",
                        "txHash": "0x" + "2" * 64,
                        "reviewDecision": "APPROVE",
                    },
                )
                assert response.status_code == 200
                payload = response.json()
                assert payload.get("status") == "success"
                assert payload.get("requestedBy") == owner
                assert payload.get("ownerAddress") == "0xbuyerrefund"
                assert payload.get("refundId") == "ref_123"
        finally:
            cfg.settings.platform_fee_admin_wallets = old_admin_wallets
            cfg.settings.runtime_storage_dir = old_runtime_dir
            app_module.run_v2_deposit_indexer = old_indexer


def test_admin_provider_withdraw_complete_api(monkeypatch):
    _use_inmemory_storage(monkeypatch)
    with TemporaryDirectory() as tmp:
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_indexer = app_module.run_v2_deposit_indexer
        old_admin_wallets = set(cfg.settings.platform_fee_admin_wallets)
        cfg.settings.runtime_storage_dir = tmp
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                owner, token = _issue_session(client)
                cfg.settings.platform_fee_admin_wallets = {owner}

                async def _fake_complete_withdraw(self, owner_wallet, withdrawal_id, tx_hash, request_meta=None):
                    await asyncio.sleep(0)
                    _ = self
                    assert owner_wallet == "0xsellerwithdraw"
                    assert withdrawal_id == "wd_123"
                    assert request_meta is not None
                    assert request_meta.get("adminExecution", {}).get("requestedBy") == owner
                    return {"withdrawalId": withdrawal_id, "status": "COMPLETED", "txHash": tx_hash}

                monkeypatch.setattr(balance_router.BalanceService, "complete_provider_withdrawal", _fake_complete_withdraw)

                response = client.post(
                    "/api/v1/admin/providers/withdrawals/wd_123/complete",
                    headers=_auth_headers(token, owner),
                    json={
                        "ownerAddress": "0xsellerwithdraw",
                        "txHash": "0x" + "3" * 64,
                    },
                )
                assert response.status_code == 200
                payload = response.json()
                assert payload.get("status") == "success"
                assert payload.get("requestedBy") == owner
                assert payload.get("ownerAddress") == "0xsellerwithdraw"
                assert payload.get("withdrawalId") == "wd_123"
        finally:
            cfg.settings.platform_fee_admin_wallets = old_admin_wallets
            cfg.settings.runtime_storage_dir = old_runtime_dir
            app_module.run_v2_deposit_indexer = old_indexer


def test_indexer_status_requires_admin_and_sanitizes_errors(monkeypatch):
    _use_inmemory_storage(monkeypatch)
    with TemporaryDirectory() as tmp:
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_indexer = app_module.run_v2_deposit_indexer
        old_indexer_admin_wallets = set(cfg.settings.indexer_admin_wallets)
        old_platform_fee_admin_wallets = set(cfg.settings.platform_fee_admin_wallets)
        old_status = deepcopy(v2_indexer_service.INDEXER_STATUS)
        cfg.settings.runtime_storage_dir = tmp
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                owner, token = _issue_session(client)
                other_owner, _other_token = _issue_session(client)

                cfg.settings.indexer_admin_wallets = {other_owner}
                cfg.settings.platform_fee_admin_wallets = set()

                forbidden = client.get("/api/v1/indexer/status", headers=_auth_headers(token, owner))
                assert forbidden.status_code == 403
                assert forbidden.json()["detail"]["code"] == "FORBIDDEN"

                cfg.settings.indexer_admin_wallets = {owner}
                v2_indexer_service.INDEXER_STATUS["lastError"] = "relation \"synapse_collections\" does not exist"
                v2_indexer_service.INDEXER_STATUS["backfill"]["lastError"] = "stacktrace leaked"
                v2_indexer_service.INDEXER_STATUS["reconciliation"]["lastError"] = "trace leaked"

                ok = client.get("/api/v1/indexer/status", headers=_auth_headers(token, owner))
                assert ok.status_code == 200
                indexer = ok.json()["indexer"]
                assert indexer["lastError"] == "INDEXER_LOOP_FAILED"
                assert indexer["backfill"]["lastError"] == "INDEXER_BACKFILL_SCAN_FAILED"
                assert indexer["reconciliation"]["lastError"] == "INDEXER_RECONCILIATION_FAILED"
        finally:
            cfg.settings.indexer_admin_wallets = old_indexer_admin_wallets
            cfg.settings.platform_fee_admin_wallets = old_platform_fee_admin_wallets
            cfg.settings.runtime_storage_dir = old_runtime_dir
            app_module.run_v2_deposit_indexer = old_indexer
            v2_indexer_service.INDEXER_STATUS.clear()
            v2_indexer_service.INDEXER_STATUS.update(old_status)
