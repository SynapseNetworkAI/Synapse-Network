import crypto from "node:crypto";

export function createWithdrawalReviewMaturityHelpers({
  evidence,
  pass,
  queryJson,
  sqlLiteral,
}) {
  function matureConsumerDeposits(ownerAddress) {
    const result = queryJson(`
      WITH updated AS (
        UPDATE synapse_vault_deposits deposit
        SET updated_at = NOW() - INTERVAL '2 days'
        WHERE lower(deposit.owner_address) = lower(${sqlLiteral(ownerAddress)})
          AND deposit.status = 'CONFIRMED'
        RETURNING deposit.deposit_id
      )
      SELECT json_build_object('updated', (SELECT COUNT(*) FROM updated))
    `);
    if (Number(result?.updated || 0) < 1) {
      throw new Error(
        `No confirmed consumer deposit matured for ${ownerAddress}`
      );
    }
    evidence.db.consumerDepositMaturity = result;
    pass(
      "consumer:deposit-matured",
      `${result.updated} confirmed deposit(s) aged past T+1`
    );
  }

  function matureProviderCharges(ownerAddress) {
    const result = queryJson(`
      WITH provider_account AS (
        SELECT la.account_id
        FROM synapse_ledger_accounts la
        JOIN synapse_owner_accounts oa ON oa.owner_id = la.owner_id
        WHERE lower(oa.owner_wallet) = lower(${sqlLiteral(ownerAddress)})
          AND la.account_kind = 'provider_wallet'
        LIMIT 1
      ),
      updated AS (
        UPDATE synapse_ledger_entries entry
        SET created_at = NOW() - INTERVAL '8 days'
        WHERE entry.credit_account_id = (SELECT account_id FROM provider_account)
          AND entry.business_type = 'charge'
          AND entry.status = 'posted'
          AND entry.created_at >= NOW() - INTERVAL '2 hours'
        RETURNING entry.entry_id
      )
      SELECT json_build_object('updated', (SELECT COUNT(*) FROM updated))
    `);
    if (Number(result?.updated || 0) < 1) {
      throw new Error(
        `No provider charge ledger rows matured for ${ownerAddress}`
      );
    }
    evidence.db.providerChargeMaturity = result;
    pass(
      "provider:charges-matured",
      `${result.updated} charge ledger row(s) aged past T+7`
    );
  }

  function serviceEndpointId(serviceId, targetUrl, index = 0) {
    const suffix = crypto
      .createHash("sha1")
      .update(String(targetUrl))
      .digest("hex")
      .slice(0, 10);
    return `${serviceId}:ep:${index}:${suffix}`;
  }

  function seedServiceHealth(serviceId, targetUrl) {
    const endpointId = serviceEndpointId(serviceId, targetUrl);
    queryJson(`
      WITH endpoint_upsert AS (
        INSERT INTO synapse_service_endpoints
          (endpoint_id, service_id, endpoint_url, auth_mode, timeout_ms,
           max_payload_bytes, streaming_supported, async_supported,
           callback_supported, weight, is_primary, status,
           created_at, updated_at)
        VALUES (
          ${sqlLiteral(endpointId)}, ${sqlLiteral(serviceId)}, ${sqlLiteral(
      targetUrl
    )}, 'gateway_signed', 30000,
          1048576, FALSE, FALSE,
          FALSE, 100, TRUE, 'active',
          NOW(), NOW()
        )
        ON CONFLICT (endpoint_id) DO UPDATE SET updated_at = NOW()
        RETURNING endpoint_id
      ),
      snapshot_upsert AS (
        INSERT INTO synapse_service_health_snapshots
          (service_id, endpoint_id, health_score, p95_latency_ms,
           last_checked_at, updated_at)
        VALUES (${sqlLiteral(serviceId)}, ${sqlLiteral(
      endpointId
    )}, 100, 50, NOW(), NOW())
        ON CONFLICT (service_id, endpoint_id) DO UPDATE SET
          health_score = 100,
          p95_latency_ms = 50,
          last_checked_at = NOW(),
          updated_at = NOW()
        RETURNING service_id
      ),
      runtime_upsert AS (
        INSERT INTO synapse_service_health_runtime (
          service_id, target_url, status, overall_status, http_status, latency_ms,
          consecutive_successes, consecutive_failures, probe_url,
          last_checked_at, last_healthy_at, timeout_ms, created_at, updated_at
        )
        VALUES (
          ${sqlLiteral(serviceId)}, ${sqlLiteral(targetUrl)}, 'healthy', 'healthy', 200, 50,
          3, 0, ${sqlLiteral(targetUrl.replace(/\/invoke$/, "/health"))},
          NOW(), NOW(), 30000, NOW(), NOW()
        )
        ON CONFLICT (service_id, target_url) DO UPDATE SET
          status = EXCLUDED.status,
          overall_status = EXCLUDED.overall_status,
          http_status = EXCLUDED.http_status,
          latency_ms = EXCLUDED.latency_ms,
          consecutive_successes = EXCLUDED.consecutive_successes,
          consecutive_failures = EXCLUDED.consecutive_failures,
          probe_url = EXCLUDED.probe_url,
          last_checked_at = EXCLUDED.last_checked_at,
          last_healthy_at = EXCLUDED.last_healthy_at,
          timeout_ms = EXCLUDED.timeout_ms,
          updated_at = NOW()
        RETURNING service_id
      )
      SELECT json_build_object('serviceId', ${sqlLiteral(
        serviceId
      )}, 'endpointId', ${sqlLiteral(endpointId)})
    `);
  }

  return { matureConsumerDeposits, matureProviderCharges, seedServiceHealth };
}
