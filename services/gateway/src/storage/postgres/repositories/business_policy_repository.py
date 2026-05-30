from __future__ import annotations

from typing import Any, Callable

from psycopg.types.json import Jsonb

from src.domain.system import BusinessPolicyConfigRow
from src.utils.datetime_utils import to_dt_str

from ..database_manager import DatabaseManager


class BusinessPolicyRepository:
    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6

    def get_business_policy_config(self) -> BusinessPolicyConfigRow | None:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                """
                SELECT singleton_id, payload, published_version, updated_at, updated_by
                FROM synapse_business_policy_config
                WHERE singleton_id = 1
                """
            )
            row = cur.fetchone()
        if row is None:
            return None
        return BusinessPolicyConfigRow(
            singletonId=int(row[0] or 1),
            payload=dict(row[1] or {}),
            publishedVersion=int(row[2] or 1),
            updatedAt=to_dt_str(row[3]) if row[3] is not None else None,
            updatedBy=row[4],
        )

    def set_business_policy_config(
        self,
        *,
        payload: dict[str, object],
        published_version: int,
        updated_by: str,
        updated_at: str | int,
    ) -> BusinessPolicyConfigRow:
        entity = BusinessPolicyConfigRow(
            singletonId=1,
            payload=dict(payload or {}),
            publishedVersion=max(1, int(published_version or 1)),
            updatedAt=to_dt_str(updated_at),
            updatedBy=str(updated_by or ""),
        )
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_business_policy_config (
                    singleton_id, payload, published_version, updated_at, updated_by
                ) VALUES (1, %s::jsonb, %s, %s, %s)
                ON CONFLICT (singleton_id) DO UPDATE
                SET payload = EXCLUDED.payload,
                    published_version = EXCLUDED.published_version,
                    updated_at = EXCLUDED.updated_at,
                    updated_by = EXCLUDED.updated_by
                """,
                (
                    Jsonb(entity.payload),
                    entity.published_version,
                    entity.updated_at,
                    entity.updated_by,
                ),
            )
        return entity
