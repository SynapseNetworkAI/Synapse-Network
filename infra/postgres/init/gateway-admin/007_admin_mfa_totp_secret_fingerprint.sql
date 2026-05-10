\if :{?synapse_admin_db}
ALTER TABLE admin_mfa_factors
ADD COLUMN IF NOT EXISTS totp_secret_fingerprint TEXT;

DO $$
DECLARE
    duplicate_count INTEGER;
BEGIN
    SELECT COUNT(*)
    INTO duplicate_count
    FROM (
        SELECT md5(upper(trim(payload_json ->> 'totpSecret'))) AS fingerprint
        FROM admin_mfa_factors
        WHERE factor_type = 'totp'
          AND status IN ('pending', 'active')
          AND NULLIF(trim(COALESCE(payload_json ->> 'totpSecret', '')), '') IS NOT NULL
          AND upper(trim(COALESCE(payload_json ->> 'totpSecret', ''))) <> '__BOOTSTRAP_TOTP_SECRET__'
        GROUP BY 1
        HAVING COUNT(*) > 1
    ) AS duplicate_fingerprints;

    IF duplicate_count > 0 THEN
        RAISE EXCEPTION
            'Duplicate active/pending TOTP secrets detected across admin users; resolve duplicates before applying admin MFA fingerprint uniqueness.';
    END IF;
END $$;

UPDATE admin_mfa_factors
SET totp_secret_fingerprint = CASE
    WHEN factor_type = 'totp'
        AND status IN ('pending', 'active')
        AND NULLIF(trim(COALESCE(payload_json ->> 'totpSecret', '')), '') IS NOT NULL
        AND upper(trim(COALESCE(payload_json ->> 'totpSecret', ''))) <> '__BOOTSTRAP_TOTP_SECRET__'
    THEN md5(upper(trim(payload_json ->> 'totpSecret')))
    ELSE NULL
END
WHERE factor_type = 'totp'
  AND totp_secret_fingerprint IS DISTINCT FROM CASE
      WHEN status IN ('pending', 'active')
          AND NULLIF(trim(COALESCE(payload_json ->> 'totpSecret', '')), '') IS NOT NULL
          AND upper(trim(COALESCE(payload_json ->> 'totpSecret', ''))) <> '__BOOTSTRAP_TOTP_SECRET__'
      THEN md5(upper(trim(payload_json ->> 'totpSecret')))
      ELSE NULL
  END;

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_mfa_totp_secret_fingerprint
ON admin_mfa_factors (totp_secret_fingerprint)
WHERE totp_secret_fingerprint IS NOT NULL
  AND factor_type = 'totp'
  AND status IN ('pending', 'active');
\endif
