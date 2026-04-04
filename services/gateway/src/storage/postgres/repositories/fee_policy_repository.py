from __future__ import annotations

from typing import Any, Callable

from src.domain.finance import FeePolicyEntity
from src.domain.system import PlatformFeePolicyDefaultRow, PlatformFeePolicyOwnerRow
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager


class FeePolicyRepository:
    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6

    def get_platform_fee_policy(self) -> FeePolicyEntity:
        with self._db.readonly_cursor() as cur:
            cur.execute(
                "SELECT default_rate, updated_at, updated_by FROM synapse_platform_fee_policy_default WHERE singleton_id = 1"
            )
            default_row = cur.fetchone()
            cur.execute(
                "SELECT owner_address, fee_rate FROM synapse_platform_fee_policy_owner"
            )
            owner_rows = cur.fetchall()

        default_rate = 0.0
        updated_at = None
        updated_by = None
        if default_row is not None:
            default_entity = PlatformFeePolicyDefaultRow(
                singletonId=1,
                defaultRate=self._q6(default_row[0]),
                updatedAt=to_dt_str(default_row[1]) if default_row[1] is not None else None,
                updatedBy=default_row[2],
            )
            default_rate = float(self._q6(default_row[0]))
            updated_at = default_entity.updated_at
            updated_by = default_entity.updated_by

        owner_rates: dict[str, float] = {}
        for owner, fee_rate in owner_rows:
            owner_entity = PlatformFeePolicyOwnerRow(
                ownerAddress=str(owner),
                feeRate=self._q6(fee_rate),
            )
            owner_rates[str(owner_entity.owner_address)] = float(owner_entity.fee_rate)

        return FeePolicyEntity(
            default_rate=default_rate,
            owner_rates=owner_rates,
            updated_at=updated_at,
            updated_by=updated_by,
        )

    def set_platform_fee_policy(
        self,
        default_rate: float,
        owner_rates: dict[str, float],
        updated_by: str,
        updated_at: str | int,
    ) -> None:
        default_entity = PlatformFeePolicyDefaultRow(
            singletonId=1,
            defaultRate=self._q6(default_rate),
            updatedAt=to_dt_str(updated_at, now_dt_str()),
            updatedBy=str(updated_by or ""),
        )
        with self._db.tx_cursor() as cur:
            cur.execute(
                """
                INSERT INTO synapse_platform_fee_policy_default (singleton_id, default_rate, updated_at, updated_by)
                VALUES (1, %s, %s, %s)
                ON CONFLICT (singleton_id)
                DO UPDATE SET default_rate = EXCLUDED.default_rate, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
                """,
                (
                    str(default_entity.default_rate),
                    default_entity.updated_at,
                    default_entity.updated_by,
                ),
            )
            cur.execute("DELETE FROM synapse_platform_fee_policy_owner")
            for owner, fee_rate in (owner_rates or {}).items():
                owner_entity = PlatformFeePolicyOwnerRow(
                    ownerAddress=str(owner or "").strip().lower(),
                    feeRate=self._q6(fee_rate),
                )
                if not owner_entity.owner_address:
                    continue
                cur.execute(
                    "INSERT INTO synapse_platform_fee_policy_owner (owner_address, fee_rate) VALUES (%s, %s)",
                    (owner_entity.owner_address, str(owner_entity.fee_rate)),
                )
