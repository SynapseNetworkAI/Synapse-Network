import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export function env(name, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

export function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function redact(value) {
  return String(value ?? "")
    .replace(/\bagt_[A-Za-z0-9._~+/-]+/g, "agt_[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(
      /"(?:privateKey|rawSignature|jwt|adminToken|accessToken|apiKey|secret|password|token|authorization)"\s*:\s*"(?!\[REDACTED\])[^"]+"/gi,
      (match) => match.replace(/:\s*"[^"]+"/, ':"[REDACTED]"')
    );
}

export function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [
        key,
        /private|secret|password|token|authorization|signature|credential/i.test(
          key
        )
          ? "[REDACTED]"
          : sanitize(next),
      ])
    );
  }
  return typeof value === "string" ? redact(value) : value;
}

export function assertProdUrl(name, value, expectedHost) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== expectedHost) {
    throw new Error(`${name} must be https://${expectedHost}; actual=${value}`);
  }
}

export async function checkCloudRunEnv({ root, evidence, addCheck }) {
  const project = env("PROD_GCP_PROJECT_ID", "synapse-network-prod");
  const region = env("PROD_GCP_REGION", "us-central1");
  const services = ["synapse-prod-gateway", "synapse-prod-user-front"];
  const rows = [];
  for (const service of services) {
    const result = spawnSync(
      "gcloud",
      [
        "run",
        "services",
        "describe",
        service,
        "--project",
        project,
        "--region",
        region,
        "--format=json",
      ],
      { cwd: root, encoding: "utf8" }
    );
    if (result.status !== 0) {
      evidence.warnings.push(
        `Cloud Run env check skipped for ${service}: ${(
          result.stderr || result.stdout
        ).trim()}`
      );
      addCheck(
        `gcloud:${service}:env`,
        false,
        { project, region },
        "gcloud auth/config unavailable."
      );
      continue;
    }
    const payload = JSON.parse(result.stdout);
    const envRows = payload?.spec?.template?.spec?.containers?.[0]?.env || [];
    rows.push({ service, env: envRows });
    const text = JSON.stringify(envRows);
    addCheck(`gcloud:${service}:env`, text.includes("synapse-network.ai"), {
      project,
      region,
      service,
      envKeys: envRows.map((row) => row.name),
    });
  }
  evidence.gcloud = sanitize(rows);
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function psqlJson({ dsn, root }, sql) {
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
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function credentialHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function createProdCoreDbReaders({
  root,
  postgresDsn,
  canonicalServices,
  agentCredential,
}) {
  const db = { root, dsn: postgresDsn };
  return {
    readServiceDb() {
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'canonical', COALESCE((
            SELECT json_agg(row_to_json(t))
            FROM (
              SELECT sm.service_id, sm.service_name, sm.status,
                     se.status AS endpoint_status, hs.health_score, hs.last_checked_at
              FROM synapse_service_manifests sm
              LEFT JOIN synapse_service_endpoints se ON se.service_id = sm.service_id
              LEFT JOIN synapse_service_health_snapshots hs ON hs.service_id = sm.service_id
              WHERE sm.service_id = ANY(ARRAY[${canonicalServices
                .map(sqlLiteral)
                .join(",")}])
              ORDER BY sm.service_id
            ) t
          ), '[]'::json),
          'activeServices', (SELECT COUNT(*) FROM synapse_service_manifests WHERE status = 'active')
        )::text;
        `
      );
    },
    readOwnerDb(address) {
      const wallet = sqlLiteral(address);
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'owner', (
            SELECT row_to_json(t) FROM (
              SELECT owner_id, owner_wallet, status, email_verified, created_at, updated_at
              FROM synapse_owner_accounts WHERE lower(owner_wallet)=lower(${wallet}) LIMIT 1
            ) t
          ),
          'balance', (
            SELECT row_to_json(t) FROM (
              SELECT account_id, available_balance::text, pending_balance::text, frozen_balance::text, updated_at
              FROM synapse_account_balances
              WHERE account_id = CONCAT('consumer_wallet::', lower(${wallet})) LIMIT 1
            ) t
          ),
          'recentWithdrawals', COALESCE((
            SELECT json_agg(row_to_json(t)) FROM (
              SELECT withdrawal_id, withdrawal_kind, amount_usdc::text, status, created_at, updated_at
              FROM synapse_vault_withdrawals vw
              JOIN synapse_owner_accounts oa ON oa.owner_id = vw.owner_id
              WHERE lower(oa.owner_wallet)=lower(${wallet})
              ORDER BY vw.created_at DESC LIMIT 10
            ) t
          ), '[]'::json)
        )::text;
        `
      );
    },
    readCredentialDb(credential = agentCredential) {
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'credentialId', ac.credential_id,
          'agentId', ac.agent_id,
          'status', ac.status,
          'ownerWallet', oa.owner_wallet,
          'budgetPolicy', bp.policy_id
        )::text
        FROM synapse_agent_credentials ac
        JOIN synapse_agent_profiles ap ON ap.agent_id = ac.agent_id
        JOIN synapse_owner_accounts oa ON oa.owner_id = ap.owner_id
        LEFT JOIN synapse_budget_policies bp ON bp.credential_id = ac.credential_id
        WHERE ac.secret_hash = ${sqlLiteral(credentialHash(credential || ""))}
        LIMIT 1;
        `
      );
    },
    readDepositDb(txHash) {
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'deposit', (
            SELECT row_to_json(t) FROM (
              SELECT deposit_id, owner_id, owner_address, target_account_id, tx_hash,
                     amount_usdc::text, status, block_number, request_id, created_at, updated_at
              FROM synapse_vault_deposits WHERE lower(tx_hash)=lower(${sqlLiteral(
                txHash
              )}) LIMIT 1
            ) t
          ),
          'ledger', COALESCE((
            SELECT json_agg(row_to_json(t)) FROM (
              SELECT reference_type, reference_id, business_type, amount_usdc::text, status, created_at
              FROM synapse_ledger_entries
              WHERE reference_id IN (SELECT deposit_id FROM synapse_vault_deposits WHERE lower(tx_hash)=lower(${sqlLiteral(
                txHash
              )}))
              ORDER BY created_at LIMIT 20
            ) t
          ), '[]'::json),
          'audit', COALESCE((
            SELECT json_agg(row_to_json(t)) FROM (
              SELECT event_type, business_type, owner_id, amount_delta::text, result_status, error_code, created_at
              FROM synapse_audit_events
              WHERE detail_json::text ILIKE '%' || ${sqlLiteral(
                String(txHash).slice(2, 18)
              )} || '%'
              ORDER BY created_at DESC LIMIT 20
            ) t
          ), '[]'::json)
        )::text;
        `
      );
    },
    readInvocationDb(invocationId) {
      return psqlJson(
        db,
        `
        SELECT json_build_object(
          'invocation', (
            SELECT row_to_json(t) FROM (
              SELECT invocation_id, quote_id, service_id, credential_id, status, charged_usdc::text, error_code, created_at, updated_at
              FROM synapse_invocations WHERE invocation_id=${sqlLiteral(
                invocationId
              )} LIMIT 1
            ) t
          ),
          'budgetEvents', COALESCE((
            SELECT json_agg(row_to_json(t)) FROM (
              SELECT event_id, credential_id, amount_usdc::text, event_kind, created_at
              FROM synapse_budget_events WHERE invocation_id=${sqlLiteral(
                invocationId
              )} ORDER BY created_at
            ) t
          ), '[]'::json),
          'ledger', COALESCE((
            SELECT json_agg(row_to_json(t)) FROM (
              SELECT reference_type, reference_id, business_type, debit_account_id, credit_account_id, amount_usdc::text, status
              FROM synapse_ledger_entries WHERE reference_id=${sqlLiteral(
                invocationId
              )} ORDER BY created_at
            ) t
          ), '[]'::json),
          'audit', COALESCE((
            SELECT json_agg(row_to_json(t)) FROM (
              SELECT event_type, business_type, service_id, invocation_id, amount_delta::text, result_status, error_code, created_at
              FROM synapse_audit_events WHERE invocation_id=${sqlLiteral(
                invocationId
              )} ORDER BY created_at
            ) t
          ), '[]'::json)
        )::text;
        `
      );
    },
  };
}
