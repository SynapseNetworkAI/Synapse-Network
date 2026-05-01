"""Service registry lifecycle mutation helpers."""
from __future__ import annotations

import json

from src.utils.datetime_utils import now_dt_str, to_dt_str


class ServiceRegistryLifecycleMixin:
    """Small lifecycle updates that must not rewrite the full registry."""

    def mark_service_offline_if_still_failed(
        self,
        service_id: str,
        *,
        probe_started_at_ms: int,
        failure_threshold: int,
        last_healthy_cutoff_ms: int,
        probe_interval_ms: int,
        reason: str,
    ) -> bool:
        normalized_service_id = str(service_id or "").strip()
        if not normalized_service_id:
            return False

        offline_reason = str(reason or "health_probe_failure").strip()
        now_text = now_dt_str()
        probe_started_at = to_dt_str(probe_started_at_ms, now_text)

        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                UPDATE synapse_service_manifests AS sm
                SET status = 'offline',
                    updated_at = %s
                WHERE sm.service_id = %s
                  AND sm.status = 'active'
                  AND sm.updated_at <= %s::timestamptz
                  AND EXISTS (
                      SELECT 1
                      FROM synapse_runtime_state AS rs
                      WHERE rs.state_key LIKE CONCAT('service_health_meta::', sm.service_id, '::%%')
                        AND COALESCE((rs.payload->>'consecutiveFailures')::int, 0) >= %s
                        AND (
                            (
                                COALESCE((rs.payload->>'lastHealthyAt')::bigint, 0) > 0
                                AND COALESCE((rs.payload->>'lastHealthyAt')::bigint, 0) <= %s
                            )
                            OR (
                                COALESCE((rs.payload->>'lastHealthyAt')::bigint, 0) <= 0
                                AND (
                                    COALESCE((rs.payload->>'lastCheckedAt')::bigint, 0)
                                    - (
                                        GREATEST(
                                            COALESCE((rs.payload->>'consecutiveFailures')::int, 0),
                                            1
                                        ) - 1
                                    ) * %s
                                ) <= %s
                            )
                        )
                  )
                """,
                (
                    now_text,
                    normalized_service_id,
                    probe_started_at,
                    int(failure_threshold),
                    int(last_healthy_cutoff_ms),
                    int(probe_interval_ms),
                    int(last_healthy_cutoff_ms),
                ),
            )
            updated = int(getattr(cur, "rowcount", 0) or 0) > 0
            if not updated:
                return False

            cur.execute(
                """
                UPDATE synapse_runtime_state
                SET payload = payload || %s::jsonb,
                    updated_at = %s
                WHERE state_key = %s
                """,
                (
                    json.dumps(
                        {
                            "lifecycleStatus": "offline",
                            "status": "offline",
                            "offlineReason": offline_reason,
                            "offlineAt": now_text,
                        }
                    ),
                    now_text,
                    self._service_meta_state_key(normalized_service_id),
                ),
            )
            return True
