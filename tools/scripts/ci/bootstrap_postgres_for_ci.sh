#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export POSTGRES_USER="${POSTGRES_USER:-postgres}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

export SYNAPSE_GATEWAY_DB="${SYNAPSE_GATEWAY_DB:-synapse_gateway}"
export SYNAPSE_GATEWAY_APP_USER="${SYNAPSE_GATEWAY_APP_USER:-synapse_gateway_app}"
export SYNAPSE_GATEWAY_APP_PASSWORD="${SYNAPSE_GATEWAY_APP_PASSWORD:-12345678}"
export SYNAPSE_GATEWAY_READONLY_USER="${SYNAPSE_GATEWAY_READONLY_USER:-synapse_gateway_ro}"
export SYNAPSE_GATEWAY_READONLY_PASSWORD="${SYNAPSE_GATEWAY_READONLY_PASSWORD:-12345678}"

export SYNAPSE_ADMIN_DB="${SYNAPSE_ADMIN_DB:-synapse_gateway_admin}"
export SYNAPSE_ADMIN_APP_USER="${SYNAPSE_ADMIN_APP_USER:-synapse_admin_app}"
export SYNAPSE_ADMIN_APP_PASSWORD="${SYNAPSE_ADMIN_APP_PASSWORD:-12345678}"
export SYNAPSE_ADMIN_READONLY_USER="${SYNAPSE_ADMIN_READONLY_USER:-synapse_admin_ro}"
export SYNAPSE_ADMIN_READONLY_PASSWORD="${SYNAPSE_ADMIN_READONLY_PASSWORD:-12345678}"

run_psql() {
    PGPASSWORD="${POSTGRES_PASSWORD}" psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" "$@"
}

echo "[bootstrap] creating databases and roles"
bash "${repo_root}/infra/docker/postgres/init/000_create_databases_and_roles.sh"

echo "[bootstrap] applying gateway runtime schema"
run_psql \
    --dbname "${SYNAPSE_GATEWAY_DB}" \
    --file "${repo_root}/infra/docker/postgres/init/001_synapse_schema.sql"

echo "[bootstrap] applying gateway-admin schema"
run_psql \
    --dbname "${SYNAPSE_ADMIN_DB}" \
    --file "${repo_root}/admin/gateway-admin/migrations/001_admin_control_plane_schema.sql"

run_psql \
    --dbname "${SYNAPSE_ADMIN_DB}" \
    --file "${repo_root}/admin/gateway-admin/migrations/002_admin_seed_data.sql"

run_psql \
    --dbname "${SYNAPSE_ADMIN_DB}" \
    --file "${repo_root}/admin/gateway-admin/migrations/003_admin_config_center_schema.sql"

echo "[bootstrap] applying gateway admin projection views"
run_psql \
    --dbname "${SYNAPSE_GATEWAY_DB}" \
    --file "${repo_root}/infra/docker/postgres/init/003_gateway_admin_projection_views.sql"

echo "[bootstrap] granting read access on projection views"
run_psql \
    --dbname "${SYNAPSE_GATEWAY_DB}" \
    --set=gateway_ro_user="${SYNAPSE_GATEWAY_READONLY_USER}" <<'SQL'
GRANT SELECT ON
    synapse_admin_dashboard_finance_projection,
    synapse_admin_dashboard_activity_trend_projection,
    synapse_admin_dashboard_operations_projection,
    synapse_admin_dashboard_projection
TO :"gateway_ro_user";
SQL

echo "[bootstrap] CI PostgreSQL bootstrap completed"