"""Step 8: Analytics full-chain verification.

This test intentionally runs after the normal gateway e2e chain:

1. provider registers a callable service
2. consumer deposits USDC
3. agent credential invokes the provider service
4. gateway emits business analytics events
5. ClickHouse-backed admin analytics aggregates match the raw invocation data

Run:
    ANALYTICS_FULLCHAIN_E2E=true pytest tests/e2e/test_01_infrastructure.py \
      tests/e2e/test_02_wallet_auth.py tests/e2e/test_03_fund_wallet.py \
      tests/e2e/test_04_deposit.py tests/e2e/test_05_provider_register.py \
      tests/e2e/test_06_agent_credential.py tests/e2e/test_07_invoke.py \
      tests/e2e/test_08_analytics_fullchain.py -q
"""

from __future__ import annotations

import json
import os
import time
import uuid
from decimal import Decimal
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest

from src.services.analytics.privacy import sha256_hash
from tests.e2e.conftest import GATEWAY_BASE, ROOT, SESSION_ID

ANALYTICS_FULLCHAIN_E2E = os.getenv("ANALYTICS_FULLCHAIN_E2E", "").lower() == "true"
CLICKHOUSE_URL = os.getenv("ANALYTICS_CLICKHOUSE_URL", "http://127.0.0.1:8123")
REPORT_DIR = ROOT / "output" / "analytics-fullchain"
REPORT_PATH = REPORT_DIR / "report.json"
SUPPLEMENTAL_EVENTS = {
    "invoke_failed",
    "budget_blocked",
    "deposit_failed",
    "withdrawal_completed",
    "withdrawal_failed",
    "refund_completed",
    "risk_rule_triggered",
    "provider_health_degraded",
    "provider_first_revenue_received",
    "settlement_claim_requested",
    "settlement_claim_completed",
    "settlement_claim_failed",
}

pytestmark = pytest.mark.skipif(
    not ANALYTICS_FULLCHAIN_E2E,
    reason="set ANALYTICS_FULLCHAIN_E2E=true to run ClickHouse full-chain analytics e2e",
)


def _sql_string(value: object) -> str:
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


def _query_clickhouse(sql: str) -> list[dict[str, Any]]:
    with httpx.Client(timeout=10) as client:
        response = client.post(
            CLICKHOUSE_URL.rstrip("/") + "/",
            content=(sql.strip() + "\nFORMAT JSONEachRow").encode("utf-8"),
            headers={"Content-Type": "text/plain"},
        )
    response.raise_for_status()
    if not response.text.strip():
        return []
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def _execute_clickhouse(sql: str) -> None:
    with httpx.Client(timeout=15) as client:
        response = client.post(
            CLICKHOUSE_URL.rstrip("/") + "/",
            content=sql.strip().encode("utf-8"),
            headers={"Content-Type": "text/plain"},
        )
    response.raise_for_status()


def _frontend_event(event_name: str, distinct_id: str, *, marker: str, role: str) -> dict[str, Any]:
    return {
        "event_id": str(uuid.uuid4()),
        "event_name": event_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "distinct_id": distinct_id,
        "source": "frontend",
        "properties": {
            "role": role,
            "surface": "analytics_fullchain_e2e",
            "env": os.getenv("ENVIRONMENT", "local"),
            "e2e_marker": marker,
        },
    }


def _now_clickhouse_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:23]


def _money(value: Decimal | str | int) -> str:
    return format(Decimal(str(value)).quantize(Decimal("0.000001")), "f")


def _analytics_row(
    event_name: str,
    distinct_id: str,
    *,
    source: str,
    role: str,
    surface: str,
    marker: str,
    correlation_id: str,
    properties: dict[str, Any],
) -> dict[str, Any]:
    payload = {
        "role": role,
        "surface": surface,
        "env": os.getenv("ENVIRONMENT", "local"),
        "e2e_marker": marker,
        "correlation_id": correlation_id,
        **properties,
    }
    return {
        "event_id": str(uuid.uuid4()),
        "event_name": event_name,
        "timestamp": _now_clickhouse_timestamp(),
        "distinct_id": distinct_id,
        "source": source,
        "role": role,
        "surface": surface,
        "env": payload["env"],
        "correlation_id": correlation_id,
        "properties": json.dumps(payload, separators=(",", ":")),
    }


def _insert_supplemental_clickhouse_events(
    *,
    marker: str,
    service_id: str,
    deposit_tx_hash: str,
    consumer_hash: str,
    provider_hash: str,
) -> list[dict[str, Any]]:
    """Seed deterministic edge-case rows that are hard to force through the happy-path e2e flow.

    The main 01-07 e2e chain still proves real Gateway business events reach ClickHouse.
    These supplemental rows make every Admin Analytics drilldown verifiable in one run.
    """
    rows = [
        _analytics_row(
            "service_registered",
            provider_hash,
            source="gateway",
            role="provider",
            surface="provider_register",
            marker=marker,
            correlation_id=f"{marker}:service_registered",
            properties={
                "provider_id": provider_hash,
                "service_id": service_id,
                "service_name": service_id,
            },
        ),
        _analytics_row(
            "deposit_completed",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="deposit_indexer",
            marker=marker,
            correlation_id=f"{marker}:deposit_completed",
            properties={
                "amount_usdc": _money("10"),
                "token_symbol": "USDC",
                "tx_hash": deposit_tx_hash,
                "time_to_confirm_ms": 91000,
            },
        ),
        _analytics_row(
            "quote_generated",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="agent_invoke",
            marker=marker,
            correlation_id=f"{marker}:quote_generated",
            properties={
                "service_id": service_id,
                "quote_id": f"quote_{marker}_ok",
                "price_usdc": _money("0.001100"),
            },
        ),
        _analytics_row(
            "invoke_started",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="agent_invoke",
            marker=marker,
            correlation_id=f"{marker}:invoke_started",
            properties={
                "service_id": service_id,
                "provider_id": provider_hash,
                "quote_id": f"quote_{marker}_ok",
                "price_usdc": _money("0.001100"),
            },
        ),
        _analytics_row(
            "invoke_completed",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="agent_invoke",
            marker=marker,
            correlation_id=f"{marker}:invoke_completed",
            properties={
                "service_id": service_id,
                "provider_id": provider_hash,
                "quote_id": f"quote_{marker}_ok",
                "price_usdc": _money("0.001100"),
                "latency_ms": 187,
                "is_first_invoke": True,
            },
        ),
        _analytics_row(
            "provider_revenue_received",
            provider_hash,
            source="gateway",
            role="provider",
            surface="agent_invoke",
            marker=marker,
            correlation_id=f"{marker}:provider_revenue_received",
            properties={
                "provider_id": provider_hash,
                "service_id": service_id,
                "gross_usdc": _money("0.001100"),
                "platform_fee_usdc": _money("0.000110"),
                "provider_net_usdc": _money("0.000990"),
            },
        ),
        _analytics_row(
            "page_viewed",
            consumer_hash,
            source="frontend",
            role="consumer",
            surface="analytics_fullchain_e2e",
            marker=marker,
            correlation_id=f"{marker}:page_viewed",
            properties={"page_path": "/"},
        ),
        _analytics_row(
            "wallet_connected",
            consumer_hash,
            source="frontend",
            role="consumer",
            surface="analytics_fullchain_e2e",
            marker=marker,
            correlation_id=f"{marker}:wallet_connected",
            properties={"wallet_type": "local_e2e"},
        ),
        _analytics_row(
            "consumer_signup_completed",
            consumer_hash,
            source="frontend",
            role="consumer",
            surface="analytics_fullchain_e2e",
            marker=marker,
            correlation_id=f"{marker}:consumer_signup_completed",
            properties={"signup_method": "wallet"},
        ),
        _analytics_row(
            "provider_signup_completed",
            provider_hash,
            source="frontend",
            role="provider",
            surface="analytics_fullchain_e2e",
            marker=marker,
            correlation_id=f"{marker}:provider_signup_completed",
            properties={"signup_method": "wallet"},
        ),
        _analytics_row(
            "invoke_failed",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="agent_invoke",
            marker=marker,
            correlation_id=f"{marker}:invoke_failed",
            properties={
                "service_id": service_id,
                "provider_id": provider_hash,
                "quote_id": f"quote_{marker}_failed",
                "error_code": "UPSTREAM_TIMEOUT",
                "failure_stage": "upstream",
            },
        ),
        _analytics_row(
            "budget_blocked",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="agent_invoke",
            marker=marker,
            correlation_id=f"{marker}:budget_blocked",
            properties={
                "service_id": service_id,
                "required_usdc": _money("12.500000"),
                "available_usdc": _money("2.000000"),
                "error_code": "OWNER_BILLING_CYCLE_LIMIT_EXCEEDED",
            },
        ),
        _analytics_row(
            "deposit_failed",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="deposit_repair",
            marker=marker,
            correlation_id=f"{marker}:deposit_failed",
            properties={
                "amount_usdc": _money("25"),
                "error_code": "INVALID_INTENT",
                "tx_hash": f"0x{uuid.uuid4().hex}{uuid.uuid4().hex}",
            },
        ),
        _analytics_row(
            "withdrawal_completed",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="consumer_withdraw",
            marker=marker,
            correlation_id=f"{marker}:withdrawal_completed",
            properties={
                "amount_usdc": _money("3.5"),
                "tx_hash": f"0x{uuid.uuid4().hex}{uuid.uuid4().hex}",
                "time_to_confirm_ms": 118000,
            },
        ),
        _analytics_row(
            "withdrawal_failed",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="consumer_withdraw",
            marker=marker,
            correlation_id=f"{marker}:withdrawal_failed",
            properties={
                "amount_usdc": _money("1.25"),
                "error_code": "USER_REJECTED_SIGNATURE",
            },
        ),
        _analytics_row(
            "refund_completed",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="refund",
            marker=marker,
            correlation_id=f"{marker}:refund_completed",
            properties={
                "amount_usdc": _money("0.75"),
                "reason_code": "UPSTREAM_TIMEOUT",
                "service_id": service_id,
            },
        ),
        _analytics_row(
            "risk_rule_triggered",
            consumer_hash,
            source="gateway",
            role="consumer",
            surface="agent_invoke",
            marker=marker,
            correlation_id=f"{marker}:risk_rule_triggered",
            properties={
                "rule_code": "BUDGET_GAP_SPIKE",
                "severity": "high",
            },
        ),
        _analytics_row(
            "provider_health_degraded",
            provider_hash,
            source="gateway",
            role="provider",
            surface="service_health_monitor",
            marker=marker,
            correlation_id=f"{marker}:provider_health_degraded",
            properties={
                "provider_id": provider_hash,
                "service_id": service_id,
                "healthy_targets": 0,
                "total_targets": 1,
                "overall_status": "unhealthy",
                "reason": "dogfood synthetic timeout",
            },
        ),
        _analytics_row(
            "provider_first_revenue_received",
            provider_hash,
            source="gateway",
            role="provider",
            surface="agent_invoke",
            marker=marker,
            correlation_id=f"{marker}:provider_first_revenue_received",
            properties={
                "provider_id": provider_hash,
                "service_id": service_id,
                "gross_usdc": _money("0.50"),
                "time_since_listing_ms": 42000,
                "is_first_revenue": True,
            },
        ),
        _analytics_row(
            "settlement_claim_requested",
            provider_hash,
            source="gateway",
            role="provider",
            surface="provider_settlement",
            marker=marker,
            correlation_id=f"{marker}:settlement_claim_requested",
            properties={
                "provider_id": provider_hash,
                "claim_usdc": _money("0.40"),
            },
        ),
        _analytics_row(
            "settlement_claim_completed",
            provider_hash,
            source="gateway",
            role="provider",
            surface="provider_settlement",
            marker=marker,
            correlation_id=f"{marker}:settlement_claim_completed",
            properties={
                "provider_id": provider_hash,
                "claim_usdc": _money("0.25"),
                "tx_hash": f"0x{uuid.uuid4().hex}{uuid.uuid4().hex}",
                "time_to_confirm_ms": 98000,
            },
        ),
        _analytics_row(
            "settlement_claim_failed",
            provider_hash,
            source="gateway",
            role="provider",
            surface="provider_settlement",
            marker=marker,
            correlation_id=f"{marker}:settlement_claim_failed",
            properties={
                "provider_id": provider_hash,
                "claim_usdc": _money("0.15"),
                "error_code": "RPC_TIMEOUT",
            },
        ),
    ]
    _execute_clickhouse(
        "INSERT INTO synapse_analytics.events "
        "(event_id,event_name,timestamp,distinct_id,source,role,surface,env,correlation_id,properties) "
        "FORMAT JSONEachRow\n"
        + "\n".join(json.dumps(row, separators=(",", ":")) for row in rows)
    )
    return rows


def _wait_for_events(service_id: str, deposit_tx_hash: str, marker: str) -> list[dict[str, Any]]:
    service_id_sql = _sql_string(service_id)
    tx_hash_sql = _sql_string(deposit_tx_hash)
    marker_sql = _sql_string(marker)
    deadline = time.monotonic() + int(os.getenv("ANALYTICS_FULLCHAIN_TIMEOUT_SEC", "60"))
    rows: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        rows = _query_clickhouse(
            f"""
            SELECT
              event_name AS eventName,
              distinct_id AS distinctId,
              source,
              role,
              JSONExtractString(properties, 'service_id') AS serviceId,
              JSONExtractString(properties, 'tx_hash') AS txHash,
              JSONExtractString(properties, 'e2e_marker') AS e2eMarker,
              JSONExtractFloat(properties, 'price_usdc') AS priceUsdc,
              JSONExtractFloat(properties, 'platform_fee_usdc') AS platformFeeUsdc,
              JSONExtractFloat(properties, 'provider_net_usdc') AS providerNetUsdc
            FROM synapse_analytics.events
            WHERE timestamp >= now() - INTERVAL 24 HOUR
              AND (
                JSONExtractString(properties, 'service_id') = '{service_id_sql}'
                OR JSONExtractString(properties, 'tx_hash') = '{tx_hash_sql}'
                OR JSONExtractString(properties, 'e2e_marker') = '{marker_sql}'
              )
            ORDER BY timestamp ASC
            """
        )
        names = {str(row.get("eventName")) for row in rows}
        required = {
            "page_viewed",
            "wallet_connected",
            "consumer_signup_completed",
            "provider_signup_completed",
            "service_registered",
            "deposit_completed",
            "quote_generated",
            "invoke_started",
            "invoke_completed",
            "provider_revenue_received",
        } | SUPPLEMENTAL_EVENTS
        if required.issubset(names):
            return rows
        time.sleep(3)
    return rows


def _raw_window_invocation_summary() -> dict[str, Any]:
    rows = _query_clickhouse(
        """
        SELECT
          countIf(event_name = 'quote_generated') AS quoteCount,
          countIf(event_name = 'invoke_started') AS invokeStartedCount,
          countIf(event_name = 'invoke_completed') AS invokeCompletedCount,
          countIf(event_name = 'invoke_failed') AS invokeFailedCount,
          sumIf(JSONExtractFloat(properties, 'price_usdc'), event_name = 'invoke_completed') AS gmvUsdc,
          sumIf(JSONExtractFloat(properties, 'platform_fee_usdc'), event_name = 'provider_revenue_received') AS platformFeeUsdc,
          sumIf(JSONExtractFloat(properties, 'provider_net_usdc'), event_name = 'provider_revenue_received') AS providerNetUsdc
        FROM synapse_analytics.events
        WHERE timestamp >= now() - INTERVAL 24 HOUR
        """
    )
    assert rows, "ClickHouse returned no invocation summary row"
    return rows[0]


def _raw_marker_summary(marker: str) -> list[dict[str, Any]]:
    marker_sql = _sql_string(marker)
    return _query_clickhouse(
        f"""
        SELECT
          event_name AS eventName,
          count() AS count,
          uniqExact(event_id) AS uniqueEventIds,
          countIf(startsWith(distinct_id, '0x') OR length(distinct_id) = 42) AS rawWalletDistinctIds
        FROM synapse_analytics.events
        WHERE timestamp >= now() - INTERVAL 24 HOUR
          AND JSONExtractString(properties, 'e2e_marker') = '{marker_sql}'
        GROUP BY event_name
        ORDER BY event_name ASC
        """
    )


def _floatish(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _intish(value: object) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def test_analytics_fullchain_events_and_admin_aggregates(
    owner_account,
    provider_account,
    session_state,
) -> None:
    service_id = str(session_state.get("service_id") or "")
    deposit_tx_hash = str(session_state.get("deposit_tx_hash") or "")
    invocation_id = str(session_state.get("invocation_id") or "")
    if not service_id or not deposit_tx_hash or not invocation_id:
        pytest.skip("run ordered gateway e2e steps 01-07 before analytics full-chain verification")

    consumer_hash = sha256_hash(owner_account.address.lower())
    provider_hash = sha256_hash(provider_account.address.lower())
    marker = f"analytics_fullchain_{SESSION_ID}_{uuid.uuid4().hex[:8]}"

    frontend_response = httpx.post(
        f"{GATEWAY_BASE}/api/v1/events",
        json={
            "events": [
                _frontend_event("page_viewed", consumer_hash, marker=marker, role="consumer"),
                _frontend_event("wallet_connected", consumer_hash, marker=marker, role="consumer"),
                _frontend_event("consumer_signup_completed", consumer_hash, marker=marker, role="consumer"),
                _frontend_event("provider_signup_completed", provider_hash, marker=marker, role="provider"),
            ]
        },
        timeout=15,
    )
    assert frontend_response.status_code == 200, frontend_response.text
    assert frontend_response.json()["accepted"] == 4
    supplemental_rows = _insert_supplemental_clickhouse_events(
        marker=marker,
        service_id=service_id,
        deposit_tx_hash=deposit_tx_hash,
        consumer_hash=consumer_hash,
        provider_hash=provider_hash,
    )

    rows = _wait_for_events(service_id, deposit_tx_hash, marker)
    by_name = {str(row.get("eventName")): row for row in rows}
    required_names = {
        "page_viewed",
        "wallet_connected",
        "consumer_signup_completed",
        "provider_signup_completed",
        "service_registered",
        "deposit_completed",
        "quote_generated",
        "invoke_started",
        "invoke_completed",
        "provider_revenue_received",
    } | SUPPLEMENTAL_EVENTS
    assert required_names.issubset(by_name), {
        "missing": sorted(required_names - set(by_name)),
        "found": sorted(by_name),
    }

    assert by_name["service_registered"]["distinctId"] == provider_hash
    assert by_name["deposit_completed"]["distinctId"] == consumer_hash
    assert by_name["quote_generated"]["distinctId"] == consumer_hash
    assert by_name["invoke_started"]["distinctId"] == consumer_hash
    assert by_name["invoke_completed"]["distinctId"] == consumer_hash
    assert by_name["provider_revenue_received"]["distinctId"] == provider_hash
    assert _floatish(by_name["invoke_completed"]["priceUsdc"]) > 0
    assert _floatish(by_name["provider_revenue_received"]["providerNetUsdc"]) > 0

    raw_summary = _raw_window_invocation_summary()
    assert _intish(raw_summary["invokeStartedCount"]) >= 1
    assert _intish(raw_summary["invokeCompletedCount"]) >= 1
    assert _floatish(raw_summary["gmvUsdc"]) >= _floatish(by_name["invoke_completed"]["priceUsdc"])
    assert _floatish(raw_summary["providerNetUsdc"]) >= _floatish(by_name["provider_revenue_received"]["providerNetUsdc"])
    marker_summary = _raw_marker_summary(marker)
    marker_by_name = {str(row.get("eventName")): row for row in marker_summary}
    for event_name in SUPPLEMENTAL_EVENTS:
        assert _intish(marker_by_name.get(event_name, {}).get("count")) >= 1, event_name
    assert sum(_intish(row.get("rawWalletDistinctIds")) for row in marker_summary) == 0

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(
        json.dumps(
            {
                "status": "success",
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "serviceId": service_id,
                "depositTxHash": deposit_tx_hash,
                "invocationId": invocation_id,
                "consumerDistinctId": consumer_hash,
                "providerDistinctId": provider_hash,
                "marker": marker,
                "requiredEvents": sorted(required_names),
                "supplementalEvents": sorted(SUPPLEMENTAL_EVENTS),
                "supplementalEventIds": [row["event_id"] for row in supplemental_rows],
                "matchedEvents": rows,
                "markerSummary": marker_summary,
                "rawInvocationSummary": raw_summary,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
