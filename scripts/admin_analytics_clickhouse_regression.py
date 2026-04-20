#!/usr/bin/env python3
"""Verify Admin Analytics APIs against real ClickHouse data.

This script intentionally uses only the Python standard library so it can run
on local machines even when Node/Playwright or service virtualenvs are broken.

It validates the seven Admin Analytics surfaces:

* overview
* consumer-funnel
* invocation-revenue
* provider-revenue
* money-flow
* risk-health
* data-quality

For local development, set ADMIN_ANALYTICS_E2E_SEED_SESSION=true to create a
short-lived Super Admin session directly in the local admin Postgres database.
Production/staging runs should pass ADMIN_SESSION_TOKEN instead.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import socket
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
REPORT_PATH = Path(
    os.getenv(
        "ADMIN_ANALYTICS_REGRESSION_REPORT",
        str(REPO_ROOT / "output" / "analytics-fullchain" / "admin-clickhouse-regression.json"),
    )
)
SCREENSHOT_DIR = Path(
    os.getenv(
        "ANALYTICS_FULLCHAIN_SCREENSHOT_DIR",
        str(REPO_ROOT / "output" / "analytics-fullchain" / "screens"),
    )
)

ADMIN_GATEWAY_URL = os.getenv("ADMIN_GATEWAY_URL", "http://127.0.0.1:8300").rstrip("/")
CLICKHOUSE_URL = os.getenv("ANALYTICS_CLICKHOUSE_URL", "http://127.0.0.1:8123").rstrip("/") + "/"
WINDOW = os.getenv("ADMIN_ANALYTICS_WINDOW", "24h")
ADMIN_COOKIE_NAME = os.getenv("ADMIN_SESSION_COOKIE_NAME", "synapse_admin_session")
TOKEN_PREFIX = os.getenv("ADMIN_GATEWAY_TOKEN_PREFIX", "adm_demo_")
PG_HOST = os.getenv("ADMIN_ANALYTICS_PGHOST", "127.0.0.1")
PG_PORT = int(os.getenv("ADMIN_ANALYTICS_PGPORT", "5432"))
PG_USER = os.getenv("ADMIN_ANALYTICS_PGUSER", "synapse_admin_app")
PG_PASSWORD = os.getenv("ADMIN_ANALYTICS_PGPASSWORD", "12345678")
PG_DATABASE = os.getenv("ADMIN_ANALYTICS_PGDATABASE", "synapse_gateway_admin")

WINDOW_SQL = {
    "1h": "INTERVAL 1 HOUR",
    "24h": "INTERVAL 24 HOUR",
    "7d": "INTERVAL 7 DAY",
    "30d": "INTERVAL 30 DAY",
}
CONSUMER_FUNNEL_EVENTS = (
    "page_viewed",
    "wallet_connected",
    "consumer_signup_completed",
    "quote_generated",
    "deposit_completed",
    "invoke_started",
    "invoke_completed",
)
CRITICAL_EVENTS = ("page_viewed", "wallet_connected", "invoke_completed", "deposit_completed")
PAGE_SCREENSHOTS = {
    "overview": "01-analytics-overview.png",
    "consumerFunnel": "02-consumer-funnel.png",
    "invocationRevenue": "03-invocation-revenue.png",
    "providerRevenue": "04-provider-revenue.png",
    "moneyFlow": "05-money-flow.png",
    "riskHealth": "06-risk-health.png",
    "dataQuality": "07-data-quality.png",
}


@dataclass
class Check:
    name: str
    passed: bool
    detail: str = ""


checks: list[Check] = []


def record(name: str, passed: bool, detail: str = "") -> None:
    checks.append(Check(name=name, passed=passed, detail=detail))
    mark = "PASS" if passed else "FAIL"
    print(f"[{mark}] {name}{': ' + detail if detail else ''}")


def as_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def as_int(value: Any) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def rate(numerator: float, denominator: float) -> float:
    return 0.0 if denominator <= 0 else round(numerator / denominator, 4)


def near(actual: Any, expected: Any, *, epsilon: float = 0.000001) -> bool:
    return abs(as_float(actual) - as_float(expected)) <= epsilon


def clickhouse_query(sql: str) -> list[dict[str, Any]]:
    body = (sql.strip() + "\nFORMAT JSONEachRow\n").encode("utf-8")
    request = urllib.request.Request(
        CLICKHOUSE_URL,
        data=body,
        method="POST",
        headers={"Content-Type": "text/plain"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        text = response.read().decode("utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def admin_get(path: str, token: str) -> dict[str, Any]:
    request = urllib.request.Request(
        ADMIN_GATEWAY_URL + path,
        headers={"Cookie": f"{ADMIN_COOKIE_NAME}={token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"Admin API {path} failed: {exc.code} {body}") from exc
    if not payload.get("success"):
        raise RuntimeError(f"Admin API {path} failed: {payload}")
    return payload["data"]


def event_window_where(window: str) -> str:
    return f"timestamp >= now() - {WINDOW_SQL.get(window, WINDOW_SQL['24h'])}"


def event_in(events: tuple[str, ...]) -> str:
    return ", ".join(f"'{event}'" for event in events)


def first(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return rows[0] if rows else {}


def raw_snapshot(window: str) -> dict[str, Any]:
    where = event_window_where(window)
    overview = first(
        clickhouse_query(
            f"""
            SELECT
              countIf(event_name = 'invoke_completed') AS invokeCompleted,
              countIf(event_name = 'invoke_failed') AS invokeFailed,
              countIf(event_name = 'budget_blocked') AS budgetBlocked,
              countIf(event_name = 'risk_rule_triggered' AND lower(JSONExtractString(properties, 'severity')) IN ('critical','high')) AS criticalRiskEvents,
              sumIf(JSONExtractFloat(properties, 'price_usdc'), event_name = 'invoke_completed') AS gmvUsdc,
              avgIf(JSONExtractFloat(properties, 'price_usdc'), event_name = 'invoke_completed') AS priceAvgUsdc,
              sumIf(JSONExtractFloat(properties, 'platform_fee_usdc'), event_name = 'provider_revenue_received') AS platformFeeUsdc,
              sumIf(JSONExtractFloat(properties, 'provider_net_usdc'), event_name = 'provider_revenue_received') AS providerNetUsdc,
              sumIf(JSONExtractFloat(properties, 'gross_usdc'), event_name = 'provider_revenue_received') AS providerGrossUsdc,
              countIf(event_name = 'quote_generated') AS quoteCount,
              countIf(event_name = 'invoke_started') AS invokeStarted,
              quantileIf(0.50)(JSONExtractFloat(properties, 'latency_ms'), event_name = 'invoke_completed') AS latencyP50,
              quantileIf(0.95)(JSONExtractFloat(properties, 'latency_ms'), event_name = 'invoke_completed') AS latencyP95,
              quantileIf(0.99)(JSONExtractFloat(properties, 'latency_ms'), event_name = 'invoke_completed') AS latencyP99,
              uniqExactIf(JSONExtractString(properties, 'provider_id'), event_name = 'provider_revenue_received') AS revenueProviderCount,
              uniqExactIf(JSONExtractString(properties, 'provider_id'), event_name = 'provider_first_revenue_received') AS firstRevenueProviderCount,
              avgIf(JSONExtractFloat(properties, 'time_since_listing_ms'), event_name = 'provider_first_revenue_received') AS avgTimeSinceListingMs,
              sumIf(JSONExtractFloat(properties, 'claim_usdc'), event_name = 'settlement_claim_completed') AS settlementCompletedUsdc,
              countIf(event_name = 'settlement_claim_requested') AS settlementRequested,
              countIf(event_name = 'settlement_claim_failed') AS settlementFailed,
              quantileIf(0.95)(JSONExtractFloat(properties, 'time_to_confirm_ms'), event_name = 'settlement_claim_completed') AS settlementP95ConfirmMs,
              sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'deposit_completed') AS depositUsdc,
              countIf(event_name = 'deposit_failed') AS depositFailed,
              sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'withdrawal_completed') AS withdrawalUsdc,
              countIf(event_name = 'withdrawal_failed') AS withdrawalFailed,
              sumIf(JSONExtractFloat(properties, 'amount_usdc'), event_name = 'refund_completed') AS refundUsdc,
              quantileIf(0.50)(JSONExtractFloat(properties, 'time_to_confirm_ms'), event_name IN ('deposit_completed','withdrawal_completed')) AS confirmP50,
              quantileIf(0.95)(JSONExtractFloat(properties, 'time_to_confirm_ms'), event_name IN ('deposit_completed','withdrawal_completed')) AS confirmP95,
              countIf(event_name = 'provider_health_degraded') AS providerHealthDegraded,
              sumIf(greatest(JSONExtractFloat(properties, 'required_usdc') - JSONExtractFloat(properties, 'available_usdc'), 0), event_name = 'budget_blocked') AS budgetGapUsdc
            FROM synapse_analytics.events
            WHERE {where}
            """
        )
    )
    funnel_rows = clickhouse_query(
        f"""
        SELECT event_name AS eventName, uniqExact(distinct_id) AS users, count() AS events
        FROM synapse_analytics.events
        WHERE event_name IN ({event_in(CONSUMER_FUNNEL_EVENTS)}) AND {where}
        GROUP BY event_name
        """
    )
    first_invoke = first(
        clickhouse_query(
            f"""
            SELECT uniqExact(distinct_id) AS firstInvokeUsers
            FROM synapse_analytics.events
            WHERE event_name = 'invoke_completed'
              AND JSONExtractBool(properties, 'is_first_invoke')
              AND {where}
            """
        )
    )
    data_quality = first(
        clickhouse_query(
            f"""
            SELECT
              count() AS eventCount,
              count() - uniqExact(event_id) AS duplicateCount,
              countIf(
                startsWith(distinct_id, '0x')
                OR length(distinct_id) = 42
                OR startsWith(JSONExtractString(properties, 'wallet_address'), '0x')
                OR startsWith(JSONExtractString(properties, 'owner_address'), '0x')
                OR startsWith(JSONExtractString(properties, 'consumer_wallet'), '0x')
                OR startsWith(JSONExtractString(properties, 'provider_wallet'), '0x')
                OR startsWith(JSONExtractString(properties, 'from_address'), '0x')
                OR startsWith(JSONExtractString(properties, 'to_address'), '0x')
              ) AS privacyViolations,
              countIf(event_name = 'invoke_completed' AND (NOT JSONHas(properties, 'service_id') OR NOT JSONHas(properties, 'provider_id') OR NOT JSONHas(properties, 'price_usdc'))) AS invokeCompletedMissing,
              countIf(event_name = 'invoke_failed' AND (NOT JSONHas(properties, 'error_code') OR NOT JSONHas(properties, 'failure_stage'))) AS invokeFailedMissing,
              countIf(event_name = 'deposit_completed' AND (NOT JSONHas(properties, 'amount_usdc') OR NOT JSONHas(properties, 'time_to_confirm_ms'))) AS depositCompletedMissing,
              countIf(source = 'file' OR source = 'file_backend' OR JSONExtractString(properties, 'backend') = 'file') AS fileBackendFallbackEvents
            FROM synapse_analytics.events
            WHERE {where}
            """
        )
    )
    source_rows = clickhouse_query(
        f"""
        SELECT source, count() AS count
        FROM synapse_analytics.events
        WHERE {where}
        GROUP BY source
        """
    )
    freshness_rows = clickhouse_query(
        f"""
        SELECT event_name AS eventName, toString(max(timestamp)) AS lastSeenAt, count() AS count
        FROM synapse_analytics.events
        WHERE event_name IN ({event_in(CRITICAL_EVENTS)}) AND {where}
        GROUP BY event_name
        """
    )
    xor_rows = clickhouse_query(
        f"""
        SELECT count() AS xorViolations
        FROM (
          SELECT
            coalesce(JSONExtractString(properties, 'request_id'), JSONExtractString(properties, 'quote_id')) AS correlation_id,
            countIf(event_name = 'invoke_completed') AS completed,
            countIf(event_name = 'invoke_failed') AS failed
          FROM synapse_analytics.events
          WHERE event_name IN ('invoke_completed','invoke_failed') AND {where}
          GROUP BY correlation_id
          HAVING correlation_id != '' AND completed > 0 AND failed > 0
        )
        """
    )
    return {
        "overview": overview,
        "funnelRows": {str(row["eventName"]): row for row in funnel_rows},
        "firstInvokeUsers": as_int(first_invoke.get("firstInvokeUsers")),
        "dataQuality": data_quality,
        "sourceCoverage": {str(row.get("source") or "unknown"): as_int(row.get("count")) for row in source_rows},
        "freshnessRows": {str(row["eventName"]): row for row in freshness_rows},
        "xorViolations": as_int(first(xor_rows).get("xorViolations")),
    }


def _recv_all(sock: socket.socket, size: int) -> bytes:
    data = b""
    while len(data) < size:
        chunk = sock.recv(size - len(data))
        if not chunk:
            raise EOFError("postgres socket closed")
        data += chunk
    return data


def _read_pg(sock: socket.socket) -> tuple[bytes, bytes]:
    msg_type = _recv_all(sock, 1)
    length = struct.unpack("!I", _recv_all(sock, 4))[0]
    return msg_type, _recv_all(sock, length - 4)


def _send_pg(sock: socket.socket, msg_type: bytes, payload: bytes = b"") -> None:
    sock.sendall(msg_type + struct.pack("!I", len(payload) + 4) + payload)


def _pg_startup(sock: socket.socket) -> None:
    body = struct.pack("!I", 196608)
    params = {
        "user": PG_USER,
        "database": PG_DATABASE,
        "client_encoding": "UTF8",
        "application_name": "admin-analytics-clickhouse-regression",
    }
    for key, value in params.items():
        body += key.encode("utf-8") + b"\0" + value.encode("utf-8") + b"\0"
    body += b"\0"
    sock.sendall(struct.pack("!I", len(body) + 4) + body)


def _pg_scram(sock: socket.socket) -> None:
    nonce = base64.b64encode(os.urandom(18)).decode("ascii").rstrip("=")
    client_first_bare = f"n=*,r={nonce}"
    client_first = "n,," + client_first_bare
    payload = b"SCRAM-SHA-256\0" + struct.pack("!I", len(client_first.encode())) + client_first.encode()
    _send_pg(sock, b"p", payload)
    msg_type, body = _read_pg(sock)
    if msg_type != b"R" or struct.unpack("!I", body[:4])[0] != 11:
        raise RuntimeError("unexpected Postgres SCRAM first response")
    server_first = body[4:].decode("utf-8")
    attrs = {part[:1]: part[2:] for part in server_first.split(",")}
    client_final_without_proof = f"c=biws,r={attrs['r']}"
    auth_message = ",".join((client_first_bare, server_first, client_final_without_proof))
    salted = hashlib.pbkdf2_hmac("sha256", PG_PASSWORD.encode(), base64.b64decode(attrs["s"]), int(attrs["i"]))
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    signature = hmac.new(stored_key, auth_message.encode(), hashlib.sha256).digest()
    proof = bytes(left ^ right for left, right in zip(client_key, signature))
    client_final = client_final_without_proof + ",p=" + base64.b64encode(proof).decode("ascii")
    _send_pg(sock, b"p", client_final.encode())


def _pg_auth(sock: socket.socket) -> None:
    while True:
        msg_type, body = _read_pg(sock)
        if msg_type == b"R":
            code = struct.unpack("!I", body[:4])[0]
            if code == 0:
                continue
            if code == 3:
                _send_pg(sock, b"p", PG_PASSWORD.encode() + b"\0")
                continue
            if code == 5:
                inner = hashlib.md5((PG_PASSWORD + PG_USER).encode()).hexdigest().encode()
                outer = hashlib.md5(inner + body[4:8]).hexdigest()
                _send_pg(sock, b"p", b"md5" + outer.encode() + b"\0")
                continue
            if code == 10:
                _pg_scram(sock)
                continue
            if code == 12:
                continue
            raise RuntimeError(f"unsupported Postgres auth code {code}")
        if msg_type == b"E":
            raise RuntimeError(body.decode("utf-8", "replace"))
        if msg_type == b"Z":
            return


def _pg_query(sock: socket.socket, sql: str) -> list[dict[str, str | None]]:
    _send_pg(sock, b"Q", sql.encode() + b"\0")
    columns: list[str] = []
    rows: list[dict[str, str | None]] = []
    while True:
        msg_type, body = _read_pg(sock)
        if msg_type == b"T":
            count = struct.unpack("!H", body[:2])[0]
            pos = 2
            columns = []
            for _ in range(count):
                end = body.index(b"\0", pos)
                columns.append(body[pos:end].decode("utf-8"))
                pos = end + 19
        elif msg_type == b"D":
            count = struct.unpack("!H", body[:2])[0]
            pos = 2
            values: list[str | None] = []
            for _ in range(count):
                length = struct.unpack("!i", body[pos : pos + 4])[0]
                pos += 4
                if length == -1:
                    values.append(None)
                else:
                    values.append(body[pos : pos + length].decode("utf-8"))
                    pos += length
            rows.append(dict(zip(columns, values)))
        elif msg_type == b"E":
            raise RuntimeError(body.decode("utf-8", "replace"))
        elif msg_type == b"Z":
            return rows


def seed_local_admin_session() -> str:
    session_id = uuid.uuid4().hex
    token_jti = uuid.uuid4().hex
    token = TOKEN_PREFIX + session_id
    sql = f"""
    INSERT INTO admin_sessions (
      session_id, admin_id, token_jti, status, mfa_verified_at, client_ip, user_agent,
      issued_at, last_seen_at, expires_at, created_at
    )
    VALUES (
      '{session_id}', 'adm_super_admin', '{token_jti}', 'active', now(), '127.0.0.1',
      'admin-analytics-clickhouse-regression', now(), now(), now() + interval '2 hours', now()
    )
    RETURNING session_id;
    """
    with socket.create_connection((PG_HOST, PG_PORT), timeout=8) as sock:
        _pg_startup(sock)
        _pg_auth(sock)
        _pg_query(sock, sql)
    return token


def resolve_admin_token() -> str:
    token = os.getenv("ADMIN_SESSION_TOKEN", "").strip()
    if token:
        return token
    seed_enabled = os.getenv("ADMIN_ANALYTICS_E2E_SEED_SESSION", "true").lower() in {"1", "true", "yes"}
    local_gateway = ADMIN_GATEWAY_URL.startswith("http://127.0.0.1") or ADMIN_GATEWAY_URL.startswith("http://localhost")
    if seed_enabled and local_gateway:
        token = seed_local_admin_session()
        print("[INFO] seeded short-lived local Super Admin session for regression verification")
        return token
    raise RuntimeError("set ADMIN_SESSION_TOKEN or ADMIN_ANALYTICS_E2E_SEED_SESSION=true for local runs")


def fetch_admin_pages(token: str) -> dict[str, Any]:
    return {
        "overview": admin_get(f"/api/admin/v1/dashboard/analytics/overview?window={WINDOW}", token),
        "consumerFunnel": admin_get(f"/api/admin/v1/dashboard/analytics/consumer-funnel?window={WINDOW}", token),
        "invocationRevenue": admin_get(f"/api/admin/v1/dashboard/analytics/invocation-revenue?window={WINDOW}", token),
        "providerRevenue": admin_get(f"/api/admin/v1/dashboard/analytics/provider-revenue?window={WINDOW}", token),
        "moneyFlow": admin_get(f"/api/admin/v1/dashboard/analytics/money-flow?window={WINDOW}", token),
        "riskHealth": admin_get(f"/api/admin/v1/dashboard/analytics/risk-health?window={WINDOW}", token),
        "dataQuality": admin_get(f"/api/admin/v1/dashboard/analytics/data-quality?window={WINDOW}", token),
    }


def card_value(overview: dict[str, Any], key: str) -> Any:
    for card in overview.get("cards", []):
        if card.get("key") == key:
            return card.get("value")
    return None


def validate(api: dict[str, Any], raw: dict[str, Any]) -> None:
    overview_raw = raw["overview"]
    completed = as_int(overview_raw.get("invokeCompleted"))
    failed = as_int(overview_raw.get("invokeFailed"))
    budget_blocked = as_int(overview_raw.get("budgetBlocked"))
    deposit_failed = as_int(overview_raw.get("depositFailed"))
    refund_usdc = as_float(overview_raw.get("refundUsdc"))
    settlement_requested = as_int(overview_raw.get("settlementRequested"))
    settlement_failed = as_int(overview_raw.get("settlementFailed"))

    record("overview GMV matches ClickHouse", near(card_value(api["overview"], "gmv_usdc"), overview_raw.get("gmvUsdc")))
    record("overview paid invokes matches ClickHouse", as_int(card_value(api["overview"], "invoke_completed")) == completed)
    record("overview success rate matches ClickHouse", near(card_value(api["overview"], "invoke_success_rate"), rate(completed, completed + failed)))
    record("overview platform fee matches ClickHouse", near(card_value(api["overview"], "platform_fee_usdc"), overview_raw.get("platformFeeUsdc")))
    record("overview provider net matches ClickHouse", near(card_value(api["overview"], "provider_net_usdc"), overview_raw.get("providerNetUsdc")))

    previous_users: int | None = None
    api_steps = {str(step.get("eventName")): step for step in api["consumerFunnel"].get("steps", [])}
    for event_name in CONSUMER_FUNNEL_EVENTS:
        expected = raw["funnelRows"].get(event_name, {})
        actual = api_steps.get(event_name, {})
        users = as_int(expected.get("users"))
        events = as_int(expected.get("events"))
        conversion = 1.0 if previous_users is None else rate(users, previous_users)
        record(f"consumer funnel {event_name} users matches ClickHouse", as_int(actual.get("users")) == users)
        record(f"consumer funnel {event_name} events matches ClickHouse", as_int(actual.get("events")) == events)
        record(f"consumer funnel {event_name} conversion matches ClickHouse", near(actual.get("conversionRate"), conversion))
        previous_users = users

    invocation = api["invocationRevenue"]
    record("invocation quote count matches ClickHouse", as_int(invocation.get("quoteCount")) == as_int(overview_raw.get("quoteCount")))
    record("invocation started count matches ClickHouse", as_int(invocation.get("invokeStartedCount")) == as_int(overview_raw.get("invokeStarted")))
    record("invocation completed count matches ClickHouse", as_int(invocation.get("invokeCompletedCount")) == completed)
    record("invocation failed count matches ClickHouse", as_int(invocation.get("invokeFailedCount")) == failed)
    record("invocation GMV matches ClickHouse", near(invocation.get("gmvUsdc"), overview_raw.get("gmvUsdc")))
    record("invocation latency p95 matches ClickHouse", near(invocation.get("latencyMs", {}).get("p95"), overview_raw.get("latencyP95")))

    provider = api["providerRevenue"]
    record("provider revenue provider count matches ClickHouse", as_int(provider.get("revenueProviderCount")) == as_int(overview_raw.get("revenueProviderCount")))
    record("provider gross matches ClickHouse", near(provider.get("providerGrossUsdc"), overview_raw.get("providerGrossUsdc")))
    record("provider net matches ClickHouse", near(provider.get("providerNetUsdc"), overview_raw.get("providerNetUsdc")))
    record("provider settlement completed matches ClickHouse", near(provider.get("settlementCompletedUsdc"), overview_raw.get("settlementCompletedUsdc")))
    record("provider settlement failure rate matches ClickHouse", near(provider.get("settlementFailureRate"), rate(settlement_failed, settlement_requested)))
    record("provider settlement p95 confirm matches ClickHouse", near(provider.get("settlementP95ConfirmMs"), overview_raw.get("settlementP95ConfirmMs")))
    if settlement_requested > 0:
        funnel_events = {str(item.get("eventName")) for item in provider.get("settlementFunnel", [])}
        record("provider settlement funnel includes requested events", "settlement_claim_requested" in funnel_events)
    if as_int(overview_raw.get("firstRevenueProviderCount")) > 0:
        record("provider first revenue count is surfaced", as_int(provider.get("firstRevenueProviderCount")) == as_int(overview_raw.get("firstRevenueProviderCount")))
    record("provider pending field is ledger projection, not ClickHouse window", "pendingSettlementUsdc" in provider)

    money = api["moneyFlow"]
    record("money-flow deposit total matches ClickHouse", near(money.get("depositUsdc"), overview_raw.get("depositUsdc")))
    record("money-flow failed deposit count matches ClickHouse", as_int(money.get("depositFailedCount")) == as_int(overview_raw.get("depositFailed")))
    record("money-flow withdrawal total matches ClickHouse", near(money.get("withdrawalUsdc"), overview_raw.get("withdrawalUsdc")))
    record("money-flow refund total matches ClickHouse", near(money.get("refundUsdc"), overview_raw.get("refundUsdc")))
    if deposit_failed > 0:
        record("money-flow exposes failed deposit distribution", len(money.get("depositErrors", [])) > 0)
        record("money-flow exposes failed deposit samples", len(money.get("depositFailureSamples", [])) > 0)

    risk = api["riskHealth"]
    record("risk critical count matches ClickHouse", as_int(risk.get("criticalRiskEvents")) == as_int(overview_raw.get("criticalRiskEvents")))
    record("risk provider degraded count matches ClickHouse", as_int(risk.get("providerHealthDegradedCount")) == as_int(overview_raw.get("providerHealthDegraded")))
    record("risk budget gap matches ClickHouse", near(risk.get("budgetGapUsdc"), overview_raw.get("budgetGapUsdc")))
    if budget_blocked > 0:
        record("risk budget block aggregation is exposed", len(risk.get("budgetBlocks", [])) > 0)
        record("risk budget block samples are exposed", len(risk.get("budgetBlockSamples", [])) > 0)
    if refund_usdc > 0:
        record("risk refund reason distribution is exposed", len(risk.get("refundReasons", [])) > 0)

    quality = api["dataQuality"]
    quality_raw = raw["dataQuality"]
    missing_required = (
        as_int(quality_raw.get("invokeCompletedMissing"))
        + as_int(quality_raw.get("invokeFailedMissing"))
        + as_int(quality_raw.get("depositCompletedMissing"))
    )
    record("data-quality event count matches ClickHouse", as_int(quality.get("eventCount")) == as_int(quality_raw.get("eventCount")))
    record("data-quality duplicate rate matches ClickHouse", near(quality.get("duplicateRate"), rate(as_int(quality_raw.get("duplicateCount")), as_int(quality_raw.get("eventCount")))))
    record("data-quality privacy violations match ClickHouse", as_int(quality.get("privacyViolations")) == as_int(quality_raw.get("privacyViolations")))
    record("data-quality missing required properties match ClickHouse", as_int(quality.get("missingRequiredProperties")) == missing_required)
    record("data-quality xor violations match ClickHouse", as_int(quality.get("xorViolations")) == raw["xorViolations"])
    record("data-quality source coverage matches ClickHouse", quality.get("sourceCoverage") == raw["sourceCoverage"])
    freshness = {str(item.get("eventName")): item for item in quality.get("criticalEventsFreshness", [])}
    for event_name in CRITICAL_EVENTS:
        expected_count = as_int(raw["freshnessRows"].get(event_name, {}).get("count"))
        if expected_count > 0:
            record(f"data-quality critical freshness includes {event_name}", bool(freshness.get(event_name, {}).get("seen")))
    record("data-quality schema issue samples are returned", isinstance(quality.get("schemaIssueSamples"), list))


def screenshot_inventory() -> list[dict[str, Any]]:
    inventory: list[dict[str, Any]] = []
    for page_key, file_name in PAGE_SCREENSHOTS.items():
        path = SCREENSHOT_DIR / file_name
        exists = path.exists() and path.stat().st_size > 0
        inventory.append(
            {
                "page": page_key,
                "path": str(path),
                "exists": exists,
                "sizeBytes": path.stat().st_size if exists else 0,
                "modifiedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(path.stat().st_mtime)) if exists else None,
            }
        )
        record(f"screenshot artifact exists for {page_key}", exists, str(path))
    return inventory


def main() -> int:
    print(f"[INFO] Admin Analytics regression window={WINDOW}")
    print(f"[INFO] Admin API={ADMIN_GATEWAY_URL}")
    print(f"[INFO] ClickHouse={CLICKHOUSE_URL}")
    token = resolve_admin_token()
    admin = admin_get("/api/admin/v1/auth/me", token)
    record("admin session can read dashboard", "dashboard:read" in admin.get("admin", {}).get("permissions", []))

    api = fetch_admin_pages(token)
    raw = raw_snapshot(WINDOW)
    validate(api, raw)
    screenshots = screenshot_inventory()

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    failed = [check for check in checks if not check.passed]
    REPORT_PATH.write_text(
        json.dumps(
            {
                "status": "failed" if failed else "success",
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "window": WINDOW,
                "adminGatewayUrl": ADMIN_GATEWAY_URL,
                "clickHouseUrl": CLICKHOUSE_URL,
                "checks": [check.__dict__ for check in checks],
                "api": api,
                "rawClickHouse": raw,
                "screenshots": screenshots,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"[INFO] wrote report: {REPORT_PATH}")
    print(f"[INFO] result: {len(checks) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
