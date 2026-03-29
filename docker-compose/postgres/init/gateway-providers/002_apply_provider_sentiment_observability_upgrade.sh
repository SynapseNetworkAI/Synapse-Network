#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
container_name="${SYNAPSE_POSTGRES_CONTAINER:-synapse-postgres}"
container_schema_file="/docker-entrypoint-initdb.d/gateway-providers/002_provider_sentiment_observability_upgrade.sql"
host_schema_file="${script_dir}/002_provider_sentiment_observability_upgrade.sql"

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

if [[ -f "${container_schema_file}" ]]; then
    run_psql_local --dbname "${provider_db}" --file "${container_schema_file}"
    exit 0
fi

if [[ ! -f "${host_schema_file}" ]]; then
    echo "missing provider sentiment observability upgrade: ${host_schema_file}" >&2
    exit 1
fi

run_psql_docker --dbname "${provider_db}" --file "${container_schema_file}"