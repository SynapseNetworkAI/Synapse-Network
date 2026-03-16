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
        table_name="synapse_balances",
        required_columns=frozenset(
            {
                "owner_address",
                "account_type",
                "available_balance",
                "pending_balance",
                "frozen_balance",
                "updated_at",
            }
        ),
        required_constraints=(
            _constraint(
                "primary key on owner_address + account_type",
                PRIMARY_KEY_FRAGMENT,
                "owner_address",
                "account_type",
            ),
            _constraint(
                "account_type whitelist check",
                "check",
                "account_type",
                "buyer",
                "seller",
                "platform_fee",
            ),
            _constraint(
                "available_balance non-negative check",
                "check",
                "available_balance",
                "0",
            ),
            _constraint(
                "pending_balance non-negative check",
                "check",
                "pending_balance",
                "0",
            ),
            _constraint(
                "frozen_balance non-negative check",
                "check",
                "frozen_balance",
                "0",
            ),
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
        table_name="synapse_service_registry",
        required_columns=frozenset(
            {
                "service_id",
                "record_id",
                "owner_address",
                "service_name",
                "service_role",
                "service_address",
                "summary",
                "endpoint",
                "status",
                "is_active",
                "pricing_amount",
                "tags_json",
                "auth_json",
                "health_check_json",
                "forwarding_json",
                "metering_json",
                "invoke_config",
                "pricing_currency",
                "schema_version",
                "timeout_ms",
                "max_qps",
                "max_request_bytes",
                "max_response_bytes",
                "created_at",
                "updated_at",
            }
        ),
        required_indexes=frozenset(
            {
                "idx_synapse_service_registry_owner",
                "idx_synapse_service_registry_active",
                "idx_synapse_service_registry_tags_gin",
                "idx_synapse_service_registry_invoke_gin",
            }
        ),
        required_constraints=(
            _constraint("primary key on service_id", PRIMARY_KEY_FRAGMENT, "service_id"),
            _constraint(
                "service status whitelist check",
                "check",
                "status",
                "active",
                "inactive",
                "archived",
            ),
            _constraint(
                "pricing_amount non-negative check",
                "check",
                "pricing_amount",
                "0",
            ),
            _constraint(
                "timeout_ms bounded check",
                "check",
                "timeout_ms",
                "300",
                "15000",
            ),
            _constraint(
                "max_qps bounded check",
                "check",
                "max_qps",
                "1",
                "200",
            ),
            _constraint(
                "max_request_bytes bounded check",
                "check",
                "max_request_bytes",
                "256",
                "262144",
            ),
            _constraint(
                "max_response_bytes bounded check",
                "check",
                "max_response_bytes",
                "256",
                "1048576",
            ),
            _constraint(
                "tags_json array check",
                "check",
                "jsonb_typeof",
                "tags_json",
                "array",
            ),
            _constraint(
                "auth_json object check",
                "check",
                "jsonb_typeof",
                "auth_json",
                "object",
            ),
            _constraint(
                "health_check_json object check",
                "check",
                "jsonb_typeof",
                "health_check_json",
                "object",
            ),
            _constraint(
                "forwarding_json object check",
                "check",
                "jsonb_typeof",
                "forwarding_json",
                "object",
            ),
            _constraint(
                "metering_json object check",
                "check",
                "jsonb_typeof",
                "metering_json",
                "object",
            ),
            _constraint(
                "invoke_config object check",
                "check",
                "jsonb_typeof",
                "invoke_config",
                "object",
            ),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_audit_log",
        required_columns=frozenset(
            {
                "action_type",
                "business_type",
                "risk_level",
                "owner_address",
                "actor",
                "request_id",
                "trace_id",
                "tx_hash",
                "counterparty_address",
                "direction",
                "status",
                "risk_reason_code",
                "ledger_id",
                "client_ip",
                "user_agent",
                "amount_delta",
                "before_balance",
                "after_balance",
                "result_status",
                "error_code",
                "message",
                "created_at",
            }
        ),
        required_indexes=frozenset(
            {
                "idx_synapse_audit_log_created_at",
                "idx_synapse_audit_log_owner",
                "idx_synapse_audit_log_request_id",
                "idx_synapse_audit_log_tx_hash",
            }
        ),
        required_constraints=(
            _constraint("primary key on audit_log id", PRIMARY_KEY_FRAGMENT, "id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_system_activity_log",
        required_columns=frozenset(
            {
                "action_type",
                "owner_address",
                "actor",
                "request_id",
                "trace_id",
                "resource_type",
                "resource_id",
                "result_status",
                "error_code",
                "ip_address",
                "user_agent",
                "detail_json",
                "created_at",
            }
        ),
        required_indexes=frozenset(
            {
                "idx_synapse_system_activity_created_at",
                "idx_synapse_system_activity_owner",
                "idx_synapse_system_activity_action",
                "idx_synapse_system_activity_request_id",
            }
        ),
        required_constraints=(
            _constraint("primary key on system_activity id", PRIMARY_KEY_FRAGMENT, "id"),
        ),
    ),
    TableSchemaContract(
        table_name="synapse_deposit_attempts",
        required_columns=frozenset(
            {
                "attempt_id",
                "owner_address",
                "client_request_id",
                "tx_hash",
                "amount_usdc",
                "stage",
                "failure_reason",
                "request_id",
                "client_ip",
                "user_agent",
                "created_at",
                "updated_at",
            }
        ),
        required_indexes=frozenset(
            {
                "idx_synapse_deposit_attempts_owner",
                "idx_synapse_deposit_attempts_tx_hash",
                "idx_synapse_deposit_attempts_stage",
            }
        ),
        required_constraints=(
            _constraint("primary key on deposit_attempts id", PRIMARY_KEY_FRAGMENT, "id"),
            _constraint(
                "unique attempt stage per attempt_id",
                "unique",
                "attempt_id",
                "stage",
            ),
            _constraint(
                "amount_usdc positive check",
                "check",
                "amount_usdc",
                "0",
            ),
            _constraint(
                "stage whitelist check",
                "check",
                "stage",
                "sign_requested",
                "tx_broadcasted",
                "receipt_failed",
                "receipt_confirmed",
                "intent_registered",
            ),
        ),
    ),
)