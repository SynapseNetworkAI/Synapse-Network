#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
container_name="${SYNAPSE_POSTGRES_CONTAINER:-synapse-postgres}"
container_schema_file="/docker-entrypoint-initdb.d/gateway-providers/006_provider_contract_audit_observability_upgrade.sql"
host_schema_file="${script_dir}/006_provider_contract_audit_observability_upgrade.sql"

postgres_user="${POSTGRES_USER:-synapse}"
postgres_password="${POSTGRES_PASSWORD:-12345678}"
provider_db="${SYNAPSE_PROVIDER_DB:-synapse_gateway_providers}"

run_psql_local() {
    PGPASSWORD="${postgres_password}" psql -v ON_ERROR_STOP=1 --username "${postgres_user}" "$@"
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

if [[ ! -f "${container_schema_file}" && ! -f "${host_schema_file}" ]]; then
    echo "missing provider contract audit observability upgrade bootstrap: ${host_schema_file}" >&2
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
