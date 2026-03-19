from __future__ import annotations

import pytest

from synapse_client import SynapseClient
from synapse_client.exceptions import AuthenticationError, DiscoveryError, InsufficientFundsError, InvokeError


class DummyResponse:
    def __init__(self, *, status_code: int = 200, json_data=None, text: str = "", ok: bool | None = None):
        self.status_code = status_code
        self._json_data = json_data if json_data is not None else {}
        self.text = text
        self.ok = ok if ok is not None else 200 <= status_code < 300

    def json(self):
        return self._json_data


def test_client_requires_api_key(monkeypatch):
    monkeypatch.delenv("SYNAPSE_API_KEY", raising=False)

    with pytest.raises(ValueError, match="api_key is required"):
        SynapseClient(api_key="")


def test_discover_services_passes_intent_and_parses_response(monkeypatch):
    calls = []

    def fake_get(url, params, timeout):
        calls.append({"url": url, "params": params, "timeout": timeout})
        return DummyResponse(
            json_data={
                "status": "success",
                "count": 1,
                "services": [
                    {
                        "serviceId": "svc_quotes_famous_top3",
                        "serviceName": "Quotes Famous Top3",
                        "pricing": "0.05",
                        "summary": "Return top 3 famous quotes.",
                        "tags": ["quotes", "top3"],
                        "invoke": {"method": "POST", "request": {}, "response": {}},
                    }
                ],
            }
        )

    monkeypatch.setattr("synapse_client.client.requests.get", fake_get)

    client = SynapseClient(api_key="agt_test", gateway_url="http://127.0.0.1:8000", timeout_sec=12)
    result = client.discover_services(intent="quotes")

    assert result.count == 1
    assert result.services[0].serviceId == "svc_quotes_famous_top3"
    assert calls == [
        {
            "url": "http://127.0.0.1:8000/api/v1/services/discover",
            "params": {"intent": "quotes"},
            "timeout": 12,
        }
    ]


def test_discover_services_raises_discovery_error_on_failure(monkeypatch):
    monkeypatch.setattr(
        "synapse_client.client.requests.get",
        lambda url, params, timeout: DummyResponse(status_code=500, text="boom", ok=False),
    )

    client = SynapseClient(api_key="agt_test")

    with pytest.raises(DiscoveryError, match="boom"):
        client.discover_services(intent="quotes")


def test_call_service_posts_payload_and_returns_synapse_response(monkeypatch):
    calls = []

    def fake_post(url, headers, json, timeout):
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        return DummyResponse(
            json_data={
                "result": {"answer": "stay hungry"},
                "routerTxHash": "0xabc",
                "usage": {"fee": 0.05},
            }
        )

    monkeypatch.setattr("synapse_client.client.requests.post", fake_post)

    client = SynapseClient(api_key="agt_test", timeout_sec=9)
    result = client.call_service(
        service_id="svc_quotes_famous_top3",
        payload={"text": "关于坚持"},
        trace_id="trace-123",
    )

    assert result.content == "stay hungry"
    assert result.tx_hash == "0xabc"
    assert result.fee_deducted == 0.05
    assert calls == [
        {
            "url": "http://127.0.0.1:8000/api/v1/gateway/generate",
            "headers": {
                "Content-Type": "application/json",
                "X-Service-Id": "svc_quotes_famous_top3",
                "X-Credential": "agt_test",
            },
            "json": {
                "service_id": "svc_quotes_famous_top3",
                "text": "关于坚持",
                "trace_id": "trace-123",
            },
            "timeout": 9,
        }
    ]


@pytest.mark.parametrize(
    ("status_code", "error_type", "message"),
    [
        (401, AuthenticationError, "Invalid API Key or unauthorized access."),
        (402, InsufficientFundsError, "Insufficient USDC balance in your Agent account. Please top up."),
        (500, InvokeError, "upstream exploded"),
    ],
)
def test_call_service_maps_error_status_codes(monkeypatch, status_code, error_type, message):
    monkeypatch.setattr(
        "synapse_client.client.requests.post",
        lambda url, headers, json, timeout: DummyResponse(status_code=status_code, text="upstream exploded", ok=False),
    )

    client = SynapseClient(api_key="agt_test")

    with pytest.raises(error_type, match=message):
        client.call_service(service_id="svc_quotes_famous_top3", payload={"text": "hi"})


def test_call_service_polls_pending_response_until_success(monkeypatch):
    responses = iter(
        [
            DummyResponse(status_code=202, json_data={"retryAfterSec": 1}),
            DummyResponse(json_data={"result": "ready", "txHash": "0xdef", "usage": {"fee": 0.01}}),
        ]
    )
    sleeps = []

    monkeypatch.setattr("synapse_client.client.requests.post", lambda url, headers, json, timeout: next(responses))
    monkeypatch.setattr("synapse_client.client.time.sleep", lambda seconds: sleeps.append(seconds))

    timeline = iter([0, 0, 1])
    monkeypatch.setattr("synapse_client.client.time.time", lambda: next(timeline))

    client = SynapseClient(api_key="agt_test")
    result = client.call_service(service_id="svc_quotes_famous_top3", payload={"text": "hi"}, max_wait_sec=5)

    assert result.content == "ready"
    assert result.tx_hash == "0xdef"
    assert sleeps == [1]


def test_call_service_raises_timeout_when_pending_exceeds_budget(monkeypatch):
    monkeypatch.setattr(
        "synapse_client.client.requests.post",
        lambda url, headers, json, timeout: DummyResponse(status_code=202, json_data={"retryAfterSec": 2}),
    )
    monkeypatch.setattr("synapse_client.client.time.sleep", lambda seconds: None)

    timeline = iter([0, 2])
    monkeypatch.setattr("synapse_client.client.time.time", lambda: next(timeline))

    client = SynapseClient(api_key="agt_test")

    with pytest.raises(InvokeError, match="pending timeout"):
        client.call_service(service_id="svc_quotes_famous_top3", payload={"text": "hi"}, max_wait_sec=3)