import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

import { financeProjectionSql } from "./admin_dashboard_projection_readmodel_sql.mjs";

export function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isLocalUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

export function assertLocalOnly(config) {
  for (const [name, value] of [
    ["ADMIN_FRONT_URL", config.adminFrontUrl],
    ["ADMIN_GATEWAY_URL", config.adminGatewayUrl],
  ]) {
    if (!isLocalUrl(value)) {
      throw new Error(`Refusing non-local ${name}: ${value}`);
    }
  }
  for (const [name, dsn] of [
    ["ADMIN_DATABASE_DSN", config.adminDsn],
    ["GATEWAY_POSTGRES_DSN", config.gatewayDsn],
  ]) {
    if (!dsn.includes("127.0.0.1") && !dsn.includes("localhost")) {
      throw new Error(`Refusing non-local ${name}.`);
    }
  }
}

export function createRedactor(config) {
  function redact(value) {
    let text = String(value ?? "")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi, "Bearer [REDACTED]")
      .replace(
        /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/gi,
        "postgresql://[REDACTED]@"
      )
      .replace(
        /"((?:password|authorization|access_token|token|secret|cookie|session)[^"]*)"\s*:\s*"[^"]+"/gi,
        '"$1":"[REDACTED]"'
      );
    if (config.adminPassword) {
      text = text.replaceAll(config.adminPassword, "[REDACTED_PASSWORD]");
    }
    if (config.adminTotpSecret) {
      text = text.replaceAll(config.adminTotpSecret, "[REDACTED_TOTP]");
    }
    return text;
  }

  function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, next]) => [
          key,
          /password|authorization|bearer|jwt|token|secret|cookie|session/i.test(
            key
          )
            ? "[REDACTED]"
            : sanitize(next),
        ])
      );
    }
    return typeof value === "string" ? redact(value) : value;
  }

  return { redact, sanitize };
}

function sqlSha(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

function assertReadOnlySql(name, sql) {
  const normalized = sql.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized.startsWith("select")) {
    throw new Error(`${name} SQL must be read-only SELECT.`);
  }
  if (/\b(insert|update|delete|truncate|alter|drop|create)\b/i.test(sql)) {
    throw new Error(`${name} SQL contains a forbidden mutating statement.`);
  }
}

function sh(root, command, args, redact, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PGOPTIONS: "-c default_transaction_read_only=on",
      ...(options.env || {}),
    },
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${redact(
        (result.stderr || result.stdout || "").trim()
      )}`
    );
  }
  return result.stdout.trim();
}

function psqlJson(root, dsn, name, sql, evidence, redact) {
  assertReadOnlySql(name, sql);
  const result = sh(
    root,
    "psql",
    [dsn, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
    redact
  );
  evidence.sql.queries.push({
    name,
    sqlSha256: sqlSha(sql),
    readOnly: true,
  });
  return result ? JSON.parse(result) : null;
}

function adminSchemaSql() {
  return `
    SELECT json_build_object(
      'database', current_database(),
      'adminUsersTableExists', to_regclass('public.admin_users') IS NOT NULL,
      'adminSessionsTableExists', to_regclass('public.admin_sessions') IS NOT NULL
    )
  `;
}

function reconciliationRuntimeSql() {
  return `
    SELECT json_build_object(
      'chainVaultUsdc', payload->>'chainVaultUsdc',
      'ledgerObligationUsdc', payload->>'ledgerObligationUsdc',
      'deltaUsdc', payload->>'deltaUsdc',
      'lastCheckAt', payload->>'lastCheckAt',
      'updatedAt', updated_at
    )
    FROM synapse_runtime_state
    WHERE state_key = 'deposit_reconciliation_state'
    LIMIT 1
  `;
}

export function collectSqlEvidence({ config, evidence, root, redact }) {
  evidence.sql.adminSchema = psqlJson(
    root,
    config.adminDsn,
    "admin-schema-readonly",
    adminSchemaSql(),
    evidence,
    redact
  );
  evidence.sql.financeProjection = psqlJson(
    root,
    config.gatewayDsn,
    "finance-projection-native-columns",
    financeProjectionSql(),
    evidence,
    redact
  );
  evidence.sql.reconciliationRuntime = psqlJson(
    root,
    config.gatewayDsn,
    "reconciliation-runtime-state-readonly",
    reconciliationRuntimeSql(),
    evidence,
    redact
  );
}

function base32ToBuffer(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of String(secret)
    .replace(/=+$/g, "")
    .replace(/\s+/g, "")
    .toUpperCase()) {
    const value = alphabet.indexOf(char);
    if (value < 0) {
      throw new Error(`Invalid base32 character in ADMIN_TOTP_SECRET: ${char}`);
    }
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret, nowMs = Date.now()) {
  const counter = Math.floor(nowMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto
    .createHmac("sha1", base32ToBuffer(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

export function resolveLocalAdminTotpSecret({ config, root }) {
  if (config.adminTotpSecret) return config.adminTotpSecret;
  const sql = `
    SELECT to_json(payload_json->>'totpSecret')
    FROM admin_mfa_factors mf
    JOIN admin_users au ON au.admin_id = mf.admin_id
    WHERE au.email = ${sqlLiteral(config.adminEmail)}
      AND mf.status = 'active'
      AND payload_json ? 'totpSecret'
    ORDER BY mf.updated_at DESC
    LIMIT 1
  `;
  const result = spawnSync(
    "psql",
    [
      config.adminDsn,
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
    }
  );
  if (result.status !== 0) return "JBSWY3DPEHPK3PXP";
  try {
    const parsed = JSON.parse(result.stdout.trim() || "null");
    return typeof parsed === "string" && parsed.trim()
      ? parsed.trim()
      : "JBSWY3DPEHPK3PXP";
  } catch {
    return "JBSWY3DPEHPK3PXP";
  }
}

export function normalizeMoney(value) {
  if (value === null || value === undefined || value === "unavailable") {
    return value ?? null;
  }
  const raw = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return raw;
  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(6, "0").slice(0, 6)}`;
}

export function shortAddress(address) {
  if (!address || address === "unavailable") return address || "";
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

export function addressTail(address) {
  return address.slice(-6);
}
