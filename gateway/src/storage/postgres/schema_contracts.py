from __future__ import annotations

from dataclasses import dataclass


PRIMARY_KEY_FRAGMENT = "primary key"


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
        required_columns=frozenset({"owner_id", "owner_wallet", "status", "default_currency", "created_at", "updated_at"}),
        required_constraints=(
            _constraint("primary key on owner_id", PRIMARY_KEY_FRAGMENT, "owner_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_seller_profiles",
        required_columns=frozenset({"seller_id", "owner_wallet", "display_name", "status", "created_at", "updated_at"}),
        required_constraints=(
            _constraint("primary key on seller_id", PRIMARY_KEY_FRAGMENT, "seller_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_agent_profiles",
        required_columns=frozenset({"agent_id", "owner_id", "name", "purpose", "status", "runtime_label", "created_at", "updated_at"}),
        required_constraints=(
            _constraint("primary key on agent_id", PRIMARY_KEY_FRAGMENT, "agent_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_agent_credentials",
        required_columns=frozenset({"credential_id", "agent_id", "secret_hash", "secret_prefix", "status", "issued_at", "expires_at", "revoked_at", "last_used_at"}),
        required_indexes=frozenset({"idx_synapse_agent_credentials_agent"}),
        required_constraints=(
            _constraint("primary key on credential_id", PRIMARY_KEY_FRAGMENT, "credential_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_budget_policies",
        required_columns=frozenset({"policy_id", "credential_id", "lifetime_cap_usdc", "daily_cap_usdc", "per_invocation_cap_usdc", "rpm_limit", "qps_limit", "allowed_service_tags", "allowed_service_ids", "blocked_service_ids", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_budget_policies_credential"}),
        required_constraints=(
            _constraint("primary key on policy_id", PRIMARY_KEY_FRAGMENT, "policy_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_service_manifests",
        required_columns=frozenset({"service_id", "seller_id", "service_name", "manifest_version", "status", "description_for_model", "task_category", "capabilities_json", "input_schema", "output_schema", "examples_json", "limitations_json", "price_model", "base_price_usdc", "quote_required", "settlement_currency", "created_at", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_service_manifests_status"}),
        required_constraints=(
            _constraint("primary key on service_id", PRIMARY_KEY_FRAGMENT, "service_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_service_endpoints",
        required_columns=frozenset({"endpoint_id", "service_id", "endpoint_url", "auth_mode", "timeout_ms", "max_payload_bytes", "streaming_supported", "async_supported", "callback_supported", "region", "weight", "is_primary", "status", "created_at", "updated_at"}),
        required_constraints=(
            _constraint("primary key on endpoint_id", PRIMARY_KEY_FRAGMENT, "endpoint_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_service_health_snapshots",
        required_columns=frozenset({"service_id", "endpoint_id", "health_score", "p95_latency_ms", "success_rate_24h", "last_checked_at", "error_code", "updated_at"}),
        required_constraints=(
            _constraint("primary key on service_id endpoint_id", PRIMARY_KEY_FRAGMENT, "service_id", "endpoint_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_service_search_index",
        required_columns=frozenset({"service_id", "tags_json", "search_text", "embedding_ref", "reliability_tier", "health_score", "p95_latency_ms", "success_rate_24h", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_service_search_index_tags_gin"}),
        required_constraints=(
            _constraint("primary key on service_id", PRIMARY_KEY_FRAGMENT, "service_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_audit_events",
        required_columns=frozenset({"event_id", "event_type", "business_type", "owner_id", "agent_id", "credential_id", "service_id", "quote_id", "invocation_id", "amount_delta", "result_status", "error_code", "detail_json", "created_at"}),
        required_indexes=frozenset({"idx_synapse_audit_events_owner_created"}),
        required_constraints=(
            _constraint("primary key on event_id", PRIMARY_KEY_FRAGMENT, "event_id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_idempotency_keys",
        required_columns=frozenset({"id", "scope", "owner_id", "idempotency_key", "request_hash", "response_code", "response_digest", "created_at", "expires_at"}),
        required_indexes=frozenset({"idx_synapse_idempotency_keys_expires"}),
        required_constraints=(
            _constraint("primary key on id", PRIMARY_KEY_FRAGMENT, "id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_runtime_state",
        required_columns=frozenset({"state_key", "payload", "updated_at"}),
        required_indexes=frozenset({"idx_synapse_runtime_state_updated_at"}),
        required_constraints=(
            _constraint("primary key on state_key", PRIMARY_KEY_FRAGMENT, "state_key"),
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
)
