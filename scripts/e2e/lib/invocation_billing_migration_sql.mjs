export function localLegacyFixtureSql(runId) {
  const safeRun = String(runId || "local")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48);
  return `
    WITH owner_upsert AS (
      INSERT INTO synapse_owner_accounts (owner_id, owner_wallet, display_name, status)
      VALUES ('owner_inv_billing_e2e', '0x0000000000000000000000000000000000000e2e', 'Invocation Billing E2E', 'active')
      ON CONFLICT (owner_id) DO UPDATE SET updated_at = NOW()
      RETURNING owner_id
    ),
    provider_upsert AS (
      INSERT INTO synapse_provider_profiles (provider_id, owner_id, display_name, status)
      VALUES ('provider_inv_billing_e2e', 'owner_inv_billing_e2e', 'Invocation Billing E2E Provider', 'active')
      ON CONFLICT (provider_id) DO UPDATE SET updated_at = NOW()
      RETURNING provider_id
    ),
    agent_upsert AS (
      INSERT INTO synapse_agent_profiles (agent_id, owner_id, name, status)
      VALUES ('agent_inv_billing_e2e', 'owner_inv_billing_e2e', 'Invocation Billing E2E Agent', 'active')
      ON CONFLICT (agent_id) DO UPDATE SET updated_at = NOW()
      RETURNING agent_id
    ),
    cred_upsert AS (
      INSERT INTO synapse_agent_credentials (credential_id, agent_id, secret_hash, secret_prefix, status)
      VALUES ('cred_inv_billing_e2e', 'agent_inv_billing_e2e', 'inv-billing-e2e-secret-hash', 'ibe2e', 'active')
      ON CONFLICT (credential_id) DO UPDATE SET status = 'active'
      RETURNING credential_id
    ),
    service_upsert AS (
      INSERT INTO synapse_service_manifests (
        service_id, owner_id, provider_id, service_name, manifest_version,
        status, description_for_model, price_model, base_price_usdc
      )
      VALUES (
        'svc_invocation_billing_e2e', 'owner_inv_billing_e2e', 'provider_inv_billing_e2e',
        'Invocation Billing E2E Fixture', '1.0.0', 'active',
        'Local-only invocation billing migration fixture.', 'fixed', 1.000000
      )
      ON CONFLICT (service_id) DO UPDATE SET status = 'active', updated_at = NOW()
      RETURNING service_id
    ),
    endpoint_upsert AS (
      INSERT INTO synapse_service_endpoints (endpoint_id, service_id, endpoint_url, is_primary, status)
      VALUES ('ep_invocation_billing_e2e', 'svc_invocation_billing_e2e', 'http://127.0.0.1:8100/health', true, 'active')
      ON CONFLICT (endpoint_id) DO UPDATE SET status = 'active', updated_at = NOW()
      RETURNING endpoint_id
    ),
    quote_fixed AS (
      INSERT INTO synapse_service_quotes (
        quote_id, service_id, credential_id, agent_id, quoted_price_usdc,
        price_model, status, request_fingerprint, expires_at
      )
      VALUES (
        'quote_inv_billing_fixed_${safeRun}', 'svc_invocation_billing_e2e', 'cred_inv_billing_e2e',
        'agent_inv_billing_e2e', 1.000000, 'fixed', 'CONSUMED',
        'inv-billing-fixed-${safeRun}', NOW() + INTERVAL '1 day'
      )
      ON CONFLICT (quote_id) DO UPDATE SET status = 'CONSUMED'
      RETURNING quote_id
    ),
    quote_llm AS (
      INSERT INTO synapse_service_quotes (
        quote_id, service_id, credential_id, agent_id, quoted_price_usdc,
        price_model, status, request_fingerprint, expires_at
      )
      VALUES (
        'quote_inv_billing_llm_${safeRun}', 'svc_invocation_billing_e2e', 'cred_inv_billing_e2e',
        'agent_inv_billing_e2e', 0.045000, 'token_metered', 'CONSUMED',
        'inv-billing-llm-${safeRun}', NOW() + INTERVAL '1 day'
      )
      ON CONFLICT (quote_id) DO UPDATE SET status = 'CONSUMED'
      RETURNING quote_id
    ),
    inv_fixed AS (
      INSERT INTO synapse_invocations (
        invocation_id, quote_id, service_id, endpoint_id, credential_id, agent_id,
        idempotency_key, request_digest, status, charged_usdc, started_at, finished_at
      )
      VALUES (
        'inv_billing_legacy_fixed_${safeRun}', 'quote_inv_billing_fixed_${safeRun}',
        'svc_invocation_billing_e2e', 'ep_invocation_billing_e2e', 'cred_inv_billing_e2e',
        'agent_inv_billing_e2e', 'idem_inv_billing_fixed_${safeRun}',
        'digest_inv_billing_fixed_${safeRun}', 'SUCCEEDED', 1.000000, NOW(), NOW()
      )
      ON CONFLICT (invocation_id) DO UPDATE SET charged_usdc = 1.000000, status = 'SUCCEEDED'
      RETURNING invocation_id
    ),
    inv_llm AS (
      INSERT INTO synapse_invocations (
        invocation_id, quote_id, service_id, endpoint_id, credential_id, agent_id,
        idempotency_key, request_digest, status, charged_usdc, started_at, finished_at
      )
      VALUES (
        'inv_billing_legacy_llm_${safeRun}', 'quote_inv_billing_llm_${safeRun}',
        'svc_invocation_billing_e2e', 'ep_invocation_billing_e2e', 'cred_inv_billing_e2e',
        'agent_inv_billing_e2e', 'idem_inv_billing_llm_${safeRun}',
        'digest_inv_billing_llm_${safeRun}', 'SETTLED', 0.045000, NOW(), NOW()
      )
      ON CONFLICT (invocation_id) DO UPDATE SET charged_usdc = 0.045000, status = 'SETTLED'
      RETURNING invocation_id
    )
    INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
    VALUES
      (
        'invocation_billing::inv_billing_legacy_fixed_${safeRun}',
        '{"businessType":"charge","totalCharge":"1.000000","unitPrice":"1.000000","protocolFee":"0.100000","routingTax":"0.000000"}'::jsonb,
        NOW()
      ),
      (
        'invocation_billing::inv_billing_legacy_llm_${safeRun}',
        '{"businessType":"token_metered","totalCharge":"0.045000","unitPrice":"0.045000","protocolFee":"0.004500","routingTax":"0.000000","usage":{"inputTokens":120,"outputTokens":40}}'::jsonb,
        NOW()
      )
    ON CONFLICT (state_key)
    DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
    RETURNING state_key;
  `;
}
