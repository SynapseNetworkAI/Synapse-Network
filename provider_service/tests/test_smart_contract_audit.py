# pyright: reportMissingImports=false

import asyncio
import hashlib
import hmac
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from fastapi import HTTPException
import httpx
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services import smart_contract_audit_service  # noqa: E402
from app.services.smart_contract_audit import adapters as audit_adapters  # noqa: E402
from app.services.smart_contract_audit.adapters import (  # noqa: E402
    FetchAttemptError,
    VerifiedSourceBundle,
)
from app.services.smart_contract_audit.domain import (  # noqa: E402
    ContractAuditReportRecord,
    ProviderInvocationRecord,
)


RISKY_SOURCE = """
pragma solidity ^0.8.20;

contract RiskyVault {
    address public owner;

    function exec(address target, bytes calldata data) external returns (bytes memory) {
        require(tx.origin == owner, "owner only");
        (bool ok, bytes memory response) = target.delegatecall(data);
        require(ok, "delegatecall failed");
        return response;
    }

    function emergencyCall(address target, bytes calldata data) external payable {
        target.call{value: msg.value}(data);
    }

    function kill() external {
        selfdestruct(payable(owner));
    }
}
""".strip()


class InMemoryAuditRepository:
    def __init__(self) -> None:
        self.reports: list[ContractAuditReportRecord] = []
        self.invocations: list[ProviderInvocationRecord] = []

    def save_report(self, record: ContractAuditReportRecord) -> None:
        self.reports.append(record)

    def append_invocation(self, record: ProviderInvocationRecord) -> None:
        self.invocations.append(record)


@pytest.fixture(autouse=True)
def stub_audit_repository(monkeypatch: pytest.MonkeyPatch):
    repository = InMemoryAuditRepository()
    monkeypatch.setattr(
        "app.services.smart_contract_audit_service.get_smart_contract_audit_repository",
        lambda: repository,
    )
    monkeypatch.setattr(
        "app.api.v1.endpoints.smart_contract_audit.get_smart_contract_audit_repository",
        lambda: repository,
    )
    return repository


def _signed_headers(payload: dict) -> dict[str, str]:
    settings = get_settings()
    service_id = smart_contract_audit_service.SERVICE_ID
    signed_at = "1710931200"
    body = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    digest = hashlib.sha256(body).hexdigest()
    canonical = f"{service_id}.{signed_at}.{digest}"
    signature = hmac.new(
        settings.gateway_provider_signature_secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Synapse-Service-Id": service_id,
        "X-Synapse-Signed-At": signed_at,
        "X-Synapse-Signature": signature,
    }


def test_smart_contract_audit_invokes_with_inline_source_bundle():
    client = TestClient(app)
    payload = {
        "source_bundle": RISKY_SOURCE,
        "analysis_depth": "standard",
        "include_evidence": True,
    }

    response = client.post(
        "/provider-services/smart-contract-audit/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_smart_contract_audit"
    assert body["service"]["serviceName"] == "Smart Contract Audit Model"
    assert body["sources"] == [
        {"name": "provided_source_bundle", "freshnessSec": 0},
        {"name": "synapse_rule_engine", "freshnessSec": 0},
    ]
    assert body["freshness"]["cacheHit"] is False
    assert body["result"]["target"] == "inline_source_bundle"
    assert body["result"]["riskScore"] >= 80
    assert body["result"]["riskLevel"] in {"high", "critical"}
    titles = {item["title"] for item in body["result"]["criticalFindings"]}
    assert "Delegatecall execution path detected" in titles
    assert "tx.origin authorization pattern detected" in titles
    assert "Low-level external call path detected" in titles
    assert any(
        finding.get("evidence", "").startswith("Line ")
        for finding in body["result"]["criticalFindings"]
    )
    assert len(body["result"]["fixSuggestions"]) >= 1
    assert body["errors"] == []


def test_execute_smart_contract_audit_persists_report_and_invocation():
    repository = InMemoryAuditRepository()
    payload = smart_contract_audit_service.SmartContractAuditRequest.model_validate(
        {
            "source_bundle": RISKY_SOURCE,
            "analysis_depth": "standard",
            "include_evidence": True,
        }
    )

    response = asyncio.run(
        smart_contract_audit_service.execute_smart_contract_audit(
            payload,
            request_id="req-smart-audit-1",
            gateway_request_id="gw-smart-audit-1",
            repository=repository,
        )
    )

    assert response.result.risk_score >= 80
    assert len(repository.reports) == 1
    assert repository.reports[0].response.result.target == "inline_source_bundle"
    assert repository.reports[0].observability_payload["resolvedSourceProvider"] == "provided_source_bundle"
    assert repository.reports[0].observability_payload["fallbackAttempts"] == []
    assert len(repository.invocations) == 1
    invocation = repository.invocations[0]
    assert invocation.response_status == 200
    assert invocation.request_id == "req-smart-audit-1"
    assert invocation.gateway_request_id == "gw-smart-audit-1"
    assert invocation.error_code is None
    assert invocation.observability_payload["resolvedSourceProvider"] == "provided_source_bundle"


def test_execute_smart_contract_audit_persists_failed_invocation(monkeypatch: pytest.MonkeyPatch):
    repository = InMemoryAuditRepository()
    payload = smart_contract_audit_service.SmartContractAuditRequest.model_validate(
        {
            "source_bundle": RISKY_SOURCE,
            "analysis_depth": "fast",
        }
    )

    async def _boom(_payload):
        raise HTTPException(
            status_code=502,
            detail={
                "code": "VERIFIED_SOURCE_FETCH_FAILED",
                "message": "upstream provider down",
                "upstream_status": 503,
            },
        )

    monkeypatch.setattr(
        smart_contract_audit_service,
        "build_smart_contract_audit",
        _boom,
    )

    with pytest.raises(HTTPException):
        asyncio.run(
            smart_contract_audit_service.execute_smart_contract_audit(
                payload,
                request_id="req-smart-audit-2",
                gateway_request_id="gw-smart-audit-2",
                repository=repository,
            )
        )

    assert repository.reports == []
    assert len(repository.invocations) == 1
    invocation = repository.invocations[0]
    assert invocation.response_status == 502
    assert invocation.error_code == "VERIFIED_SOURCE_FETCH_FAILED"
    assert invocation.upstream_status == 503
    assert invocation.observability_payload["fallbackAttempts"] == []


def test_smart_contract_audit_can_analyze_verified_source_mode(monkeypatch: pytest.MonkeyPatch):
    async def _fake_fetch_verified_source_bundle(
        *,
        chain: str,
        contract_address: str,
    ) -> tuple[VerifiedSourceBundle, tuple[FetchAttemptError, ...]]:
        assert chain == "ethereum"
        assert contract_address == "0x1111111111111111111111111111111111111111"
        return (
            VerifiedSourceBundle(
                provider_name="blockscout_verified_source",
                chain="ethereum",
                chain_id="1",
                contract_address=contract_address,
                match="exact_match",
                verified_at=None,
                fetched_at=audit_adapters._now_utc(),
                source_bundle=RISKY_SOURCE,
                source_file_count=1,
            ),
            (),
        )

    monkeypatch.setattr(
        smart_contract_audit_service,
        "fetch_verified_source_bundle",
        _fake_fetch_verified_source_bundle,
    )

    client = TestClient(app)
    payload = {
        "contract_address": "0x1111111111111111111111111111111111111111",
        "chain": "ethereum",
        "analysis_depth": "fast",
    }

    response = client.post(
        "/provider-services/smart-contract-audit/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["result"]["target"] == "ethereum:0x1111111111111111111111111111111111111111"
    assert body["sources"][0] == {
        "name": "blockscout_verified_source",
        "freshnessSec": 0,
    }
    assert body["result"]["analysisMode"] == "fast"


def test_smart_contract_audit_requires_exactly_one_input_mode():
    client = TestClient(app)
    payload = {
        "chain": "ethereum",
        "source_bundle": RISKY_SOURCE,
    }

    response = client.post(
        "/provider-services/smart-contract-audit/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any(
        "either contract_address + chain or source_bundle" in entry["msg"]
        or "contract_address and chain must be provided together" in entry["msg"]
        for entry in detail
    )


def test_smart_contract_audit_requires_gateway_signature():
    client = TestClient(app)
    response = client.post(
        "/provider-services/smart-contract-audit/invoke",
        json={"source_bundle": RISKY_SOURCE},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GATEWAY_SIGNATURE_REQUIRED"


def test_smart_contract_audit_signature_failure_persists_invocation(monkeypatch: pytest.MonkeyPatch):
    repository = InMemoryAuditRepository()
    monkeypatch.setattr(
        "app.api.v1.endpoints.smart_contract_audit.get_smart_contract_audit_repository",
        lambda: repository,
    )

    client = TestClient(app)
    response = client.post(
        "/provider-services/smart-contract-audit/invoke",
        json={"source_bundle": RISKY_SOURCE},
        headers={"X-Request-Id": "req-signature-failure"},
    )

    assert response.status_code == 401
    assert len(repository.invocations) == 1
    invocation = repository.invocations[0]
    assert invocation.request_id == "req-signature-failure"
    assert invocation.response_status == 401
    assert invocation.error_code == "GATEWAY_SIGNATURE_REQUIRED"


def test_sourcify_adapter_fetches_and_builds_source_bundle():
    def _handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/server/v2/contract/1/0x1111111111111111111111111111111111111111":
            return httpx.Response(
                200,
                json={
                    "match": "exact_match",
                    "creationMatch": "exact_match",
                    "runtimeMatch": "exact_match",
                    "verifiedAt": "2026-03-25T12:00:00Z",
                },
            )
        if request.url.path == "/server/files/any/1/0x1111111111111111111111111111111111111111":
            return httpx.Response(
                200,
                json={
                    "status": "full",
                    "files": [
                        {
                            "name": "Vault.sol",
                            "path": "contracts/full_match/1/0x111/sources/Vault.sol",
                            "content": "pragma solidity ^0.8.20; contract Vault { function exec(address target, bytes calldata data) external { target.call(data); } }",
                        },
                        {
                            "name": "metadata.json",
                            "path": "contracts/full_match/1/0x111/metadata.json",
                            "content": "{\"compiler\":{\"version\":\"0.8.20\"}}",
                        },
                    ],
                },
            )
        return httpx.Response(404, json={"error": "not found"})

    transport = httpx.MockTransport(_handler)
    async def _run() -> VerifiedSourceBundle:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://sourcify.dev",
        ) as client:
            return await audit_adapters.fetch_sourcify_verified_source_bundle(
                chain="ethereum",
                contract_address="0x1111111111111111111111111111111111111111",
                client=client,
            )

    bundle = asyncio.run(_run())

    assert bundle.chain == "ethereum"
    assert bundle.chain_id == "1"
    assert bundle.match == "exact_match"
    assert bundle.source_file_count == 1
    assert "// File: Vault.sol" in bundle.source_bundle
    assert "target.call(data)" in bundle.source_bundle


def test_sourcify_adapter_raises_when_contract_missing():
    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "not found"})

    transport = httpx.MockTransport(_handler)
    async def _run() -> None:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://sourcify.dev",
        ) as client:
            await audit_adapters.fetch_sourcify_verified_source_bundle(
                chain="ethereum",
                contract_address="0x1111111111111111111111111111111111111111",
                client=client,
            )

    with pytest.raises(LookupError):
        asyncio.run(_run())


def test_blockscout_adapter_parses_standard_json_sources():
    standard_json = json.dumps(
        {
            "language": "Solidity",
            "sources": {
                "contracts/Vault.sol": {
                    "content": "pragma solidity ^0.8.20; contract Vault { function kill() external { selfdestruct(payable(msg.sender)); } }"
                }
            },
        }
    )

    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "status": "1",
                "message": "OK",
                "result": [
                    {
                        "SourceCode": "{{" + standard_json[1:-1] + "}}",
                        "ContractName": "Vault",
                        "CompilerVersion": "v0.8.20+commit",
                    }
                ],
            },
        )

    transport = httpx.MockTransport(_handler)

    async def _run() -> VerifiedSourceBundle:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://eth.blockscout.com/api",
        ) as client:
            return await audit_adapters.fetch_blockscout_verified_source_bundle(
                chain="ethereum",
                contract_address="0x1111111111111111111111111111111111111111",
                client=client,
            )

    bundle = asyncio.run(_run())
    assert bundle.provider_name == "blockscout_verified_source"
    assert bundle.contract_name == "Vault"
    assert "contracts/Vault.sol" in bundle.source_bundle
    assert "selfdestruct" in bundle.source_bundle


def test_etherscan_adapter_parses_raw_source(monkeypatch: pytest.MonkeyPatch):
    settings = get_settings().model_copy(update={"etherscan_api_key": "etherscan-test-key"})
    monkeypatch.setattr("app.services.smart_contract_audit.adapters.get_settings", lambda: settings)

    def _handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["chainid"] == "1"
        assert request.url.params["apikey"] == "etherscan-test-key"
        return httpx.Response(
            200,
            json={
                "status": "1",
                "message": "OK",
                "result": [
                    {
                        "SourceCode": "pragma solidity ^0.8.20; contract Plain { function exec(address target, bytes calldata data) external { target.call(data); } }",
                        "ContractName": "Plain",
                        "CompilerVersion": "v0.8.20+commit",
                    }
                ],
            },
        )

    transport = httpx.MockTransport(_handler)

    async def _run() -> VerifiedSourceBundle:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="https://api.etherscan.io/v2/api",
        ) as client:
            return await audit_adapters.fetch_etherscan_verified_source_bundle(
                chain="ethereum",
                contract_address="0x1111111111111111111111111111111111111111",
                client=client,
            )

    bundle = asyncio.run(_run())
    assert bundle.provider_name == "etherscan_verified_source"
    assert bundle.contract_name == "Plain"
    assert "// File: Plain.sol" in bundle.source_bundle


def test_verified_source_fallback_uses_blockscout_when_sourcify_misses(monkeypatch: pytest.MonkeyPatch):
    async def _fail_sourcify(*, chain: str, contract_address: str) -> VerifiedSourceBundle:
        _ = chain, contract_address
        raise LookupError("sourcify miss")

    async def _blockscout_hit(*, chain: str, contract_address: str) -> VerifiedSourceBundle:
        return VerifiedSourceBundle(
            provider_name="blockscout_verified_source",
            chain=chain,
            chain_id="1",
            contract_address=contract_address,
            match="verified",
            verified_at=None,
            fetched_at=audit_adapters._now_utc(),
            source_bundle=RISKY_SOURCE,
            source_file_count=1,
        )

    monkeypatch.setattr(
        audit_adapters,
        "fetch_sourcify_verified_source_bundle",
        _fail_sourcify,
    )
    monkeypatch.setattr(
        audit_adapters,
        "fetch_blockscout_verified_source_bundle",
        _blockscout_hit,
    )

    bundle, attempts = asyncio.run(
        audit_adapters.fetch_verified_source_bundle_with_fallback(
            chain="ethereum",
            contract_address="0x1111111111111111111111111111111111111111",
        )
    )

    assert bundle.provider_name == "blockscout_verified_source"
    assert len(attempts) == 1
    assert attempts[0].provider_name == "sourcify_verified_source"


def test_verified_source_fallback_uses_etherscan_after_blockscout(monkeypatch: pytest.MonkeyPatch):
    async def _fail_sourcify(*, chain: str, contract_address: str) -> VerifiedSourceBundle:
        _ = chain, contract_address
        raise LookupError("sourcify miss")

    async def _fail_blockscout(*, chain: str, contract_address: str) -> VerifiedSourceBundle:
        _ = chain, contract_address
        raise LookupError("blockscout miss")

    async def _etherscan_hit(*, chain: str, contract_address: str) -> VerifiedSourceBundle:
        return VerifiedSourceBundle(
            provider_name="etherscan_verified_source",
            chain=chain,
            chain_id="1",
            contract_address=contract_address,
            match="verified",
            verified_at=None,
            fetched_at=audit_adapters._now_utc(),
            source_bundle=RISKY_SOURCE,
            source_file_count=1,
        )

    monkeypatch.setattr(
        audit_adapters,
        "fetch_sourcify_verified_source_bundle",
        _fail_sourcify,
    )
    monkeypatch.setattr(
        audit_adapters,
        "fetch_blockscout_verified_source_bundle",
        _fail_blockscout,
    )
    monkeypatch.setattr(
        audit_adapters,
        "fetch_etherscan_verified_source_bundle",
        _etherscan_hit,
    )

    bundle, attempts = asyncio.run(
        audit_adapters.fetch_verified_source_bundle_with_fallback(
            chain="ethereum",
            contract_address="0x1111111111111111111111111111111111111111",
        )
    )

    assert bundle.provider_name == "etherscan_verified_source"
    assert [attempt.provider_name for attempt in attempts] == [
        "sourcify_verified_source",
        "blockscout_verified_source",
    ]


def test_execute_smart_contract_audit_persists_fallback_attempt_observability(monkeypatch: pytest.MonkeyPatch):
    repository = InMemoryAuditRepository()
    payload = smart_contract_audit_service.SmartContractAuditRequest.model_validate(
        {
            "contract_address": "0x1111111111111111111111111111111111111111",
            "chain": "ethereum",
            "analysis_depth": "fast",
        }
    )

    async def _build(_payload):
        response = smart_contract_audit_service.SmartContractAuditResponse.model_validate(
            {
                "service": {
                    "serviceId": "svc_smart_contract_audit",
                    "serviceName": "Smart Contract Audit Model",
                    "version": "1.0.0",
                },
                "sources": [
                    {"name": "blockscout_verified_source", "freshnessSec": 0},
                    {"name": "synapse_rule_engine", "freshnessSec": 0},
                ],
                "freshness": {
                    "generatedAt": "2026-03-26T01:00:00Z",
                    "maxSourceAgeSec": 0,
                    "cacheHit": False,
                },
                "result": {
                    "target": "ethereum:0x1111111111111111111111111111111111111111",
                    "riskScore": 20,
                    "riskLevel": "low",
                    "criticalFindings": [],
                    "attackSurfaceSummary": "clean",
                    "fixSuggestions": ["manual review"],
                    "analysisMode": "fast",
                },
                "errors": [],
            }
        )
        return (
            response,
            (
                FetchAttemptError(
                    provider_name="sourcify_verified_source",
                    error_code="VERIFIED_SOURCE_NOT_FOUND",
                    message="sourcify miss",
                ),
            ),
        )

    monkeypatch.setattr(
        smart_contract_audit_service,
        "build_smart_contract_audit",
        _build,
    )

    asyncio.run(
        smart_contract_audit_service.execute_smart_contract_audit(
            payload,
            request_id="req-smart-audit-3",
            gateway_request_id="gw-smart-audit-3",
            repository=repository,
        )
    )

    assert repository.reports[0].observability_payload["resolvedSourceProvider"] == "blockscout_verified_source"
    assert repository.reports[0].observability_payload["fallbackAttempts"] == [
        {
            "providerName": "sourcify_verified_source",
            "errorCode": "VERIFIED_SOURCE_NOT_FOUND",
            "message": "sourcify miss",
        }
    ]
    assert repository.invocations[0].observability_payload["fallbackAttempts"] == [
        {
            "providerName": "sourcify_verified_source",
            "errorCode": "VERIFIED_SOURCE_NOT_FOUND",
            "message": "sourcify miss",
        }
    ]


def test_execute_smart_contract_audit_persists_failed_fallback_attempts(monkeypatch: pytest.MonkeyPatch):
    repository = InMemoryAuditRepository()
    payload = smart_contract_audit_service.SmartContractAuditRequest.model_validate(
        {
            "contract_address": "0x1111111111111111111111111111111111111111",
            "chain": "ethereum",
            "analysis_depth": "fast",
        }
    )

    async def _boom(_payload):
        raise HTTPException(
            status_code=404,
            detail={
                "code": "VERIFIED_SOURCE_NOT_FOUND",
                "message": "all providers miss",
                "fallback_attempts": [
                    {
                        "providerName": "sourcify_verified_source",
                        "errorCode": "VERIFIED_SOURCE_NOT_FOUND",
                        "message": "sourcify miss",
                    },
                    {
                        "providerName": "blockscout_verified_source",
                        "errorCode": "VERIFIED_SOURCE_NOT_FOUND",
                        "message": "blockscout miss",
                    },
                ],
            },
        )

    monkeypatch.setattr(
        smart_contract_audit_service,
        "build_smart_contract_audit",
        _boom,
    )

    with pytest.raises(HTTPException):
        asyncio.run(
            smart_contract_audit_service.execute_smart_contract_audit(
                payload,
                request_id="req-smart-audit-4",
                gateway_request_id="gw-smart-audit-4",
                repository=repository,
            )
        )

    assert repository.invocations[0].observability_payload["fallbackAttempts"] == [
        {
            "providerName": "sourcify_verified_source",
            "errorCode": "VERIFIED_SOURCE_NOT_FOUND",
            "message": "sourcify miss",
        },
        {
            "providerName": "blockscout_verified_source",
            "errorCode": "VERIFIED_SOURCE_NOT_FOUND",
            "message": "blockscout miss",
        },
    ]
