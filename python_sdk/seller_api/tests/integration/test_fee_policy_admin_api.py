# pyright: reportMissingImports=false

import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import asyncio

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "seller_api"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from src import app as app_module  # noqa: E402
from src.core import config as cfg  # noqa: E402
from src.api.routers import balance as balance_router  # noqa: E402


async def _noop_indexer(stop_event, storage):
    await asyncio.sleep(0)
    _ = (stop_event, storage)
    return None


def _auth_headers(address: str):
    return {
        "Authorization": "Bearer test-token",
        "X-User-Address": address,
        "Content-Type": "application/json",
    }


def test_fee_policy_admin_get_put_flow(monkeypatch):
    monkeypatch.setattr(
        balance_router.credential_service,
        "require_owner_wallet",
        lambda authorization=None, x_user_address=None: str(x_user_address or "0x" + "1" * 40),
    )

    with TemporaryDirectory() as tmp:
        old_data_dir = cfg.settings.data_dir
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_env = cfg.settings.environment
        old_admins = set(cfg.settings.platform_fee_admin_wallets)
        old_default_rate = cfg.settings.platform_fee_rate
        old_indexer = app_module.run_v2_deposit_indexer

        cfg.settings.data_dir = tmp
        cfg.settings.runtime_storage_dir = tmp
        cfg.settings.environment = "development"
        cfg.settings.platform_fee_admin_wallets = {"0x" + "1" * 40}
        cfg.settings.platform_fee_rate = 0.10
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                get_empty = client.get("/api/v1/admin/fee-policy", headers=_auth_headers("0x" + "1" * 40))
                assert get_empty.status_code == 200
                empty_payload = get_empty.json()
                assert empty_payload["policy"]["defaultRate"] == 0.10
                assert empty_payload["policy"]["ownerRates"] == {}

                put_resp = client.put(
                    "/api/v1/admin/fee-policy",
                    headers=_auth_headers("0x" + "1" * 40),
                    json={
                        "defaultRate": 0.08,
                        "ownerRates": {
                            "0xD856907D7E35A8F9BD225859A59E58577147A092": 0.03,
                        },
                    },
                )
                assert put_resp.status_code == 200
                saved = put_resp.json()["policy"]
                assert saved["defaultRate"] == 0.08
                assert saved["ownerRates"]["0xd856907d7e35a8f9bd225859a59e58577147a092"] == 0.03

                get_saved = client.get("/api/v1/admin/fee-policy", headers=_auth_headers("0x" + "1" * 40))
                assert get_saved.status_code == 200
                current = get_saved.json()["policy"]
                assert current["defaultRate"] == 0.08
                assert current["ownerRates"]["0xd856907d7e35a8f9bd225859a59e58577147a092"] == 0.03
        finally:
            cfg.settings.data_dir = old_data_dir
            cfg.settings.runtime_storage_dir = old_runtime_dir
            cfg.settings.environment = old_env
            cfg.settings.platform_fee_admin_wallets = old_admins
            cfg.settings.platform_fee_rate = old_default_rate
            app_module.run_v2_deposit_indexer = old_indexer


def test_fee_policy_admin_forbidden_for_non_admin(monkeypatch):
    monkeypatch.setattr(
        balance_router.credential_service,
        "require_owner_wallet",
        lambda authorization=None, x_user_address=None: str(x_user_address or "0x" + "2" * 40),
    )

    with TemporaryDirectory() as tmp:
        old_data_dir = cfg.settings.data_dir
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_env = cfg.settings.environment
        old_admins = set(cfg.settings.platform_fee_admin_wallets)
        old_indexer = app_module.run_v2_deposit_indexer

        cfg.settings.data_dir = tmp
        cfg.settings.runtime_storage_dir = tmp
        cfg.settings.environment = "development"
        cfg.settings.platform_fee_admin_wallets = {"0x" + "1" * 40}
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                forbidden = client.get("/api/v1/admin/fee-policy", headers=_auth_headers("0x" + "2" * 40))
                assert forbidden.status_code == 403
                assert forbidden.json()["detail"]["code"] == "FORBIDDEN"
        finally:
            cfg.settings.data_dir = old_data_dir
            cfg.settings.runtime_storage_dir = old_runtime_dir
            cfg.settings.environment = old_env
            cfg.settings.platform_fee_admin_wallets = old_admins
            app_module.run_v2_deposit_indexer = old_indexer


def test_fee_policy_admin_rejects_invalid_payload(monkeypatch):
    monkeypatch.setattr(
        balance_router.credential_service,
        "require_owner_wallet",
        lambda authorization=None, x_user_address=None: str(x_user_address or "0x" + "1" * 40),
    )

    with TemporaryDirectory() as tmp:
        old_data_dir = cfg.settings.data_dir
        old_runtime_dir = cfg.settings.runtime_storage_dir
        old_env = cfg.settings.environment
        old_admins = set(cfg.settings.platform_fee_admin_wallets)
        old_indexer = app_module.run_v2_deposit_indexer

        cfg.settings.data_dir = tmp
        cfg.settings.runtime_storage_dir = tmp
        cfg.settings.environment = "development"
        cfg.settings.platform_fee_admin_wallets = {"0x" + "1" * 40}
        app_module.run_v2_deposit_indexer = _noop_indexer
        try:
            app = app_module.create_app()
            with TestClient(app) as client:
                bad = client.put(
                    "/api/v1/admin/fee-policy",
                    headers=_auth_headers("0x" + "1" * 40),
                    json={"defaultRate": 1.2},
                )
                assert bad.status_code == 400
                assert bad.json()["detail"]["code"] == "INVALID_FEE_POLICY"
        finally:
            cfg.settings.data_dir = old_data_dir
            cfg.settings.runtime_storage_dir = old_runtime_dir
            cfg.settings.environment = old_env
            cfg.settings.platform_fee_admin_wallets = old_admins
            app_module.run_v2_deposit_indexer = old_indexer
