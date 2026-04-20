from __future__ import annotations

import asyncio
import json
import logging
from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException

import gateway_fastapi
from src import app as gateway_app
from src.api import deps as api_deps
from src.api.schemas.pydantic_models import InferenceRequest
from src.core.log_config import setup_logger
from src.core.config import settings
from src.services.owner import forwarding_service, forwarding_validation, forwarding_billing
from src.services.platform import credential_service
from src.services.platform.balance_service import BalanceService
from src.utils.logging_utils import workflow_logger


class FakeWorkflowLog:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, object]]] = []

    def info(self, message: str, **fields: object) -> None:
        self.calls.append(("info", message, dict(fields)))

    def warning(self, message: str, **fields: object) -> None:
        self.calls.append(("warning", message, dict(fields)))

    def error(self, message: str, **fields: object) -> None:
        self.calls.append(("error", message, dict(fields)))

    def exception(self, message: str, **fields: object) -> None:
        self.calls.append(("exception", message, dict(fields)))


class StubRegistryService:
    def __init__(self, response: list[dict[str, object]] | None = None) -> None:
        self.response = list(response or [])

    async def discover_services(self, *_, **__) -> list[dict[str, object]]:
        await asyncio.sleep(0)
        return list(self.response)


async def _background_loop_until_stopped(stop_event, storage) -> None:
    _ = storage
    await stop_event.wait()


@contextmanager
def _http_client(monkeypatch, *, registry_service: StubRegistryService | None = None):
    fake_storage = SimpleNamespace()

    monkeypatch.setattr(gateway_app, "create_storage", lambda settings: fake_storage)
    monkeypatch.setattr(gateway_app, "run_v2_deposit_indexer", _background_loop_until_stopped)
    monkeypatch.setattr(gateway_app, "run_service_health_monitor", _background_loop_until_stopped)
    monkeypatch.setattr(
        gateway_app,
        "run_provider_withdraw_expiry_reaper",
        _background_loop_until_stopped,
    )
    monkeypatch.setattr(
        gateway_app.settings, "service_health_monitor_enabled", False, raising=False
    )
    monkeypatch.setattr(
        gateway_app.settings,
        "provider_withdraw_expiry_reaper_enabled",
        False,
        raising=False,
    )

    app = gateway_app.create_app()
    app.dependency_overrides = {}
    if registry_service is not None:
        app.dependency_overrides[api_deps.get_registry_service] = lambda: registry_service

    with TestClient(app, base_url="https://gateway.test") as client:
        yield client


@contextmanager
def capture_logs(level: int = logging.INFO):
    records: list[logging.LogRecord] = []

    class _ListHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record)

    handler = _ListHandler()
    handler.setLevel(level)
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        yield records
    finally:
        root.removeHandler(handler)


def _patch_invocation_dependencies(monkeypatch):
    monkeypatch.setattr(
        forwarding_validation,
        "validate_service_id",
        lambda header, body: body or header or "svc.echo",
    )
    monkeypatch.setattr(
        forwarding_validation,
        "validate_credential_token",
        lambda token: token or "cred_1",
    )
    monkeypatch.setattr(
        forwarding_validation,
        "resolve_request_id",
        lambda request_id: request_id or "req-auto",
    )
    monkeypatch.setattr(
        credential_service,
        "resolve_active_credential",
        lambda storage, token: SimpleNamespace(
            credential=SimpleNamespace(credential_id="cred_1"),
            agent=SimpleNamespace(agent_id="agent_1"),
            owner=SimpleNamespace(owner_wallet="0xabc"),
        ),
    )
    monkeypatch.setattr(
        forwarding_validation,
        "find_active_service",
        lambda storage, service_id: SimpleNamespace(service_id=service_id),
    )
    monkeypatch.setattr(
        forwarding_validation,
        "parse_service_price_usdc",
        lambda service: 0.25,
    )
    monkeypatch.setattr(forwarding_service, "_request_payload", lambda req, svc: {"text": "hi"})
    monkeypatch.setattr(
        forwarding_validation,
        "validate_invoke_request_contract",
        lambda service, payload: None,
    )
    monkeypatch.setattr(
        forwarding_service,
        "build_service_quote",
        lambda service, credential, payload, price, response_mode=None: SimpleNamespace(quote_id="quote_1"),
    )
    monkeypatch.setattr(forwarding_service, "persist_quote", lambda storage, quote: None)

    async def _stub_emit(*_, **__):  # pragma: no cover - async stub
        return None

    monkeypatch.setattr(forwarding_service, "emit_quote_generated", _stub_emit)

    async def _stub_pipeline(*_, **__):
        invocation = SimpleNamespace(
            invocation_id="inv_1",
            status="RUNNING",
            result=SimpleNamespace(payload={"answer": "ok"}),
        )
        return invocation, 9.0, {"unit_price": 0.25, "total_charge": 0.5}

    monkeypatch.setattr(forwarding_service, "_execute_invocation_pipeline", _stub_pipeline)

    def _stub_receipt(**kwargs):
        return {"request_id": kwargs["request_id"], "quote_id": kwargs["quote_id"]}

    monkeypatch.setattr(forwarding_billing, "build_consumer_receipt", _stub_receipt)

    def _stub_success(receipt, payload):
        return SimpleNamespace(payload=SimpleNamespace(receipt=receipt, data=SimpleNamespace(result=payload)))

    monkeypatch.setattr(forwarding_billing, "build_consumer_success_response", _stub_success)


def test_setup_logger_writes_json_file(tmp_path):
    log_path = tmp_path / "gateway.log"
    setup_logger(
        log_file_path=str(log_path),
        log_rotation="200 KB",
        log_retention="2 days",
        log_level="INFO",
        serialize=True,
        enqueue=False,
    )
    workflow_logger("unit", request_id="req-demo").info("unit-test", key="value")
    contents = log_path.read_text().strip().splitlines()
    assert contents
    record = json.loads(contents[-1])
    assert record["message"] == "unit-test"
    assert record["extra"]["request_id"] == "req-demo"
    assert record["extra"]["workflow"] == "unit"


def test_setup_logger_serializes_decimal_fields(tmp_path):
    log_path = tmp_path / "gateway.log"
    setup_logger(
        log_file_path=str(log_path),
        log_rotation="200 KB",
        log_retention="2 days",
        log_level="INFO",
        serialize=True,
        enqueue=False,
    )
    workflow_logger("unit", request_id="req-decimal").info(
        "decimal-test",
        amount_usdc=Decimal("23.703000"),
    )
    contents = log_path.read_text().strip().splitlines()
    assert contents
    record = json.loads(contents[-1])
    assert record["message"] == "decimal-test"
    assert record["extra"]["amount_usdc"] == "23.703000"


def test_log_file_path_uses_daily_directory(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "log_directory", str(tmp_path), raising=False)
    monkeypatch.setattr(settings, "log_file_name", "gateway.log", raising=False)
    monkeypatch.setattr(
        settings, "_log_date_slug", lambda self=None: "2026-04-14", raising=False
    )
    expected = tmp_path / "2026-04-14" / "gateway.log"
    assert settings.log_file_path == str(expected)


def test_setup_logger_uses_daily_directory(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "log_directory", str(tmp_path), raising=False)
    monkeypatch.setattr(settings, "log_file_name", "gateway.log", raising=False)
    monkeypatch.setattr(
        settings, "_log_date_slug", lambda self=None: "2026-04-14", raising=False
    )
    setup_logger(
        log_file_path=None,
        log_rotation="10 MB",
        log_retention="2 days",
        log_level="INFO",
        serialize=True,
        enqueue=False,
    )
    expected = tmp_path / "2026-04-14" / "gateway.log"
    workflow_logger("daily", request_id="req-daily").info("daily-test")
    assert expected.exists()


def test_discover_services_logs_workflow(monkeypatch):
    registry_service = StubRegistryService(
        response=[{"serviceId": "svc.echo", "serviceName": "Echo"}]
    )
    with capture_logs() as records, _http_client(
        monkeypatch, registry_service=registry_service
    ) as client:
        response = client.get(
            "/api/v1/services/discover",
            params={"intent": "echo", "sortBy": "best_match", "sortOrder": "desc"},
            headers={"X-Request-Id": "req-discovery"},
        )
    assert response.status_code == 200
    messages = [
        (getattr(rec, "workflow", None), rec.getMessage()) for rec in records
    ]
    assert ("discovery", "discovery.start") in messages
    assert ("discovery", "discovery.complete") in messages


def test_generate_response_logs_invocation(monkeypatch):
    fake_log = FakeWorkflowLog()
    monkeypatch.setattr(
        forwarding_service,
        "_invocation_logger",
        lambda *args, **kwargs: fake_log,
    )
    _patch_invocation_dependencies(monkeypatch)
    storage = SimpleNamespace()
    result = asyncio.run(
        forwarding_service.generate_response_v2(
            storage,
            InferenceRequest(prompt="hello", serviceId="svc.echo"),
            "svc.echo",
            "cred_token",
            "req-test",
        )
    )
    assert result.payload.receipt["request_id"] == "req-test"
    assert any(call[1] == "invocation.start" for call in fake_log.calls)
    assert any(call[1] == "invocation.complete" for call in fake_log.calls)


def test_generate_response_logs_failure(monkeypatch):
    fake_log = FakeWorkflowLog()
    monkeypatch.setattr(
        forwarding_service,
        "_invocation_logger",
        lambda *args, **kwargs: fake_log,
    )
    _patch_invocation_dependencies(monkeypatch)

    async def _failing_pipeline(*_, **__):
        raise HTTPException(status_code=422, detail={"code": "BUDGET"})

    monkeypatch.setattr(forwarding_service, "_execute_invocation_pipeline", _failing_pipeline)
    storage = SimpleNamespace()
    with pytest.raises(HTTPException):
        asyncio.run(
            forwarding_service.generate_response_v2(
                storage,
                InferenceRequest(prompt="hello", serviceId="svc.echo"),
                "svc.echo",
                "cred_token",
                None,
            )
        )
    assert any(call[0] == "warning" and call[1] == "invocation.failed" for call in fake_log.calls)


def test_balance_service_logs_settlement(monkeypatch):
    balance_service = BalanceService(storage=SimpleNamespace())
    fake_log = FakeWorkflowLog()
    monkeypatch.setattr(balance_service, "_settlement_logger", lambda *args, **kwargs: fake_log)

    async def _stub_create(*_, **__):
        return {"withdrawalId": "wd_1", "status": "PENDING"}

    balance_service.provider_withdraw_service = SimpleNamespace(
        create_provider_withdraw_intent=_stub_create,
    )

    result = asyncio.run(
        balance_service.create_provider_withdraw_intent(
            payload={"amountUsdc": 2.5},
            owner_wallet="0xabc",
            idempotency_key="idem",
            request_meta={"requestId": "req-settle"},
        )
    )
    assert result["withdrawalId"] == "wd_1"
    assert any(call[1] == "settlement.start" for call in fake_log.calls)
    assert any(call[1] == "settlement.complete" for call in fake_log.calls)


def test_balance_service_logs_failure(monkeypatch):
    balance_service = BalanceService(storage=SimpleNamespace())
    fake_log = FakeWorkflowLog()
    monkeypatch.setattr(balance_service, "_settlement_logger", lambda *args, **kwargs: fake_log)

    async def _stub_create(*_, **__):
        raise RuntimeError("boom")

    balance_service.provider_withdraw_service = SimpleNamespace(
        create_provider_withdraw_intent=_stub_create,
    )

    with pytest.raises(RuntimeError):
        asyncio.run(
            balance_service.create_provider_withdraw_intent(
                payload={"amountUsdc": 1.0},
                owner_wallet="0xabc",
                idempotency_key="idem",
                request_meta=None,
            )
        )
    assert any(call[0] == "exception" and call[1] == "settlement.failed" for call in fake_log.calls)


def test_gateway_fastapi_startup_logs_to_file(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "log_directory", str(tmp_path / "logs"), raising=False)
    monkeypatch.setattr(settings, "log_file_name", "gateway.log", raising=False)

    captured_run: dict[str, object] = {}

    def _fake_run(*args, **kwargs):
        captured_run["args"] = args
        captured_run["kwargs"] = kwargs

    monkeypatch.setattr(gateway_fastapi, "uvicorn", SimpleNamespace(run=_fake_run))

    gateway_fastapi._run_gateway()

    assert captured_run["kwargs"]["log_config"] is None

    log_files = sorted((tmp_path / "logs").glob("*/gateway.log"))
    assert log_files, "Daily file handler did not create a log file"
    newest_file = log_files[-1]
    contents = newest_file.read_text().strip().splitlines()
    assert contents
    record = json.loads(contents[-1])
    assert record["extra"]["service"] == "synapse-gateway"
    assert record["extra"]["host"] == settings.provider_api_host
