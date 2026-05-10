from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.core.totp_secret_store import build_inline_totp_secret_ref, payload_totp_metadata, totp_secret_fingerprint


@dataclass(frozen=True)
class TotpSecretMigrationSummary:
    scanned: int
    migrated: int


def migrate_legacy_totp_payload_secrets(
    dsn: str,
    *,
    connect: Callable[..., object] | None = None,
) -> TotpSecretMigrationSummary:
    connect_fn = connect or psycopg.connect
    scanned = 0
    migrated = 0
    with connect_fn(dsn, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT factor_id, payload_json
                FROM admin_mfa_factors
                WHERE factor_type = 'totp'
                """
            )
            rows = cur.fetchall()
            for row in rows:
                scanned += 1
                factor_id = str(row["factor_id"])
                payload = dict(row.get("payload_json") or {})
                legacy_secret = str(payload.get("totpSecret") or "").strip()
                if not legacy_secret:
                    continue
                cur.execute(
                    """
                    UPDATE admin_mfa_factors
                    SET secret_ref = %s,
                        totp_secret_fingerprint = %s,
                        payload_json = %s::jsonb,
                        updated_at = NOW()
                    WHERE factor_id = %s
                    """,
                    (
                        build_inline_totp_secret_ref(legacy_secret),
                        totp_secret_fingerprint(legacy_secret),
                        Jsonb(payload_totp_metadata(legacy_secret, migrated=True)),
                        factor_id,
                    ),
                )
                migrated += 1
        conn.commit()
    return TotpSecretMigrationSummary(scanned=scanned, migrated=migrated)
