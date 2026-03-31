#!/usr/bin/env bash
set -euo pipefail

provider_db="${SYNAPSE_PROVIDER_DB:-synapse_gateway_providers}"
provider_app_user="${SYNAPSE_PROVIDER_APP_USER:-synapse_provider_app}"
provider_app_password="${SYNAPSE_PROVIDER_APP_PASSWORD:-12345678}"
provider_ro_user="${SYNAPSE_PROVIDER_READONLY_USER:-synapse_provider_ro}"
provider_ro_password="${SYNAPSE_PROVIDER_READONLY_PASSWORD:-12345678}"
postgres_host="${PGHOST:-127.0.0.1}"
postgres_port="${PGPORT:-5432}"

run_psql() {
    PGPASSWORD="${POSTGRES_PASSWORD}" psql -v ON_ERROR_STOP=1 --host "${postgres_host}" --port "${postgres_port}" --username "${POSTGRES_USER}" "$@"
}

run_psql \
    --dbname postgres \
    --set=provider_db="${provider_db}" \
    --set=provider_app_user="${provider_app_user}" \
    --set=provider_app_password="${provider_app_password}" \
    --set=provider_ro_user="${provider_ro_user}" \
    --set=provider_ro_password="${provider_ro_password}" <<'SQL'
SELECT format('CREATE DATABASE %I', :'provider_db')
WHERE NOT EXISTS (
    SELECT 1 FROM pg_database WHERE datname = :'provider_db'
) \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'provider_app_user',
    :'provider_app_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'provider_app_user'
) \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'provider_app_user',
    :'provider_app_password'
)
WHERE EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'provider_app_user'
) \gexec

SELECT format(
    'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'provider_ro_user',
    :'provider_ro_password'
)
WHERE NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'provider_ro_user'
) \gexec

SELECT format(
    'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION',
    :'provider_ro_user',
    :'provider_ro_password'
)
WHERE EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = :'provider_ro_user'
) \gexec

REVOKE ALL ON DATABASE :"provider_db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"provider_db" TO :"provider_app_user";
GRANT CONNECT ON DATABASE :"provider_db" TO :"provider_ro_user";
SQL
