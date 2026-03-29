# pyright: reportMissingImports=false

import hashlib
import hmac
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.services import oss_security_healthcheck_service  # noqa: E402


def _signed_headers(payload: dict) -> dict[str, str]:
    settings = get_settings()
    service_id = oss_security_healthcheck_service.SERVICE_ID
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


def test_oss_security_healthcheck_returns_structured_response():
    client = TestClient(app)
    payload = {
        "repoUrl": "https://github.com/synapse-network/provider-examples",
        "packageList": ["lodash@4.17.19", "requests==2.19.1"],
        "ecosystem": "mixed",
    }

    response = client.post(
        "/provider-services/oss-security-healthcheck/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["service"]["serviceId"] == "svc_oss_security_healthcheck"
    assert body["service"]["serviceName"] == "OSS Security Healthcheck"
    assert isinstance(body["result"]["repo_health_score"], int)
    assert len(body["result"]["vulnerability_matches"]) >= 1
    assert len(body["result"]["upgrade_advice"]) >= 2


def test_oss_security_healthcheck_requires_gateway_signature():
    client = TestClient(app)
    response = client.post(
        "/provider-services/oss-security-healthcheck/invoke",
        json={"repoUrl": "https://github.com/example/repo"},
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "GATEWAY_SIGNATURE_REQUIRED"


def test_oss_security_healthcheck_requires_target_inputs():
    client = TestClient(app)
    payload = {
        "ecosystem": "npm",
    }

    response = client.post(
        "/provider-services/oss-security-healthcheck/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any("repoUrl or packageList" in item["msg"] for item in detail)


def test_oss_security_healthcheck_persists_snapshot_and_invocation(monkeypatch):
    from app.services.oss_security_healthcheck.repository import InMemoryOSSSecurityHealthcheckRepository
    from app.services import oss_security_healthcheck_service

    repository = InMemoryOSSSecurityHealthcheckRepository()
    monkeypatch.setattr(
        oss_security_healthcheck_service,
        "get_oss_security_healthcheck_repository",
        lambda: repository,
    )

    payload = {"repoUrl": "https://github.com/synapse-network/provider-examples"}
    response = TestClient(app).post(
        "/provider-services/oss-security-healthcheck/invoke",
        json=payload,
        headers=_signed_headers(payload),
    )

    assert response.status_code == 200
    assert len(repository.reports) == 1
    assert len(repository.invocations) == 1
    assert repository.invocations[0].response_status == 200


def test_oss_security_healthcheck_replay_from_snapshot_when_runtime_fails(monkeypatch):
    from app.services.oss_security_healthcheck.repository import InMemoryOSSSecurityHealthcheckRepository
    from app.services.oss_security_healthcheck.domain import OSSSecurityReportRecord
    from app.services import oss_security_healthcheck_service

    repository = InMemoryOSSSecurityHealthcheckRepository()
    payload = oss_security_healthcheck_service.OSSSecurityHealthcheckRequest.model_validate(
        {"repoUrl": "https://github.com/synapse-network/provider-examples"}
    )
    live_response = __import__("asyncio").run(
        oss_security_healthcheck_service.build_oss_security_healthcheck(payload)
    )
    report_key = oss_security_healthcheck_service.build_report_key(payload)
    repository.save_report(
        OSSSecurityReportRecord(
            report_key=report_key,
            request=payload,
            response=live_response,
            expires_at="2099-01-01T00:00:00Z",
        )
    )

    async def _boom(_payload):
        raise RuntimeError("upstream failed")

    monkeypatch.setattr(
        oss_security_healthcheck_service,
        "build_oss_security_healthcheck",
        _boom,
    )
    monkeypatch.setattr(
        oss_security_healthcheck_service,
        "get_oss_security_healthcheck_repository",
        lambda: repository,
    )

    response = __import__("asyncio").run(
        oss_security_healthcheck_service.execute_oss_security_healthcheck(
            payload,
            request_id="req-1",
            gateway_request_id="gw-1",
        )
    )

    assert response.freshness.cache_hit is True
    assert response.errors[-1].code == "OSS_SECURITY_SNAPSHOT_FALLBACK_USED"
