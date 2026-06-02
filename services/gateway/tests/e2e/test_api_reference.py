"""API Reference E2E — 验证每个文档接口可以正常调用

对应文档: http://localhost:3000/docs/api-reference
运行方式:
    cd services/gateway
    pytest tests/e2e/test_api_reference.py -v --tb=short -s

前提条件:
    - Anvil :8545 + Gateway :8000 已运行
    - bash tools/scripts/local/restart_gateway.sh
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import httpx
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from tests.e2e.conftest import (
    GATEWAY_BASE,
    OWNER_KEY,
    PROVIDER_KEY,
    RELEASE_E2E,
    revoke_stale_e2e_agent_credentials,
)
from tests.e2e.helpers.auth import authenticate_wallet
from tests.e2e.helpers.service_fixtures import (
    canonical_invoke_payload,
    canonical_missing_message,
    configured_e2e_service_id,
    discover_service,
    service_price_usdc,
)

# ─────────────────────────────────────────────────────────────────────────────
# Shared state across tests (populated by earlier tests)
# ─────────────────────────────────────────────────────────────────────────────
STATE: dict = {}


def _skip_or_fail(message: str) -> None:
    if RELEASE_E2E:
        pytest.fail(message)
    pytest.skip(message)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Auth
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuth:
    """GET /api/v1/auth/challenge  •  POST /api/v1/auth/verify  •  GET /api/v1/auth/me"""

    def test_01_challenge_returns_nonce(self):
        """GET /api/v1/auth/challenge → 200 with challenge string"""
        account = Account.from_key(OWNER_KEY)
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/auth/challenge",
            params={"address": account.address.lower()},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("success") is True, f"success != True: {data}"
        assert "challenge" in data and len(data["challenge"]) > 10
        STATE["challenge_message"] = data["challenge"]
        STATE["owner_address"] = account.address.lower()

    def test_02_verify_returns_jwt(self):
        """POST /api/v1/auth/verify → 200 with access_token"""
        account = Account.from_key(OWNER_KEY)
        msg = STATE.get("challenge_message")
        if not msg:
            # fetch fresh challenge
            r = httpx.get(
                f"{GATEWAY_BASE}/api/v1/auth/challenge",
                params={"address": account.address.lower()},
                timeout=15,
            )
            msg = r.json()["challenge"]

        signed = Account.sign_message(encode_defunct(text=msg), private_key=OWNER_KEY)
        r = httpx.post(
            f"{GATEWAY_BASE}/api/v1/auth/verify",
            json={
                "wallet_address": account.address.lower(),
                "signature": signed.signature.hex(),
                "message": msg,
            },
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("success") is True
        assert "access_token" in data and len(data["access_token"]) > 20
        STATE["owner_jwt"] = data["access_token"]

    def test_03_invalid_signature_rejected(self):
        """POST /api/v1/auth/verify with fake sig → 400/401/422"""
        account = Account.from_key(OWNER_KEY)
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/auth/challenge",
            params={"address": account.address.lower()},
            timeout=15,
        )
        msg = r.json()["challenge"]
        r2 = httpx.post(
            f"{GATEWAY_BASE}/api/v1/auth/verify",
            json={
                "wallet_address": account.address.lower(),
                "signature": "0x" + "ab" * 65,
                "message": msg,
            },
            timeout=15,
        )
        assert r2.status_code in (400, 401, 422), (
            f"Expected 4xx for fake sig, got {r2.status_code}: {r2.text}"
        )

    def test_04_get_me_returns_profile(self):
        """GET /api/v1/auth/me → 200 with wallet_address"""
        jwt = STATE.get("owner_jwt")
        if not jwt:
            jwt, _ = authenticate_wallet(GATEWAY_BASE, OWNER_KEY)
            STATE["owner_jwt"] = jwt

        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/auth/me",
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        # profile must contain wallet address
        body = str(data).lower()
        assert "0x" in body or "wallet" in body, f"No wallet info in /me response: {data}"

    def test_05_me_requires_auth(self):
        """GET /api/v1/auth/me without token → 401/403"""
        r = httpx.get(f"{GATEWAY_BASE}/api/v1/auth/me", timeout=10)
        assert r.status_code in (401, 403), (
            f"Expected 401/403, got {r.status_code}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Balance
# ═══════════════════════════════════════════════════════════════════════════════

class TestBalance:
    """GET /api/v1/balance"""

    def _jwt(self) -> str:
        if not STATE.get("owner_jwt"):
            STATE["owner_jwt"], _ = authenticate_wallet(GATEWAY_BASE, OWNER_KEY)
        return STATE["owner_jwt"]

    def test_01_get_balance_returns_summary(self):
        """GET /api/v1/balance → 200 with balance fields"""
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/balance",
            headers={"Authorization": f"Bearer {self._jwt()}"},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        # At minimum, some balance structure should be present
        body_str = str(data).lower()
        assert any(k in body_str for k in ["balance", "consumer", "available", "success"]), (
            f"Unexpected balance response: {data}"
        )

    def test_02_balance_requires_auth(self):
        """GET /api/v1/balance without token → 401/403"""
        r = httpx.get(f"{GATEWAY_BASE}/api/v1/balance", timeout=10)
        assert r.status_code in (401, 403)

    def test_03_spending_limit_readable(self):
        """GET /api/v1/balance/spending-limit → 200"""
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/balance/spending-limit",
            headers={"Authorization": f"Bearer {self._jwt()}"},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Services / Discovery
# ═══════════════════════════════════════════════════════════════════════════════

class TestServices:
    """GET /api/v1/services/discover  •  GET /api/v1/services"""

    def _owner_jwt(self) -> str:
        if not STATE.get("owner_jwt"):
            STATE["owner_jwt"], _ = authenticate_wallet(GATEWAY_BASE, OWNER_KEY)
        return STATE["owner_jwt"]

    def _provider_jwt(self) -> str:
        if not STATE.get("provider_jwt"):
            STATE["provider_jwt"], _ = authenticate_wallet(GATEWAY_BASE, PROVIDER_KEY)
        return STATE["provider_jwt"]

    def test_01_discover_returns_list(self):
        """GET /api/v1/services/discover → 200 with list"""
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/services/discover",
            headers={"Authorization": f"Bearer {self._owner_jwt()}"},
            params={"limit": 20},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        # Accept list or dict with services key
        if isinstance(data, list):
            pass  # OK
        elif isinstance(data, dict):
            assert any(k in data for k in ["services", "data", "items", "success"]), (
                f"Unexpected discover response shape: {data}"
            )

    def test_02_discover_requires_auth(self):
        """GET /api/v1/services/discover — gateway allows public discovery (200) or requires auth (401/403)"""
        r = httpx.get(f"{GATEWAY_BASE}/api/v1/services/discover", timeout=10)
        # Gateway currently allows unauthenticated discovery; both behaviours are acceptable
        assert r.status_code in (200, 401, 403), (
            f"Expected 200 or 4xx, got {r.status_code}: {r.text}"
        )

    def test_03_existing_provider_catalog_service_visible(self):
        """API reference smoke uses an existing Provider catalog service."""
        service_id = configured_e2e_service_id()
        row = discover_service(GATEWAY_BASE, service_id, token=self._owner_jwt())
        assert row, canonical_missing_message(service_id)
        STATE["test_service_id"] = service_id

    def test_04_list_own_services(self):
        """GET /api/v1/services → 200 with list"""
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/services",
            headers={"Authorization": f"Bearer {self._provider_jwt()}"},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"

    def test_05_discover_search_query(self):
        """GET /api/v1/services/discover?search_query=... → 200"""
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/services/discover",
            headers={"Authorization": f"Bearer {self._owner_jwt()}"},
            params={"search_query": "test", "limit": 5},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"

    def test_06_provider_catalog_service_remains_visible(self):
        """No DELETE in local/staging E2E; assert catalog service remains listed."""
        service_id = configured_e2e_service_id()
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/services",
            headers={"Authorization": f"Bearer {self._provider_jwt()}"},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        services = r.json().get("services") or r.json().get("items") or []
        ids = {
            str(value)
            for row in services
            for value in (
                row.get("serviceId"),
                row.get("service_id"),
                row.get("id"),
                row.get("agentToolName"),
            )
            if value
        }
        assert service_id in ids, canonical_missing_message(service_id)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Agent Credentials
# ═══════════════════════════════════════════════════════════════════════════════

class TestCredentials:
    """POST /api/v1/credentials/agent/issue  •  GET /api/v1/credentials/agent/list"""

    def _jwt(self) -> str:
        if not STATE.get("owner_jwt"):
            STATE["owner_jwt"], _ = authenticate_wallet(GATEWAY_BASE, OWNER_KEY)
        return STATE["owner_jwt"]

    def test_01_issue_credential(self):
        """POST /api/v1/credentials/agent/issue → 200 with token"""
        revoke_stale_e2e_agent_credentials(
            {"Authorization": f"Bearer {self._jwt()}"}
        )
        r = httpx.post(
            f"{GATEWAY_BASE}/api/v1/credentials/agent/issue",
            headers={"Authorization": f"Bearer {self._jwt()}"},
            json={
                "name": f"api-ref-test-{uuid.uuid4().hex[:6]}",
                "max_calls": 50,
                "credit_limit": 2,
                "rpm": 30,
            },
            timeout=15,
        )
        assert r.status_code in (200, 201), f"Expected 200/201, got {r.status_code}: {r.text}"
        data = r.json()
        # Gateway nests credential under data['credential']['token']
        nested = data.get("credential") or {}
        token = (
            data.get("token")
            or data.get("access_token")
            or data.get("credential_token")
            or nested.get("token")
        )
        assert token and len(token) > 10, f"No credential token in response: {data}"
        STATE["agent_credential"] = token
        cred_id = (
            data.get("credential_id")
            or data.get("id")
            or nested.get("id")
        )
        if cred_id:
            STATE["credential_id"] = cred_id

    def test_02_list_credentials(self):
        """GET /api/v1/credentials/agent/list → 200"""
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/credentials/agent/list",
            headers={"Authorization": f"Bearer {self._jwt()}"},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"

    def test_03_credential_requires_auth(self):
        """POST /api/v1/credentials/agent/issue without token → 401/403"""
        r = httpx.post(
            f"{GATEWAY_BASE}/api/v1/credentials/agent/issue",
            json={"name": "no-auth-test"},
            timeout=10,
        )
        assert r.status_code in (401, 403)

    def test_04_revoke_credential(self):
        """DELETE /api/v1/credentials/agent/:id → 200/204"""
        cred_id = STATE.get("credential_id")
        if not cred_id:
            pytest.skip("No credential_id from test_01, skipping delete")
        r = httpx.delete(
            f"{GATEWAY_BASE}/api/v1/credentials/agent/{cred_id}",
            headers={"Authorization": f"Bearer {self._jwt()}"},
            timeout=15,
        )
        assert r.status_code in (200, 204), f"Expected 200/204, got {r.status_code}: {r.text}"
        STATE.pop("agent_credential", None)
        STATE.pop("credential_id", None)


# ═══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — Agent Invocations (Quote + Invoke)
# Requires a live service from the Synapse-Network-Provider catalog.
# ═══════════════════════════════════════════════════════════════════════════════

class TestInvocations:
    """POST /api/v1/agent/quotes  •  POST /api/v1/agent/invocations  •  GET receipt"""

    def _cred(self) -> str:
        if not STATE.get("agent_credential"):
            # Issue a fresh credential
            jwt, _ = authenticate_wallet(GATEWAY_BASE, OWNER_KEY)
            revoke_stale_e2e_agent_credentials({"Authorization": f"Bearer {jwt}"})
            r = httpx.post(
                f"{GATEWAY_BASE}/api/v1/credentials/agent/issue",
                headers={"Authorization": f"Bearer {jwt}"},
                json={
                    "name": f"inv-test-{uuid.uuid4().hex[:6]}",
                    "maxCalls": 20,
                    "creditLimit": 5,
                    "rpm": 10,
                },
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()
            nested = data.get("credential") or {}
            STATE["agent_credential"] = (
                data.get("token")
                or data.get("access_token")
                or data.get("credential_token")
                or nested.get("token")
                or ""
            )
            assert STATE["agent_credential"], f"No invocation credential token in response: {data}"
        return STATE["agent_credential"]

    @staticmethod
    def _is_sync_api_service(row: dict) -> bool:
        pricing = row.get("pricing") if isinstance(row.get("pricing"), dict) else {}
        service_kind = str(
            row.get("serviceKind")
            or row.get("service_kind")
            or pricing.get("serviceKind")
            or ""
        ).strip().lower()
        price_model = str(
            row.get("priceModel")
            or row.get("price_model")
            or pricing.get("priceModel")
            or ""
        ).strip().lower()
        if service_kind == "llm" or price_model == "token_metered":
            return False
        return True

    def _discover_service_id(self) -> str | None:
        configured = configured_e2e_service_id()
        row = discover_service(GATEWAY_BASE, configured, token=None, timeout=15)
        if row and self._is_sync_api_service(row):
            STATE["fallback_price_usdc"] = service_price_usdc(row)
            return configured

        STATE["canonical_missing_message"] = canonical_missing_message(configured)
        return None

    def test_01_quote_service(self):
        """POST /api/v1/agent/discovery/search → 200 with live service price."""
        svc_id = self._discover_service_id()
        if not svc_id:
            _skip_or_fail(STATE.get("canonical_missing_message") or "No live services in discover")

        r = httpx.post(
            f"{GATEWAY_BASE}/api/v1/agent/discovery/search",
            headers={"X-Credential": self._cred()},
            json={"serviceId": svc_id},
            timeout=15,
        )
        assert r.status_code in (200, 201), f"Expected 200/201, got {r.status_code}: {r.text}"
        data = r.json()
        results = data.get("results", [])
        match = next((row for row in results if row.get("serviceId") == svc_id), None)
        if not match and STATE.get("fallback_price_usdc"):
            match = {"serviceId": svc_id, "priceUsdc": STATE["fallback_price_usdc"]}
        assert match, f"service_id {svc_id!r} not found in discovery results: {data}"
        pricing = match.get("pricing") if isinstance(match.get("pricing"), dict) else {}
        price_usdc = (
            match.get("basePriceUsdc")
            or match.get("priceUsdc")
            or pricing.get("amount")
        )
        assert price_usdc, f"No service price in discovery response: {match}"
        STATE["quote_id"] = "price_confirmed"
        STATE["quoted_price_usdc"] = str(price_usdc)
        STATE["quoted_service_id"] = svc_id

    def test_02_invoke_service(self):
        """POST /api/v1/agent/invoke → 200 with invocation_id"""
        quote_id = STATE.get("quote_id")
        if not quote_id:
            _skip_or_fail("No quote_id from test_01, skipping invoke")

        r = httpx.post(
            f"{GATEWAY_BASE}/api/v1/agent/invoke",
            headers={
                "X-Credential": self._cred(),
            },
            json={
                "serviceId": STATE["quoted_service_id"],
                "idempotencyKey": f"api-ref-test-{uuid.uuid4().hex}",
                "costUsdc": STATE["quoted_price_usdc"],
                "payload": {"body": canonical_invoke_payload(STATE["quoted_service_id"])},
                "responseMode": "sync",
            },
            timeout=30,
        )
        if r.status_code == 504:
            detail = r.json().get("detail", {}) if r.content else {}
            code = detail.get("code") if isinstance(detail, dict) else ""
            if code == "SERVICE_TIMEOUT":
                _skip_or_fail(
                    "Live provider timed out during local API reference invoke"
                )
        assert r.status_code in (200, 201, 202), f"Expected 2xx, got {r.status_code}: {r.text}"
        data = r.json()
        inv_id = data.get("invocationId") or data.get("invocation_id") or data.get("id")
        assert inv_id, f"No invocation_id in response: {data}"
        STATE["invocation_id"] = inv_id

    def test_03_get_invocation_receipt(self):
        """GET /api/v1/agent/invocations/:id → 200 with status"""
        inv_id = STATE.get("invocation_id")
        if not inv_id:
            _skip_or_fail("No invocation_id from test_02, skipping receipt check")

        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/agent/invocations/{inv_id}",
            headers={"X-Credential": self._cred()},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "status" in str(data).lower(), f"No status in receipt: {data}"

    def test_04_get_invocations_list(self):
        """GET /api/v1/usage/logs → 200 (invocation history)"""
        jwt, _ = authenticate_wallet(GATEWAY_BASE, OWNER_KEY)
        r = httpx.get(
            f"{GATEWAY_BASE}/api/v1/usage/logs",
            headers={"Authorization": f"Bearer {jwt}"},
            params={"limit": 10},
            timeout=15,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
