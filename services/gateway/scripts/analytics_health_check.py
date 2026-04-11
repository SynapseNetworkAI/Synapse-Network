#!/usr/bin/env python3
"""
Synapse Analytics — Data Quality Health Check

Run periodically to validate analytics pipeline health.
Checks: event flow, deduplication, privacy, source coverage, critical events, invoke health.

Usage:
    python scripts/analytics_health_check.py
    python scripts/analytics_health_check.py --clickhouse-url http://clickhouse:8123

Exit codes:
    0 = all checks passed
    1 = one or more checks failed
"""
import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone

import httpx

CHECKS_PASSED = 0
CHECKS_FAILED = 0


async def query_ch(url: str, sql: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            url,
            params={"query": sql, "default_format": "JSONEachRow"},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"ClickHouse query failed: {resp.text}")
        if not resp.text.strip():
            return []
        return [json.loads(line) for line in resp.text.strip().split("\n") if line]


def check(name: str, condition: bool, detail: str = ""):
    global CHECKS_PASSED, CHECKS_FAILED
    status = "✅ PASS" if condition else "❌ FAIL"
    print(f"  {status}: {name}" + (f" — {detail}" if detail else ""))
    if condition:
        CHECKS_PASSED += 1
    else:
        CHECKS_FAILED += 1


async def main(clickhouse_url: str):
    print("=" * 60)
    print("Synapse Analytics Health Check")
    print(f"Time: {datetime.now(timezone.utc).isoformat()}")
    print(f"ClickHouse: {clickhouse_url}")
    print("=" * 60)

    # Check 1: Events flowing
    print("\n[1] Event Flow")
    rows = await query_ch(clickhouse_url, """
        SELECT count() AS cnt
        FROM synapse_analytics.events
        WHERE timestamp >= now() - INTERVAL 1 HOUR
    """)
    recent_count = int(rows[0]["cnt"]) if rows else 0
    check("Events in last hour", recent_count > 0, f"count={recent_count}")

    # Check 2: No duplicate event_ids
    print("\n[2] Deduplication")
    rows = await query_ch(clickhouse_url, """
        SELECT count() AS total, uniqExact(event_id) AS unique_ids
        FROM synapse_analytics.events
        WHERE timestamp >= now() - INTERVAL 24 HOUR
    """)
    if rows and int(rows[0]["total"]) > 0:
        total = int(rows[0]["total"])
        unique = int(rows[0]["unique_ids"])
        dup_rate = (total - unique) / max(total, 1)
        check("Duplicate rate < 1%", dup_rate < 0.01,
              f"total={total}, unique={unique}, dup_rate={dup_rate:.4f}")
    else:
        check("Duplicate rate < 1%", True, "no events to check")

    # Check 3: No raw wallet addresses
    print("\n[3] Privacy")
    rows = await query_ch(clickhouse_url, """
        SELECT count() AS cnt
        FROM synapse_analytics.events
        WHERE distinct_id LIKE '0x%' AND length(distinct_id) = 42
        AND timestamp >= now() - INTERVAL 24 HOUR
    """)
    raw_wallets = int(rows[0]["cnt"]) if rows else 0
    check("No raw wallet addresses in distinct_id", raw_wallets == 0, f"found={raw_wallets}")

    # Check 4: All sources present
    print("\n[4] Source Coverage")
    rows = await query_ch(clickhouse_url, """
        SELECT source, count() AS cnt
        FROM synapse_analytics.events
        WHERE timestamp >= now() - INTERVAL 24 HOUR
        GROUP BY source
    """)
    sources_found = {row["source"] for row in rows}
    check("Frontend events present", "frontend" in sources_found)
    check("Gateway events present", "gateway" in sources_found)

    # Check 5: Critical events present
    print("\n[5] Critical Events")
    rows = await query_ch(clickhouse_url, """
        SELECT event_name, count() AS cnt
        FROM synapse_analytics.events
        WHERE timestamp >= now() - INTERVAL 24 HOUR
        GROUP BY event_name
    """)
    events_found = {row["event_name"] for row in rows}
    critical = ["page_viewed", "wallet_connected", "invoke_completed", "deposit_completed"]
    for evt in critical:
        check(f"'{evt}' present", evt in events_found)

    # Check 6: Invoke health
    print("\n[6] Invoke Health")
    rows = await query_ch(clickhouse_url, """
        SELECT
            countIf(event_name = 'invoke_completed') AS succeeded,
            countIf(event_name = 'invoke_failed') AS failed
        FROM synapse_analytics.events
        WHERE event_name IN ('invoke_completed', 'invoke_failed')
        AND timestamp >= now() - INTERVAL 1 HOUR
    """)
    if rows and (int(rows[0]["succeeded"]) + int(rows[0]["failed"])) > 0:
        total_invokes = int(rows[0]["succeeded"]) + int(rows[0]["failed"])
        success_rate = int(rows[0]["succeeded"]) / total_invokes
        check("Invoke success rate > 90%", success_rate > 0.90,
              f"rate={success_rate:.2%} ({rows[0]['succeeded']}/{total_invokes})")
    else:
        check("Invoke success rate > 90%", True, "no invokes in last hour")

    # Summary
    print("\n" + "=" * 60)
    print(f"Results: {CHECKS_PASSED} passed, {CHECKS_FAILED} failed")
    print("=" * 60)
    sys.exit(1 if CHECKS_FAILED > 0 else 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synapse Analytics Health Check")
    parser.add_argument(
        "--clickhouse-url",
        default="http://localhost:8123",
        help="ClickHouse HTTP URL (default: http://localhost:8123)",
    )
    args = parser.parse_args()
    asyncio.run(main(args.clickhouse_url))
