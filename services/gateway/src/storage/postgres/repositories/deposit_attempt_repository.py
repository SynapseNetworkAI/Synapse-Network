from __future__ import annotations

from typing import Any, Callable

from src.domain.finance import DepositAttemptRow
from src.utils.datetime_utils import now_dt_str, to_dt_str

from ..database_manager import DatabaseManager


class DepositAttemptRepository:
    def __init__(self, db: DatabaseManager, quantize6: Callable[[Any], Any]):
        self._db = db
        self._q6 = quantize6

    def upsert_attempt(self, row: DepositAttemptRow) -> DepositAttemptRow:
        now_text = now_dt_str()
        with self._db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO synapse_deposit_attempts (
                        attempt_id,
                        owner_address,
                        client_request_id,
                        tx_hash,
                        amount_usdc,
                        stage,
                        failure_reason,
                        request_id,
                        client_ip,
                        user_agent,
                        created_at,
                        updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (attempt_id, stage)
                    DO UPDATE SET
                        client_request_id = COALESCE(EXCLUDED.client_request_id, synapse_deposit_attempts.client_request_id),
                        tx_hash = COALESCE(EXCLUDED.tx_hash, synapse_deposit_attempts.tx_hash),
                        amount_usdc = EXCLUDED.amount_usdc,
                        failure_reason = COALESCE(EXCLUDED.failure_reason, synapse_deposit_attempts.failure_reason),
                        request_id = COALESCE(EXCLUDED.request_id, synapse_deposit_attempts.request_id),
                        client_ip = COALESCE(EXCLUDED.client_ip, synapse_deposit_attempts.client_ip),
                        user_agent = COALESCE(EXCLUDED.user_agent, synapse_deposit_attempts.user_agent),
                        updated_at = EXCLUDED.updated_at
                    RETURNING id, attempt_id, owner_address, client_request_id, tx_hash, amount_usdc,
                              stage, failure_reason, request_id, client_ip, user_agent, created_at, updated_at
                    """,
                    (
                        row.attempt_id,
                        row.owner_address.lower(),
                        row.client_request_id,
                        row.tx_hash.lower() if row.tx_hash else None,
                        str(self._q6(row.amount_usdc)),
                        row.stage,
                        row.failure_reason,
                        row.request_id,
                        row.client_ip,
                        row.user_agent,
                        to_dt_str(row.created_at, now_text),
                        to_dt_str(row.updated_at, now_text),
                    ),
                )
                saved = cur.fetchone()
            conn.commit()

        return DepositAttemptRow(
            id=int(saved[0]),
            attemptId=str(saved[1]),
            ownerAddress=str(saved[2]),
            clientRequestId=saved[3],
            txHash=saved[4],
            amountUsdc=self._q6(saved[5]),
            stage=str(saved[6]),
            failureReason=saved[7],
            requestId=saved[8],
            clientIp=saved[9],
            userAgent=saved[10],
            createdAt=to_dt_str(saved[11], now_text) or now_text,
            updatedAt=to_dt_str(saved[12], now_text) or now_text,
        )