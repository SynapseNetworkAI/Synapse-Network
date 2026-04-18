#!/usr/bin/env bash
set -euo pipefail

gateway_db="${SYNAPSE_GATEWAY_DB:-${POSTGRES_DB:-synapse_gateway}}"
gateway_app_user="${SYNAPSE_GATEWAY_APP_USER:-synapse_gateway_app}"
gateway_app_password="${SYNAPSE_GATEWAY_APP_PASSWORD:-local-dev-gateway-app-password}"
gateway_ro_user="${SYNAPSE_GATEWAY_READONLY_USER:-synapse_gateway_ro}"
gateway_ro_password="${SYNAPSE_GATEWAY_READONLY_PASSWORD:-local-dev-gateway-readonly-password}"
gateway_migrator_user="${SYNAPSE_GATEWAY_MIGRATOR_USER:-synapse_gateway_migrator}"
gateway_migrator_password="${SYNAPSE_GATEWAY_MIGRATOR_PASSWORD:-local-dev-gateway-migrator-password}"

admin_db="${SYNAPSE_ADMIN_DB:-synapse_gateway_admin}"
admin_app_user="${SYNAPSE_ADMIN_APP_USER:-synapse_admin_app}"
admin_app_password="${SYNAPSE_ADMIN_APP_PASSWORD:-local-dev-admin-app-password}"
admin_ro_user="${SYNAPSE_ADMIN_READONLY_USER:-synapse_admin_ro}"
admin_ro_password="${SYNAPSE_ADMIN_READONLY_PASSWORD:-local-dev-admin-readonly-password}"
admin_migrator_user="${SYNAPSE_ADMIN_MIGRATOR_USER:-synapse_admin_migrator}"
admin_migrator_password="${SYNAPSE_ADMIN_MIGRATOR_PASSWORD:-local-dev-admin-migrator-password}"

run_psql() {
    PGPASSWORD="${POSTGRES_PASSWORD}" psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" "$@"
}

run_psql \
    --dbname postgres \
    --set=gateway_db="${gateway_db}" \
    --set=gateway_app_user="${gateway_app_user}" \
    --set=gateway_app_password="${gateway_app_password}" \
    --set=gateway_ro_user="${gateway_ro_user}" \
    --set=gateway_ro_password="${gateway_ro_password}" \
    --set=gateway_migrator_user="${gateway_migrator_user}" \
    --set=gateway_migrator_password="${gateway_migrator_password}" \
    --set=admin_db="${admin_db}" \
    --set=admin_app_user="${admin_app_user}" \
    --set=admin_app_password="${admin_app_password}" \
    --set=admin_ro_user="${admin_ro_user}" \
    --set=admin_ro_password="${admin_ro_password}" \
    --set=admin_migrator_user="${admin_migrator_user}" \
    --set=admin_migrator_password="${admin_migrator_password}" <<'SQL'
SELECT format('CREATE DATABASE %I', :'gateway_db')
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = :'gateway_db'
) \gexec

SELECT format('CREATE DATABASE %I', :'admin_db')
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = :'admin_db'
) \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'gateway_app_user',
    :'gateway_app_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'gateway_app_user'
) \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'gateway_app_user',
    :'gateway_app_password'
)
WHERE EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'gateway_app_user'
) \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'gateway_ro_user',
    :'gateway_ro_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'gateway_ro_user'
) \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'gateway_ro_user',
    :'gateway_ro_password'
)
WHERE EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'gateway_ro_user'
) \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'admin_app_user',
    :'admin_app_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'admin_app_user'
) \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'admin_app_user',
    :'admin_app_password'
)
WHERE EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'admin_app_user'
) \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'admin_ro_user',
    :'admin_ro_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'admin_ro_user'
) \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'admin_ro_user',
    :'admin_ro_password'
)
WHERE EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'admin_ro_user'
) \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'gateway_migrator_user',
    :'gateway_migrator_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'gateway_migrator_user'
) \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'gateway_migrator_user',
    :'gateway_migrator_password'
)
WHERE EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'gateway_migrator_user'
) \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'admin_migrator_user',
    :'admin_migrator_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'admin_migrator_user'
) \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'admin_migrator_user',
    :'admin_migrator_password'
)
WHERE EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'admin_migrator_user'
) \gexec
SQL
