-- Synapse staging credential rotation helper
-- Usage example:
--   PGPASSWORD=<superuser_pw> psql -h <host> -U <superuser> -d postgres \
--     -f scripts/sql/rotate_synapse_db_credentials.sql \
--     -v gateway_app_user=synapse_gateway_app -v gateway_app_password='new-app-secret' \
--     -v gateway_ro_user=synapse_gateway_ro   -v gateway_ro_password='new-ro-secret' \
--     -v gateway_migrator_user=synapse_gateway_migrator -v gateway_migrator_password='new-migrator-secret' \
--     -v admin_app_user=synapse_admin_app -v admin_app_password='new-admin-app-secret' \
--     -v admin_ro_user=synapse_admin_ro   -v admin_ro_password='new-admin-ro-secret' \
--     -v admin_migrator_user=synapse_admin_migrator -v admin_migrator_password='new-admin-migrator-secret'
-- Only the roles supplied via -v pairs will be altered; omit variables you do not intend to rotate.

\echo '--- Synapse credential rotation starting ---'

\if :{?gateway_app_password}
  \if :{?gateway_app_user}
ALTER ROLE :"gateway_app_user" WITH PASSWORD :'gateway_app_password';
\echo 'Updated gateway app role'
  \else
\echo 'Skipped gateway app role (gateway_app_user not provided)'
  \endif
\endif

\if :{?gateway_ro_password}
  \if :{?gateway_ro_user}
ALTER ROLE :"gateway_ro_user" WITH PASSWORD :'gateway_ro_password';
\echo 'Updated gateway readonly role'
  \else
\echo 'Skipped gateway readonly role (gateway_ro_user not provided)'
  \endif
\endif

\if :{?gateway_migrator_password}
  \if :{?gateway_migrator_user}
ALTER ROLE :"gateway_migrator_user" WITH PASSWORD :'gateway_migrator_password';
\echo 'Updated gateway migrator role'
  \else
\echo 'Skipped gateway migrator role (gateway_migrator_user not provided)'
  \endif
\endif

\if :{?admin_app_password}
  \if :{?admin_app_user}
ALTER ROLE :"admin_app_user" WITH PASSWORD :'admin_app_password';
\echo 'Updated admin app role'
  \else
\echo 'Skipped admin app role (admin_app_user not provided)'
  \endif
\endif

\if :{?admin_ro_password}
  \if :{?admin_ro_user}
ALTER ROLE :"admin_ro_user" WITH PASSWORD :'admin_ro_password';
\echo 'Updated admin readonly role'
  \else
\echo 'Skipped admin readonly role (admin_ro_user not provided)'
  \endif
\endif

\if :{?admin_migrator_password}
  \if :{?admin_migrator_user}
ALTER ROLE :"admin_migrator_user" WITH PASSWORD :'admin_migrator_password';
\echo 'Updated admin migrator role'
  \else
\echo 'Skipped admin migrator role (admin_migrator_user not provided)'
  \endif
\endif

\echo '--- Synapse credential rotation completed ---'
