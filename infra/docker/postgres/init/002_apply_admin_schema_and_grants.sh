#!/usr/bin/env bash
set -euo pipefail

gateway_db="${SYNAPSE_GATEWAY_DB:-${POSTGRES_DB:-synapse_gateway}}"
gateway_app_user="${SYNAPSE_GATEWAY_APP_USER:-synapse_gateway_app}"
gateway_ro_user="${SYNAPSE_GATEWAY_READONLY_USER:-synapse_gateway_ro}"

admin_db="${SYNAPSE_ADMIN_DB:-synapse_gateway_admin}"
admin_app_user="${SYNAPSE_ADMIN_APP_USER:-synapse_admin_app}"
admin_ro_user="${SYNAPSE_ADMIN_READONLY_USER:-synapse_admin_ro}"

run_psql() {
    PGPASSWORD="${POSTGRES_PASSWORD}" psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" "$@"
}

grant_schema_access() {
    local db_name="$1"
    local app_user="$2"
    local ro_user="$3"

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
}

run_psql \
    --dbname "${admin_db}" \
    --file /admin-migrations/001_admin_control_plane_schema.sql

run_psql \
    --dbname "${admin_db}" \
    --file /admin-migrations/002_admin_seed_data.sql

run_psql \
    --dbname postgres \
    --set=gateway_db="${gateway_db}" \
    --set=gateway_app_user="${gateway_app_user}" \
    --set=gateway_ro_user="${gateway_ro_user}" \
    --set=admin_db="${admin_db}" \
    --set=admin_app_user="${admin_app_user}" \
    --set=admin_ro_user="${admin_ro_user}" <<'SQL'
REVOKE ALL ON DATABASE :"gateway_db" FROM PUBLIC;
REVOKE ALL ON DATABASE :"admin_db" FROM PUBLIC;

GRANT CONNECT, TEMPORARY ON DATABASE :"gateway_db" TO :"gateway_app_user";
GRANT CONNECT ON DATABASE :"gateway_db" TO :"gateway_ro_user";

GRANT CONNECT, TEMPORARY ON DATABASE :"admin_db" TO :"admin_app_user";
GRANT CONNECT ON DATABASE :"admin_db" TO :"admin_ro_user";
SQL

grant_schema_access "${gateway_db}" "${gateway_app_user}" "${gateway_ro_user}"
grant_schema_access "${admin_db}" "${admin_app_user}" "${admin_ro_user}"