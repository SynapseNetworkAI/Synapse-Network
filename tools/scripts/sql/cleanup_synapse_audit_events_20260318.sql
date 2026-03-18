BEGIN;

-- 1) Normalize historical FINANCE_RATE_LIMIT_HIT rows so they are queryable as anomalies.
--    Old rows may still be `business_type = charge` and may not carry action/backend/bucket keys.
UPDATE synapse_audit_events
SET
    business_type = 'anomaly',
    detail_json = jsonb_strip_nulls(
        coalesce(detail_json, '{}'::jsonb)
        || jsonb_build_object(
            'domain', coalesce(detail_json->>'domain', 'finance'),
            'businessType', 'anomaly',
            'action', coalesce(nullif(detail_json->>'action', ''), 'legacy_unknown'),
            'backend', coalesce(nullif(detail_json->>'backend', ''), 'legacy'),
            'rateLimitBucket', coalesce(
                nullif(detail_json->>'rateLimitBucket', ''),
                nullif(detail_json->>'windowBucket', ''),
                floor(extract(epoch from created_at) / 60)::bigint::text
            ),
            'windowBucket', coalesce(
                nullif(detail_json->>'windowBucket', ''),
                nullif(detail_json->>'rateLimitBucket', ''),
                floor(extract(epoch from created_at) / 60)::bigint::text
            )
        )
    )
WHERE event_type = 'FINANCE_RATE_LIMIT_HIT';

-- 2) Delete duplicate FINANCE_RATE_LIMIT_HIT rows, keeping the earliest row in each minute bucket.
WITH rate_limit_ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY
                lower(owner_id),
                coalesce(nullif(detail_json->>'action', ''), 'legacy_unknown'),
                coalesce(nullif(detail_json->>'backend', ''), 'legacy'),
                coalesce(
                    nullif(detail_json->>'rateLimitBucket', ''),
                    nullif(detail_json->>'windowBucket', ''),
                    floor(extract(epoch from created_at) / 60)::bigint::text
                )
            ORDER BY created_at ASC, id ASC
        ) AS rn
    FROM synapse_audit_events
    WHERE event_type = 'FINANCE_RATE_LIMIT_HIT'
), rate_limit_dupes AS (
    SELECT id
    FROM rate_limit_ranked
    WHERE rn > 1
)
DELETE FROM synapse_audit_events target
USING rate_limit_dupes dupes
WHERE target.id = dupes.id;

-- 3) Delete duplicate DEPOSIT_INTENT_REGISTERED rows, keeping the earliest row per owner + txHash.
WITH deposit_registered_ranked AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY
                lower(owner_id),
                lower(detail_json->>'txHash')
            ORDER BY created_at ASC, id ASC
        ) AS rn
    FROM synapse_audit_events
    WHERE event_type = 'DEPOSIT_INTENT_REGISTERED'
      AND coalesce(detail_json->>'txHash', '') <> ''
), deposit_registered_dupes AS (
    SELECT id
    FROM deposit_registered_ranked
    WHERE rn > 1
)
DELETE FROM synapse_audit_events target
USING deposit_registered_dupes dupes
WHERE target.id = dupes.id;

-- 4) Post-cleanup summary for operator verification.
--    Keep this SELECT inside the transaction so the operator can verify before COMMIT.
WITH remaining_rate_limit AS (
    SELECT count(*) AS cnt
    FROM synapse_audit_events
    WHERE event_type = 'FINANCE_RATE_LIMIT_HIT'
), remaining_deposit_registered AS (
    SELECT count(*) AS cnt
    FROM synapse_audit_events
    WHERE event_type = 'DEPOSIT_INTENT_REGISTERED'
), remaining_charge_rate_limit AS (
    SELECT count(*) AS cnt
    FROM synapse_audit_events
    WHERE event_type = 'FINANCE_RATE_LIMIT_HIT'
      AND business_type <> 'anomaly'
)
SELECT
    (SELECT cnt FROM remaining_rate_limit) AS remaining_rate_limit_hits,
    (SELECT cnt FROM remaining_deposit_registered) AS remaining_deposit_registered,
    (SELECT cnt FROM remaining_charge_rate_limit) AS remaining_non_anomaly_rate_limit_hits;

COMMIT;