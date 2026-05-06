import crypto from "node:crypto";

function sqlLiteral(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function futureIso(seconds) {
  return new Date(
    Date.now() + 3650 * 24 * 60 * 60 * 1000 + seconds * 1000
  ).toISOString();
}

export function createAdminPaginationSortingFixture({ prefix, runId }) {
  const withdrawals = [
    {
      id: `${prefix}_wd_latest_yellow`,
      amount: "31.000000",
      risk: "yellow",
      createdAt: futureIso(30),
    },
    {
      id: `${prefix}_wd_mid_red`,
      amount: "22.000000",
      risk: "red",
      createdAt: futureIso(20),
    },
    {
      id: `${prefix}_wd_old_red`,
      amount: "13.000000",
      risk: "red",
      createdAt: futureIso(10),
    },
  ];
  const services = [
    {
      id: `${prefix}_svc_a`,
      name: `${prefix} Service A`,
      createdAt: futureIso(60),
      updatedAt: futureIso(1),
    },
    {
      id: `${prefix}_svc_b`,
      name: `${prefix} Service B`,
      createdAt: futureIso(60),
      updatedAt: futureIso(2),
    },
    {
      id: `${prefix}_svc_old_updated`,
      name: `${prefix} Old Updated`,
      createdAt: futureIso(40),
      updatedAt: futureIso(300),
    },
  ];
  const forumRows = [
    {
      topicId: `${prefix}_topic_latest`,
      taskId: `${prefix}_task_latest`,
      title: `${prefix} latest topic`,
      priority: "low",
      pinned: false,
      createdAt: futureIso(90),
      updatedAt: futureIso(4),
      lastActivityAt: futureIso(5),
    },
    {
      topicId: `${prefix}_topic_mid`,
      taskId: `${prefix}_task_mid`,
      title: `${prefix} mid topic`,
      priority: "normal",
      pinned: false,
      createdAt: futureIso(80),
      updatedAt: futureIso(6),
      lastActivityAt: futureIso(7),
    },
    {
      topicId: `${prefix}_topic_old_pinned`,
      taskId: `${prefix}_task_old_pinned`,
      title: `${prefix} old pinned topic`,
      priority: "critical",
      pinned: true,
      createdAt: futureIso(70),
      updatedAt: futureIso(400),
      lastActivityAt: futureIso(500),
    },
  ];

  function wallet(seed) {
    return `0x${crypto
      .createHash("sha1")
      .update(`${prefix}:${seed}`)
      .digest("hex")
      .slice(0, 40)}`;
  }

  function seedWithdrawals(psql) {
    const ownerId = `${prefix}_withdraw_owner`;
    const accountId = `${prefix}_withdraw_account`;
    psql(`
      INSERT INTO synapse_owner_accounts (owner_id, owner_wallet, display_name, status, created_at, updated_at)
      VALUES (${sqlLiteral(ownerId)}, ${sqlLiteral(
      wallet("withdraw-owner")
    )}, ${sqlLiteral(`${prefix} withdraw owner`)}, 'active', NOW(), NOW())
      ON CONFLICT (owner_id) DO UPDATE SET updated_at = NOW();
      INSERT INTO synapse_ledger_accounts (account_id, account_kind, owner_id, currency, status, created_at, updated_at)
      VALUES (${sqlLiteral(accountId)}, 'consumer_wallet', ${sqlLiteral(
      ownerId
    )}, 'USDC', 'active', NOW(), NOW())
      ON CONFLICT (account_id) DO UPDATE SET status = 'active', updated_at = NOW();
      ${withdrawals
        .map(
          (row) => `
        INSERT INTO synapse_vault_withdrawals (
          withdrawal_id, owner_id, source_account_id, withdrawal_kind, amount_usdc,
          status, request_id, created_at, updated_at
        ) VALUES (
          ${sqlLiteral(row.id)}, ${sqlLiteral(ownerId)}, ${sqlLiteral(
            accountId
          )},
          'consumer_refund', ${sqlLiteral(row.amount)}, 'PENDING_MANUAL_REVIEW',
          ${sqlLiteral(`${row.id}_request`)}, ${sqlLiteral(
            row.createdAt
          )}::timestamptz, ${sqlLiteral(row.createdAt)}::timestamptz
        )
        ON CONFLICT (withdrawal_id) DO UPDATE SET
          amount_usdc = EXCLUDED.amount_usdc,
          status = 'PENDING_MANUAL_REVIEW',
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at;
        INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
        VALUES (
          ${sqlLiteral(`vault_withdrawal_meta::${row.id}`)},
          jsonb_build_object(
            'flowStatus', 'PENDING_MANUAL_REVIEW',
            'requestId', ${sqlLiteral(`${row.id}_request`)},
            'riskLevel', ${sqlLiteral(row.risk)},
            'riskReasonCode', ${sqlLiteral(`${prefix}_sorting_check`)},
            'evidenceSummary', ${sqlLiteral(`Sort evidence ${row.id}`)}
          ),
          ${sqlLiteral(row.createdAt)}::timestamptz
        )
        ON CONFLICT (state_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;
      `
        )
        .join("\n")}
    `);
  }

  function seedServices(psql) {
    const ownerId = `${prefix}_service_owner`;
    const providerId = `${prefix}_provider`;
    psql(`
      INSERT INTO synapse_owner_accounts (owner_id, owner_wallet, display_name, status, created_at, updated_at)
      VALUES (${sqlLiteral(ownerId)}, ${sqlLiteral(
      wallet("service-owner")
    )}, ${sqlLiteral(`${prefix} provider owner`)}, 'active', NOW(), NOW())
      ON CONFLICT (owner_id) DO UPDATE SET updated_at = NOW();
      INSERT INTO synapse_provider_profiles (provider_id, owner_id, display_name, status, created_at, updated_at)
      VALUES (${sqlLiteral(providerId)}, ${sqlLiteral(ownerId)}, ${sqlLiteral(
      `${prefix} provider`
    )}, 'active', NOW(), NOW())
      ON CONFLICT (provider_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW();
      ${services
        .map(
          (row) => `
        INSERT INTO synapse_service_manifests (
          service_id, owner_id, provider_id, service_name, manifest_version, status,
          description_for_model, task_category, capabilities_json, input_schema,
          output_schema, examples_json, limitations_json, price_model,
          base_price_usdc, quote_required, settlement_currency, created_at, updated_at
        ) VALUES (
          ${sqlLiteral(row.id)}, ${sqlLiteral(ownerId)}, ${sqlLiteral(
            providerId
          )},
          ${sqlLiteral(row.name)}, '1', 'active', ${sqlLiteral(
            `${prefix} sorting summary ${row.id}`
          )},
          'admin_sorting', '["admin-sort"]'::jsonb, '{}'::jsonb, '{}'::jsonb,
          '[]'::jsonb, '[]'::jsonb, 'fixed', '1.000000', TRUE, 'USDC',
          ${sqlLiteral(row.createdAt)}::timestamptz, ${sqlLiteral(
            row.updatedAt
          )}::timestamptz
        )
        ON CONFLICT (service_id) DO UPDATE SET
          service_name = EXCLUDED.service_name,
          status = 'active',
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at;
        INSERT INTO synapse_service_endpoints (
          endpoint_id, service_id, endpoint_url, auth_mode, timeout_ms,
          max_payload_bytes, weight, is_primary, status, created_at, updated_at
        ) VALUES (
          ${sqlLiteral(`${row.id}_endpoint`)}, ${sqlLiteral(row.id)},
          ${sqlLiteral(
            `https://provider.test/${row.id}/invoke`
          )}, 'gateway_signed',
          15000, 4194304, 100, TRUE, 'active',
          ${sqlLiteral(row.createdAt)}::timestamptz, ${sqlLiteral(
            row.updatedAt
          )}::timestamptz
        )
        ON CONFLICT (endpoint_id) DO UPDATE SET status = 'active', updated_at = EXCLUDED.updated_at;
        INSERT INTO synapse_service_search_index (service_id, tags_json, search_text, updated_at)
        VALUES (${sqlLiteral(row.id)}, '["admin-sort"]'::jsonb, ${sqlLiteral(
            `${row.id} ${row.name} ${prefix}`
          )}, ${sqlLiteral(row.updatedAt)}::timestamptz)
        ON CONFLICT (service_id) DO UPDATE SET tags_json = EXCLUDED.tags_json, search_text = EXCLUDED.search_text, updated_at = EXCLUDED.updated_at;
        INSERT INTO synapse_runtime_state (state_key, payload, updated_at)
        VALUES (${sqlLiteral(
          `service_meta::${row.id}`
        )}, jsonb_build_object('lifecycleStatus', 'active'), ${sqlLiteral(
            row.updatedAt
          )}::timestamptz)
        ON CONFLICT (state_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at;
      `
        )
        .join("\n")}
    `);
  }

  function seedForum(psql) {
    psql(
      forumRows
        .map(
          (row) => `
      INSERT INTO synapse_forum_topics (
        topic_id, title, body, excerpt, category, author_address, author_display,
        author_roles, status, resolved, locked, pinned, views_count, replies_count,
        reactions_count, last_activity_at, created_at, updated_at
      ) VALUES (
        ${sqlLiteral(row.topicId)}, ${sqlLiteral(row.title)}, ${sqlLiteral(
            `Body for ${row.title}`
          )},
        ${sqlLiteral(`Excerpt for ${row.title}`)}, 'Bugs', ${sqlLiteral(
            wallet(row.topicId)
          )},
        'Admin Sorting E2E', ARRAY['Builder'], 'open', FALSE, FALSE, ${
          row.pinned ? "TRUE" : "FALSE"
        },
        0, 0, 0, ${sqlLiteral(row.lastActivityAt)}::timestamptz,
        ${sqlLiteral(row.createdAt)}::timestamptz, ${sqlLiteral(
            row.updatedAt
          )}::timestamptz
      )
      ON CONFLICT (topic_id) DO UPDATE SET
        title = EXCLUDED.title,
        pinned = EXCLUDED.pinned,
        last_activity_at = EXCLUDED.last_activity_at,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at;
      INSERT INTO synapse_forum_response_tasks (
        response_task_id, topic_id, status, source, priority, classification,
        suggested_reply, suggested_reply_source, suggested_reply_updated_at,
        metadata_json, created_at, updated_at
      ) VALUES (
        ${sqlLiteral(row.taskId)}, ${sqlLiteral(row.topicId)}, 'draft_ready',
        'growing_agent', ${sqlLiteral(row.priority)}, 'bug',
        ${sqlLiteral(`Suggested reply for ${row.taskId}`)}, 'admin_sorting_e2e',
        ${sqlLiteral(row.updatedAt)}::timestamptz,
        jsonb_build_object('runId', ${sqlLiteral(runId)}),
        ${sqlLiteral(row.createdAt)}::timestamptz, ${sqlLiteral(
            row.updatedAt
          )}::timestamptz
      )
      ON CONFLICT (response_task_id) DO UPDATE SET
        status = 'draft_ready',
        priority = EXCLUDED.priority,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at;
    `
        )
        .join("\n")
    );
  }

  return {
    forumRows,
    seedData(psql) {
      seedWithdrawals(psql);
      seedServices(psql);
      seedForum(psql);
    },
    services,
    withdrawals,
  };
}
