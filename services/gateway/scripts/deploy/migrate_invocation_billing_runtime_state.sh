#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-}"

usage() {
  cat >&2 <<'EOF'
Usage:
  INVOCATION_BILLING_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_MIGRATES_FINANCIAL_BILLING_STATE \
    bash services/gateway/scripts/deploy/migrate_invocation_billing_runtime_state.sh local|staging|prod

DSN selection:
  local   MIGRATION_DSN | LOCAL_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | POSTGRES_DSN | local default
  staging MIGRATION_DSN | STAGING_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | POSTGRES_DSN
  prod    MIGRATION_DSN | PROD_POSTGRES_MIGRATOR_DSN | POSTGRES_MIGRATOR_DSN | POSTGRES_DSN

Prod additionally requires:
  SYNAPSE_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PROD
EOF
}

is_local_dsn() {
  [[ "$1" =~ localhost|127\.0\.0\.1|0\.0\.0\.0 ]]
}

if [[ ! "${ENVIRONMENT}" =~ ^(local|staging|prod)$ ]]; then
  usage
  exit 2
fi

if [[ "${INVOCATION_BILLING_MIGRATION_CONFIRM:-}" != "I_UNDERSTAND_THIS_MIGRATES_FINANCIAL_BILLING_STATE" ]]; then
  echo "refusing billing migration without INVOCATION_BILLING_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_MIGRATES_FINANCIAL_BILLING_STATE" >&2
  exit 2
fi

case "${ENVIRONMENT}" in
  local)
    CONNINFO="${MIGRATION_DSN:-${LOCAL_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-postgresql://synapse:local-dev-postgres-password@127.0.0.1:15432/synapse_gateway}}}}"
    if ! is_local_dsn "${CONNINFO}"; then
      echo "refusing local migration against non-local DSN" >&2
      exit 2
    fi
    ;;
  staging)
    CONNINFO="${MIGRATION_DSN:-${STAGING_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-}}}}"
    if [[ -z "${CONNINFO}" ]]; then
      echo "missing staging migration DSN" >&2
      exit 2
    fi
    if [[ "${CONNINFO}" =~ prod|production ]]; then
      echo "refusing staging migration because DSN looks production-like" >&2
      exit 2
    fi
    ;;
  prod)
    if [[ "${SYNAPSE_MIGRATION_CONFIRM:-}" != "I_UNDERSTAND_THIS_CHANGES_PROD" ]]; then
      echo "refusing prod migration without SYNAPSE_MIGRATION_CONFIRM=I_UNDERSTAND_THIS_CHANGES_PROD" >&2
      exit 2
    fi
    CONNINFO="${MIGRATION_DSN:-${PROD_POSTGRES_MIGRATOR_DSN:-${POSTGRES_MIGRATOR_DSN:-${POSTGRES_DSN:-}}}}"
    if [[ -z "${CONNINFO}" ]]; then
      echo "missing prod migration DSN" >&2
      exit 2
    fi
    ;;
esac

if ! command -v psql >/dev/null 2>&1; then
  echo "missing required command: psql" >&2
  exit 1
fi

echo "[invocation-billing-migration] environment=${ENVIRONMENT}"
psql "${CONNINFO}" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

CREATE TABLE IF NOT EXISTS synapse_invocation_billing (
    id BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    invocation_id TEXT PRIMARY KEY REFERENCES synapse_invocations (invocation_id) ON DELETE CASCADE,
    business_type TEXT NOT NULL DEFAULT 'charge',
    charged_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    unit_price_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    protocol_fee_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    routing_tax_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    provider_earned_usdc NUMERIC(36, 6) NOT NULL DEFAULT 0,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (charged_usdc >= 0),
    CHECK (unit_price_usdc >= 0),
    CHECK (protocol_fee_usdc >= 0),
    CHECK (routing_tax_usdc >= 0),
    CHECK (provider_earned_usdc >= 0)
);

CREATE INDEX IF NOT EXISTS idx_synapse_invocation_billing_business_updated
ON synapse_invocation_billing (business_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_synapse_invocation_billing_updated
ON synapse_invocation_billing (updated_at DESC);

DO $$
DECLARE
    bad_keys TEXT;
BEGIN
    WITH legacy AS (
        SELECT
            state_key,
            substring(state_key FROM '^invocation_billing::(.+)$') AS invocation_id,
            payload
        FROM synapse_runtime_state
        WHERE state_key LIKE 'invocation_billing::%'
    ),
    invalid AS (
        SELECT legacy.state_key
        FROM legacy
        LEFT JOIN synapse_invocations inv ON inv.invocation_id = legacy.invocation_id
        WHERE legacy.invocation_id IS NULL
           OR legacy.invocation_id = ''
           OR inv.invocation_id IS NULL
           OR jsonb_typeof(legacy.payload) <> 'object'
           OR (NULLIF(legacy.payload->>'totalCharge', '') IS NOT NULL AND NULLIF(legacy.payload->>'totalCharge', '') !~ '^[0-9]+(\.[0-9]+)?$')
           OR (NULLIF(legacy.payload->>'unitPrice', '') IS NOT NULL AND NULLIF(legacy.payload->>'unitPrice', '') !~ '^[0-9]+(\.[0-9]+)?$')
           OR (NULLIF(legacy.payload->>'protocolFee', '') IS NOT NULL AND NULLIF(legacy.payload->>'protocolFee', '') !~ '^[0-9]+(\.[0-9]+)?$')
           OR (NULLIF(legacy.payload->>'routingTax', '') IS NOT NULL AND NULLIF(legacy.payload->>'routingTax', '') !~ '^[0-9]+(\.[0-9]+)?$')
        ORDER BY legacy.state_key
        LIMIT 20
    )
    SELECT string_agg(state_key, ', ') INTO bad_keys FROM invalid;

    IF bad_keys IS NOT NULL THEN
        RAISE EXCEPTION 'invalid invocation_billing runtime_state rows: %', bad_keys;
    END IF;
END $$;

\echo '[invocation-billing-migration] before'
WITH legacy AS (
    SELECT
        substring(rs.state_key FROM '^invocation_billing::(.+)$') AS invocation_id,
        rs.payload
    FROM synapse_runtime_state rs
    WHERE rs.state_key LIKE 'invocation_billing::%'
),
matched AS (
    SELECT legacy.payload
    FROM legacy
    JOIN synapse_invocations inv ON inv.invocation_id = legacy.invocation_id
)
SELECT
    (SELECT COUNT(*) FROM legacy)::BIGINT AS legacy_rows,
    (SELECT COUNT(*) FROM matched)::BIGINT AS matching_invocation_rows,
    (SELECT COUNT(*) FROM synapse_invocation_billing)::BIGINT AS typed_rows_before,
    COALESCE(SUM(COALESCE(NULLIF(payload->>'totalCharge', '')::numeric, 0)), 0)::numeric(36, 6) AS legacy_charged_usdc,
    COALESCE(SUM(COALESCE(NULLIF(payload->>'protocolFee', '')::numeric, 0)), 0)::numeric(36, 6) AS legacy_protocol_fee_usdc,
    COALESCE(SUM(GREATEST(
        COALESCE(NULLIF(payload->>'unitPrice', '')::numeric, 0)
        - COALESCE(NULLIF(payload->>'protocolFee', '')::numeric, 0),
        0
    )), 0)::numeric(36, 6) AS legacy_provider_earned_usdc
FROM matched;

\echo '[invocation-billing-migration] upsert'
WITH legacy AS (
    SELECT
        substring(rs.state_key FROM '^invocation_billing::(.+)$') AS invocation_id,
        rs.payload,
        rs.updated_at
    FROM synapse_runtime_state rs
    WHERE rs.state_key LIKE 'invocation_billing::%'
),
parsed AS (
    SELECT
        inv.invocation_id,
        COALESCE(NULLIF(legacy.payload->>'businessType', ''), 'charge') AS business_type,
        COALESCE(NULLIF(legacy.payload->>'totalCharge', '')::numeric, inv.charged_usdc, 0) AS charged_usdc,
        COALESCE(NULLIF(legacy.payload->>'unitPrice', '')::numeric, 0) AS unit_price_usdc,
        COALESCE(NULLIF(legacy.payload->>'protocolFee', '')::numeric, 0) AS protocol_fee_usdc,
        COALESCE(NULLIF(legacy.payload->>'routingTax', '')::numeric, 0) AS routing_tax_usdc,
        legacy.payload,
        inv.created_at,
        legacy.updated_at
    FROM legacy
    JOIN synapse_invocations inv ON inv.invocation_id = legacy.invocation_id
)
INSERT INTO synapse_invocation_billing (
    invocation_id, business_type, charged_usdc, unit_price_usdc,
    protocol_fee_usdc, routing_tax_usdc, provider_earned_usdc,
    payload, created_at, updated_at
)
SELECT
    invocation_id,
    business_type,
    charged_usdc::numeric(36, 6),
    unit_price_usdc::numeric(36, 6),
    protocol_fee_usdc::numeric(36, 6),
    routing_tax_usdc::numeric(36, 6),
    GREATEST(unit_price_usdc - protocol_fee_usdc, 0)::numeric(36, 6),
    payload,
    created_at,
    updated_at
FROM parsed
ON CONFLICT (invocation_id)
DO UPDATE SET
    business_type = EXCLUDED.business_type,
    charged_usdc = EXCLUDED.charged_usdc,
    unit_price_usdc = EXCLUDED.unit_price_usdc,
    protocol_fee_usdc = EXCLUDED.protocol_fee_usdc,
    routing_tax_usdc = EXCLUDED.routing_tax_usdc,
    provider_earned_usdc = EXCLUDED.provider_earned_usdc,
    payload = EXCLUDED.payload,
    updated_at = EXCLUDED.updated_at;

\echo '[invocation-billing-migration] after'
SELECT
    COUNT(*)::BIGINT AS typed_rows_after,
    COALESCE(SUM(charged_usdc), 0)::numeric(36, 6) AS typed_charged_usdc,
    COALESCE(SUM(protocol_fee_usdc), 0)::numeric(36, 6) AS typed_protocol_fee_usdc,
    COALESCE(SUM(provider_earned_usdc), 0)::numeric(36, 6) AS typed_provider_earned_usdc
FROM synapse_invocation_billing;

COMMIT;
SQL
