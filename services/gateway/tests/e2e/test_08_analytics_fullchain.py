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
        }
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
    }
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
                "matchedEvents": rows,
                "rawInvocationSummary": raw_summary,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
