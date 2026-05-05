"""Service registry health runtime and transition event persistence."""
# ruff: noqa: S608  # reason: bounded dynamic placeholder lists stay parameterized
from __future__ import annotations

from typing import Any, List

from src.domain.registry import ServiceTargetHealth, ServiceTargetHealthHistory
from src.utils.datetime_utils import now_dt_str, to_dt_str

HEALTHY_SCORE_THRESHOLD = 80


class ServiceRegistryHealthMixin:
    @staticmethod
    def _composite_not_in_clause(row_count: int) -> str:
        return ", ".join(["(%s, %s)"] * max(1, row_count))

    def _delete_obsolete_service_health_snapshots(
        self, cur: Any, rows: List[ServiceTargetHealth]
    ) -> None:
        valid_rows = [
            row
            for row in rows
            if str(row.service_id or "").strip() and str(row.target_url or "").strip()
        ]
        if not valid_rows:
            cur.execute("DELETE FROM synapse_service_health_snapshots")
            return

        params: list[Any] = []
        for row in valid_rows:
            params.extend(
                [
                    str(row.service_id or "").strip(),
                    self._endpoint_id(
                        str(row.service_id or "").strip(),
                        str(row.target_url or "").strip(),
                        0,
                    ),
                ]
            )
        placeholders = self._composite_not_in_clause(len(valid_rows))
        cur.execute(
            f"DELETE FROM synapse_service_health_snapshots WHERE (service_id, endpoint_id) NOT IN ({placeholders})",
            tuple(params),
        )

    def _delete_obsolete_service_health_runtime(
        self, cur: Any, rows: List[ServiceTargetHealth]
    ) -> None:
        valid_rows = [
            row
            for row in rows
            if str(row.service_id or "").strip() and str(row.target_url or "").strip()
        ]
        if not valid_rows:
            cur.execute("DELETE FROM synapse_service_health_runtime")
            return

        params: list[Any] = []
        for row in valid_rows:
            params.extend(
                [
                    str(row.service_id or "").strip(),
                    str(row.target_url or "").strip(),
                ]
            )
        placeholders = self._composite_not_in_clause(len(valid_rows))
        cur.execute(
            f"DELETE FROM synapse_service_health_runtime WHERE (service_id, target_url) NOT IN ({placeholders})",
            tuple(params),
        )

    def read_service_target_health_rows(self) -> List[ServiceTargetHealth]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    hr.service_id,
                    oa.owner_wallet,
                    hr.target_url,
                    hr.owner_address,
                    hr.status,
                    hr.overall_status,
                    hr.http_status,
                    hr.latency_ms,
                    hr.consecutive_successes,
                    hr.consecutive_failures,
                    hr.probe_url,
                    hr.last_checked_at,
                    hr.last_healthy_at,
                    hr.error_code,
                    sh.health_score,
                    sh.p95_latency_ms,
                    sh.success_rate_24h,
                    sh.last_checked_at,
                    sh.error_code
                FROM synapse_service_health_runtime AS hr
                INNER JOIN synapse_service_manifests AS sm ON sm.service_id = hr.service_id
                INNER JOIN synapse_owner_accounts AS oa ON oa.owner_id = sm.owner_id
                LEFT JOIN synapse_service_endpoints AS ep
                    ON ep.service_id = hr.service_id AND ep.endpoint_url = hr.target_url
                LEFT JOIN synapse_service_health_snapshots AS sh
                    ON sh.service_id = hr.service_id AND sh.endpoint_id = ep.endpoint_id
                ORDER BY hr.service_id, hr.target_url
                """
            )
            rows = cur.fetchall()
        return [self._service_target_health_from_row(row) for row in rows]

    def _service_target_health_from_row(self, row: tuple[object, ...]) -> ServiceTargetHealth:
        (
            service_id,
            owner,
            target_url,
            owner_address,
            status,
            overall_status,
            http_status,
            runtime_latency_ms,
            consecutive_successes,
            consecutive_failures,
            probe_url,
            runtime_last_checked_at,
            runtime_last_healthy_at,
            runtime_error_code,
            health_score,
            latency_ms,
            _,
            snapshot_last_checked_at,
            snapshot_error_code,
        ) = row
        normalized_last_checked_at = self._epoch_ms(runtime_last_checked_at) or self._epoch_ms(snapshot_last_checked_at)
        normalized_last_healthy_at = self._epoch_ms(runtime_last_healthy_at) or self._epoch_ms(runtime_last_checked_at) or self._epoch_ms(snapshot_last_checked_at)
        return ServiceTargetHealth(
            serviceId=service_id,
            ownerAddress=owner_address or owner,
            targetUrl=target_url,
            status=str(
                status
                or (
                    "healthy"
                    if int(health_score or 0) >= HEALTHY_SCORE_THRESHOLD
                    else "unhealthy"
                )
            ),
            overallStatus=overall_status,
            httpStatus=http_status,
            latencyMs=runtime_latency_ms or latency_ms,
            consecutiveSuccesses=int(consecutive_successes or 0),
            consecutiveFailures=int(consecutive_failures or 0),
            probeUrl=probe_url,
            lastCheckedAt=normalized_last_checked_at,
            lastHealthyAt=normalized_last_healthy_at,
            error=runtime_error_code or snapshot_error_code,
        )

    def write_service_target_health_rows(self, rows: List[ServiceTargetHealth]) -> None:
        with self._db.tx_cursor() as cur:
            self._delete_obsolete_service_health_snapshots(cur, rows)
            self._delete_obsolete_service_health_runtime(cur, rows)
            for row in rows:
                if not row.service_id or not row.target_url:
                    continue
                self._upsert_service_target_health_row(cur, row)

    def _upsert_service_target_health_row(self, cur: Any, row: ServiceTargetHealth) -> None:
        updated_at = now_dt_str()
        endpoint_id = self._endpoint_id(row.service_id, row.target_url, 0)
        self._upsert_health_endpoint(cur, row, endpoint_id, updated_at)
        self._upsert_health_snapshot(cur, row, endpoint_id, updated_at)
        self._upsert_health_runtime(cur, row, updated_at)

    def _upsert_health_endpoint(
        self, cur: Any, row: ServiceTargetHealth, endpoint_id: str, updated_at: str
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_service_endpoints (
                endpoint_id, service_id, endpoint_url, auth_mode, timeout_ms,
                max_payload_bytes, streaming_supported, async_supported,
                callback_supported, region, weight, is_primary, status,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s, 'gateway_forward', %s,
                4194304, FALSE, FALSE,
                FALSE, %s, %s, FALSE, 'active',
                %s, %s
            )
            ON CONFLICT (endpoint_id)
            DO UPDATE SET
                endpoint_url = EXCLUDED.endpoint_url,
                timeout_ms = EXCLUDED.timeout_ms,
                region = EXCLUDED.region,
                weight = EXCLUDED.weight,
                updated_at = EXCLUDED.updated_at
            """,
            (
                endpoint_id,
                row.service_id,
                row.target_url,
                int(row.timeout_ms or 15000),
                row.region,
                int(row.weight or 100),
                updated_at,
                updated_at,
            ),
        )

    def _upsert_health_snapshot(
        self, cur: Any, row: ServiceTargetHealth, endpoint_id: str, updated_at: str
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_service_health_snapshots (
                service_id, endpoint_id, health_score, p95_latency_ms,
                success_rate_24h, last_checked_at, error_code, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (service_id, endpoint_id)
            DO UPDATE SET
                health_score = EXCLUDED.health_score,
                p95_latency_ms = EXCLUDED.p95_latency_ms,
                success_rate_24h = EXCLUDED.success_rate_24h,
                last_checked_at = EXCLUDED.last_checked_at,
                error_code = EXCLUDED.error_code,
                updated_at = EXCLUDED.updated_at
            """,
            (
                row.service_id,
                endpoint_id,
                self._health_score(str(row.status or "unknown")),
                row.latency_ms,
                self._success_rate(row.consecutive_successes, row.consecutive_failures),
                to_dt_str(row.last_checked_at),
                row.error,
                updated_at,
            ),
        )

    def _upsert_health_runtime(
        self, cur: Any, row: ServiceTargetHealth, updated_at: str
    ) -> None:
        cur.execute(
            """
            INSERT INTO synapse_service_health_runtime (
                service_id, target_url, owner_address, status, overall_status,
                http_status, latency_ms, consecutive_successes,
                consecutive_failures, probe_url, last_checked_at,
                last_healthy_at, timeout_ms, error_code, offline_reason,
                created_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s
            )
            ON CONFLICT (service_id, target_url)
            DO UPDATE SET
                owner_address = EXCLUDED.owner_address,
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
                error_code = EXCLUDED.error_code,
                offline_reason = EXCLUDED.offline_reason,
                updated_at = NOW()
            """,
            (
                row.service_id,
                row.target_url,
                (row.owner_address or "").lower() or None,
                row.status or "unknown",
                row.overall_status,
                row.http_status,
                row.latency_ms,
                int(row.consecutive_successes or 0),
                int(row.consecutive_failures or 0),
                row.probe_url,
                to_dt_str(row.last_checked_at),
                to_dt_str(row.last_healthy_at),
                int(row.timeout_ms or 15000),
                row.error,
                row.error if str(row.overall_status or "").lower() == "offline" else None,
                updated_at,
                updated_at,
            ),
        )

    def read_service_target_health_history_rows(self) -> List[ServiceTargetHealthHistory]:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT
                    service_id,
                    owner_address,
                    target_url,
                    from_status,
                    to_status,
                    http_status,
                    latency_ms,
                    probe_url,
                    consecutive_successes,
                    consecutive_failures,
                    checked_at,
                    last_healthy_at,
                    error_code
                FROM synapse_service_health_events
                ORDER BY service_id ASC, target_url ASC, checked_at DESC
                """
            )
            rows = cur.fetchall()
        return [self._health_history_from_row(row) for row in rows]

    def _health_history_from_row(
        self, row: tuple[object, ...]
    ) -> ServiceTargetHealthHistory:
        (
            service_id,
            owner_address,
            target_url,
            from_status,
            to_status,
            http_status,
            latency_ms,
            probe_url,
            consecutive_successes,
            consecutive_failures,
            checked_at,
            last_healthy_at,
            error_code,
        ) = row
        return ServiceTargetHealthHistory(
            serviceId=service_id,
            ownerAddress=owner_address,
            targetUrl=target_url,
            status=to_status,
            fromStatus=from_status,
            toStatus=to_status,
            httpStatus=http_status,
            latencyMs=latency_ms,
            probeUrl=probe_url,
            consecutiveSuccesses=int(consecutive_successes or 0),
            consecutiveFailures=int(consecutive_failures or 0),
            checkedAt=self._epoch_ms(checked_at) or 0,
            lastHealthyAt=self._epoch_ms(last_healthy_at),
            error=error_code,
        )

    def write_service_target_health_history_rows(self, rows: List[ServiceTargetHealthHistory]) -> None:
        with self._db.tx_cursor() as cur:
            for row in rows:
                self._insert_health_event(cur, row)

    def _insert_health_event(self, cur: Any, row: ServiceTargetHealthHistory) -> None:
        service_id = str(row.service_id or "").strip()
        target_url = str(row.target_url or "").strip()
        if not service_id or not target_url:
            return
        to_status = str(row.to_status or row.status or "unknown").strip().lower() or "unknown"
        cur.execute(
            """
            INSERT INTO synapse_service_health_events (
                service_id, target_url, owner_address, from_status, to_status,
                http_status, latency_ms, probe_url, consecutive_successes,
                consecutive_failures, checked_at, last_healthy_at, error_code, reason
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s
            )
            """,
            (
                service_id,
                target_url,
                (row.owner_address or "").lower() or None,
                row.from_status,
                to_status,
                row.http_status,
                row.latency_ms,
                row.probe_url,
                int(row.consecutive_successes or 0),
                int(row.consecutive_failures or 0),
                to_dt_str(row.checked_at),
                to_dt_str(row.last_healthy_at),
                row.error,
                row.error,
            ),
        )

    def prune_service_target_health_events(self, retention_days: int) -> int:
        days = max(1, int(retention_days or 1))
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                DELETE FROM synapse_service_health_events
                WHERE created_at < NOW() - (%s::text || ' days')::interval
                """,
                (days,),
            )
            return int(getattr(cur, "rowcount", 0) or 0)

    def cleanup_legacy_service_health_runtime_state(self) -> int:
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                DELETE FROM synapse_runtime_state
                WHERE state_key LIKE 'service_health_%'
                """
            )
            return int(getattr(cur, "rowcount", 0) or 0)
