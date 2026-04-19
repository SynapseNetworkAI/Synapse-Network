from __future__ import annotations

from typing import Any

import httpx

from src.services.adapters.provider_services import HttpProviderServicesAdapter
from src.services.auth.service import AdminIdentity


def test_provider_services_adapter_drops_empty_filter_params(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_request(method: str, url: str, **kwargs):
        captured["method"] = method
        captured["url"] = url
        captured["params"] = kwargs.get("params")
        request = httpx.Request(method, url)
        return httpx.Response(
            200,
            json={"items": [], "totalCount": 0, "page": 1, "pageSize": 20, "totalPages": 1},
            request=request,
        )

    monkeypatch.setattr(httpx, "request", fake_request)
    adapter = HttpProviderServicesAdapter(
        base_url="http://gateway.local",
        admin_wallet="0xa0f67a47d9ef18183cd113ed85a654e2772c5901",
        jwt_secret="local-test-internal-secret-with-enough-length",
        token_issuer="gateway-admin",
        token_audience="gateway-internal",
        service_subject="service:gateway-admin",
        timeout_sec=1,
    )

    adapter.list_services(
        actor=AdminIdentity(
            admin_id="adm_test",
            email="ops@example.com",
            display_name="Ops",
            role="super_admin",
            permissions=("dashboard:read",),
        ),
        params={
            "query": "",
            "status": None,
            "runtimeStatus": "",
            "page": 1,
            "pageSize": 20,
        },
    )

    assert captured["method"] == "GET"
    assert captured["url"] == "http://gateway.local/api/v1/admin/provider-services"
    assert captured["params"] == {"page": 1, "pageSize": 20}
