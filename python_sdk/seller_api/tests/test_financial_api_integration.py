# pyright: reportMissingImports=false

from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import asyncio

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "seller_api"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src import app as app_module  # noqa: E402
from src.core import config as cfg  # noqa: E402


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


def test_financial_api_auth_and_idempotency_flow():
    with TemporaryDirectory() as tmp:
        old_data_dir = cfg.settings.data_dir
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_indexer = app_module.run_v2_deposit_indexer
        cfg.settings.data_dir = tmp
        cfg.settings.runtime_storage_dir = tmp
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                owner, token = _issue_session(client)

                # refund minimum amount must be >= 10
                bad = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token, owner), "X-Idempotency-Key": "k_refund_min_123456"},
                    json={"amountUsdc": 9.9, "reason": "too-small"},
                )
                assert bad.status_code in (400, 422)

                ok = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token, owner), "X-Idempotency-Key": "k_refund_ok_123456"},
                    json={"amountUsdc": 10, "reason": "ok"},
                )
                assert ok.status_code == 200
                first = ok.json()

                replay = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token, owner), "X-Idempotency-Key": "k_refund_ok_123456"},
                    json={"amountUsdc": 10, "reason": "ok"},
                )
                assert replay.status_code == 200
                second = replay.json()
                assert first["refundId"] == second["refundId"]

                mismatch = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token, owner), "X-Idempotency-Key": "k_refund_ok_123456"},
                    json={"amountUsdc": 11, "reason": "mismatch"},
                )
                assert mismatch.status_code == 409
        finally:
            cfg.settings.data_dir = old_data_dir
            cfg.settings.runtime_storage_dir = old_runtime_dir
            app_module.run_v2_deposit_indexer = old_indexer


def test_owner_isolation_and_router_limit_range():
    with TemporaryDirectory() as tmp:
        old_data_dir = cfg.settings.data_dir
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_indexer = app_module.run_v2_deposit_indexer
        cfg.settings.data_dir = tmp
        cfg.settings.runtime_storage_dir = tmp
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                owner1, token1 = _issue_session(client)
                owner2, token2 = _issue_session(client)

                # Create refund for owner1
                create_refund = client.post(
                    "/api/v1/refund",
                    headers={**_auth_headers(token1, owner1), "X-Idempotency-Key": "k_owner1_refund_12345"},
                    json={"amountUsdc": 20, "reason": "owner1"},
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
            cfg.settings.data_dir = old_data_dir
            cfg.settings.runtime_storage_dir = old_runtime_dir
            app_module.run_v2_deposit_indexer = old_indexer
