#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
container_name="${SYNAPSE_POSTGRES_CONTAINER:-synapse-postgres}"
container_gateway_schema_file="/docker-entrypoint-initdb.d/gateway/001_synapse_schema.sql"
container_admin_schema_files=(
    "/docker-entrypoint-initdb.d/gateway-admin/003_gateway_admin_projection_views.sql"
    "/docker-entrypoint-initdb.d/gateway-admin/004_admin_funds_observability_projection_upgrade.sql"
    "/docker-entrypoint-initdb.d/gateway-admin/005_admin_task_monitoring_projection_upgrade.sql"
)
host_gateway_schema_file="${script_dir}/../gateway/001_synapse_schema.sql"
host_admin_schema_files=(
    "${script_dir}/003_gateway_admin_projection_views.sql"
    "${script_dir}/004_admin_funds_observability_projection_upgrade.sql"
    "${script_dir}/005_admin_task_monitoring_projection_upgrade.sql"
)

postgres_db="${POSTGRES_DB:-synapse_gateway}"
postgres_user="${POSTGRES_USER:-synapse}"
postgres_password="${POSTGRES_PASSWORD:-12345678}"

gateway_db="${SYNAPSE_GATEWAY_DB:-${postgres_db}}"
gateway_app_user="${SYNAPSE_GATEWAY_APP_USER:-synapse_gateway_app}"
gateway_ro_user="${SYNAPSE_GATEWAY_READONLY_USER:-synapse_gateway_ro}"
gateway_migrator_user="${SYNAPSE_GATEWAY_MIGRATOR_USER:-synapse_gateway_migrator}"

admin_db="${SYNAPSE_ADMIN_DB:-synapse_gateway_admin}"
admin_app_user="${SYNAPSE_ADMIN_APP_USER:-synapse_admin_app}"
admin_ro_user="${SYNAPSE_ADMIN_READONLY_USER:-synapse_admin_ro}"
admin_migrator_user="${SYNAPSE_ADMIN_MIGRATOR_USER:-synapse_admin_migrator}"

run_psql_local() {
    PGPASSWORD="${postgres_password}" psql -v ON_ERROR_STOP=1 --username "${postgres_user}" "$@"
}

run_psql_docker() {
    docker exec -i -e PGPASSWORD="${postgres_password}" "${container_name}" \
        psql -v ON_ERROR_STOP=1 --username "${postgres_user}" "$@"
}

run_psql() {
    if [[ -f "${container_gateway_schema_file}" || -f "${host_gateway_schema_file}" ]]; then
        run_psql_local "$@"
        return
    fi

    run_psql_docker "$@"
}

run_psql_file() {
    local db_name="$1"
    local container_schema_file="$2"
    local host_schema_file="$3"
    shift
    shift
    shift

    if [[ -f "${container_schema_file}" ]]; then
        run_psql_local --dbname "${db_name}" "$@" --file "${container_schema_file}"
        return
    fi

    if [[ -f "${host_schema_file}" ]]; then
        run_psql_local --dbname "${db_name}" "$@" --file "${host_schema_file}"
        return
    fi

    if [[ ! -f "${host_schema_file}" ]]; then
        echo "missing schema bootstrap: ${host_schema_file}" >&2
        exit 1
    fi
}

if [[ ! -f "${container_gateway_schema_file}" && ! -f "${host_gateway_schema_file}" ]]; then
    echo "missing gateway schema bootstrap: ${host_gateway_schema_file}" >&2
    exit 1
fi

for schema_file in "${container_admin_schema_files[@]}"; do
    if [[ -f "${schema_file}" ]]; then
        continue
    fi

    schema_basename="$(basename "${schema_file}")"
    schema_host_path="${script_dir}/${schema_basename}"
    if [[ ! -f "${schema_host_path}" ]]; then
        echo "missing admin schema bootstrap: ${schema_host_path}" >&2
        exit 1
    fi
done

if [[ ! -f "${container_gateway_schema_file}" ]] && [[ ! -f "${host_gateway_schema_file}" ]]; then
    echo "missing postgres bootstrap sources for local or container mode" >&2
    exit 1
fi

grant_schema_access() {
    local db_name="$1"
    local app_user="$2"
    local ro_user="$3"
    local migrator_user="${4:-}"

    run_psql \
        --dbname "${db_name}" \
        --set=app_user="${app_user}" \
        --set=ro_user="${ro_user}" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO :"app_user";
GRANT USAGE ON SCHEMA public TO :"ro_user";

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON ALL TABLES IN SCHEMA public TO :"app_user";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO :"ro_user";

GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"app_user";
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO :"ro_user";

SELECT format('GRANT USAGE ON TYPE public.%I TO %I', t.typname, :'app_user')
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
    AND t.typtype IN ('d', 'e') \gexec

SELECT format('GRANT USAGE ON TYPE public.%I TO %I', t.typname, :'ro_user')
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
    AND t.typtype IN ('d', 'e') \gexec

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO :"app_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO :"ro_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON SEQUENCES TO :"ro_user";
SQL

    if [[ -n "${migrator_user}" ]]; then
        run_psql \
            --dbname "${db_name}" \
            --set=migrator_user="${migrator_user}" <<'SQL'
GRANT USAGE, CREATE ON SCHEMA public TO :"migrator_user";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO :"migrator_user";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO :"migrator_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL PRIVILEGES ON TABLES TO :"migrator_user";

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL PRIVILEGES ON SEQUENCES TO :"migrator_user";
SQL
    fi
}

run_psql_file \
    "${gateway_db}" \
    "${container_gateway_schema_file}" \
    "${host_gateway_schema_file}" \
    --set=synapse_gateway_db="${gateway_db}"

run_psql_file \
    "${admin_db}" \
    "${container_admin_schema_files[0]}" \
    "${host_admin_schema_files[0]}" \
    --set=synapse_admin_db="${admin_db}"

for index in "${!container_admin_schema_files[@]}"; do
    run_psql_file \
        "${gateway_db}" \
        "${container_admin_schema_files[index]}" \
        "${host_admin_schema_files[index]}" \
        --set=synapse_gateway_db="${gateway_db}"
done

run_psql \
    --dbname postgres \
    --set=gateway_db="${gateway_db}" \
    --set=gateway_app_user="${gateway_app_user}" \
    --set=gateway_ro_user="${gateway_ro_user}" \
    --set=gateway_migrator_user="${gateway_migrator_user}" \
    --set=admin_db="${admin_db}" \
    --set=admin_app_user="${admin_app_user}" \
    --set=admin_ro_user="${admin_ro_user}" \
    --set=admin_migrator_user="${admin_migrator_user}" <<'SQL'
REVOKE ALL ON DATABASE :"gateway_db" FROM PUBLIC;
REVOKE ALL ON DATABASE :"admin_db" FROM PUBLIC;

GRANT CONNECT, TEMPORARY ON DATABASE :"gateway_db" TO :"gateway_app_user";
GRANT CONNECT ON DATABASE :"gateway_db" TO :"gateway_ro_user";
GRANT ALL PRIVILEGES ON DATABASE :"gateway_db" TO :"gateway_migrator_user";

GRANT CONNECT, TEMPORARY ON DATABASE :"admin_db" TO :"admin_app_user";
GRANT CONNECT ON DATABASE :"admin_db" TO :"admin_ro_user";
GRANT ALL PRIVILEGES ON DATABASE :"admin_db" TO :"admin_migrator_user";
SQL

grant_schema_access "${gateway_db}" "${gateway_app_user}" "${gateway_ro_user}" "${gateway_migrator_user}"
grant_schema_access "${admin_db}" "${admin_app_user}" "${admin_ro_user}" "${admin_migrator_user}"
