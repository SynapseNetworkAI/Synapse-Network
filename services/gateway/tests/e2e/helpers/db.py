"""Direct database helpers for e2e test seeding.

Only used to inject test fixtures that the gateway's async health poller
would normally create (but takes 60+ seconds to run).
"""
from __future__ import annotations

import hashlib
import json
import os
import time

DB_DSN = os.getenv(
    "POSTGRES_DSN",
    "postgresql://synapse_gateway_app:12345678@127.0.0.1:5432/synapse_gateway",
)


def _endpoint_id(service_id: str, target_url: str, index: int = 0) -> str:
    """Mirror ServiceRegistryRepository._endpoint_id deterministic formula."""
    suffix = hashlib.sha1(target_url.encode("utf-8")).hexdigest()[:10]
    return f"{service_id}:ep:{index}:{suffix}"


def seed_service_health(service_id: str, target_url: str) -> None:
    """Insert a 'healthy' health record so forwarding_upstream passes the gate.

    The gateway freshly loads health rows from DB on every invocation, so this
    seed is visible immediately without restarting the gateway process.
    """
    import psycopg  # optional import; psycopg2/psycopg3 — already in gateway dep

    now_ms = int(time.time() * 1000)
    ep_id = _endpoint_id(service_id, target_url)
    state_key = f"service_health_meta::{service_id}::{target_url}"
    health_payload = json.dumps(
        {
            "status": "healthy",
            "overallStatus": "healthy",
            "lastCheckedAt": now_ms,
            "lastHealthyAt": now_ms,
            "httpStatus": 200,
            "latencyMs": 50,
            "consecutiveSuccesses": 3,
            "consecutiveFailures": 0,
            "healthyTargets": 1,
            "totalTargets": 1,
        }
    )

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            # Ensure endpoint row exists (gateway may have created it already)
            cur.execute(
                """
                INSERT INTO synapse_service_endpoints
                    (endpoint_id, service_id, endpoint_url, auth_mode, timeout_ms,
                     max_payload_bytes, streaming_supported, async_supported,
                     callback_supported, weight, is_primary, status,
                     created_at, updated_at)
                VALUES (%s, %s, %s, 'gateway_signed', 30000,
                        1048576, FALSE, FALSE,
                        FALSE, 100, TRUE, 'active',
                        NOW(), NOW())
                ON CONFLICT (endpoint_id) DO UPDATE SET updated_at = NOW()
                """,
                (ep_id, service_id, target_url),
            )

            # Upsert health snapshot (health_score=100 → status="healthy")
            cur.execute(
                """
                INSERT INTO synapse_service_health_snapshots
                    (service_id, endpoint_id, health_score, p95_latency_ms,
                     last_checked_at, updated_at)
                VALUES (%s, %s, 100, 50, NOW(), NOW())
                ON CONFLICT (service_id, endpoint_id) DO UPDATE SET
                    health_score = 100,
                    p95_latency_ms = 50,
                    last_checked_at = NOW(),
                    updated_at = NOW()
                """,
                (service_id, ep_id),
            )

            # Upsert runtime-state health-meta (provides lastCheckedAt to is_health_stale)
            cur.execute(
                """
                INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
                VALUES (%s, %s::jsonb, NOW())
                ON CONFLICT (state_key) DO UPDATE SET
                    payload = %s::jsonb,
                    updated_at = NOW()
                """,
                (state_key, health_payload, health_payload),
            )

        conn.commit()
