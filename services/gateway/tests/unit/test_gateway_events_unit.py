"""Unit tests for gateway_events module and business-logic instrumentation."""
import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.services.analytics.emitter import (
    AnalyticsEmitter,
    FileBackend,
    create_analytics_emitter,
)
from src.services.analytics.gateway_events import (
    _emit,
    emit_budget_blocked,
    emit_deposit_completed,
    emit_deposit_failed,
    emit_invoke_completed,
    emit_invoke_failed,
    emit_invoke_started,
    emit_provider_revenue_received,
    emit_quote_generated,
    emit_refund_completed,
    emit_risk_rule_triggered,
    emit_settlement_claim_completed,
    emit_settlement_claim_requested,
    emit_withdrawal_completed,
    get_emitter,
    set_emitter,
)
from src.services.analytics.privacy import sha256_hash


@pytest.fixture(autouse=True)
def reset_emitter():
    """Reset module-level emitter before and after each test."""
    set_emitter(None)
    yield
    set_emitter(None)


@pytest.fixture
def file_emitter(tmp_path) -> AnalyticsEmitter:
    return create_analytics_emitter(
        environment="local",
        fallback_file=str(tmp_path / "gw_events.jsonl"),
    )


@pytest.fixture
def events_file(tmp_path) -> Path:
    return tmp_path / "gw_events.jsonl"


def _read_events(events_file: Path) -> list[dict]:
    if not events_file.exists():
        return []
    lines = events_file.read_text().strip().split("\n")
    return [json.loads(line) for line in lines if line.strip()]


class TestSetGetEmitter:
    def test_default_is_none(self):
        assert get_emitter() is None

    def test_set_and_get(self, file_emitter):
        set_emitter(file_emitter)
        assert get_emitter() is file_emitter


class TestEmitNoop:
    async def test_emit_noop_when_no_emitter(self):
        """_emit should silently no-op when emitter is not set."""
        await _emit("test_event", "0xABC")
        # No exception raised


class TestEmitQuoteGenerated:
    async def test_emits_quote_event(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_quote_generated(
            "0xConsumer123",
            service_id="svc_1",
            quote_id="q_1",
            price_usdc=0.05,
            correlation_id="corr_abc",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "quote_generated"
        assert e["distinct_id"] == sha256_hash("0xConsumer123")
        assert e["properties"]["service_id"] == "svc_1"
        assert e["properties"]["quote_id"] == "q_1"
        assert e["properties"]["price_usdc"] == "0.050000"
        assert e["properties"]["correlation_id"] == "corr_abc"
        assert e["properties"]["role"] == "consumer"


class TestEmitInvokeCompleted:
    async def test_emits_invoke_started(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_invoke_started(
            "0xConsumer",
            service_id="svc_2",
            provider_address="0xProvider",
            quote_id="q_2",
            price_usdc=0.10,
            correlation_id="corr_started",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "invoke_started"
        assert e["properties"]["service_id"] == "svc_2"
        assert e["properties"]["provider_id"] == sha256_hash("0xProvider")
        assert e["properties"]["quote_id"] == "q_2"
        assert e["properties"]["price_usdc"] == "0.100000"
        assert e["properties"]["correlation_id"] == "corr_started"

    async def test_emits_invoke_completed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_invoke_completed(
            "0xConsumer",
            service_id="svc_2",
            provider_address="0xProvider",
            quote_id="q_2",
            price_usdc=0.10,
            latency_ms=342,
            is_first_invoke=True,
            correlation_id="corr_xyz",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "invoke_completed"
        assert e["properties"]["provider_id"] == sha256_hash("0xProvider")
        assert e["properties"]["price_usdc"] == "0.100000"
        assert e["properties"]["latency_ms"] == 342
        assert e["properties"]["is_first_invoke"] is True


class TestEmitInvokeFailed:
    async def test_emits_invoke_failed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_invoke_failed(
            "0xConsumer",
            service_id="svc_3",
            provider_address="0xProvider",
            quote_id="q_3",
            error_code="UPSTREAM_TIMEOUT",
            failure_stage="upstream",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "invoke_failed"
        assert e["properties"]["error_code"] == "UPSTREAM_TIMEOUT"
        assert e["properties"]["failure_stage"] == "upstream"

    async def test_default_error_code(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_invoke_failed(
            "0xConsumer",
            service_id="svc_3",
            provider_address="0xProvider",
            quote_id="q_3",
        )
        events = _read_events(events_file)
        assert events[0]["properties"]["error_code"] == "UNKNOWN"


class TestEmitBudgetBlocked:
    async def test_emits_budget_blocked(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_budget_blocked(
            "0xConsumer",
            service_id="svc_4",
            required_usdc=1.0,
            available_usdc=0.5,
            error_code="BUDGET_EXHAUSTED",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "budget_blocked"
        assert e["properties"]["required_usdc"] == "1.000000"
        assert e["properties"]["available_usdc"] == "0.500000"
        assert e["properties"]["error_code"] == "BUDGET_EXHAUSTED"


class TestEmitDepositCompleted:
    async def test_emits_deposit_completed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_deposit_completed(
            "0xOwner",
            amount_usdc=50.0,
            tx_hash="0xabc123",
            token_symbol="USDC",
            time_to_confirm_ms=5000,
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "deposit_completed"
        assert e["properties"]["amount_usdc"] == "50.000000"
        assert e["properties"]["tx_hash"] == "0xabc123"
        assert e["properties"]["time_to_confirm_ms"] == 5000

    async def test_defaults_confirm_time_when_none(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_deposit_completed(
            "0xOwner", amount_usdc=10.0, tx_hash="0x123",
        )
        events = _read_events(events_file)
        assert events[0]["properties"]["time_to_confirm_ms"] == 0


class TestEmitDepositFailed:
    async def test_emits_deposit_failed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_deposit_failed(
            "0xOwner", amount_usdc=100.0, error_code="CHAIN_TX_FAILED",
        )
        events = _read_events(events_file)
        assert len(events) == 1
        assert events[0]["event_name"] == "deposit_failed"
        assert events[0]["properties"]["error_code"] == "CHAIN_TX_FAILED"


class TestEmitProviderRevenueReceived:
    async def test_emits_provider_revenue(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_provider_revenue_received(
            "0xProvider",
            service_id="svc_5",
            gross_usdc=0.10,
            platform_fee_usdc=0.01,
            provider_net_usdc=0.09,
        )
        events = _read_events(events_file)
        assert len(events) == 1
        e = events[0]
        assert e["event_name"] == "provider_revenue_received"
        assert e["properties"]["role"] == "provider"
        assert e["properties"]["provider_id"] == sha256_hash("0xProvider")
        assert e["properties"]["gross_usdc"] == "0.100000"
        assert e["properties"]["provider_net_usdc"] == "0.090000"


class TestEmitWithdrawalCompleted:
    async def test_consumer_withdrawal(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_withdrawal_completed(
            "0xConsumer", amount_usdc=25.0, tx_hash="0xtx1", role="consumer",
        )
        events = _read_events(events_file)
        assert events[0]["event_name"] == "withdrawal_completed"
        assert events[0]["properties"]["role"] == "consumer"

    async def test_provider_withdrawal(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_withdrawal_completed(
            "0xProvider", amount_usdc=50.0, tx_hash="0xtx2", role="provider",
        )
        events = _read_events(events_file)
        assert events[0]["properties"]["role"] == "provider"


class TestEmitSettlementClaim:
    async def test_settlement_claim_requested(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_settlement_claim_requested(
            "0xProvider", claim_usdc=100.0,
        )
        events = _read_events(events_file)
        assert events[0]["event_name"] == "settlement_claim_requested"
        assert events[0]["properties"]["claim_usdc"] == "100.000000"

    async def test_settlement_claim_completed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_settlement_claim_completed(
            "0xProvider", claim_usdc=100.0, tx_hash="0xtx3",
        )
        events = _read_events(events_file)
        assert events[0]["event_name"] == "settlement_claim_completed"
        assert events[0]["properties"]["tx_hash"] == "0xtx3"


class TestEmitRefundCompleted:
    async def test_emits_refund_completed(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_refund_completed(
            "0xOwner",
            amount_usdc=5.0,
            reason_code="SERVICE_FAILURE",
            tx_hash="0xref1",
        )
        events = _read_events(events_file)
        assert events[0]["event_name"] == "refund_completed"
        assert events[0]["properties"]["reason_code"] == "SERVICE_FAILURE"


class TestEmitRiskRuleTriggered:
    async def test_emits_risk_event(self, file_emitter, events_file):
        set_emitter(file_emitter)
        await emit_risk_rule_triggered(
            "0xSuspect",
            rule_code="HIGH_VELOCITY_WITHDRAW",
            severity="critical",
        )
        events = _read_events(events_file)
        assert events[0]["event_name"] == "risk_rule_triggered"
        assert events[0]["properties"]["rule_code"] == "HIGH_VELOCITY_WITHDRAW"
        assert events[0]["properties"]["severity"] == "critical"


class TestPrivacyIntegration:
    async def test_distinct_id_is_always_hashed(self, file_emitter, events_file):
        """All events must hash wallet addresses — never send raw 0x addresses."""
        set_emitter(file_emitter)
        raw_address = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12"
        await emit_invoke_completed(
            raw_address,
            service_id="svc_1",
            provider_address="0xProviderAddr",
            quote_id="q_1",
            price_usdc=0.01,
            latency_ms=100,
        )
        events = _read_events(events_file)
        e = events[0]
        # distinct_id must be a SHA-256 hash, not the raw address
        assert not e["distinct_id"].startswith("0x")
        assert len(e["distinct_id"]) == 64
        assert e["distinct_id"] == sha256_hash(raw_address)
        # provider_id must also be hashed
        assert not e["properties"]["provider_id"].startswith("0x")


class TestErrorResilience:
    async def test_emit_swallows_backend_errors(self, file_emitter):
        """Analytics should never crash the main business logic."""
        set_emitter(file_emitter)
        # Force backend to raise
        file_emitter._backend.send = AsyncMock(side_effect=RuntimeError("kafka down"))
        # Should not raise
        await emit_invoke_completed(
            "0xWallet",
            service_id="svc",
            provider_address="0xProv",
            quote_id="q",
            price_usdc=0.01,
            latency_ms=10,
        )
