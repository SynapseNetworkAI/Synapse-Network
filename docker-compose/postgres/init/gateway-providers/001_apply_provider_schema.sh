#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
container_name="${SYNAPSE_POSTGRES_CONTAINER:-synapse-postgres}"
container_schema_file="/docker-entrypoint-initdb.d/gateway-providers/001_provider_schema.sql"
host_schema_file="${script_dir}/001_provider_schema.sql"

postgres_user="${POSTGRES_USER:-synapse}"
postgres_password="${POSTGRES_PASSWORD:-12345678}"
provider_db="${SYNAPSE_PROVIDER_DB:-synapse_gateway_providers}"
provider_app_user="${SYNAPSE_PROVIDER_APP_USER:-synapse_provider_app}"
provider_ro_user="${SYNAPSE_PROVIDER_READONLY_USER:-synapse_provider_ro}"
postgres_host="${PGHOST:-127.0.0.1}"
postgres_port="${PGPORT:-5432}"

run_psql_local() {
    PGPASSWORD="${postgres_password}" psql -v ON_ERROR_STOP=1 --host "${postgres_host}" --port "${postgres_port}" --username "${postgres_user}" "$@"
}

run_psql_docker() {
    docker exec -i -e PGPASSWORD="${postgres_password}" "${container_name}" \
        psql -v ON_ERROR_STOP=1 --username "${postgres_user}" "$@"
}

run_schema_file() {
    local schema_path="$1"
    if [[ -f "${container_schema_file}" ]]; then
        run_psql_local --dbname "${provider_db}" --file "${schema_path}"
        return
    fi
    docker exec -i -e PGPASSWORD="${postgres_password}" "${container_name}" \
        psql -v ON_ERROR_STOP=1 --username "${postgres_user}" --dbname "${provider_db}" < "${schema_path}"
}

run_psql() {
    if [[ -f "${container_schema_file}" ]]; then
        run_psql_local "$@"
        return
    fi
    run_psql_docker "$@"
}

if [[ ! -f "${container_schema_file}" && ! -f "${host_schema_file}" ]]; then
    echo "missing provider schema bootstrap: ${host_schema_file}" >&2
    exit 1
fi

if [[ ! -f "${container_schema_file}" ]] && ! docker ps --format '{{.Names}}' | grep -Fxq "${container_name}"; then
    echo "postgres container is not running: ${container_name}" >&2
    exit 1
fi

if [[ -f "${container_schema_file}" ]]; then
    run_schema_file "${container_schema_file}"
else
    run_schema_file "${host_schema_file}"
fi

run_psql \
    --dbname "${provider_db}" \
    --set=app_user="${provider_app_user}" \
    --set=ro_user="${provider_ro_user}" <<'SQL'
GRANT USAGE ON SCHEMA public TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"ro_user";

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"ro_user";

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO :"ro_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO :"ro_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON SEQUENCES TO :"ro_user";
SQL
