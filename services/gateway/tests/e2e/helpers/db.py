"""Direct database helpers for e2e test seeding.

Only used to inject test fixtures that the gateway's async health poller
would normally create (but takes 60+ seconds to run).
"""
from __future__ import annotations

import hashlib
import os

DB_DSN = os.getenv(
    "LOCAL_GATEWAY_POSTGRES_DSN",
    os.getenv(
        "POSTGRES_DSN",
        "postgresql://synapse_gateway_app:local-dev-gateway-app-password@127.0.0.1:15432/synapse_gateway",
    ),
)


_TEST_SERVICE_SQL_CLAUSE = """
(
    service_id LIKE 'api_ref_%%'
    OR service_id LIKE 'apiref_test_%%'
    OR service_id LIKE 'provider_onboard_%%'
    OR service_id LIKE 'llm_%%_llm_deepseek_%%'
    OR service_id LIKE 'gateway_pull_health_%%'
    OR service_id LIKE 'svc_e2e_%%'
    OR service_id LIKE 'svc_verify_%%'
    OR service_id LIKE 'svc_buyer_%%'
    OR service_id LIKE 'ufc_%%'
)
AND service_id NOT IN (
    'svc_synapse_echo',
    'svc_synapse_mock_cost_1usdc',
    'svc_web3_sentiment_index',
    'svc_protocol_fundamental_brief',
    'svc_oss_security_healthcheck',
    'svc_deepseek_chat'
)
"""


def _is_local_dsn() -> bool:
    normalized = DB_DSN.replace("@postgres:", "@127.0.0.1:")
    return "127.0.0.1" in normalized or "localhost" in normalized


def active_test_service_ids() -> set[str]:
    """Return active local E2E/test service ids.

    This helper is intentionally local-only because it is used by E2E teardown
    guardrails. Staging evidence must stay read-only unless a runbook explicitly
    opts into a mutating cleanup.
    """
    if not _is_local_dsn():
        return set()
    import psycopg

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT service_id
                FROM synapse_service_manifests
                WHERE status = 'active'
                  AND {_TEST_SERVICE_SQL_CLAUSE}
                """
            )
            return {str(row[0]) for row in cur.fetchall()}


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

    ep_id = _endpoint_id(service_id, target_url)

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

            # Upsert typed runtime health (provides lastCheckedAt to is_health_stale)
            cur.execute(
                """
                INSERT INTO synapse_service_health_runtime (
                    service_id, target_url, status, overall_status, http_status,
                    latency_ms, consecutive_successes, consecutive_failures,
                    probe_url, last_checked_at, last_healthy_at, timeout_ms,
                    created_at, updated_at
                ) VALUES (
                    %s, %s, 'healthy', 'healthy', 200,
                    50, 3, 0,
                    %s, NOW(), NOW(), 30000,
                    NOW(), NOW()
                )
                ON CONFLICT (service_id, target_url)
                DO UPDATE SET
                    status = EXCLUDED.status,
                    overall_status = EXCLUDED.overall_status,
                    http_status = EXCLUDED.http_status,
                    latency_ms = EXCLUDED.latency_ms,
                    consecutive_successes = EXCLUDED.consecutive_successes,
                    consecutive_failures = EXCLUDED.consecutive_failures,
                    probe_url = EXCLUDED.probe_url,
                    last_checked_at = EXCLUDED.last_checked_at,
                    last_healthy_at = EXCLUDED.last_healthy_at,
                    timeout_ms = EXCLUDED.timeout_ms,
                    updated_at = NOW()
                """,
                (service_id, target_url, target_url.replace("/invoke", "/health")),
            )

        conn.commit()


def archive_test_service(service_id: str) -> None:
    """Soft-archive an E2E-created service and clear health runtime rows.

    Manifests stay in audit history as archived. Health snapshots/runtime/events
    are deleted so the local health monitor does not keep probing stale test
    services after an E2E run.
    """
    normalized = str(service_id or "").strip()
    if not normalized:
        return
    if not _is_local_dsn():
        return
    import psycopg

    with psycopg.connect(DB_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE synapse_service_manifests
                SET status = 'archived', updated_at = NOW()
                WHERE service_id = %s
                  AND status = 'active'
                  AND {_TEST_SERVICE_SQL_CLAUSE}
                """,
                (normalized,),
            )
            cur.execute(
                "DELETE FROM synapse_service_health_snapshots WHERE service_id = %s",
                (normalized,),
            )
            cur.execute(
                "DELETE FROM synapse_service_health_runtime WHERE service_id = %s",
                (normalized,),
            )
            cur.execute(
                "DELETE FROM synapse_service_health_events WHERE service_id = %s",
                (normalized,),
            )
            cur.execute(
                """
                DELETE FROM synapse_runtime_state
                WHERE state_key LIKE %s
                   OR state_key = %s
                """,
                (
                    f"service_health_meta::{normalized}::%",
                    f"service_health_history::{normalized}",
                ),
            )
        conn.commit()
