import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function psqlText({ dsn, root }, sql) {
  const result = spawnSync(
    "psql",
    [dsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
    }
  );
  if (result.status !== 0) {
    throw new Error(
      `psql failed: ${(result.stderr || result.stdout || "").trim()}`
    );
  }
  return result.stdout.trim();
}

function psqlJson(db, sql) {
  const text = psqlText(db, sql);
  return text ? JSON.parse(text) : null;
}

function credentialHash(agentCredential) {
  return crypto.createHash("sha256").update(agentCredential).digest("hex");
}

export function createStagingFullRegressionDbReaders({
  root,
  postgresDsn,
  canonicalServices,
  agentCredential,
}) {
  const db = { root, dsn: postgresDsn };
  return {
    readServiceBaseline() {
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'total', (SELECT COUNT(*) FROM synapse_service_manifests),
          'active', (SELECT COUNT(*) FROM synapse_service_manifests WHERE status = 'active'),
          'canonical', COALESCE((
            SELECT json_agg(row_to_json(t))
            FROM (
              SELECT sm.service_id, sm.service_name, sm.status, sm.updated_at,
                     se.endpoint_url, se.status AS endpoint_status,
                     hs.health_score, hs.last_checked_at, hs.error_code
              FROM synapse_service_manifests sm
              LEFT JOIN synapse_service_endpoints se ON se.service_id = sm.service_id
              LEFT JOIN synapse_service_health_snapshots hs ON hs.service_id = sm.service_id
              WHERE sm.service_id = ANY(ARRAY[${canonicalServices
                .map(sqlLiteral)
                .join(",")}])
              ORDER BY sm.service_id
            ) t
          ), '[]'::json)
        )::text;
        `
      );
    },
    readOwnerDb(address) {
      const owner = sqlLiteral(address);
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'owner', (
            SELECT row_to_json(t)
            FROM (
              SELECT owner_id, owner_wallet, status, email_verified, created_at, updated_at
              FROM synapse_owner_accounts
              WHERE lower(owner_wallet) = lower(${owner})
              LIMIT 1
            ) t
          ),
          'balance', (
            SELECT row_to_json(t)
            FROM (
              SELECT account_id, available_balance::text, pending_balance::text,
                     frozen_balance::text, updated_at
              FROM synapse_account_balances
              WHERE account_id = CONCAT('consumer_wallet::', LOWER(${owner}))
              LIMIT 1
            ) t
          ),
          'recentDeposits', COALESCE((
            SELECT json_agg(row_to_json(t))
            FROM (
              SELECT deposit_id, tx_hash, amount_usdc::text, status, updated_at
              FROM synapse_vault_deposits
              WHERE lower(owner_address) = lower(${owner})
              ORDER BY updated_at DESC
              LIMIT 10
            ) t
          ), '[]'::json)
        )::text;
        `
      );
    },
    readCredentialOwnerDb() {
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'credential', json_build_object(
            'credentialId', ac.credential_id,
            'agentId', ac.agent_id,
            'tokenPrefix', ac.secret_prefix,
            'status', ac.status,
            'issuedAt', ac.issued_at,
            'lastUsedAt', ac.last_used_at
          ),
          'agent', json_build_object(
            'agentId', ap.agent_id,
            'ownerId', ap.owner_id,
            'name', ap.name,
            'status', ap.status
          ),
          'ownerWallet', oa.owner_wallet
        )::text
        FROM synapse_agent_credentials ac
        JOIN synapse_agent_profiles ap ON ap.agent_id = ac.agent_id
        JOIN synapse_owner_accounts oa ON oa.owner_id = ap.owner_id
        WHERE ac.secret_hash = ${sqlLiteral(credentialHash(agentCredential))}
        LIMIT 1;
        `
      );
    },
    readInvocationDb(invocationId) {
      const invocation = sqlLiteral(invocationId);
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'invocation', (
            SELECT row_to_json(t)
            FROM (
              SELECT invocation_id, quote_id, service_id, credential_id, status,
                     charged_usdc::text, error_code, created_at, updated_at
              FROM synapse_invocations
              WHERE invocation_id = ${invocation}
              LIMIT 1
            ) t
          ),
          'ledger', COALESCE((
            SELECT json_agg(row_to_json(t))
            FROM (
              SELECT reference_type, reference_id, business_type,
                     debit_account_id, credit_account_id, amount_usdc::text, status
              FROM synapse_ledger_entries
              WHERE reference_id = ${invocation}
              ORDER BY created_at
              LIMIT 20
            ) t
          ), '[]'::json),
          'audit', COALESCE((
            SELECT json_agg(row_to_json(t))
            FROM (
              SELECT event_type, business_type, service_id, invocation_id,
                     amount_delta::text, result_status, error_code, created_at
              FROM synapse_audit_events
              WHERE invocation_id = ${invocation}
              ORDER BY created_at
              LIMIT 20
            ) t
          ), '[]'::json)
        )::text;
        `
      );
    },
    readAdminDbSummary() {
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'ownerAccounts', (SELECT COUNT(*) FROM synapse_owner_accounts),
          'deposits', (SELECT COUNT(*) FROM synapse_vault_deposits),
          'providerWithdrawals', (
            SELECT COUNT(*) FROM synapse_vault_withdrawals
            WHERE withdrawal_kind::text ILIKE '%provider%'
          ),
          'pendingReviews', (
            SELECT COUNT(*) FROM synapse_vault_withdrawals
            WHERE status::text ILIKE '%PENDING%'
          )
        )::text;
        `
      );
    },
  };
}
