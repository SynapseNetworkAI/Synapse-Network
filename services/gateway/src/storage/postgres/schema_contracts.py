from __future__ import annotations

from dataclasses import dataclass


PRIMARY_KEY_FRAGMENT = "primary key"
WITHDRAWAL_STATUS_CHECK_FRAGMENT = (
    "check (status in ('REQUESTED', 'SIGNED', 'FAILED', "
    "'APPROVED_AUTO', 'PENDING_MANUAL_REVIEW', 'REJECTED', 'COMPLETED', 'CANCELLED'))"
)
WITHDRAWAL_STATUS_CHECK_REQUIRED_FRAGMENTS = (
    "status",
    "'REQUESTED'::text",
    "'SIGNED'::text",
    "'FAILED'::text",
    "'APPROVED_AUTO'::text",
    "'PENDING_MANUAL_REVIEW'::text",
    "'REJECTED'::text",
    "'COMPLETED'::text",
    "'CANCELLED'::text",
)


@dataclass(frozen=True)
class ConstraintContract:
    description: str
    required_fragments: tuple[str, ...]


@dataclass(frozen=True)
class TableSchemaContract:
    table_name: str
    required_columns: frozenset[str]
    required_indexes: frozenset[str] = frozenset()
    required_constraints: tuple[ConstraintContract, ...] = ()


def _constraint(description: str, *required_fragments: str) -> ConstraintContract:
    return ConstraintContract(
        description=description,
        required_fragments=tuple(required_fragments),
    )


POSTGRES_TABLE_SCHEMA_CONTRACTS: tuple[TableSchemaContract, ...] = (
    TableSchemaContract(
        table_name="synapse_owner_accounts",
        required_columns=frozenset(
            {
                "id",
                "owner_id",
                "owner_wallet",
                "display_name",
                "email",
                "email_verified",
                "notify_marketing",
                "notify_alerts",
                "status",
                "default_currency",
                "created_at",
                "updated_at",
            }
        ),
        required_indexes=frozenset({"idx_synapse_owner_accounts_email_unique"}),
        required_constraints=(
            _constraint("primary key on owner_id", PRIMARY_KEY_FRAGMENT, "owner_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_provider_profiles",
        required_columns=frozenset({"id", "provider_id", "owner_id", "display_name", "status", "created_at", "updated_at"}),
        required_constraints=(
            _constraint("primary key on provider_id", PRIMARY_KEY_FRAGMENT, "provider_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_agent_profiles",
        required_columns=frozenset({"id", "agent_id", "owner_id", "name", "purpose", "status", "runtime_label", "created_at", "updated_at"}),
        required_constraints=(
            _constraint("primary key on agent_id", PRIMARY_KEY_FRAGMENT, "agent_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_agent_credentials",
        required_columns=frozenset({"id", "credential_id", "agent_id", "secret_hash", "secret_prefix", "status", "issued_at", "expires_at", "revoked_at", "last_used_at"}),
        required_indexes=frozenset({"idx_synapse_agent_credentials_agent"}),
        required_constraints=(
            _constraint("primary key on credential_id", PRIMARY_KEY_FRAGMENT, "credential_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_budget_policies",
        required_columns=frozenset({"id", "policy_id", "credential_id", "lifetime_cap_usdc", "daily_cap_usdc", "per_invocation_cap_usdc", "rpm_limit", "qps_limit", "allowed_service_tags", "allowed_service_ids", "blocked_service_ids", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_budget_policies_credential"}),
        required_constraints=(
            _constraint("primary key on policy_id", PRIMARY_KEY_FRAGMENT, "policy_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_service_manifests",
        required_columns=frozenset({"id", "service_id", "owner_id", "provider_id", "service_name", "manifest_version", "status", "description_for_model", "task_category", "capabilities_json", "input_schema", "output_schema", "examples_json", "limitations_json", "price_model", "base_price_usdc", "quote_required", "settlement_currency", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_service_manifests_status"}),
        required_constraints=(
            _constraint("primary key on service_id", PRIMARY_KEY_FRAGMENT, "service_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_service_endpoints",
        required_columns=frozenset({"id", "endpoint_id", "service_id", "endpoint_url", "auth_mode", "timeout_ms", "max_payload_bytes", "streaming_supported", "async_supported", "callback_supported", "region", "weight", "is_primary", "status", "created_at", "updated_at"}),
        required_constraints=(
            _constraint("primary key on endpoint_id", PRIMARY_KEY_FRAGMENT, "endpoint_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_service_health_snapshots",
        required_columns=frozenset({"id", "service_id", "endpoint_id", "health_score", "p95_latency_ms", "success_rate_24h", "last_checked_at", "error_code", "updated_at"}),
        required_constraints=(
            _constraint("primary key on service_id endpoint_id", PRIMARY_KEY_FRAGMENT, "service_id", "endpoint_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_service_search_index",
        required_columns=frozenset({"id", "service_id", "tags_json", "search_text", "embedding_ref", "reliability_tier", "health_score", "p95_latency_ms", "success_rate_24h", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_service_search_index_tags_gin"}),
        required_constraints=(
            _constraint("primary key on service_id", PRIMARY_KEY_FRAGMENT, "service_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_service_quotes",
        required_columns=frozenset({"id", "quote_id", "service_id", "credential_id", "agent_id", "quoted_price_usdc", "price_model", "status", "request_fingerprint", "response_mode", "invoke_constraints", "expires_at", "created_at"}),
        required_constraints=(
            _constraint("primary key on quote_id", PRIMARY_KEY_FRAGMENT, "quote_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_invocations",
        required_columns=frozenset({"id", "invocation_id", "quote_id", "service_id", "endpoint_id", "credential_id", "agent_id", "idempotency_key", "request_digest", "response_mode", "status", "charged_usdc", "error_code", "error_action", "upstream_status", "result_digest", "result_json", "started_at", "finished_at", "created_at", "updated_at"}),
        required_constraints=(
            _constraint("primary key on invocation_id", PRIMARY_KEY_FRAGMENT, "invocation_id"),
            _constraint("unique credential idempotency key", "unique", "credential_id", "idempotency_key"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_audit_events",
        required_columns=frozenset({"id", "event_id", "event_type", "business_type", "owner_id", "agent_id", "credential_id", "service_id", "quote_id", "invocation_id", "amount_delta", "result_status", "error_code", "detail_json", "created_at"}),
        required_indexes=frozenset({"idx_synapse_audit_events_owner_created"}),
        required_constraints=(
            _constraint("primary key on event_id", PRIMARY_KEY_FRAGMENT, "event_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_idempotency_keys",
        required_columns=frozenset({"row_id", "id", "scope", "owner_id", "idempotency_key", "request_hash", "response_code", "response_digest", "created_at", "expires_at"}),
        required_indexes=frozenset({"idx_synapse_idempotency_keys_expires"}),
        required_constraints=(
            _constraint("primary key on id", PRIMARY_KEY_FRAGMENT, "id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_finance_rate_limit",
        required_columns=frozenset({"row_id", "id", "owner_id", "action", "window_start", "count", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_finance_rate_limit_owner_action"}),
        required_constraints=(
            _constraint("primary key on finance rate limit id", PRIMARY_KEY_FRAGMENT, "id"),
            _constraint("unique owner action window row", "unique", "owner_id", "action"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_runtime_state",
        required_columns=frozenset({"id", "state_key", "payload", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_runtime_state_updated_at"}),
        required_constraints=(
            _constraint("primary key on state_key", PRIMARY_KEY_FRAGMENT, "state_key"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_processed_deposit_events",
        required_columns=frozenset({"id", "dedup_key", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_processed_deposit_events_updated_at"}),
        required_constraints=(
            _constraint("primary key on dedup_key", PRIMARY_KEY_FRAGMENT, "dedup_key"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_vault_deposits",
        required_columns=frozenset({"id", "deposit_id", "owner_id", "owner_address", "target_account_id", "tx_hash", "amount_usdc", "status", "block_number", "request_id", "client_request_id", "client_ip", "user_agent", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_vault_deposits_owner_created", "idx_synapse_vault_deposits_owner_address_created"}),
        required_constraints=(
            _constraint("primary key on deposit_id", PRIMARY_KEY_FRAGMENT, "deposit_id"),
            _constraint("unique tx hash for deposits", "unique", "tx_hash"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_vault_withdrawals",
        required_columns=frozenset({"id", "withdrawal_id", "owner_id", "provider_id", "source_account_id", "withdrawal_kind", "tx_hash", "amount_usdc", "status", "request_id", "signature", "nonce", "deadline", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_vault_withdrawals_kind_owner"}),
        required_constraints=(
            _constraint("primary key on withdrawal_id", PRIMARY_KEY_FRAGMENT, "withdrawal_id"),
            _constraint(
                "withdrawal status check supports current lifecycle",
                *WITHDRAWAL_STATUS_CHECK_REQUIRED_FRAGMENTS,
            ),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_deposit_attempts",
        required_columns=frozenset({"id", "attempt_id", "owner_id", "owner_address", "client_request_id", "tx_hash", "amount_usdc", "stage", "failure_reason", "request_id", "client_ip", "user_agent", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_deposit_attempts_owner", "idx_synapse_deposit_attempts_tx_hash", "idx_synapse_deposit_attempts_stage"}),
        required_constraints=(
            _constraint("primary key on deposit attempts id", PRIMARY_KEY_FRAGMENT, "id"),
            _constraint("unique attempt stage per attempt_id", "unique", "attempt_id", "stage"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_platform_fee_policy_default",
        required_columns=frozenset({"id", "singleton_id", "default_rate", "updated_at", "updated_by"}),
        required_constraints=(
            _constraint("primary key on fee policy default id", PRIMARY_KEY_FRAGMENT, "id"),
            _constraint("unique singleton row", "unique", "singleton_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_platform_fee_policy_owner",
        required_columns=frozenset({"id", "owner_address", "fee_rate", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_platform_fee_policy_owner_address"}),
        required_constraints=(
            _constraint("primary key on fee policy owner id", PRIMARY_KEY_FRAGMENT, "id"),
            _constraint("unique owner address fee policy row", "unique", "owner_address"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_credit_voucher_campaigns",
        required_columns=frozenset(
            {
                "id",
                "campaign_id",
                "campaign_code",
                "display_name",
                "status",
                "credit_amount_usdc",
                "starts_at",
                "expires_at",
                "max_total_redemptions",
                "max_redemptions_per_owner",
                "allowlist_mode",
                "notes",
                "created_by",
                "created_at",
                "updated_at",
            }
        ),
        required_indexes=frozenset({"idx_voucher_campaign_status_window"}),
        required_constraints=(
            _constraint("primary key on campaign_id", PRIMARY_KEY_FRAGMENT, "campaign_id"),
            _constraint("unique campaign_code", "unique", "campaign_code"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_credit_voucher_codes",
        required_columns=frozenset(
            {
                "id",
                "voucher_code_id",
                "campaign_id",
                "code_hash",
                "code_last4",
                "status",
                "owner_id_redeemed",
                "redeemed_by_address",
                "redeemed_at",
                "redemption_id",
                "created_at",
                "updated_at",
            }
        ),
        required_indexes=frozenset({"idx_voucher_codes_campaign_status"}),
        required_constraints=(
            _constraint("primary key on voucher_code_id", PRIMARY_KEY_FRAGMENT, "voucher_code_id"),
            _constraint("unique code_hash", "unique", "code_hash"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_credit_voucher_owner_allowlist",
        required_columns=frozenset({"id", "campaign_id", "owner_id", "created_at", "updated_at"}),
        required_constraints=(
            _constraint("unique owner allowlist row", "unique", "campaign_id", "owner_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_credit_voucher_redemptions",
        required_columns=frozenset(
            {
                "id",
                "redemption_id",
                "voucher_code_id",
                "campaign_id",
                "owner_id",
                "owner_address",
                "target_account_id",
                "promo_account_id",
                "ledger_entry_id",
                "granted_amount_usdc",
                "before_balance_usdc",
                "after_balance_usdc",
                "status",
                "request_id",
                "client_request_id",
                "request_hash",
                "client_ip",
                "user_agent",
                "failure_code",
                "failure_reason",
                "created_at",
                "updated_at",
            }
        ),
        required_indexes=frozenset(
            {
                "idx_voucher_redemptions_owner_created",
                "idx_voucher_redemptions_campaign_created",
                "uq_voucher_redemptions_code_live",
                "uq_voucher_redemptions_owner_client_request",
            }
        ),
        required_constraints=(
            _constraint("primary key on redemption_id", PRIMARY_KEY_FRAGMENT, "redemption_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_provider_risk_flags",
        required_columns=frozenset({"id", "owner_address", "is_high_risk", "risk_reason_code", "risk_level", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_provider_risk_flags_high_risk"}),
        required_constraints=(
            _constraint("primary key on provider risk flag id", PRIMARY_KEY_FRAGMENT, "id"),
            _constraint("unique owner address risk flag row", "unique", "owner_address"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_withdraw_tx_dedup",
        required_columns=frozenset({"id", "owner_address", "tx_hash", "kind", "created_at"}),
        required_indexes=frozenset({"idx_synapse_withdraw_tx_dedup_lookup"}),
        required_constraints=(
            _constraint("primary key on withdraw tx dedup id", PRIMARY_KEY_FRAGMENT, "id"),
            _constraint("unique owner tx hash kind row", "unique", "owner_address", "tx_hash", "kind"),
        ),
    ),

    TableSchemaContract(
        table_name="synapse_owner_spend_limits",
        required_columns=frozenset({"id", "owner_address", "spending_limit_usdc", "cycle_interval", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_owner_spend_limits_updated_at"}),
        required_constraints=(
            _constraint("primary key on owner spend limit id", PRIMARY_KEY_FRAGMENT, "id"),
            _constraint("unique owner address spend limit row", "unique", "owner_address"),
            _constraint("monthly cycle interval check", "check", "cycle_interval", "monthly"),
        ),
    ),
)
